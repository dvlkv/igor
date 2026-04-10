# Task Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cleanup logic that kills Claude sessions, removes worktrees, handles branches, and notifies Telegram when a task completes — triggered by Telegram `/done`, MCP tool, GitHub PR merge, or Linear issue cancellation.

**Architecture:** Single `Orchestrator.completeTask(taskId)` method owns the full cleanup sequence. Three trigger categories (Telegram command, MCP tool via HTTP endpoint, adapter webhooks) all resolve a task ID and call this method. The MCP server proxies to the harness via `POST /tasks/:taskId/complete`.

**Tech Stack:** TypeScript, grammy (Telegram), express (HTTP), @modelcontextprotocol/sdk (MCP), vitest (testing)

---

### Task 1: Add `findByBranch` to TaskStore

**Files:**
- Modify: `harness/src/task-store.ts`
- Modify: `harness/src/task-store.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `harness/src/task-store.test.ts`:

```typescript
it("finds task by branch name", () => {
  const store = new TaskStore("/tmp/test-tasks.json");
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd harness && npx vitest run task-store.test.ts`
Expected: FAIL — `findByBranch` is not a function

- [ ] **Step 3: Write minimal implementation**

Add to `harness/src/task-store.ts`, after the `findByGithubIssue` method:

```typescript
findByBranch(branch: string): Task | undefined {
  return this.data.tasks.find((t) => t.branch === branch);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd harness && npx vitest run task-store.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add harness/src/task-store.ts harness/src/task-store.test.ts
git commit -m "feat(task-store): add findByBranch method"
```

---

### Task 2: Add `completeTask` to Orchestrator

**Files:**
- Modify: `harness/src/orchestrator.ts`
- Modify: `harness/src/orchestrator.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the `describe("Orchestrator")` block in `harness/src/orchestrator.test.ts`:

```typescript
describe("completeTask", () => {
  it("kills session, updates task, cleans up maps", async () => {
    const mockTask: Task = {
      taskId: "LIN-123",
      projectName: "igor",
      source: "linear",
      title: "Fix the bug",
      worktreePath: "/tmp/worktrees/LIN-123",
      branch: "igor/LIN-123",
      sessionId: "LIN-123",
      telegramThreadId: "thread-456",
      status: "active",
      createdAt: new Date().toISOString(),
      claudePid: 12345,
    };

    (taskStore.get as ReturnType<typeof vi.fn>).mockReturnValue(mockTask);
    (sessionManager.isAlive as ReturnType<typeof vi.fn>).mockReturnValue(
      true,
    );

    // Mock exec to report branch as merged
    const { exec } = await import("node:child_process");
    (exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (cmd: string, cb: Function) => {
        if (cmd.includes("branch --merged")) {
          cb(null, "  main\n  igor/LIN-123\n", "");
        } else {
          cb(null, "", "");
        }
      },
    );

    const orchestrator = new Orchestrator({
      adapters: [telegramAdapter],
      telegram: telegramAdapter as any,
      taskStore,
      sessionManager,
      memoryIngestion,
      worktreeDir: "/tmp/worktrees",
      generalProjectDir: "/tmp/project",
      generalClaudeArgs: [],
    });

    await orchestrator.completeTask("LIN-123");

    expect(sessionManager.killSession).toHaveBeenCalledWith("LIN-123");
    expect(taskStore.update).toHaveBeenCalledWith(
      "LIN-123",
      expect.objectContaining({
        status: "completed",
        claudePid: undefined,
      }),
    );
    expect(telegramAdapter.sendMessage).toHaveBeenCalledWith(
      "thread-456",
      expect.stringContaining("completed"),
    );
  });

  it("skips if task not found", async () => {
    (taskStore.get as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    const orchestrator = new Orchestrator({
      adapters: [telegramAdapter],
      telegram: telegramAdapter as any,
      taskStore,
      sessionManager,
      memoryIngestion,
      worktreeDir: "/tmp/worktrees",
      generalProjectDir: "/tmp/project",
      generalClaudeArgs: [],
    });

    await orchestrator.completeTask("NONEXISTENT");

    expect(sessionManager.killSession).not.toHaveBeenCalled();
    expect(taskStore.update).not.toHaveBeenCalled();
  });

  it("skips if task already completed", async () => {
    const mockTask: Task = {
      taskId: "LIN-123",
      projectName: "igor",
      source: "linear",
      title: "Fix the bug",
      worktreePath: "/tmp/worktrees/LIN-123",
      branch: "igor/LIN-123",
      sessionId: "LIN-123",
      status: "completed",
      createdAt: new Date().toISOString(),
    };

    (taskStore.get as ReturnType<typeof vi.fn>).mockReturnValue(mockTask);

    const orchestrator = new Orchestrator({
      adapters: [telegramAdapter],
      telegram: telegramAdapter as any,
      taskStore,
      sessionManager,
      memoryIngestion,
      worktreeDir: "/tmp/worktrees",
      generalProjectDir: "/tmp/project",
      generalClaudeArgs: [],
    });

    await orchestrator.completeTask("LIN-123");

    expect(sessionManager.killSession).not.toHaveBeenCalled();
    expect(taskStore.update).not.toHaveBeenCalled();
  });

  it("keeps unmerged branch and mentions it in summary", async () => {
    const mockTask: Task = {
      taskId: "LIN-456",
      projectName: "igor",
      source: "linear",
      title: "Add feature",
      worktreePath: "/tmp/worktrees/LIN-456",
      branch: "igor/LIN-456",
      sessionId: "LIN-456",
      telegramThreadId: "thread-789",
      status: "active",
      createdAt: new Date().toISOString(),
    };

    (taskStore.get as ReturnType<typeof vi.fn>).mockReturnValue(mockTask);

    // Branch NOT in merged list
    const { exec } = await import("node:child_process");
    (exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (cmd: string, cb: Function) => {
        if (cmd.includes("branch --merged")) {
          cb(null, "  main\n", "");
        } else {
          cb(null, "", "");
        }
      },
    );

    const orchestrator = new Orchestrator({
      adapters: [telegramAdapter],
      telegram: telegramAdapter as any,
      taskStore,
      sessionManager,
      memoryIngestion,
      worktreeDir: "/tmp/worktrees",
      generalProjectDir: "/tmp/project",
      generalClaudeArgs: [],
    });

    await orchestrator.completeTask("LIN-456");

    expect(telegramAdapter.sendMessage).toHaveBeenCalledWith(
      "thread-789",
      expect.stringContaining("kept"),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd harness && npx vitest run orchestrator.test.ts`
Expected: FAIL — `completeTask` is not a function

- [ ] **Step 3: Write the implementation**

Add to `harness/src/orchestrator.ts`, inside the `Orchestrator` class after `handleMessage`:

```typescript
async completeTask(taskId: string): Promise<void> {
  const task = this.taskStore.get(taskId);
  if (!task || task.status === "completed" || task.status === "abandoned") {
    console.log(`[cleanup] task "${taskId}" not found or already done`);
    return;
  }

  console.log(`[cleanup] completing task "${taskId}"`);

  // 1. Kill Claude session
  try {
    if (this.sessionManager.isAlive(task.sessionId)) {
      await this.sessionManager.killSession(task.sessionId);
      console.log(`[cleanup] killed session "${task.sessionId}"`);
    }
  } catch (err: any) {
    console.log(`[cleanup] session kill failed: ${err.message}`);
  }

  // 2. Check if branch is merged and handle worktree + branch
  let branchMerged = false;
  let branchMessage = "";
  try {
    const mergedOutput = await run(
      `git branch --merged main`,
    );
    branchMerged = mergedOutput
      .split("\n")
      .map((b) => b.trim())
      .includes(task.branch);
  } catch (err: any) {
    console.log(`[cleanup] merge check failed: ${err.message}`);
  }

  // 3. Remove worktree
  try {
    if (branchMerged) {
      await run(`git worktree remove ${task.worktreePath}`);
    } else {
      await run(`git worktree remove --force ${task.worktreePath}`);
    }
    console.log(`[cleanup] removed worktree "${task.worktreePath}"`);
  } catch (err: any) {
    console.log(`[cleanup] worktree remove failed: ${err.message}`);
  }

  // 4. Delete branch if merged, keep if not
  if (branchMerged) {
    try {
      await run(`git branch -d ${task.branch}`);
      branchMessage = `Branch \`${task.branch}\` deleted.`;
      console.log(`[cleanup] deleted branch "${task.branch}"`);
    } catch (err: any) {
      branchMessage = `Branch \`${task.branch}\` kept (delete failed).`;
      console.log(`[cleanup] branch delete failed: ${err.message}`);
    }
  } else {
    branchMessage = `Branch \`${task.branch}\` kept (not merged).`;
  }

  // 5. Update task status
  this.taskStore.update(taskId, {
    status: "completed",
    completedAt: new Date().toISOString(),
    claudePid: undefined,
  });

  // 6. Notify Telegram
  if (this.telegram?.sendMessage && task.telegramThreadId) {
    try {
      await this.telegram.sendMessage(
        task.telegramThreadId,
        `Task completed. ${branchMessage}`,
      );
    } catch (err: any) {
      console.log(`[cleanup] telegram notify failed: ${err.message}`);
    }
  }

  // 7. Clean up internal maps
  this.replyContext.delete(task.sessionId);
  this.progressMessages.delete(task.sessionId);

  console.log(`[cleanup] task "${taskId}" completed`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd harness && npx vitest run orchestrator.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add harness/src/orchestrator.ts harness/src/orchestrator.test.ts
git commit -m "feat(orchestrator): add completeTask cleanup method"
```

---

### Task 3: Add `/done` command to TelegramAdapter

**Files:**
- Modify: `harness/src/adapters/telegram.ts`
- Modify: `harness/src/adapters/telegram.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `describe("TelegramAdapter")` in `harness/src/adapters/telegram.test.ts`:

```typescript
it("registers /done command handler", () => {
  const adapter = new TelegramAdapter({
    botToken: "test-token",
    ownerChatId: 123,
  });

  const bot = (Bot as unknown as ReturnType<typeof vi.fn>).mock.results[0]
    .value;
  expect(bot.command).toHaveBeenCalledWith("done", expect.any(Function));
});

it("fires onTaskCompleted with taskId from argument", () => {
  const adapter = new TelegramAdapter({
    botToken: "test-token",
    ownerChatId: 123,
  });

  const completedTasks: string[] = [];
  adapter.onTaskCompleted((taskId) => completedTasks.push(taskId));

  const bot = (Bot as unknown as ReturnType<typeof vi.fn>).mock.results[0]
    .value;
  const doneHandler = bot.command.mock.calls.find(
    (c: any[]) => c[0] === "done",
  )?.[1];

  doneHandler({
    message: { text: "/done LIN-123", message_thread_id: undefined },
    reply: vi.fn(),
  });

  expect(completedTasks).toEqual(["LIN-123"]);
});

it("fires onTaskCompleted with threadId when no argument given", () => {
  const adapter = new TelegramAdapter({
    botToken: "test-token",
    ownerChatId: 123,
  });

  const completedThreads: string[] = [];
  adapter.onTaskCompleted((_taskId, threadId) =>
    completedThreads.push(threadId ?? ""),
  );

  const bot = (Bot as unknown as ReturnType<typeof vi.fn>).mock.results[0]
    .value;
  const doneHandler = bot.command.mock.calls.find(
    (c: any[]) => c[0] === "done",
  )?.[1];

  doneHandler({
    message: { text: "/done", message_thread_id: 456 },
    reply: vi.fn(),
  });

  expect(completedThreads).toEqual(["456"]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd harness && npx vitest run adapters/telegram.test.ts`
Expected: FAIL — `onTaskCompleted` is not a function

- [ ] **Step 3: Write the implementation**

In `harness/src/adapters/telegram.ts`:

Add a new handler array in the class fields (after `clearHandlers`):

```typescript
private taskCompletedHandlers: Array<
  (taskId: string | undefined, threadId: string | undefined) => void
> = [];
```

Add the `/done` command handler in the constructor (after the `/clear` command):

```typescript
this.bot.command("done", (ctx) => {
  const text = ctx.message?.text ?? "";
  const arg = text.replace(/^\/done\s*/, "").trim();
  const threadId = ctx.message?.message_thread_id?.toString();

  const taskId = arg || undefined;

  for (const handler of this.taskCompletedHandlers) {
    handler(taskId, threadId);
  }
});
```

Add the `onTaskCompleted` method (after `onClear`):

```typescript
onTaskCompleted(
  handler: (taskId: string | undefined, threadId: string | undefined) => void,
): void {
  this.taskCompletedHandlers.push(handler);
}
```

Update the `setMyCommands` call in `start()` to include the `/done` command:

```typescript
await this.bot.api.setMyCommands([
  {
    command: "task",
    description: "Create a new task — /task Title\\nDescription",
  },
  {
    command: "done",
    description: "Complete a task — /done [taskId] or use in task thread",
  },
  {
    command: "clear",
    description: "Clear and restart the general Claude session",
  },
]);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd harness && npx vitest run adapters/telegram.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add harness/src/adapters/telegram.ts harness/src/adapters/telegram.test.ts
git commit -m "feat(telegram): add /done command for task completion"
```

---

### Task 4: Wire Telegram `/done` to Orchestrator

**Files:**
- Modify: `harness/src/orchestrator.ts`
- Modify: `harness/src/orchestrator.test.ts`
- Modify: `harness/src/index.ts`

- [ ] **Step 1: Write the failing test**

Add to `describe("Orchestrator")` in `harness/src/orchestrator.test.ts`. First add `onTaskCompleted` to the mock telegram adapter. In the `createMockTelegramAdapter` function, add:

```typescript
onTaskCompleted: vi.fn(),
```

Then add the test:

```typescript
it("wires telegram onTaskCompleted to completeTask", async () => {
  const mockTask: Task = {
    taskId: "LIN-123",
    projectName: "igor",
    source: "linear",
    title: "Fix the bug",
    worktreePath: "/tmp/worktrees/LIN-123",
    branch: "igor/LIN-123",
    sessionId: "LIN-123",
    telegramThreadId: "thread-456",
    status: "active",
    createdAt: new Date().toISOString(),
  };

  (taskStore.get as ReturnType<typeof vi.fn>).mockReturnValue(mockTask);
  (
    taskStore.findByTelegramThread as ReturnType<typeof vi.fn>
  ).mockReturnValue(mockTask);

  const { exec } = await import("node:child_process");
  (exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (cmd: string, cb: Function) => {
      cb(null, "  main\n", "");
    },
  );

  const orchestrator = new Orchestrator({
    adapters: [telegramAdapter],
    telegram: telegramAdapter as any,
    taskStore,
    sessionManager,
    memoryIngestion,
    worktreeDir: "/tmp/worktrees",
    generalProjectDir: "/tmp/project",
    generalClaudeArgs: [],
  });

  // Simulate: /done called with explicit taskId
  const handler = (
    telegramAdapter.onTaskCompleted as ReturnType<typeof vi.fn>
  ).mock.calls[0][0];
  await handler("LIN-123", undefined);

  expect(taskStore.update).toHaveBeenCalledWith(
    "LIN-123",
    expect.objectContaining({ status: "completed" }),
  );
});

it("resolves task from thread when /done has no argument", async () => {
  const mockTask: Task = {
    taskId: "LIN-789",
    projectName: "igor",
    source: "linear",
    title: "Another bug",
    worktreePath: "/tmp/worktrees/LIN-789",
    branch: "igor/LIN-789",
    sessionId: "LIN-789",
    telegramThreadId: "thread-101",
    status: "active",
    createdAt: new Date().toISOString(),
  };

  (taskStore.get as ReturnType<typeof vi.fn>).mockReturnValue(mockTask);
  (
    taskStore.findByTelegramThread as ReturnType<typeof vi.fn>
  ).mockReturnValue(mockTask);

  const { exec } = await import("node:child_process");
  (exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (cmd: string, cb: Function) => {
      cb(null, "  main\n", "");
    },
  );

  const orchestrator = new Orchestrator({
    adapters: [telegramAdapter],
    telegram: telegramAdapter as any,
    taskStore,
    sessionManager,
    memoryIngestion,
    worktreeDir: "/tmp/worktrees",
    generalProjectDir: "/tmp/project",
    generalClaudeArgs: [],
  });

  // Simulate: /done called inside task thread (no explicit ID)
  const handler = (
    telegramAdapter.onTaskCompleted as ReturnType<typeof vi.fn>
  ).mock.calls[0][0];
  await handler(undefined, "thread-101");

  expect(taskStore.update).toHaveBeenCalledWith(
    "LIN-789",
    expect.objectContaining({ status: "completed" }),
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd harness && npx vitest run orchestrator.test.ts`
Expected: FAIL — `onTaskCompleted` not called on mock

- [ ] **Step 3: Write the implementation**

In `harness/src/orchestrator.ts`, add to the constructor (after the existing adapter subscription loop):

```typescript
if (this.telegram) {
  this.telegram.onTaskCompleted(
    async (taskId: string | undefined, threadId: string | undefined) => {
      let resolvedTaskId = taskId;
      if (!resolvedTaskId && threadId) {
        const task = this.taskStore.findByTelegramThread(threadId);
        resolvedTaskId = task?.taskId;
      }
      if (resolvedTaskId) {
        await this.completeTask(resolvedTaskId);
      } else {
        console.log(
          `[done] could not resolve task — taskId=${taskId} threadId=${threadId}`,
        );
      }
    },
  );
}
```

Also add the `onTaskCompleted` to the `TelegramAdapter` import type at the top of orchestrator.ts — it's already imported as `type { TelegramAdapter }` so no change needed there since we added the method in Task 3.

In `harness/src/index.ts`, the existing wiring for `onClear` already shows the pattern. No additional wiring needed — the orchestrator constructor now handles it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd harness && npx vitest run orchestrator.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add harness/src/orchestrator.ts harness/src/orchestrator.test.ts
git commit -m "feat(orchestrator): wire telegram /done to completeTask"
```

---

### Task 5: Add HTTP endpoint for task completion

**Files:**
- Modify: `harness/src/index.ts`

- [ ] **Step 1: Add the endpoint**

In `harness/src/index.ts`, after the `/health` endpoint, add:

```typescript
app.post("/tasks/:taskId/complete", async (req, res) => {
  try {
    await orchestrator.completeTask(req.params.taskId);
    res.json({ status: "ok", taskId: req.params.taskId });
  } catch (err: any) {
    res.status(500).json({ status: "error", message: err.message });
  }
});
```

- [ ] **Step 2: Ensure the webhook server starts even without Linear/GitHub adapters**

Currently the express server only starts if `linearAdapter || githubAdapter`. The MCP tool needs this endpoint regardless. Update the condition in `main()`:

Replace:

```typescript
if (linearAdapter || githubAdapter) {
  app.listen(config.webhookPort, () => {
    console.log(`Webhook server listening on port ${config.webhookPort}`);
  });
}
```

With:

```typescript
app.listen(config.webhookPort, () => {
  console.log(`HTTP server listening on port ${config.webhookPort}`);
});
```

- [ ] **Step 3: Commit**

```bash
git add harness/src/index.ts
git commit -m "feat(harness): add POST /tasks/:taskId/complete endpoint"
```

---

### Task 6: Add `complete_task` MCP tool

**Files:**
- Modify: `mcp-server/src/index.ts`

- [ ] **Step 1: Add the tool**

In `mcp-server/src/index.ts`, after the `kill_session` tool, add:

```typescript
server.tool(
  "complete_task",
  "Complete a task — kills Claude session, removes worktree, handles branch cleanup, notifies Telegram",
  {
    task_id: z.string().describe("Task ID to complete"),
  },
  async ({ task_id }) => {
    const port = process.env.IGOR_HARNESS_PORT || "3847";
    const url = `http://localhost:${port}/tasks/${encodeURIComponent(task_id)}/complete`;

    try {
      const res = await fetch(url, { method: "POST" });
      const body = await res.json();

      if (!res.ok) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to complete task "${task_id}": ${body.message ?? res.statusText}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Task "${task_id}" completed successfully.`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to reach harness at ${url}: ${err}`,
          },
        ],
      };
    }
  },
);
```

- [ ] **Step 2: Commit**

```bash
git add mcp-server/src/index.ts
git commit -m "feat(mcp): add complete_task tool"
```

---

### Task 7: GitHub PR merged trigger

**Files:**
- Modify: `harness/src/adapters/github.ts`
- Modify: `harness/src/adapters/github.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the existing `describe("GitHubAdapter")` in `harness/src/adapters/github.test.ts`:

```typescript
it("emits task completed on PR merged", () => {
  const adapter = new GitHubAdapter({
    webhookSecret: "test-secret",
    assigneeLogin: "igor-bot",
  });

  const completedBranches: string[] = [];
  adapter.onTaskCompleted((branch) => completedBranches.push(branch));

  adapter.handleWebhook("pull_request", {
    action: "closed",
    pull_request: {
      merged: true,
      head: { ref: "igor/LIN-123" },
    },
  });

  expect(completedBranches).toEqual(["igor/LIN-123"]);
});

it("ignores closed but not merged PR", () => {
  const adapter = new GitHubAdapter({
    webhookSecret: "test-secret",
    assigneeLogin: "igor-bot",
  });

  const completedBranches: string[] = [];
  adapter.onTaskCompleted((branch) => completedBranches.push(branch));

  adapter.handleWebhook("pull_request", {
    action: "closed",
    pull_request: {
      merged: false,
      head: { ref: "igor/LIN-123" },
    },
  });

  expect(completedBranches).toEqual([]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd harness && npx vitest run adapters/github.test.ts`
Expected: FAIL — `onTaskCompleted` is not a function

- [ ] **Step 3: Write the implementation**

In `harness/src/adapters/github.ts`:

Add a handler array (after `taskHandlers`):

```typescript
private taskCompletedHandlers: Array<(branch: string) => void> = [];
```

Add the `onTaskCompleted` method:

```typescript
onTaskCompleted(handler: (branch: string) => void): void {
  this.taskCompletedHandlers.push(handler);
}
```

Add PR merged detection to `handleWebhook`, after the existing `issue_comment` block:

```typescript
if (
  event === "pull_request" &&
  payload.action === "closed" &&
  payload.pull_request?.merged === true
) {
  const branch = payload.pull_request.head.ref;
  for (const handler of this.taskCompletedHandlers) {
    handler(branch);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd harness && npx vitest run adapters/github.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add harness/src/adapters/github.ts harness/src/adapters/github.test.ts
git commit -m "feat(github): emit task completed on PR merge"
```

---

### Task 8: Linear issue cancelled trigger

**Files:**
- Modify: `harness/src/adapters/linear.ts`
- Modify: `harness/src/adapters/linear.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the existing `describe("LinearAdapter")` in `harness/src/adapters/linear.test.ts`:

```typescript
it("emits task completed on issue cancelled", () => {
  const adapter = new LinearAdapter({
    webhookSecret: "test-secret",
    assigneeId: "user-igor",
  });

  const completedIssues: string[] = [];
  adapter.onTaskCompleted((issueId) => completedIssues.push(issueId));

  adapter.handleWebhook({
    action: "update",
    type: "Issue",
    data: {
      id: "issue-1",
      state: { name: "Cancelled" },
      assignee: { id: "user-igor" },
    },
  });

  expect(completedIssues).toEqual(["issue-1"]);
});

it("ignores non-cancelled issue updates", () => {
  const adapter = new LinearAdapter({
    webhookSecret: "test-secret",
    assigneeId: "user-igor",
  });

  const completedIssues: string[] = [];
  adapter.onTaskCompleted((issueId) => completedIssues.push(issueId));

  adapter.handleWebhook({
    action: "update",
    type: "Issue",
    data: {
      id: "issue-1",
      state: { name: "In Progress" },
      assignee: { id: "user-igor" },
    },
  });

  expect(completedIssues).toEqual([]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd harness && npx vitest run adapters/linear.test.ts`
Expected: FAIL — `onTaskCompleted` is not a function

- [ ] **Step 3: Write the implementation**

In `harness/src/adapters/linear.ts`:

Add a handler array (after `taskHandlers`):

```typescript
private taskCompletedHandlers: Array<(issueId: string) => void> = [];
```

Add the `onTaskCompleted` method:

```typescript
onTaskCompleted(handler: (issueId: string) => void): void {
  this.taskCompletedHandlers.push(handler);
}
```

Add cancelled detection to `handleWebhook`. Inside the existing `payload.type === "Issue"` block, after the task assignment emission, add a separate check:

```typescript
if (
  payload.type === "Issue" &&
  payload.action === "update" &&
  payload.data?.state?.name === "Cancelled"
) {
  const issueId = String(payload.data.id);
  for (const handler of this.taskCompletedHandlers) {
    handler(issueId);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd harness && npx vitest run adapters/linear.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add harness/src/adapters/linear.ts harness/src/adapters/linear.test.ts
git commit -m "feat(linear): emit task completed on issue cancelled"
```

---

### Task 9: Wire GitHub and Linear triggers to Orchestrator

**Files:**
- Modify: `harness/src/index.ts`
- Modify: `harness/src/orchestrator.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `describe("Orchestrator")` in `harness/src/orchestrator.test.ts`. First update `createMockAdapter` to include `onTaskCompleted`:

In the `createMockAdapter` function, add to the adapter object:

```typescript
onTaskCompleted: vi.fn(),
```

Then add the tests:

```typescript
it("completes task when GitHub adapter reports PR merged", async () => {
  const mockTask: Task = {
    taskId: "dvlkv/igor#50",
    projectName: "igor",
    source: "github",
    title: "Add feature",
    worktreePath: "/tmp/worktrees/dvlkv-igor-50",
    branch: "igor/dvlkv-igor-50",
    sessionId: "dvlkv-igor-50",
    status: "active",
    createdAt: new Date().toISOString(),
  };

  (taskStore.get as ReturnType<typeof vi.fn>).mockReturnValue(mockTask);
  (
    taskStore.findByBranch as ReturnType<typeof vi.fn>
  ).mockReturnValue(mockTask);

  const { exec } = await import("node:child_process");
  (exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (cmd: string, cb: Function) => {
      cb(null, "  main\n  igor/dvlkv-igor-50\n", "");
    },
  );

  const githubAdapter = createMockAdapter("github");

  const orchestrator = new Orchestrator({
    adapters: [telegramAdapter, githubAdapter],
    telegram: telegramAdapter as any,
    taskStore,
    sessionManager,
    memoryIngestion,
    worktreeDir: "/tmp/worktrees",
    generalProjectDir: "/tmp/project",
    generalClaudeArgs: [],
  });

  // Simulate GitHub PR merged callback
  const handler = (
    githubAdapter.onTaskCompleted as ReturnType<typeof vi.fn>
  ).mock.calls[0]?.[0];

  // GitHub emits branch name — orchestrator resolves to task
  if (handler) {
    await handler("igor/dvlkv-igor-50");
  }

  expect(taskStore.update).toHaveBeenCalledWith(
    "dvlkv/igor#50",
    expect.objectContaining({ status: "completed" }),
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd harness && npx vitest run orchestrator.test.ts`
Expected: FAIL — orchestrator doesn't subscribe to `onTaskCompleted` on non-telegram adapters

- [ ] **Step 3: Write the implementation**

In `harness/src/orchestrator.ts`, update the constructor. In the adapter subscription loop, after the existing `adapter.onMessage` and `adapter.onTaskAssigned` calls, add:

```typescript
if ("onTaskCompleted" in adapter && typeof (adapter as any).onTaskCompleted === "function") {
  (adapter as any).onTaskCompleted(async (idOrBranch: string) => {
    // Try as taskId first, then as branch
    let task = this.taskStore.get(idOrBranch);
    if (!task) {
      task = this.taskStore.findByBranch(idOrBranch);
    }
    if (!task) {
      task = this.taskStore.findByLinearIssue(idOrBranch);
    }
    if (task) {
      await this.completeTask(task.taskId);
    } else {
      console.log(
        `[cleanup] could not resolve task for "${idOrBranch}"`,
      );
    }
  });
}
```

Also add `findByBranch` and `findByLinearIssue` to the TaskStore mock in the test file. In the `vi.mock("./task-store.js")` block, add:

```typescript
findByBranch: vi.fn(),
```

(Note: `findByLinearIssue` is already in the mock.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd harness && npx vitest run orchestrator.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run all tests**

Run: `cd harness && npx vitest run`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add harness/src/orchestrator.ts harness/src/orchestrator.test.ts harness/src/index.ts
git commit -m "feat(orchestrator): wire GitHub/Linear completion triggers"
```
