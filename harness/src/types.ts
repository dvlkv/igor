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
  sendMessage?(threadId: string, text: string): Promise<number | undefined>;
  createThread?(title: string): Promise<string>;
}

// ---------------------------------------------------------------------------
// Project: a named repository that lives in the projects directory
// ---------------------------------------------------------------------------
export interface Project {
  /** Unique slug used as directory name, e.g. "igor", "my-api" */
  name: string;
  /** Absolute path to the repo checkout (always on main/default branch) */
  path: string;
  /** Optional remote URL (git clone source) */
  remoteUrl?: string;
  /** ISO timestamp */
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Task: unit of work done in a worktree, always linked to a project
// ---------------------------------------------------------------------------
export interface Task {
  taskId: string;
  /** Project this task belongs to */
  projectName: string;
  source: ChannelType;
  title: string;
  description?: string;
  /** Worktree path where work happens */
  worktreePath: string;
  /** Git branch name */
  branch: string;
  /** Claude session id */
  sessionId: string;
  status: "active" | "completed" | "abandoned";
  createdAt: string;
  completedAt?: string;
  claudePid?: number;

  // Channel thread links
  telegramThreadId?: string;
  slackThreadTs?: string;
  slackChannelId?: string;

  // External issue links
  linearIssueId?: string;
  linearIssueUrl?: string;
  githubIssueNumber?: number;
  githubIssueUrl?: string;
}

/** @deprecated Use Task instead — kept for migration compatibility */
export interface TaskSession {
  taskId: string;
  source: ChannelType;
  title: string;
  url?: string;
  worktreePath: string;
  branch: string;
  sessionId: string;
  telegramThreadId: string;
  status: "active" | "completed";
  createdAt: string;
  claudePid?: number;
}

// ---------------------------------------------------------------------------
// Log entry written for every ingested message / memory operation
// ---------------------------------------------------------------------------
export interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  category: "message" | "memory" | "task" | "project" | "system";
  project?: string;
  taskId?: string;
  data: Record<string, unknown>;
}

export interface SessionManagerOptions {
  name: string;
  worktreePath: string;
  prompt: string;
  systemPrompt?: string;
  claudeArgs?: string[];
}

export interface SessionManager {
  createSession(opts: SessionManagerOptions): Promise<void>;
  killSession(name: string): Promise<void>;
  isAlive(name: string): boolean;
  listSessions(): string[];
}

// ---------------------------------------------------------------------------
// Storage layout configuration
// ---------------------------------------------------------------------------
export interface StorageConfig {
  /** Root directory for all project repos (default ~/projects) */
  projectsDir: string;
  /** Igor's own directory (symlinked into projectsDir) */
  igorDir: string;
  /** Directory for task worktrees */
  worktreeDir: string;
  /** Directory for logs */
  logsDir: string;
  /** Path to projects registry JSON */
  projectsFile: string;
  /** Path to tasks registry JSON */
  tasksFile: string;
  /** Directory for memory ingestion buffers */
  memoryBufferDir: string;
}

export interface HarnessConfig {
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
    systemPrompt?: string;
  };
  task: {
    claudeArgs: string[];
    systemPrompt?: string;
  };
  memory: {
    ingestIntervalMs: number;
  };
  storage: StorageConfig;
  webhookPort: number;
}
