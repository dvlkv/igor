import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { loadConfig } from "./config.js";

vi.mock("node:fs");

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
      general: { claudeArgs: [], projectDir: "/proj" },
      bridge: { wsPort: 9100, channelBridgePath: "./bridge.js" },
      memory: { ingestIntervalMs: 1000, bufferDir: "/tmp" },
      webhookPort: 3000,
      stateFile: "state.json",
      worktreeDir: "/work",
    });

    mockedReadFileSync.mockReturnValue(configJson);

    const config = loadConfig("/fake/config.json");

    expect(config.telegram.botToken).toBe("secret-token");
    expect(config.slack.botToken).toBe("app-token");
    expect(config.slack.appToken).toBe("literal");
    expect(config.telegram.ownerChatId).toBe(123);
    expect(config.bridge.wsPort).toBe(9100);
    expect(config.bridge.channelBridgePath).toBe("./bridge.js");
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
