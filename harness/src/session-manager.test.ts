import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({
  exec: vi.fn(),
}));

import { exec } from "node:child_process";
import { TmuxSessionManager } from "./session-manager.js";

const execMock = vi.mocked(exec);

function mockExecSuccess(stdout = "") {
  execMock.mockImplementation((_cmd: any, cb: any) => {
    cb(null, stdout, "");
    return {} as any;
  });
}

function mockExecError(message = "command failed") {
  execMock.mockImplementation((_cmd: any, cb: any) => {
    cb(new Error(message), "", message);
    return {} as any;
  });
}

describe("TmuxSessionManager", () => {
  let manager: TmuxSessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new TmuxSessionManager();
  });

  it("creates tmux session with correct command", async () => {
    mockExecSuccess();

    await manager.createSession({
      name: "test-session",
      worktreePath: "/tmp/work",
      prompt: "do stuff",
    });

    const firstCall = execMock.mock.calls[0][0] as string;
    expect(firstCall).toContain("tmux new-session -d -s");
    expect(firstCall).toContain("-c");
    expect(firstCall).toContain("test-session");
    expect(firstCall).toContain("/tmp/work");
  });

  it("sends input via tmux send-keys", async () => {
    mockExecSuccess();

    await manager.sendInput("my-session", "hello world");

    const cmd = execMock.mock.calls[0][0] as string;
    expect(cmd).toContain("tmux send-keys -t my-session");
    expect(cmd).toContain("hello world");
    expect(cmd).toContain("Enter");
  });

  it("kills a tmux session", async () => {
    mockExecSuccess();

    await manager.killSession("my-session");

    const cmd = execMock.mock.calls[0][0] as string;
    expect(cmd).toContain("tmux kill-session -t my-session");
  });

  it("lists active sessions", async () => {
    mockExecSuccess("sess-1\nsess-2\nsess-3");

    const sessions = await manager.listSessions();

    expect(sessions).toEqual(["sess-1", "sess-2", "sess-3"]);
    const cmd = execMock.mock.calls[0][0] as string;
    expect(cmd).toContain("tmux list-sessions");
  });

  it("returns empty list when no sessions exist", async () => {
    mockExecError("no server running");

    const sessions = await manager.listSessions();

    expect(sessions).toEqual([]);
  });
});
