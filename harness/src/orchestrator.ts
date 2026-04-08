import { exec } from "node:child_process";
import type {
  ChannelAdapter,
  IncomingMessage,
  TaskAssignment,
  TaskSession,
} from "./types.js";
import { StateStore } from "./state.js";
import { TmuxSessionManager } from "./session-manager.js";
import { MemoryIngestion } from "./memory-ingestion.js";

export interface OrchestratorOptions {
  adapters: ChannelAdapter[];
  telegram: ChannelAdapter;
  stateStore: StateStore;
  sessionManager: TmuxSessionManager;
  memoryIngestion: MemoryIngestion;
  worktreeDir: string;
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
  private adapters: ChannelAdapter[];
  private telegram: ChannelAdapter;
  private stateStore: StateStore;
  private sessionManager: TmuxSessionManager;
  private memoryIngestion: MemoryIngestion;
  private worktreeDir: string;

  constructor(opts: OrchestratorOptions) {
    this.adapters = opts.adapters;
    this.telegram = opts.telegram;
    this.stateStore = opts.stateStore;
    this.sessionManager = opts.sessionManager;
    this.memoryIngestion = opts.memoryIngestion;
    this.worktreeDir = opts.worktreeDir;

    for (const adapter of this.adapters) {
      adapter.onMessage((msg) => this.handleMessage(msg));
      adapter.onTaskAssigned((task) => this.handleTaskAssignment(task));
    }
  }

  async handleTaskAssignment(task: TaskAssignment): Promise<void> {
    const sanitizedId = task.taskId.replace(/[^a-zA-Z0-9-]/g, "-");
    const branch = `igor/${sanitizedId}`;
    const worktreePath = `${this.worktreeDir}/${sanitizedId}`;

    await run(`git worktree add ${worktreePath} -b ${branch}`);

    let telegramThreadId = "";
    if (this.telegram.createThread) {
      telegramThreadId = await this.telegram.createThread(`Task: ${task.title}`);
    }

    const tmuxSession = sanitizedId;
    await this.sessionManager.createSession({
      name: tmuxSession,
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
      tmuxSession,
      telegramThreadId,
      status: "active",
      createdAt: new Date().toISOString(),
    };

    this.stateStore.save(session);

    if (this.telegram.sendMessage && telegramThreadId) {
      await this.telegram.sendMessage(
        telegramThreadId,
        `Started working on: ${task.title}`,
      );
    }
  }

  handleMessage(msg: IncomingMessage): void {
    const project =
      (msg.metadata.project as string) || msg.channelType;
    this.memoryIngestion.buffer(project, msg);

    if (msg.channelType === "telegram") {
      const session = this.stateStore.findByTelegramThread(msg.threadId);
      if (session && session.status === "active") {
        void this.sessionManager.sendInput(session.tmuxSession, msg.text);
      }
    }
  }
}
