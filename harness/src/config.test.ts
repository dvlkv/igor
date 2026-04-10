import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { loadConfig } from "./config.js";

vi.mock("node:fs");

const mockedReadFileSync = vi.mocked(readFileSync);

function makeConfigJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    telegram: { botToken: "$TEST_BOT_TOKEN", ownerChatId: 123 },
    slack: {
      botToken: "$TEST_APP_TOKEN",
      appToken: "literal",
      channelProjectMap: {},
    },
    linear: { webhookSecret: "ws", assigneeId: "a1" },
    github: { webhookSecret: "gs", assigneeLogin: "user" },
    general: { claudeArgs: [], systemPrompt: "hello" },
    memory: { ingestIntervalMs: 1000 },
    storage: {
      projectsDir: "/proj",
      igorDir: "/igor",
      worktreeDir: "/work",
      logsDir: "/logs",
      projectsFile: "/proj.json",
      tasksFile: "/tasks.json",
      memoryBufferDir: "/buf",
    },
    webhookPort: 3000,
    ...overrides,
  });
}

describe("loadConfig", () => {
  beforeEach(() => {
    process.env.TEST_BOT_TOKEN = "secret-token";
    process.env.TEST_APP_TOKEN = "app-token";
  });

  afterEach(() => {
    delete process.env.TEST_BOT_TOKEN;
    delete process.env.TEST_APP_TOKEN;
    vi.restoreAllMocks();
  });

  it("loads config and resolves env vars", () => {
    mockedReadFileSync.mockReturnValue(makeConfigJson());

    const config = loadConfig("/fake/config.json");

    expect(config.telegram.botToken).toBe("secret-token");
    expect(config.slack.botToken).toBe("app-token");
    expect(config.slack.appToken).toBe("literal");
    expect(config.telegram.ownerChatId).toBe(123);
    expect(config.storage.worktreeDir).toBe("/work");
    expect(config.storage.memoryBufferDir).toBe("/buf");
  });

  it("throws if storage block is missing", () => {
    const configJson = JSON.stringify({
      telegram: { botToken: "", ownerChatId: 0 },
      general: { claudeArgs: [] },
      memory: { ingestIntervalMs: 1000 },
      webhookPort: 3000,
    });

    mockedReadFileSync.mockReturnValue(configJson);

    expect(() => loadConfig("/fake/config.json")).toThrow(
      "Missing required 'storage' block",
    );
  });

  it("throws if config file is missing", () => {
    mockedReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT: no such file or directory");
    });

    expect(() => loadConfig("/nonexistent.json")).toThrow();
  });

  it("returns empty string for unset env var", () => {
    const configJson = JSON.stringify({
      telegram: { botToken: "$MISSING_VAR", ownerChatId: 0 },
      storage: {
        projectsDir: "/p",
        igorDir: "/i",
        worktreeDir: "/w",
        logsDir: "/l",
        projectsFile: "/pf",
        tasksFile: "/tf",
        memoryBufferDir: "/mb",
      },
    });

    mockedReadFileSync.mockReturnValue(configJson);

    const config = loadConfig("/fake/config.json");
    expect(config.telegram.botToken).toBe("");
  });
});
