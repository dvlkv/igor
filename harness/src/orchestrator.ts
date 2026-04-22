import { exec } from "node:child_process";
import type {
  ChannelAdapter,
  IncomingMessage,
  TaskAssignment,
  Task,
} from "./types.js";
import { TaskStore } from "./task-store.js";
import { ClaudeSessionManager } from "./session-manager.js";
import { MemoryIngestion } from "./memory-ingestion.js";
import type { TelegramAdapter } from "./adapters/telegram.js";
import { toolDisplayName } from "./tool-display.js";
import { generateThreadName } from "./thread-name.js";

export interface OrchestratorOptions {
  adapters: ChannelAdapter[];
  telegram?: TelegramAdapter;
  taskStore: TaskStore;
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
  private taskStore: TaskStore;
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
  private pendingQuestions = new Map<string, {
    questions: Array<{
      questionText: string;
      options: Array<{ label: string; description: string }>;
      multiSelect: boolean;
      questionId: string;
      messageId?: number;
      selectedOptions: Set<number>;
      waitingForFreeText: boolean;
    }>;
    answers: Map<number, string>;
    threadId: string;
  }>();
  private questionIdCounter = 0;
  private questionIdToSession = new Map<string, { sessionId: string; questionIndex: number }>();

  constructor(opts: OrchestratorOptions) {
    this.adapters = opts.adapters;
    this.telegram = opts.telegram;
    this.taskStore = opts.taskStore;
    this.sessionManager = opts.sessionManager;
    this.memoryIngestion = opts.memoryIngestion;
    this.worktreeDir = opts.worktreeDir;
    this.generalProjectDir = opts.generalProjectDir;
    this.generalClaudeArgs = opts.generalClaudeArgs;
    this.generalSystemPrompt = opts.generalSystemPrompt;

    for (const adapter of this.adapters) {
      adapter.onMessage((msg) => this.handleMessage(msg));
      adapter.onTaskAssigned((task) => this.handleTaskAssignment(task));
      if ("onTaskCompleted" in adapter && typeof (adapter as any).onTaskCompleted === "function") {
        (adapter as any).onTaskCompleted(async (idOrBranch: string) => {
          // Try as taskId first, then as branch, then as linearIssueId
          let task = this.taskStore.get(idOrBranch);
          if (!task) {
            task = this.taskStore.findByBranch(idOrBranch);
          }
          if (!task) {
            task = this.taskStore.findByLinearIssue(idOrBranch);
          }
          if (task) {
            await this.completeTask(task.taskId);
          } else {
            console.log(
              `[cleanup] could not resolve task for "${idOrBranch}"`,
            );
          }
        });
      }
    }

    // Route tool_use events as progress messages
    this.sessionManager.onToolUse((sessionId, toolName, input) => {
      void this.handleToolUse(sessionId, toolName, input);
    });

    // Route assistant text as progress updates
    this.sessionManager.onAssistantText((sessionId, text) => {
      void this.handleAssistantText(sessionId, text);
    });

    if (this.telegram) {
      this.telegram.onQuestionAnswer((questionId: string, answer: string) => {
        this.handleQuestionAnswer(questionId, answer);
      });
    }

    if (this.telegram) {
      this.telegram.onTaskCompleted(
        async (taskId: string | undefined, threadId: string | undefined) => {
          let resolvedTaskId = taskId;
          if (!resolvedTaskId && threadId) {
            const task = this.taskStore.findByTelegramThread(threadId);
            resolvedTaskId = task?.taskId;
          }
          if (resolvedTaskId) {
            await this.completeTask(resolvedTaskId);
          } else {
            console.log(
              `[done] could not resolve task — taskId=${taskId} threadId=${threadId}`,
            );
          }
        },
      );
    }

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
      const activeTasks = this.taskStore.getActive().length;
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
      const threadName = await generateThreadName(task.title, task.description);
      telegramThreadId = await this.telegram.createThread(threadName);
    }

    const sessionId = sanitizedId;
    const pid = await this.sessionManager.createSession({
      name: sessionId,
      worktreePath,
      prompt: `/human-coder\n\n${task.title}${task.description ? '\n\n' + task.description : ''}`,
    });

    const newTask: Task = {
      taskId: task.taskId,
      projectName: task.repo ?? "igor",
      source: task.source,
      title: task.title,
      description: task.description,
      worktreePath,
      branch,
      sessionId,
      status: "active",
      createdAt: new Date().toISOString(),
      claudePid: pid,
      telegramThreadId: telegramThreadId || undefined,
      githubIssueUrl: task.source === "github" ? task.url : undefined,
      linearIssueUrl: task.source === "linear" ? task.url : undefined,
    };

    this.taskStore.save(newTask);

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

  async completeTask(taskId: string): Promise<void> {
    const task = this.taskStore.get(taskId);
    if (!task || task.status === "completed" || task.status === "abandoned") {
      console.log(`[cleanup] task "${taskId}" not found or already done`);
      return;
    }

    console.log(`[cleanup] completing task "${taskId}"`);

    // 1. Kill Claude session
    try {
      if (this.sessionManager.isAlive(task.sessionId)) {
        await this.sessionManager.killSession(task.sessionId);
        console.log(`[cleanup] killed session "${task.sessionId}"`);
      }
    } catch (err: any) {
      console.log(`[cleanup] session kill failed: ${err.message}`);
    }

    // 2. Check if branch is merged and handle worktree + branch
    let branchMerged = false;
    let branchMessage = "";
    try {
      const mergedOutput = await run(
        `git branch --merged main`,
      );
      branchMerged = mergedOutput
        .split("\n")
        .map((b) => b.trim())
        .includes(task.branch);
    } catch (err: any) {
      console.log(`[cleanup] merge check failed: ${err.message}`);
    }

    // 3. Remove worktree
    try {
      if (branchMerged) {
        await run(`git worktree remove ${task.worktreePath}`);
      } else {
        await run(`git worktree remove --force ${task.worktreePath}`);
      }
      console.log(`[cleanup] removed worktree "${task.worktreePath}"`);
    } catch (err: any) {
      console.log(`[cleanup] worktree remove failed: ${err.message}`);
    }

    // 4. Delete branch if merged, keep if not
    if (branchMerged) {
      try {
        await run(`git branch -d ${task.branch}`);
        branchMessage = `Branch \`${task.branch}\` deleted.`;
        console.log(`[cleanup] deleted branch "${task.branch}"`);
      } catch (err: any) {
        branchMessage = `Branch \`${task.branch}\` kept (delete failed).`;
        console.log(`[cleanup] branch delete failed: ${err.message}`);
      }
    } else {
      branchMessage = `Branch \`${task.branch}\` kept (not merged).`;
    }

    // 5. Update task status
    this.taskStore.update(taskId, {
      status: "completed",
      completedAt: new Date().toISOString(),
      claudePid: undefined,
    });

    // 6. Notify Telegram
    if (this.telegram?.sendMessage && task.telegramThreadId) {
      try {
        await this.telegram.sendMessage(
          task.telegramThreadId,
          `Task completed. ${branchMessage}`,
        );
      } catch (err: any) {
        console.log(`[cleanup] telegram notify failed: ${err.message}`);
      }
    }

    // 7. Delete Telegram topic
    if (this.telegram?.deleteTopic && task.telegramThreadId) {
      try {
        await this.telegram.deleteTopic(task.telegramThreadId);
        console.log(`[cleanup] deleted topic "${task.telegramThreadId}"`);
      } catch (err: any) {
        console.log(`[cleanup] topic delete failed: ${err.message}`);
      }
    }

    // 8. Clean up internal maps
    this.replyContext.delete(task.sessionId);
    this.progressMessages.delete(task.sessionId);

    // 8b. Clean up pending questions
    const pendingQ = this.pendingQuestions.get(task.sessionId);
    if (pendingQ) {
      for (const q of pendingQ.questions) {
        this.questionIdToSession.delete(q.questionId);
      }
      this.pendingQuestions.delete(task.sessionId);
    }

    console.log(`[cleanup] task "${taskId}" completed`);
  }

  handleMessage(msg: IncomingMessage): void {
    console.log(`[${msg.channelType}] ${msg.author}: ${msg.text}`);
    const project = (msg.metadata.project as string) || msg.channelType;
    this.memoryIngestion.buffer(project, msg);

    if (msg.channelType === "telegram") {
      const session = this.taskStore.findByTelegramThread(msg.threadId);

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

      // Check if there's a pending question waiting for free-text
      const pending = this.pendingQuestions.get(targetSession);
      if (pending) {
        const waitingIdx = pending.questions.findIndex(
          (q) => q.waitingForFreeText,
        );
        if (waitingIdx >= 0) {
          pending.questions[waitingIdx].waitingForFreeText = false;
          pending.answers.set(waitingIdx, msg.text);
          this.tryCompletePendingQuestions(targetSession);
          return;
        }
      }

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
    if (toolName === "AskUserQuestion") {
      await this.handleAskUserQuestion(sessionId, input);
      return;
    }

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

  private async handleAskUserQuestion(
    sessionId: string,
    input: Record<string, unknown>,
  ): Promise<void> {
    const ctx = this.replyContext.get(sessionId);
    if (!ctx || !this.telegram) return;

    const questions = input.questions as Array<{
      question: string;
      header: string;
      multiSelect: boolean;
      options: Array<{ label: string; description: string }>;
    }>;

    if (!questions?.length) return;

    // Delete existing progress message
    const existing = this.progressMessages.get(sessionId);
    if (existing && this.telegram.deleteMessage) {
      void this.telegram.deleteMessage(existing.messageId);
      this.progressMessages.delete(sessionId);
    }

    const pendingSet: {
      questions: Array<{
        questionText: string;
        options: Array<{ label: string; description: string }>;
        multiSelect: boolean;
        questionId: string;
        messageId?: number;
        selectedOptions: Set<number>;
        waitingForFreeText: boolean;
      }>;
      answers: Map<number, string>;
      threadId: string;
    } = {
      questions: [],
      answers: new Map<number, string>(),
      threadId: ctx.threadId,
    };

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const questionId = `q${this.questionIdCounter++}`;

      this.questionIdToSession.set(questionId, {
        sessionId,
        questionIndex: i,
      });

      const messageId = await this.telegram.sendQuestion(
        ctx.threadId,
        q.question,
        q.options,
        questionId,
        q.multiSelect,
      );

      pendingSet.questions.push({
        questionText: q.question,
        options: q.options,
        multiSelect: q.multiSelect,
        questionId,
        messageId,
        selectedOptions: new Set(),
        waitingForFreeText: false,
      });
    }

    this.pendingQuestions.set(sessionId, pendingSet);
  }

  private handleQuestionAnswer(questionId: string, answer: string): void {
    const mapping = this.questionIdToSession.get(questionId);
    if (!mapping) return;

    const { sessionId, questionIndex } = mapping;
    const pending = this.pendingQuestions.get(sessionId);
    if (!pending) return;

    const question = pending.questions[questionIndex];
    if (!question) return;

    if (answer === "__other__") {
      question.waitingForFreeText = true;
      return;
    }

    if (answer === "__done__") {
      const labels = [...question.selectedOptions]
        .sort()
        .map((i) => question.options[i]?.label)
        .filter(Boolean);
      pending.answers.set(questionIndex, labels.join(", "));
    } else if (question.multiSelect) {
      const idx = parseInt(answer, 10);
      if (question.selectedOptions.has(idx)) {
        question.selectedOptions.delete(idx);
      } else {
        question.selectedOptions.add(idx);
      }
      return;
    } else {
      const idx = parseInt(answer, 10);
      const label = question.options[idx]?.label ?? answer;
      pending.answers.set(questionIndex, label);
    }

    this.tryCompletePendingQuestions(sessionId);
  }

  private tryCompletePendingQuestions(sessionId: string): void {
    const pending = this.pendingQuestions.get(sessionId);
    if (!pending) return;

    if (pending.answers.size < pending.questions.length) return;

    const lines: string[] = [];
    for (let i = 0; i < pending.questions.length; i++) {
      const q = pending.questions[i];
      const a = pending.answers.get(i) ?? "";
      if (pending.questions.length === 1) {
        lines.push(a);
      } else {
        lines.push(`${q.questionText}: ${a}`);
      }
    }

    this.sessionManager.sendMessage(sessionId, lines.join("\n"));

    for (const q of pending.questions) {
      this.questionIdToSession.delete(q.questionId);
    }
    this.pendingQuestions.delete(sessionId);
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
