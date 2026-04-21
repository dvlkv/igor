# Human-Readable Branch Names & Instant Task Feedback

## Problem

1. Worktree branches use raw task IDs (`igor/LIN-123`, `igor/dvlkv-igor-50`) which are not human-readable when listing branches or worktrees.
2. When a user sends `/task`, there is no immediate response. The first feedback arrives after worktree creation, Haiku call, thread creation, and Claude session spawn (~30s+).

## Solution

### One Haiku call, two formatters

Rename `thread-name.ts` to `task-name.ts`. Call Haiku once per task to generate a short human-readable name, then format it for two uses:

- **Thread name**: used as-is (e.g. "Fix login timeout")
- **Branch/worktree slug**: `slugify()` converts to branch-safe format, combined with sanitized task ID (e.g. `igor/LIN-123-fix-login-timeout`)

### Instant progress messages

Send an immediate message to the Telegram general thread when a task is received, then edit it as each setup step completes:

1. "Starting task: {title}..."
2. "Creating worktree..."
3. "Creating thread..."
4. "Starting Claude session..."

## Files changed

| File | Change |
|------|--------|
| `harness/src/thread-name.ts` -> `harness/src/task-name.ts` | Rename, add `slugify()`, rename `generateThreadName` to `generateTaskName` |
| `harness/src/orchestrator.ts` | Import from `task-name.ts`, use `slugify(taskName)` for branch/worktree, pass `taskName` to `createThread`, add progress messages |
| `harness/src/orchestrator.test.ts` | Update mock path, add tests for progress messages and new naming |
| `harness/src/task-name.test.ts` | Tests for `slugify()` |

## API

### `task-name.ts`

```typescript
// Calls Haiku to generate a short name from title + description
export async function generateTaskName(title: string, description?: string): Promise<string>;

// Converts a name to a branch-safe slug: lowercase, spaces to hyphens, strip non-alphanumeric
export function slugify(name: string): string;
```

### Branch naming

```
igor/${sanitizedTaskId}-${slugify(taskName)}
```

Examples:
- Linear task `LIN-123` titled "Fix login timeout" -> `igor/LIN-123-fix-login-timeout`
- GitHub task `dvlkv/igor#50` titled "Add dark mode" -> `igor/dvlkv-igor-50-add-dark-mode`
- Telegram task `12345` titled "Refactor auth" -> `igor/12345-refactor-auth`

### Worktree directory

```
${worktreeDir}/${sanitizedTaskId}-${slugify(taskName)}
```

## Progress message flow

```
User: /task Fix login timeout
Bot (general, immediate): "Starting task: Fix login timeout..."
Bot (general, edit):       "Creating worktree..."
Bot (general, edit):       "Creating thread..."
Bot (general, edit):       "Starting Claude session..."
Bot (task thread):         "Started working on: Fix login timeout"
```
