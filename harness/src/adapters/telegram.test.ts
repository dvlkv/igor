import { describe, it, expect, vi } from "vitest";

vi.mock("grammy", () => {
  const bot = {
    command: vi.fn(),
    on: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    api: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 42 }),
      editMessageText: vi.fn().mockResolvedValue(true),
      deleteMessage: vi.fn().mockResolvedValue(true),
      createForumTopic: vi.fn().mockResolvedValue({ message_thread_id: 99, name: "Test" }),
    },
  };
  return {
    Bot: vi.fn(function () { return bot; }),
    InlineKeyboard: vi.fn(function () { return { text: vi.fn().mockReturnThis() }; }),
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

    const bot = (Bot as unknown as ReturnType<typeof vi.fn>).mock.results[0]
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

    const bot = (Bot as unknown as ReturnType<typeof vi.fn>).mock.results[0]
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

    const bot = (Bot as unknown as ReturnType<typeof vi.fn>).mock.results[0]
      .value;
    expect(bot.api.sendMessage).toHaveBeenCalledWith(123, "Hello topic", {
      message_thread_id: 99,
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

    const bot = (Bot as unknown as ReturnType<typeof vi.fn>).mock.results[0]
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

    const bot = (Bot as unknown as ReturnType<typeof vi.fn>).mock.results[0]
      .value;
    expect(bot.api.deleteMessage).toHaveBeenCalledWith(123, 42);
  });
});
