# Task Cleanup Design

**Date:** 2026-04-10
**Branch:** igor/399

## Problem

When a task finishes, nothing cleans up after it. Claude sessions keep running, worktrees accumulate, task status stays "active", and there's no notification. Cleanup must be triggered explicitly from multiple sources.

## Triggers

Three categories of trigger, all funneling into `Orchestrator.completeTask(taskId)`:

### 1. Telegram `/done` command

- Inside a task's thread: task inferred from thread ID, no argument needed
- With explicit ID (`/done TASK-1`): works from any thread
- `TelegramAdapter` registers a `/done` command handler and emits via `onTaskCompleted` callback (same pattern as `onMessage`/`onTaskAssigned`)
- Orchestrator subscribes in constructor, calls `completeTask(taskId)`
- If task not found or already completed, reply with error in same thread

### 2. MCP tool

- New `complete_task` tool in `mcp-server/src/index.ts`
- Input: `{ taskId: string }`
- Calls harness via HTTP: `POST /tasks/:taskId/complete`
- New endpoint in `harness/src/index.ts` calls `orchestrator.completeTask(taskId)`
- Returns success/failure to MCP caller

### 3. External signals

- **GitHub PR merged:** `GitHubAdapter` detects `pull_request` event with `action: "closed"` + `merged: true`. Extracts branch from `payload.pull_request.head.ref`, resolves task via `TaskStore.findByBranch(branch)`, emits `onTaskCompleted`
- **Linear issue cancelled:** `LinearAdapter` detects issue update where state changes to cancelled. Resolves task via `TaskStore.findByLinearIssue(issueId)`, emits `onTaskCompleted`

## Cleanup Sequence

`Orchestrator.completeTask(taskId: string): Promise<void>`:

1. Look up task in `TaskStore` — bail if not found or already completed
2. Kill the Claude session via `sessionManager.killSession(task.sessionId)` (skip if already dead)
3. Check if branch is merged: `git branch --merged main`, check if `task.branch` is in output
4. If merged: `git worktree remove <path>` then `git branch -d <branch>`
5. If not merged: `git worktree remove --force <path>`, keep the branch
6. Update task: `status: "completed"`, `completedAt: new Date().toISOString()`, clear `claudePid`
7. Send summary to task's Telegram thread (if exists):
   - Branch merged: "Task completed. Branch `X` deleted."
   - Branch not merged: "Task completed. Branch `X` kept (not merged)."
8. Clean up internal maps: `replyContext`, `progressMessages`

## Error Handling

Best-effort on each step — never let one failure abort the sequence:

- Claude session already dead: skip kill, continue
- Worktree removal fails (dirty files): log warning, force remove, mention in Telegram summary
- Branch deletion fails: log warning, keep branch, mention in summary
- Telegram notification fails: log error, don't block cleanup

## Files Changed

| File | Change |
|------|--------|
| `harness/src/orchestrator.ts` | Add `completeTask(taskId)` method |
| `harness/src/adapters/telegram.ts` | Add `/done` command handler + `onTaskCompleted` callback |
| `harness/src/adapters/github.ts` | Detect PR merged, emit task completed |
| `harness/src/adapters/linear.ts` | Detect issue cancelled, emit task completed |
| `harness/src/task-store.ts` | Add `findByBranch(branch)` method |
| `harness/src/index.ts` | Add `POST /tasks/:taskId/complete` endpoint, wire `onTaskCompleted` |
| `mcp-server/src/index.ts` | Add `complete_task` tool calling HTTP endpoint |
| Tests | Tests for all of the above |
