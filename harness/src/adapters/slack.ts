import { App } from "@slack/bolt";
import type {
  ChannelAdapter,
  IncomingMessage,
  TaskAssignment,
} from "../types.js";

export interface SlackConfig {
  botToken: string;
  appToken: string;
  channelProjectMap: Record<string, string>;
}

export class SlackAdapter implements ChannelAdapter {
  readonly name = "slack";
  readonly sendMessage = undefined;
  readonly createThread = undefined;

  private app: App;
  private config: SlackConfig;
  private messageHandlers: Array<(msg: IncomingMessage) => void> = [];
  private taskHandlers: Array<(task: TaskAssignment) => void> = [];

  constructor(config: SlackConfig) {
    this.config = config;
    this.app = new App({
      token: config.botToken,
      appToken: config.appToken,
      socketMode: true,
    });

    this.app.message(async ({ message }) => {
      if (message.subtype !== undefined) return;
      const msg = message as { channel: string; ts: string; text?: string; user?: string };
      const project = this.getProjectForChannel(msg.channel);
      const incoming: IncomingMessage = {
        channelType: "slack",
        threadId: msg.ts,
        text: msg.text ?? "",
        author: msg.user ?? "unknown",
        metadata: { channel: msg.channel, ...(project ? { project } : {}) },
      };
      for (const handler of this.messageHandlers) {
        handler(incoming);
      }
    });
  }

  getProjectForChannel(channelId: string): string | undefined {
    return this.config.channelProjectMap[channelId];
  }

  onMessage(handler: (msg: IncomingMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  onTaskAssigned(handler: (task: TaskAssignment) => void): void {
    this.taskHandlers.push(handler);
  }

  async start(): Promise<void> {
    await this.app.start();
  }

  async stop(): Promise<void> {
    await this.app.stop();
  }
}
