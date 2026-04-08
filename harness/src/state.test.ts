import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TaskSession } from "./types.js";

vi.mock("node:fs");

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { StateStore } from "./state.js";

const mExistsSync = vi.mocked(existsSync);
const mReadFileSync = vi.mocked(readFileSync);
const mWriteFileSync = vi.mocked(writeFileSync);

function makeSession(overrides: Partial<TaskSession> = {}): TaskSession {
  return {
    taskId: "task-1",
    source: "telegram",
    title: "Test task",
    worktreePath: "/tmp/wt",
    branch: "feat/test",
    tmuxSession: "sess-1",
    telegramThreadId: "thread-1",
    status: "active",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("StateStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts empty when no file exists", () => {
    mExistsSync.mockReturnValue(false);
    const store = new StateStore("/tmp/state.json");
    expect(store.getAll()).toEqual([]);
  });

  it("loads existing state from disk", () => {
    const session = makeSession();
    mExistsSync.mockReturnValue(true);
    mReadFileSync.mockReturnValue(JSON.stringify({ sessions: [session] }));

    const store = new StateStore("/tmp/state.json");
    expect(store.getAll()).toEqual([session]);
  });

  it("saves and retrieves a session", () => {
    mExistsSync.mockReturnValue(false);
    const store = new StateStore("/tmp/state.json");
    const session = makeSession();

    store.save(session);

    expect(store.get("task-1")).toEqual(session);
    expect(mWriteFileSync).toHaveBeenCalled();
  });

  it("updates a session", () => {
    mExistsSync.mockReturnValue(false);
    const store = new StateStore("/tmp/state.json");
    store.save(makeSession());

    store.update("task-1", { status: "completed" });

    expect(store.get("task-1")?.status).toBe("completed");
    expect(mWriteFileSync).toHaveBeenCalledTimes(2);
  });

  it("finds by telegram thread ID", () => {
    mExistsSync.mockReturnValue(false);
    const store = new StateStore("/tmp/state.json");
    store.save(makeSession({ telegramThreadId: "t-42" }));

    expect(store.findByTelegramThread("t-42")?.taskId).toBe("task-1");
    expect(store.findByTelegramThread("missing")).toBeUndefined();
  });

  it("returns active sessions only", () => {
    mExistsSync.mockReturnValue(false);
    const store = new StateStore("/tmp/state.json");
    store.save(makeSession({ taskId: "a", status: "active" }));
    store.save(makeSession({ taskId: "b", status: "completed" }));
    store.save(makeSession({ taskId: "c", status: "active" }));

    const active = store.getActive();
    expect(active).toHaveLength(2);
    expect(active.map((s) => s.taskId)).toEqual(["a", "c"]);
  });
});
