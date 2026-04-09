import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

vi.mock("node:fs", () => ({
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { ClaudeSessionManager } from "./session-manager.js";
import { EventEmitter } from "node:events";

const spawnMock = vi.mocked(spawn);
const writeFileMock = vi.mocked(writeFileSync);

function createMockProcess() {
  const proc = new EventEmitter() as any;
  proc.pid = 12345;
  proc.exitCode = null;
  proc.kill = vi.fn(() => {
    proc.exitCode = 0;
    queueMicrotask(() => proc.emit("exit", 0, null));
  });
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  return proc;
}

describe("ClaudeSessionManager", () => {
  let manager: ClaudeSessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new ClaudeSessionManager({
      bridgeWsPort: 9100,
      channelBridgePath: "/path/to/channel-bridge.js",
    });
  });

  it("spawns claude with correct args", async () => {
    const mockProc = createMockProcess();
    spawnMock.mockReturnValue(mockProc as any);

    await manager.createSession({
      name: "test-session",
      worktreePath: "/tmp/work",
      prompt: "do stuff",
      systemPrompt: "You are igor",
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = spawnMock.mock.calls[0];
    expect(cmd).toBe("claude");
    expect(args).toContain("--print");
    expect(args).toContain("--input-format");
    expect(args).toContain("stream-json");
    expect(args).toContain("--dangerously-skip-permissions");
    expect(args).toContain("--system-prompt");
    expect(args).toContain("You are igor");
    expect(args).toContain("-p");
    expect(args).toContain("do stuff");
    expect((opts as any).cwd).toBe("/tmp/work");
  });

  it("writes MCP config with session ID and WS URL", async () => {
    const mockProc = createMockProcess();
    spawnMock.mockReturnValue(mockProc as any);

    await manager.createSession({
      name: "my-session",
      worktreePath: "/tmp/work",
      prompt: "hello",
    });

    expect(writeFileMock).toHaveBeenCalled();
    const configContent = writeFileMock.mock.calls[0][1] as string;
    const config = JSON.parse(configContent);
    expect(config.mcpServers.harness.env.SESSION_ID).toBe("my-session");
    expect(config.mcpServers.harness.env.BRIDGE_WS_URL).toBe(
      "ws://127.0.0.1:9100",
    );
  });

  it("tracks alive sessions", async () => {
    const mockProc = createMockProcess();
    spawnMock.mockReturnValue(mockProc as any);

    await manager.createSession({
      name: "sess-1",
      worktreePath: "/tmp/work",
      prompt: "hello",
    });

    expect(manager.isAlive("sess-1")).toBe(true);
    expect(manager.listSessions()).toEqual(["sess-1"]);
  });

  it("kills a session", async () => {
    const mockProc = createMockProcess();
    spawnMock.mockReturnValue(mockProc as any);

    await manager.createSession({
      name: "sess-1",
      worktreePath: "/tmp/work",
      prompt: "hello",
    });

    await manager.killSession("sess-1");

    expect(mockProc.kill).toHaveBeenCalledWith("SIGTERM");
    expect(manager.isAlive("sess-1")).toBe(false);
  });

  it("returns pid from createSession", async () => {
    const mockProc = createMockProcess();
    mockProc.pid = 42;
    spawnMock.mockReturnValue(mockProc as any);

    const pid = await manager.createSession({
      name: "sess-1",
      worktreePath: "/tmp/work",
      prompt: "hello",
    });

    expect(pid).toBe(42);
  });
});
