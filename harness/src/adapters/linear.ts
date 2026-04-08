import type {
  ChannelAdapter,
  IncomingMessage,
  TaskAssignment,
} from "../types.js";

export interface LinearConfig {
  webhookSecret: string;
  assigneeId: string;
}

export class LinearAdapter implements ChannelAdapter {
  readonly name = "linear";
  readonly sendMessage = undefined;
  readonly createThread = undefined;

  private config: LinearConfig;
  private messageHandlers: Array<(msg: IncomingMessage) => void> = [];
  private taskHandlers: Array<(task: TaskAssignment) => void> = [];

  constructor(config: LinearConfig) {
    this.config = config;
  }

  onMessage(handler: (msg: IncomingMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  onTaskAssigned(handler: (task: TaskAssignment) => void): void {
    this.taskHandlers.push(handler);
  }

  handleWebhook(payload: any): void {
    if (
      payload.type === "Issue" &&
      payload.data?.assignee?.id === this.config.assigneeId
    ) {
      const task: TaskAssignment = {
        source: "linear",
        taskId: String(payload.data.id),
        title: payload.data.title ?? "",
        description: payload.data.description ?? "",
        url: payload.data.url,
        labels: payload.data.labels?.map((l: any) => l.name),
      };

      for (const handler of this.taskHandlers) {
        handler(task);
      }
    }

    if (payload.type === "Comment") {
      const msg: IncomingMessage = {
        channelType: "linear",
        threadId: String(payload.data.issue.id),
        text: payload.data.body ?? "",
        author: payload.data.user?.name ?? "unknown",
        metadata: {},
      };

      for (const handler of this.messageHandlers) {
        handler(msg);
      }
    }
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}
