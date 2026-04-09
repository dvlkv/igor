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
    },
  };
  return { Bot: vi.fn(() => bot) };
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

  it("creates a thread by sending root message and returns message_id as string", async () => {
    const adapter = new TelegramAdapter({
      botToken: "test-token",
      ownerChatId: 123,
    });
    const threadId = await adapter.createThread("Test Thread");
    expect(threadId).toBe("42");

    const bot = (Bot as unknown as ReturnType<typeof vi.fn>).mock.results[0]
      .value;
    expect(bot.api.sendMessage).toHaveBeenCalledWith(123, "Test Thread");
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
