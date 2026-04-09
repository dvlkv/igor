import { Bot, InlineKeyboard } from "grammy";
import type {
  ChannelAdapter,
  IncomingMessage,
  TaskAssignment,
  BridgePermissionRequest,
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
  private clearHandlers: Array<() => void> = [];
  private permissionResponseHandler?: (
    sessionId: string,
    requestId: string,
    behavior: "allow" | "deny",
  ) => void;

  constructor(config: TelegramConfig) {
    this.config = config;
    this.bot = new Bot(config.botToken);

    this.bot.command("clear", (ctx) => {
      for (const handler of this.clearHandlers) {
        handler();
      }
      ctx.reply("General session cleared.");
    });

    this.bot.command("task", (ctx) => {
      const text = ctx.message?.text ?? "";
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

    // Handle permission relay callback queries
    this.bot.on("callback_query:data", async (ctx) => {
      const data = ctx.callbackQuery.data;
      if (!data.startsWith("perm:")) return;

      // Format: perm:<allow|deny>:<sessionId>:<requestId>
      const parts = data.split(":");
      if (parts.length !== 4) return;

      const [, behavior, sessionId, requestId] = parts;
      if (behavior !== "allow" && behavior !== "deny") return;

      this.permissionResponseHandler?.(sessionId, requestId, behavior);

      const label = behavior === "allow" ? "Allowed" : "Denied";
      await ctx.editMessageText(
        `${ctx.callbackQuery.message?.text}\n\n${label}.`,
      );
      await ctx.answerCallbackQuery({ text: label });
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
        metadata: {
          chat_id: String(ctx.chat.id),
          message_id: String(ctx.message.message_id),
        },
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

  onClear(handler: () => void): void {
    this.clearHandlers.push(handler);
  }

  onPermissionResponse(
    handler: (
      sessionId: string,
      requestId: string,
      behavior: "allow" | "deny",
    ) => void,
  ): void {
    this.permissionResponseHandler = handler;
  }

  async sendMessage(threadId: string, text: string): Promise<void> {
    console.log(`[telegram:send] threadId="${threadId}" ownerChatId=${this.config.ownerChatId} text="${text.slice(0, 100)}"`);
    const opts =
      threadId !== "general"
        ? { reply_parameters: { message_id: Number(threadId) } }
        : {};
    try {
      await this.bot.api.sendMessage(this.config.ownerChatId, text, opts);
      console.log(`[telegram:send] message sent successfully`);
    } catch (err: any) {
      console.log(`[telegram:send] ERROR: ${err.message}`);
    }
  }

  async createThread(title: string): Promise<string> {
    const result = await this.bot.api.sendMessage(
      this.config.ownerChatId,
      title,
    );
    return String(result.message_id);
  }

  async sendPermissionPrompt(req: BridgePermissionRequest): Promise<void> {
    const text =
      `Claude wants to run **${req.toolName}**:\n${req.description}`;

    const keyboard = new InlineKeyboard()
      .text("Allow", `perm:allow:${req.sessionId}:${req.requestId}`)
      .text("Deny", `perm:deny:${req.sessionId}:${req.requestId}`);

    await this.bot.api.sendMessage(this.config.ownerChatId, text, {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });
  }

  async start(): Promise<void> {
    await this.bot.api.setMyCommands([
      {
        command: "task",
        description: "Create a new task — /task Title\\nDescription",
      },
      {
        command: "clear",
        description: "Clear and restart the general Claude session",
      },
    ]);
    await this.bot.start();
  }

  async stop(): Promise<void> {
    await this.bot.stop();
  }
}
