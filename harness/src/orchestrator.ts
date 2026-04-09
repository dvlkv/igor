import { exec } from "node:child_process";
import type {
  ChannelAdapter,
  IncomingMessage,
  TaskAssignment,
  TaskSession,
} from "./types.js";
import { StateStore } from "./state.js";
import { ClaudeSessionManager } from "./session-manager.js";
import { MemoryIngestion } from "./memory-ingestion.js";
import type { TelegramAdapter } from "./adapters/telegram.js";
import { toolDisplayName } from "./tool-display.js";

export interface OrchestratorOptions {
  adapters: ChannelAdapter[];
  telegram?: TelegramAdapter;
  stateStore: StateStore;
  sessionManager: ClaudeSessionManager;
  memoryIngestion: MemoryIngestion;
  worktreeDir: string;
  generalProjectDir: string;
  generalClaudeArgs: string[];
  generalSystemPrompt?: string;
}

function run(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout.trim());
    });
  });
}

export class Orchestrator {
  static readonly GENERAL_SESSION = "igor-general";

  private adapters: ChannelAdapter[];
  private telegram?: TelegramAdapter;
  private stateStore: StateStore;
  private sessionManager: ClaudeSessionManager;
  private memoryIngestion: MemoryIngestion;
  private worktreeDir: string;
  private generalProjectDir: string;
  private generalClaudeArgs: string[];
  private generalSystemPrompt?: string;
  private replyContext = new Map<
    string,
    { adapter: string; threadId: string }
  >();
  private progressMessages = new Map<
    string,
    { threadId: string; messageId: number }
  >();

  constructor(opts: OrchestratorOptions) {
    this.adapters = opts.adapters;
    this.telegram = opts.telegram;
    this.stateStore = opts.stateStore;
    this.sessionManager = opts.sessionManager;
    this.memoryIngestion = opts.memoryIngestion;
    this.worktreeDir = opts.worktreeDir;
    this.generalProjectDir = opts.generalProjectDir;
    this.generalClaudeArgs = opts.generalClaudeArgs;
    this.generalSystemPrompt = opts.generalSystemPrompt;

    for (const adapter of this.adapters) {
      adapter.onMessage((msg) => this.handleMessage(msg));
      adapter.onTaskAssigned((task) => this.handleTaskAssignment(task));
    }

    // Route tool_use events as progress messages
    this.sessionManager.onToolUse((sessionId, toolName, input) => {
      void this.handleToolUse(sessionId, toolName, input);
    });

    // Route assistant text as progress updates
    this.sessionManager.onAssistantText((sessionId, text) => {
      void this.handleAssistantText(sessionId, text);
    });

    // Route Claude JSON output back to adapters
    this.sessionManager.onOutput((sessionId, text) => {
      const ctx = this.replyContext.get(sessionId);
      if (ctx) {
        console.log(
          `[output] session="${sessionId}" → ${ctx.adapter} thread="${ctx.threadId}" text="${text.slice(0, 200)}"`,
        );
        const progress = this.progressMessages.get(sessionId);
        if (progress && this.telegram?.deleteMessage) {
          void this.telegram.deleteMessage(progress.messageId);
          this.progressMessages.delete(sessionId);
        }
        const adapter = this.adapters.find((a) => a.name === ctx.adapter);
        if (adapter?.sendMessage) {
          void adapter.sendMessage(ctx.threadId, text);
        }
      } else {
        console.log(
          `[output] session="${sessionId}" — no reply context, dropping`,
        );
      }
    });
  }

  async startGeneralSession(): Promise<void> {
    if (this.sessionManager.isAlive(Orchestrator.GENERAL_SESSION)) {
      console.log("General session already running");
      return;
    }
    await this.sessionManager.createSession({
      name: Orchestrator.GENERAL_SESSION,
      worktreePath: this.generalProjectDir,
      prompt: "",
      systemPrompt: this.generalSystemPrompt,
      claudeArgs: this.generalClaudeArgs,
    });
    console.log("General session started");

    if (this.telegram?.sendMessage) {
      const activeAdapters = this.adapters.map((a) => a.name).join(", ");
      const activeTasks = this.stateStore.getActive().length;
      const lines = [
        "⚙️ Harness started",
        `PID: ${process.pid}`,
        `Adapters: ${activeAdapters}`,
        `Project: ${this.generalProjectDir}`,
        `Active tasks: ${activeTasks}`,
      ];
      await this.telegram.sendMessage("general", lines.join("\n"));
    }
  }

  async clearGeneralSession(): Promise<void> {
    try {
      await this.sessionManager.killSession(Orchestrator.GENERAL_SESSION);
    } catch {
      // session may not exist
    }
    this.replyContext.delete(Orchestrator.GENERAL_SESSION);
    await this.startGeneralSession();
    console.log("General session cleared and restarted");
  }

  async handleTaskAssignment(task: TaskAssignment): Promise<void> {
    console.log(`[task:${task.source}] ${task.title}`);
    const sanitizedId = task.taskId.replace(/[^a-zA-Z0-9-]/g, "-");
    const branch = `igor/${sanitizedId}`;
    const worktreePath = `${this.worktreeDir}/${sanitizedId}`;

    await run(`git worktree add ${worktreePath} -b ${branch}`);

    let telegramThreadId = "";
    if (this.telegram?.createThread) {
      telegramThreadId = await this.telegram.createThread(
        `Task: ${task.title}`,
      );
    }

    const sessionId = sanitizedId;
    const pid = await this.sessionManager.createSession({
      name: sessionId,
      worktreePath,
      prompt: task.description,
    });

    const session: TaskSession = {
      taskId: task.taskId,
      source: task.source,
      title: task.title,
      url: task.url,
      worktreePath,
      branch,
      sessionId,
      telegramThreadId,
      status: "active",
      createdAt: new Date().toISOString(),
      claudePid: pid,
    };

    this.stateStore.save(session);

    if (this.telegram?.sendMessage && telegramThreadId) {
      // Set reply context for task sessions
      this.replyContext.set(sessionId, {
        adapter: "telegram",
        threadId: telegramThreadId,
      });
      await this.telegram.sendMessage(
        telegramThreadId,
        `Started working on: ${task.title}`,
      );
    }
  }

  handleMessage(msg: IncomingMessage): void {
    console.log(`[${msg.channelType}] ${msg.author}: ${msg.text}`);
    const project = (msg.metadata.project as string) || msg.channelType;
    this.memoryIngestion.buffer(project, msg);

    if (msg.channelType === "telegram") {
      const session = this.stateStore.findByTelegramThread(msg.threadId);

      const targetSession =
        session?.status === "active"
          ? session.sessionId
          : msg.threadId === "general"
            ? Orchestrator.GENERAL_SESSION
            : null;

      if (!targetSession) {
        console.log(
          `[route] DROPPED: no target session for threadId="${msg.threadId}"`,
        );
        return;
      }

      // Set reply context so output routes back to the right place
      this.replyContext.set(targetSession, {
        adapter: "telegram",
        threadId: msg.threadId,
      });

      void this.ensureSessionAlive(targetSession).then(() => {
        console.log(
          `[route] sending to session="${targetSession}" via stdin`,
        );
        this.sessionManager.sendMessage(targetSession, msg.text);

        // Show "thinking..." indicator while Claude processes the message
        if (this.telegram && !this.progressMessages.has(targetSession)) {
          void this.telegram
            .sendMessage(msg.threadId, "⚙️ _thinking..._")
            .then((messageId) => {
              if (messageId) {
                this.progressMessages.set(targetSession, {
                  threadId: msg.threadId,
                  messageId,
                });
              }
            });
        }
      });
    } else {
      console.log(
        `[route] non-telegram channel "${msg.channelType}" — no routing implemented`,
      );
    }
  }

  private async handleAssistantText(
    sessionId: string,
    text: string,
  ): Promise<void> {
    const ctx = this.replyContext.get(sessionId);
    if (!ctx || !this.telegram) return;

    const progressText = `⚙️ _thinking..._\n\n${text}`;
    const existing = this.progressMessages.get(sessionId);

    if (existing) {
      await this.telegram.editMessage(
        ctx.threadId,
        existing.messageId,
        progressText,
      );
    } else {
      const messageId = await this.telegram.sendMessage(
        ctx.threadId,
        progressText,
      );
      if (messageId) {
        this.progressMessages.set(sessionId, {
          threadId: ctx.threadId,
          messageId,
        });
      }
    }
  }

  private async handleToolUse(
    sessionId: string,
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<void> {
    const ctx = this.replyContext.get(sessionId);
    if (!ctx || !this.telegram) return;

    const description = toolDisplayName(toolName);
    const inputPreview = this.formatToolInput(toolName, input);
    const progressText = inputPreview
      ? `⚙️ _${description}..._\n\n${inputPreview}`
      : `⚙️ _${description}..._`;
    const existing = this.progressMessages.get(sessionId);

    if (existing) {
      await this.telegram.editMessage(
        ctx.threadId,
        existing.messageId,
        progressText,
      );
    } else {
      const messageId = await this.telegram.sendMessage(
        ctx.threadId,
        progressText,
      );
      if (messageId) {
        this.progressMessages.set(sessionId, {
          threadId: ctx.threadId,
          messageId,
        });
      }
    }
  }

  private formatToolInput(
    toolName: string,
    input: Record<string, unknown>,
  ): string {
    switch (toolName) {
      case "Bash":
        return input.command ? `\`${String(input.command).slice(0, 200)}\`` : "";
      case "Read":
        return input.file_path ? String(input.file_path) : "";
      case "Edit":
      case "Write":
        return input.file_path ? String(input.file_path) : "";
      case "Grep":
        return input.pattern ? `\`${String(input.pattern)}\`` : "";
      case "Glob":
        return input.pattern ? `\`${String(input.pattern)}\`` : "";
      case "WebSearch":
        return input.query ? String(input.query) : "";
      case "WebFetch":
        return input.url ? String(input.url) : "";
      default:
        return "";
    }
  }

  private async ensureSessionAlive(sessionId: string): Promise<void> {
    if (this.sessionManager.isAlive(sessionId)) {
      return;
    }
    console.log(`[route] session "${sessionId}" is dead, restarting...`);
    if (sessionId === Orchestrator.GENERAL_SESSION) {
      await this.startGeneralSession();
    }
  }
}
