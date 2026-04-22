import { describe, it, expect, vi } from "vitest";

vi.mock("grammy", () => {
  return {
    Bot: vi.fn(function () {
      return {
        command: vi.fn(),
        on: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        api: {
          sendMessage: vi.fn().mockResolvedValue({ message_id: 42 }),
          editMessageText: vi.fn().mockResolvedValue(true),
          deleteMessage: vi.fn().mockResolvedValue(true),
          createForumTopic: vi.fn().mockResolvedValue({ message_thread_id: 99, name: "Test" }),
          closeForumTopic: vi.fn().mockResolvedValue(true),
          deleteForumTopic: vi.fn().mockResolvedValue(true),
        },
      };
    }),
    InlineKeyboard: vi.fn(function () {
      return {
        text: vi.fn().mockReturnThis(),
        row: vi.fn().mockReturnThis(),
      };
    }),
  };
});

import { TelegramAdapter } from "./telegram.js";
import { Bot } from "grammy";

describe("TelegramAdapter", () => {
  it("has correct name", () => {
    const adapter = new TelegramAdapter({
      botToken: "test-token",
      ownerChatId: 123,
    });
    expect(adapter.name).toBe("telegram");
  });

  it("creates a forum topic and returns message_thread_id as string", async () => {
    const adapter = new TelegramAdapter({
      botToken: "test-token",
      ownerChatId: 123,
    });
    const threadId = await adapter.createThread("Test Thread");
    expect(threadId).toBe("99");

    const bot = (Bot as unknown as ReturnType<typeof vi.fn>).mock.results.at(-1)
      .value;
    expect(bot.api.createForumTopic).toHaveBeenCalledWith(123, "Test Thread");
  });

  it("truncates forum topic name to 128 characters", async () => {
    const adapter = new TelegramAdapter({
      botToken: "test-token",
      ownerChatId: 123,
    });
    const longTitle = "A".repeat(200);
    await adapter.createThread(longTitle);

    const bot = (Bot as unknown as ReturnType<typeof vi.fn>).mock.results.at(-1)
      .value;
    expect(bot.api.createForumTopic).toHaveBeenCalledWith(
      123,
      "A".repeat(128),
    );
  });

  it("sendMessage uses message_thread_id for non-general threads", async () => {
    const adapter = new TelegramAdapter({
      botToken: "test-token",
      ownerChatId: 123,
    });
    await adapter.sendMessage("99", "Hello topic");

    const bot = (Bot as unknown as ReturnType<typeof vi.fn>).mock.results.at(-1)
      .value;
    expect(bot.api.sendMessage).toHaveBeenCalledWith(123, "Hello topic", {
      message_thread_id: 99,
      parse_mode: "Markdown",
    });
  });

  it("sendMessage returns the message_id", async () => {
    const adapter = new TelegramAdapter({
      botToken: "test-token",
      ownerChatId: 123,
    });
    const msgId = await adapter.sendMessage("general", "Hello");
    expect(msgId).toBe(42);
  });

  it("editMessage calls bot.api.editMessageText", async () => {
    const adapter = new TelegramAdapter({
      botToken: "test-token",
      ownerChatId: 123,
    });
    await adapter.editMessage("general", 42, "Updated text");

    const bot = (Bot as unknown as ReturnType<typeof vi.fn>).mock.results.at(-1)
      .value;
    expect(bot.api.editMessageText).toHaveBeenCalledWith(
      123,
      42,
      "Updated text",
      { parse_mode: "Markdown" },
    );
  });

  it("deleteMessage calls bot.api.deleteMessage", async () => {
    const adapter = new TelegramAdapter({
      botToken: "test-token",
      ownerChatId: 123,
    });
    await adapter.deleteMessage(42);

    const bot = (Bot as unknown as ReturnType<typeof vi.fn>).mock.results.at(-1)
      .value;
    expect(bot.api.deleteMessage).toHaveBeenCalledWith(123, 42);
  });

  it("registers /done command handler", () => {
    const adapter = new TelegramAdapter({
      botToken: "test-token",
      ownerChatId: 123,
    });

    const bot = (Bot as unknown as ReturnType<typeof vi.fn>).mock.results.at(-1)
      .value;
    expect(bot.command).toHaveBeenCalledWith("done", expect.any(Function));
  });

  it("fires onTaskCompleted with taskId from argument", () => {
    const adapter = new TelegramAdapter({
      botToken: "test-token",
      ownerChatId: 123,
    });

    const completedTasks: (string | undefined)[] = [];
    adapter.onTaskCompleted((taskId) => completedTasks.push(taskId));

    const bot = (Bot as unknown as ReturnType<typeof vi.fn>).mock.results.at(-1)
      .value;
    const lastDoneCall = bot.command.mock.calls
      .reverse()
      .find((c: any[]) => c[0] === "done");
    const doneHandler = lastDoneCall?.[1];

    doneHandler({
      message: { text: "/done LIN-123", message_thread_id: undefined },
      reply: vi.fn(),
    });

    expect(completedTasks).toEqual(["LIN-123"]);
  });

  it("fires onTaskCompleted with threadId when no argument given", () => {
    const adapter = new TelegramAdapter({
      botToken: "test-token",
      ownerChatId: 123,
    });

    const completedThreads: string[] = [];
    adapter.onTaskCompleted((_taskId, threadId) =>
      completedThreads.push(threadId ?? ""),
    );

    const bot = (Bot as unknown as ReturnType<typeof vi.fn>).mock.results.at(-1)
      .value;
    const lastDoneCall = bot.command.mock.calls
      .reverse()
      .find((c: any[]) => c[0] === "done");
    const doneHandler = lastDoneCall?.[1];

    doneHandler({
      message: { text: "/done", message_thread_id: 456 },
      reply: vi.fn(),
    });

    expect(completedThreads).toEqual(["456"]);
  });

  it("deleteTopic calls closeForumTopic then deleteForumTopic", async () => {
    const adapter = new TelegramAdapter({
      botToken: "test-token",
      ownerChatId: 123,
    });
    await adapter.deleteTopic("99");

    const bot = (Bot as unknown as ReturnType<typeof vi.fn>).mock.results.at(-1)
      .value;
    expect(bot.api.closeForumTopic).toHaveBeenCalledWith(123, 99);
    expect(bot.api.deleteForumTopic).toHaveBeenCalledWith(123, 99);
  });

  it("deleteTopic continues to delete even if close fails", async () => {
    const bot = (Bot as unknown as ReturnType<typeof vi.fn>).mock.results.at(-1)
      ?.value;

    const adapter = new TelegramAdapter({
      botToken: "test-token",
      ownerChatId: 123,
    });

    const botInstance = (Bot as unknown as ReturnType<typeof vi.fn>).mock
      .results.at(-1)!.value;
    botInstance.api.closeForumTopic.mockRejectedValueOnce(
      new Error("topic already closed"),
    );

    await adapter.deleteTopic("99");

    expect(botInstance.api.deleteForumTopic).toHaveBeenCalledWith(123, 99);
  });

  it("sendQuestion sends message with inline keyboard", async () => {
    const adapter = new TelegramAdapter({
      botToken: "test-token",
      ownerChatId: 123,
    });

    const msgId = await adapter.sendQuestion("thread-99", "Which library?", [
      { label: "React", description: "UI library" },
      { label: "Vue", description: "Progressive framework" },
    ], "q0", false);

    expect(msgId).toBe(42);

    const bot = (Bot as unknown as ReturnType<typeof vi.fn>).mock.results.at(-1)!.value;
    expect(bot.api.sendMessage).toHaveBeenCalledWith(
      123,
      "❓ *Which library?*\n\n• *React* — UI library\n• *Vue* — Progressive framework",
      expect.objectContaining({
        message_thread_id: 99,
        parse_mode: "Markdown",
        reply_markup: expect.anything(),
      }),
    );
  });

  it("sendQuestion with multiSelect includes Done button", async () => {
    const adapter = new TelegramAdapter({
      botToken: "test-token",
      ownerChatId: 123,
    });

    await adapter.sendQuestion("general", "Which features?", [
      { label: "Auth", description: "Authentication" },
      { label: "Logs", description: "Logging" },
    ], "q1", true);

    const bot = (Bot as unknown as ReturnType<typeof vi.fn>).mock.results.at(-1)!.value;
    expect(bot.api.sendMessage).toHaveBeenCalled();
  });

  it("fires onQuestionAnswer when q: callback received", () => {
    const adapter = new TelegramAdapter({
      botToken: "test-token",
      ownerChatId: 123,
    });

    const answers: Array<{ questionId: string; answer: string }> = [];
    adapter.onQuestionAnswer((questionId, answer) => {
      answers.push({ questionId, answer });
    });

    const bot = (Bot as unknown as ReturnType<typeof vi.fn>).mock.results.at(-1)!.value;

    // Find the callback_query handler
    const callbackCall = bot.on.mock.calls.find(
      (c: any[]) => c[0] === "callback_query:data",
    );
    expect(callbackCall).toBeDefined();
    const callbackHandler = callbackCall![1];

    // Simulate button tap: q:<questionId>:<optionIndex>
    callbackHandler({
      callbackQuery: {
        data: "q:q0:1",
        message: { text: "❓ *Which library?*" },
      },
      editMessageText: vi.fn(),
      answerCallbackQuery: vi.fn(),
    });

    expect(answers).toEqual([{ questionId: "q0", answer: "1" }]);
  });
});
