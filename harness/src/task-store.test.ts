import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Task } from "./types.js";

vi.mock("node:fs");

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { TaskStore } from "./task-store.js";

const mExistsSync = vi.mocked(existsSync);
const mReadFileSync = vi.mocked(readFileSync);
const mWriteFileSync = vi.mocked(writeFileSync);

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    taskId: "task-1",
    projectName: "igor",
    source: "telegram",
    title: "Test task",
    worktreePath: "/tmp/wt",
    branch: "igor/task-1",
    sessionId: "sess-1",
    status: "active",
    createdAt: "2026-04-10T00:00:00Z",
    ...overrides,
  };
}

describe("TaskStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts empty when no file exists", () => {
    mExistsSync.mockReturnValue(false);
    const store = new TaskStore("/tmp/tasks.json");
    expect(store.getAll()).toEqual([]);
  });

  it("loads existing tasks from disk", () => {
    const task = makeTask();
    mExistsSync.mockReturnValue(true);
    mReadFileSync.mockReturnValue(JSON.stringify({ tasks: [task] }));

    const store = new TaskStore("/tmp/tasks.json");
    expect(store.getAll()).toEqual([task]);
  });

  it("saves and retrieves a task", () => {
    mExistsSync.mockReturnValue(false);
    const store = new TaskStore("/tmp/tasks.json");
    store.save(makeTask());

    expect(store.get("task-1")).toBeDefined();
    expect(mWriteFileSync).toHaveBeenCalled();
  });

  it("updates a task", () => {
    mExistsSync.mockReturnValue(false);
    const store = new TaskStore("/tmp/tasks.json");
    store.save(makeTask());

    store.update("task-1", { status: "completed" });
    expect(store.get("task-1")?.status).toBe("completed");
  });

  it("filters by project", () => {
    mExistsSync.mockReturnValue(false);
    const store = new TaskStore("/tmp/tasks.json");
    store.save(makeTask({ taskId: "a", projectName: "igor" }));
    store.save(makeTask({ taskId: "b", projectName: "other" }));
    store.save(makeTask({ taskId: "c", projectName: "igor" }));

    expect(store.getByProject("igor")).toHaveLength(2);
    expect(store.getByProject("other")).toHaveLength(1);
  });

  it("finds by telegram thread", () => {
    mExistsSync.mockReturnValue(false);
    const store = new TaskStore("/tmp/tasks.json");
    store.save(makeTask({ telegramThreadId: "tg-42" }));

    expect(store.findByTelegramThread("tg-42")?.taskId).toBe("task-1");
    expect(store.findByTelegramThread("missing")).toBeUndefined();
  });

  it("finds by slack thread", () => {
    mExistsSync.mockReturnValue(false);
    const store = new TaskStore("/tmp/tasks.json");
    store.save(
      makeTask({ slackChannelId: "C123", slackThreadTs: "1234.5678" }),
    );

    expect(store.findBySlackThread("C123", "1234.5678")?.taskId).toBe(
      "task-1",
    );
    expect(store.findBySlackThread("C999", "1234.5678")).toBeUndefined();
  });

  it("finds by linear issue", () => {
    mExistsSync.mockReturnValue(false);
    const store = new TaskStore("/tmp/tasks.json");
    store.save(makeTask({ linearIssueId: "LIN-42" }));

    expect(store.findByLinearIssue("LIN-42")?.taskId).toBe("task-1");
  });

  it("finds by github issue", () => {
    mExistsSync.mockReturnValue(false);
    const store = new TaskStore("/tmp/tasks.json");
    store.save(makeTask({ githubIssueNumber: 99 }));

    expect(store.findByGithubIssue(99)?.taskId).toBe("task-1");
  });

  it("returns active tasks only", () => {
    mExistsSync.mockReturnValue(false);
    const store = new TaskStore("/tmp/tasks.json");
    store.save(makeTask({ taskId: "a", status: "active" }));
    store.save(makeTask({ taskId: "b", status: "completed" }));
    store.save(makeTask({ taskId: "c", status: "abandoned" }));

    expect(store.getActive()).toHaveLength(1);
    expect(store.getActive()[0].taskId).toBe("a");
  });

  it("finds task by branch name", () => {
    mExistsSync.mockReturnValue(false);
    const store = new TaskStore("/tmp/tasks.json");
    store.save({
      taskId: "TASK-1",
      projectName: "igor",
      source: "github",
      title: "Fix bug",
      worktreePath: "/tmp/worktrees/TASK-1",
      branch: "igor/TASK-1",
      sessionId: "TASK-1",
      status: "active",
      createdAt: "2026-04-10T00:00:00Z",
    });
    expect(store.findByBranch("igor/TASK-1")).toEqual(
      expect.objectContaining({ taskId: "TASK-1" }),
    );
    expect(store.findByBranch("nonexistent")).toBeUndefined();
  });
});
