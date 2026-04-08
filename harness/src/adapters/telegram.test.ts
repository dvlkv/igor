import { describe, it, expect, vi } from "vitest";

vi.mock("grammy", () => {
  const bot = {
    command: vi.fn(),
    on: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    api: { sendMessage: vi.fn().mockResolvedValue({ message_id: 42 }) },
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
});
