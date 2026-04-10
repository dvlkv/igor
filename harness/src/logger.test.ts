import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs");

import { appendFileSync, mkdirSync } from "node:fs";
import { Logger } from "./logger.js";

const mAppendFileSync = vi.mocked(appendFileSync);
const mMkdirSync = vi.mocked(mkdirSync);

describe("Logger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-10T12:00:00Z"));
  });

  it("writes message logs to messages subdirectory", () => {
    const logger = new Logger("/tmp/logs");
    logger.logMessage("igor", "telegram", "user", "hello world");

    expect(mMkdirSync).toHaveBeenCalledWith("/tmp/logs/messages", {
      recursive: true,
    });
    expect(mAppendFileSync).toHaveBeenCalledWith(
      "/tmp/logs/messages/2026-04-10.jsonl",
      expect.stringContaining('"category":"message"'),
      "utf-8",
    );
  });

  it("writes memory logs to memory subdirectory", () => {
    const logger = new Logger("/tmp/logs");
    logger.logMemoryIngestion("my-project", 5, "/tmp/buffer/my-project.json");

    expect(mAppendFileSync).toHaveBeenCalledWith(
      "/tmp/logs/memory/2026-04-10.jsonl",
      expect.stringContaining('"category":"memory"'),
      "utf-8",
    );
  });

  it("writes task events to tasks subdirectory", () => {
    const logger = new Logger("/tmp/logs");
    logger.logTaskEvent("task-1", "igor", "created", { branch: "igor/task-1" });

    expect(mAppendFileSync).toHaveBeenCalledWith(
      "/tmp/logs/tasks/2026-04-10.jsonl",
      expect.stringContaining('"event":"created"'),
      "utf-8",
    );
  });

  it("writes valid JSONL (one JSON object per line)", () => {
    const logger = new Logger("/tmp/logs");
    logger.logMessage("igor", "telegram", "user", "test");

    const written = mAppendFileSync.mock.calls[0][1] as string;
    expect(written.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(written.trim());
    expect(parsed.category).toBe("message");
    expect(parsed.data.text).toBe("test");
  });

  it("includes project and timestamp in all entries", () => {
    const logger = new Logger("/tmp/logs");
    logger.logMessage("my-proj", "slack", "bot", "hi");

    const written = mAppendFileSync.mock.calls[0][1] as string;
    const parsed = JSON.parse(written.trim());
    expect(parsed.project).toBe("my-proj");
    expect(parsed.timestamp).toBe("2026-04-10T12:00:00.000Z");
  });
});
