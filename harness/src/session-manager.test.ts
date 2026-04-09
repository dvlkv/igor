import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import { spawn } from "node:child_process";
import { ClaudeSessionManager } from "./session-manager.js";
import { EventEmitter } from "node:events";

const spawnMock = vi.mocked(spawn);

function createMockProcess() {
  const proc = new EventEmitter() as any;
  proc.pid = 12345;
  proc.exitCode = null;
  proc.kill = vi.fn(() => {
    proc.exitCode = 0;
    queueMicrotask(() => proc.emit("exit", 0, null));
  });
  proc.stdin = { writable: true, write: vi.fn() };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  return proc;
}

describe("ClaudeSessionManager", () => {
  let manager: ClaudeSessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new ClaudeSessionManager();
  });

  it("spawns claude with stream-json args", async () => {
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
    expect(args).toContain("--output-format");
    expect(args).toContain("stream-json");
    expect(args).toContain("--input-format");
    expect(args).toContain("--dangerously-skip-permissions");
    expect(args).toContain("--system-prompt");
    expect(args).toContain("You are igor");
    expect(args).not.toContain("--mcp-config");
    expect(args).not.toContain("--dangerously-load-development-channels");
    expect((opts as any).cwd).toBe("/tmp/work");
  });

  it("sends initial prompt via stdin", async () => {
    const mockProc = createMockProcess();
    spawnMock.mockReturnValue(mockProc as any);

    await manager.createSession({
      name: "test-session",
      worktreePath: "/tmp/work",
      prompt: "do stuff",
    });

    expect(mockProc.stdin.write).toHaveBeenCalledTimes(1);
    const written = mockProc.stdin.write.mock.calls[0][0];
    const parsed = JSON.parse(written.trim());
    expect(parsed.type).toBe("user");
    expect(parsed.message.content).toBe("do stuff");
  });

  it("emits output on result event", async () => {
    const mockProc = createMockProcess();
    spawnMock.mockReturnValue(mockProc as any);

    const outputs: string[] = [];
    manager.onOutput((_id, text) => outputs.push(text));

    await manager.createSession({
      name: "test-session",
      worktreePath: "/tmp/work",
      prompt: "hello",
    });

    // Simulate Claude result output
    const resultEvent = JSON.stringify({
      type: "result",
      result: "Here is my response",
    });
    mockProc.stdout.emit("data", Buffer.from(resultEvent + "\n"));

    expect(outputs).toEqual(["Here is my response"]);
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

  it("sends follow-up messages via stdin", async () => {
    const mockProc = createMockProcess();
    spawnMock.mockReturnValue(mockProc as any);

    await manager.createSession({
      name: "sess-1",
      worktreePath: "/tmp/work",
      prompt: "hello",
    });

    manager.sendMessage("sess-1", "follow up");

    expect(mockProc.stdin.write).toHaveBeenCalledTimes(2); // initial + follow-up
    const written = mockProc.stdin.write.mock.calls[1][0];
    const parsed = JSON.parse(written.trim());
    expect(parsed.message.content).toBe("follow up");
  });
});
