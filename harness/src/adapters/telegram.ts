import { Bot, InlineKeyboard } from "grammy";
import type {
  ChannelAdapter,
  IncomingMessage,
  TaskAssignment,
} from "../types.js";

export interface PermissionPrompt {
  sessionId: string;
  requestId: string;
  toolName: string;
  description: string;
  inputPreview: string;
}

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
  private taskCompletedHandlers: Array<
    (taskId: string | undefined, threadId: string | undefined) => void
  > = [];
  private permissionResponseHandler?: (
    sessionId: string,
    requestId: string,
    behavior: "allow" | "deny",
  ) => void;
  private questionAnswerHandler?: (
    questionId: string,
    answer: string,
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

    this.bot.command("done", (ctx) => {
      const text = ctx.message?.text ?? "";
      const arg = text.replace(/^\/done\s*/, "").trim();
      const threadId = ctx.message?.message_thread_id?.toString();

      const taskId = arg || undefined;

      for (const handler of this.taskCompletedHandlers) {
        handler(taskId, threadId);
      }
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

      if (data.startsWith("q:")) {
        // Format: q:<questionId>:<optionIndex>
        const parts = data.split(":");
        if (parts.length === 3) {
          const [, questionId, optionIndex] = parts;
          this.questionAnswerHandler?.(questionId, optionIndex);
          await ctx.answerCallbackQuery({ text: "Selected" });
        }
        return;
      }
      if (data.startsWith("qd:")) {
        // Format: qd:<questionId> (multi-select done)
        const questionId = data.slice(3);
        this.questionAnswerHandler?.(questionId, "__done__");
        await ctx.answerCallbackQuery({ text: "Confirmed" });
        return;
      }
      if (data.startsWith("qo:")) {
        // Format: qo:<questionId> (other / free-text)
        const questionId = data.slice(3);
        this.questionAnswerHandler?.(questionId, "__other__");
        await ctx.answerCallbackQuery({ text: "Reply with your answer" });
        return;
      }

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

  onTaskCompleted(
    handler: (taskId: string | undefined, threadId: string | undefined) => void,
  ): void {
    this.taskCompletedHandlers.push(handler);
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

  onQuestionAnswer(
    handler: (questionId: string, answer: string) => void,
  ): void {
    this.questionAnswerHandler = handler;
  }

  async sendQuestion(
    threadId: string,
    questionText: string,
    options: Array<{ label: string; description: string }>,
    questionId: string,
    multiSelect: boolean,
  ): Promise<number | undefined> {
    const optionLines = options
      .map((o) => `• *${o.label}* — ${o.description}`)
      .join("\n");
    const text = `❓ *${questionText}*\n\n${optionLines}`;

    const keyboard = new InlineKeyboard();
    for (let i = 0; i < options.length; i++) {
      keyboard.text(options[i].label, `q:${questionId}:${i}`);
      if (i < options.length - 1) keyboard.row();
    }
    if (multiSelect) {
      keyboard.row();
      keyboard.text("✅ Done", `qd:${questionId}`);
    }
    keyboard.row();
    keyboard.text("Other...", `qo:${questionId}`);

    const numericMatch = /(\d+)$/.exec(threadId);
    const opts: Record<string, unknown> =
      threadId !== "general" && numericMatch
        ? { message_thread_id: Number(numericMatch[1]), parse_mode: "Markdown", reply_markup: keyboard }
        : { parse_mode: "Markdown", reply_markup: keyboard };

    try {
      const result = await this.bot.api.sendMessage(
        this.config.ownerChatId,
        text,
        opts,
      );
      return result.message_id;
    } catch (err: any) {
      console.log(`[telegram:sendQuestion] ERROR: ${err.message}`);
      return undefined;
    }
  }

  async sendMessage(
    threadId: string,
    text: string,
  ): Promise<number | undefined> {
    console.log(
      `[telegram:send] threadId="${threadId}" ownerChatId=${this.config.ownerChatId} text="${text.slice(0, 100)}"`,
    );
    const opts: Record<string, unknown> =
      threadId !== "general"
        ? { message_thread_id: Number(threadId), parse_mode: "Markdown" }
        : { parse_mode: "Markdown" };
    try {
      const result = await this.bot.api.sendMessage(
        this.config.ownerChatId,
        text,
        opts,
      );
      console.log(`[telegram:send] message sent successfully`);
      return result.message_id;
    } catch (err: any) {
      console.log(`[telegram:send] ERROR: ${err.message}`);
      return undefined;
    }
  }

  async editMessage(
    threadId: string,
    messageId: number,
    text: string,
  ): Promise<void> {
    try {
      await this.bot.api.editMessageText(
        this.config.ownerChatId,
        messageId,
        text,
        { parse_mode: "Markdown" },
      );
    } catch (err: any) {
      console.log(`[telegram:edit] ERROR: ${err.message}`);
    }
  }

  async deleteMessage(messageId: number): Promise<void> {
    try {
      await this.bot.api.deleteMessage(this.config.ownerChatId, messageId);
    } catch (err: any) {
      console.log(`[telegram:delete] ERROR: ${err.message}`);
    }
  }

  async deleteTopic(threadId: string): Promise<void> {
    const numericId = Number(threadId);
    try {
      await this.bot.api.closeForumTopic(this.config.ownerChatId, numericId);
    } catch (err: any) {
      console.log(`[telegram:closeTopic] ERROR: ${err.message}`);
    }
    try {
      await this.bot.api.deleteForumTopic(this.config.ownerChatId, numericId);
    } catch (err: any) {
      console.log(`[telegram:deleteTopic] ERROR: ${err.message}`);
    }
  }

  async createThread(title: string): Promise<string> {
    const result = await this.bot.api.createForumTopic(
      this.config.ownerChatId,
      title.slice(0, 128),
    );
    return String(result.message_thread_id);
  }

  async sendPermissionPrompt(req: PermissionPrompt): Promise<void> {
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
        command: "done",
        description: "Complete a task — /done [taskId] or use in task thread",
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
