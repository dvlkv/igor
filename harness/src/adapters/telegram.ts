import { Bot } from "grammy";
import type {
  ChannelAdapter,
  IncomingMessage,
  TaskAssignment,
} from "../types.js";

export interface TelegramConfig {
  botToken: string;
  ownerChatId: number;
}

export class TelegramAdapter implements ChannelAdapter {
  readonly name = "telegram";
  private bot: Bot;
  private config: TelegramConfig;
  private messageHandlers: Array<(msg: IncomingMessage) => void> = [];
  private taskHandlers: Array<(task: TaskAssignment) => void> = [];

  constructor(config: TelegramConfig) {
    this.config = config;
    this.bot = new Bot(config.botToken);

    this.bot.command("task", (ctx) => {
      const text = ctx.message?.text ?? "";
      // Parse: /task Title\nDescription
      const withoutCommand = text.replace(/^\/task\s*/, "");
      const [title, ...rest] = withoutCommand.split("\n");
      const description = rest.join("\n").trim();

      const task: TaskAssignment = {
        source: "telegram",
        taskId: String(ctx.message?.message_id ?? Date.now()),
        title: title.trim(),
        description,
      };

      for (const handler of this.taskHandlers) {
        handler(task);
      }
    });

    this.bot.on("message:text", (ctx) => {
      const threadId =
        ctx.message.message_thread_id?.toString() ??
        ctx.message.reply_to_message?.message_id?.toString() ??
        "general";

      const msg: IncomingMessage = {
        channelType: "telegram",
        threadId,
        text: ctx.message.text,
        author: ctx.message.from?.username ?? String(ctx.message.from?.id),
        metadata: {},
      };

      for (const handler of this.messageHandlers) {
        handler(msg);
      }
    });
  }

  onMessage(handler: (msg: IncomingMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  onTaskAssigned(handler: (task: TaskAssignment) => void): void {
    this.taskHandlers.push(handler);
  }

  async sendMessage(threadId: string, text: string): Promise<void> {
    const opts =
      threadId !== "general"
        ? { reply_parameters: { message_id: Number(threadId) } }
        : {};
    await this.bot.api.sendMessage(this.config.ownerChatId, text, opts);
  }

  async createThread(title: string): Promise<string> {
    const result = await this.bot.api.sendMessage(
      this.config.ownerChatId,
      title,
    );
    return String(result.message_id);
  }

  async start(): Promise<void> {
    await this.bot.start();
  }

  async stop(): Promise<void> {
    await this.bot.stop();
  }
}
