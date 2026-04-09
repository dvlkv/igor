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
  sessionId: string;
  telegramThreadId: string;
  status: "active" | "completed";
  createdAt: string;
  claudePid?: number;
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

// Bridge protocol types — messages between harness and channel-bridge over WS

export interface BridgeMessage {
  type: "message";
  content: string;
  meta: Record<string, string>;
}

export interface BridgeReply {
  type: "reply";
  adapter: string;
  chat_id: string;
  text: string;
  reply_to?: string;
  files?: string[];
}

export interface BridgePermissionRequest {
  type: "permission_request";
  sessionId: string;
  requestId: string;
  toolName: string;
  description: string;
  inputPreview: string;
}

export interface BridgePermissionResponse {
  type: "permission_response";
  requestId: string;
  behavior: "allow" | "deny";
}

export interface BridgeRegistration {
  type: "register";
  sessionId: string;
}

export type BridgeInbound = BridgeMessage;
export type BridgeOutbound =
  | BridgeReply
  | BridgePermissionRequest
  | BridgeRegistration;

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
    projectDir: string;
    systemPrompt?: string;
  };
  bridge: {
    wsPort: number;
    channelBridgePath: string;
  };
  memory: {
    ingestIntervalMs: number;
    bufferDir: string;
  };
  webhookPort: number;
  stateFile: string;
  worktreeDir: string;
}
