import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { loadConfig } from "./config.js";

vi.mock("node:fs");

// Mock storage.ts to avoid os.homedir() side effects in tests
vi.mock("./storage.js", () => {
  return {
    defaultStorageConfig: vi.fn((igorDir: string) => ({
      projectsDir: "/home/test/projects",
      igorDir,
      worktreeDir: "/home/test/.igor/worktrees",
      logsDir: "/home/test/.igor/logs",
      projectsFile: "/home/test/.igor/projects.json",
      tasksFile: "/home/test/.igor/tasks.json",
      memoryBufferDir: "/home/test/.igor/memory-buffer",
    })),
  };
});

const mockedReadFileSync = vi.mocked(readFileSync);

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
    const configJson = JSON.stringify({
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
    });

    mockedReadFileSync.mockReturnValue(configJson);

    const config = loadConfig("/fake/config.json");

    expect(config.telegram.botToken).toBe("secret-token");
    expect(config.slack.botToken).toBe("app-token");
    expect(config.slack.appToken).toBe("literal");
    expect(config.telegram.ownerChatId).toBe(123);
    expect(config.storage.worktreeDir).toBe("/work");
    expect(config.storage.memoryBufferDir).toBe("/buf");
  });

  it("migrates legacy config fields to storage", () => {
    const configJson = JSON.stringify({
      telegram: { botToken: "", ownerChatId: 0 },
      slack: { botToken: "", appToken: "", channelProjectMap: {} },
      linear: { webhookSecret: "", assigneeId: "" },
      github: { webhookSecret: "", assigneeLogin: "" },
      general: { claudeArgs: [], projectDir: "/old/project" },
      memory: { ingestIntervalMs: 1000, bufferDir: "/old/buffers" },
      webhookPort: 3000,
      stateFile: "/old/state.json",
      worktreeDir: "/old/worktrees",
    });

    mockedReadFileSync.mockReturnValue(configJson);

    const config = loadConfig("/fake/config.json");

    // Legacy fields should be migrated into storage
    expect(config.storage).toBeDefined();
    expect(config.storage.worktreeDir).toBe("/old/worktrees");
    expect(config.storage.memoryBufferDir).toBe("/old/buffers");
    expect(config.storage.igorDir).toBe("/old/project");

    // Legacy fields should be stripped
    expect((config as any).stateFile).toBeUndefined();
    expect((config as any).worktreeDir).toBeUndefined();
    expect((config as any).general?.projectDir).toBeUndefined();
    expect((config as any).memory?.bufferDir).toBeUndefined();
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
    });

    mockedReadFileSync.mockReturnValue(configJson);

    const config = loadConfig("/fake/config.json");
    expect(config.telegram.botToken).toBe("");
  });
});
