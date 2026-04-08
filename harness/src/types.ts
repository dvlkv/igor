export type ChannelType = "telegram" | "slack" | "linear" | "github";

export interface IncomingMessage {
  channelType: ChannelType;
  threadId: string;
  text: string;
  author: string;
  metadata: Record<string, unknown>;
}

export interface TaskAssignment {
  source: ChannelType;
  taskId: string;
  title: string;
  description: string;
  url?: string;
  repo?: string;
  labels?: string[];
}

export interface ChannelAdapter {
  name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  onMessage(handler: (msg: IncomingMessage) => void): void;
  onTaskAssigned(handler: (task: TaskAssignment) => void): void;
  sendMessage?(threadId: string, text: string): Promise<void>;
  createThread?(title: string): Promise<string>;
}

export interface TaskSession {
  taskId: string;
  source: ChannelType;
  title: string;
  url?: string;
  worktreePath: string;
  branch: string;
  tmuxSession: string;
  telegramThreadId: string;
  status: "active" | "completed";
  createdAt: string;
}

export interface SessionManagerOptions {
  name: string;
  worktreePath: string;
  prompt: string;
  mcpConfig?: string;
}

export interface SessionManager {
  createSession(opts: SessionManagerOptions): Promise<void>;
  sendInput(sessionName: string, text: string): Promise<void>;
  readOutput(sessionName: string): AsyncIterable<string>;
  killSession(sessionName: string): Promise<void>;
  listSessions(): Promise<string[]>;
}

export interface ChannelsConfig {
  telegram: {
    botToken: string;
    ownerChatId: number;
  };
  slack: {
    botToken: string;
    appToken: string;
    channelProjectMap: Record<string, string>;
  };
  linear: {
    webhookSecret: string;
    assigneeId: string;
  };
  github: {
    webhookSecret: string;
    assigneeLogin: string;
  };
  general: {
    claudeArgs: string[];
  };
  memory: {
    ingestIntervalMs: number;
    bufferDir: string;
  };
  webhookPort: number;
  stateFile: string;
  worktreeDir: string;
}
