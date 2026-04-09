import { exec } from "node:child_process";
import type {
  ChannelAdapter,
  IncomingMessage,
  TaskAssignment,
  TaskSession,
  BridgeReply,
  BridgePermissionRequest,
} from "./types.js";
import { StateStore } from "./state.js";
import { ClaudeSessionManager } from "./session-manager.js";
import { BridgeServer } from "./bridge-server.js";
import { MemoryIngestion } from "./memory-ingestion.js";
import type { TelegramAdapter } from "./adapters/telegram.js";

export interface OrchestratorOptions {
  adapters: ChannelAdapter[];
  telegram?: TelegramAdapter;
  stateStore: StateStore;
  sessionManager: ClaudeSessionManager;
  bridgeServer: BridgeServer;
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
  private bridgeServer: BridgeServer;
  private memoryIngestion: MemoryIngestion;
  private worktreeDir: string;
  private generalProjectDir: string;
  private generalClaudeArgs: string[];
  private generalSystemPrompt?: string;

  constructor(opts: OrchestratorOptions) {
    this.adapters = opts.adapters;
    this.telegram = opts.telegram;
    this.stateStore = opts.stateStore;
    this.sessionManager = opts.sessionManager;
    this.bridgeServer = opts.bridgeServer;
    this.memoryIngestion = opts.memoryIngestion;
    this.worktreeDir = opts.worktreeDir;
    this.generalProjectDir = opts.generalProjectDir;
    this.generalClaudeArgs = opts.generalClaudeArgs;
    this.generalSystemPrompt = opts.generalSystemPrompt;

    for (const adapter of this.adapters) {
      adapter.onMessage((msg) => this.handleMessage(msg));
      adapter.onTaskAssigned((task) => this.handleTaskAssignment(task));
    }

    // Wire bridge replies back to adapters
    this.bridgeServer.onReply((_sessionId, reply) => {
      this.handleReply(reply);
    });

    // Wire permission requests from bridge to Telegram
    this.bridgeServer.onPermissionRequest((req) => {
      this.handlePermissionRequest(req);
    });

    // Wire Telegram permission responses back to bridge
    if (this.telegram) {
      this.telegram.onPermissionResponse((sessionId, requestId, behavior) => {
        this.bridgeServer.sendPermissionResponse(sessionId, {
          type: "permission_response",
          requestId,
          behavior,
        });
      });
    }
  }

  async startGeneralSession(): Promise<void> {
    if (this.sessionManager.isAlive(Orchestrator.GENERAL_SESSION)) {
      console.log("General session already running");
      return;
    }
    await this.sessionManager.createSession({
      name: Orchestrator.GENERAL_SESSION,
      worktreePath: this.generalProjectDir,
      prompt: "Session initialized. Awaiting channel messages.",
      systemPrompt: this.generalSystemPrompt,
      claudeArgs: this.generalClaudeArgs,
    });
    console.log("General session started");
  }

  async clearGeneralSession(): Promise<void> {
    try {
      await this.sessionManager.killSession(Orchestrator.GENERAL_SESSION);
      this.bridgeServer.disconnectSession(Orchestrator.GENERAL_SESSION);
    } catch {
      // session may not exist
    }
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
      await this.telegram.sendMessage(
        telegramThreadId,
        `Started working on: ${task.title}`,
      );
    }
  }

  handleMessage(msg: IncomingMessage): void {
    console.log(`[${msg.channelType}] ${msg.author}: ${msg.text}`);
    console.log(`[route] threadId="${msg.threadId}" metadata=${JSON.stringify(msg.metadata)}`);
    const project =
      (msg.metadata.project as string) || msg.channelType;
    this.memoryIngestion.buffer(project, msg);

    if (msg.channelType === "telegram") {
      const session = this.stateStore.findByTelegramThread(msg.threadId);
      console.log(`[route] stateStore.findByTelegramThread("${msg.threadId}") => ${session ? `sessionId="${session.sessionId}" status="${session.status}"` : "null"}`);

      const targetSession =
        session?.status === "active"
          ? session.sessionId
          : msg.threadId === "general"
            ? Orchestrator.GENERAL_SESSION
            : null;

      console.log(`[route] targetSession="${targetSession}" (threadId="${msg.threadId}")`);

      if (!targetSession) {
        console.log(`[route] DROPPED: no target session for threadId="${msg.threadId}"`);
        return;
      }

      const chatId =
        (msg.metadata.chat_id as string) ||
        String(this.telegram ? (this.telegram as any).config.ownerChatId : "");

      // Ensure the session is alive before sending; restart if needed
      void this.ensureSessionAlive(targetSession).then(() => {
        console.log(`[route] sending to bridge: session="${targetSession}" chatId="${chatId}"`);
        const sent = this.bridgeServer.sendToSession(targetSession, {
          type: "message",
          content: msg.text,
          meta: {
            adapter: "telegram",
            chat_id: chatId,
            message_id: (msg.metadata.message_id as string) || "",
            user: msg.author,
            thread_id: msg.threadId,
          },
        });
        console.log(`[route] bridgeServer.sendToSession returned ${sent} (true=sent, false=queued)`);
      });
    } else {
      console.log(`[route] non-telegram channel "${msg.channelType}" — no routing implemented`);
    }
  }

  /** Ensure a session is alive, restarting the general session if needed. */
  private async ensureSessionAlive(sessionId: string): Promise<void> {
    if (this.sessionManager.isAlive(sessionId)) {
      return;
    }
    console.log(`[route] session "${sessionId}" is dead, restarting...`);
    if (sessionId === Orchestrator.GENERAL_SESSION) {
      await this.startGeneralSession();
      // Give the MCP bridge a moment to connect
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  private handleReply(reply: BridgeReply): void {
    console.log(`[reply] adapter="${reply.adapter}" chat_id="${reply.chat_id}" text="${reply.text.slice(0, 200)}"`);
    const adapter = this.adapters.find((a) => a.name === reply.adapter);
    if (adapter?.sendMessage) {
      console.log(`[reply] forwarding to ${reply.adapter} adapter`);
      void adapter.sendMessage(reply.chat_id, reply.text);
    } else {
      console.log(`[reply] WARNING: no adapter found for "${reply.adapter}" (available: ${this.adapters.map(a => a.name).join(", ")})`);
    }
  }

  private handlePermissionRequest(req: BridgePermissionRequest): void {
    if (this.telegram) {
      void this.telegram.sendPermissionPrompt(req);
    }
  }
}
