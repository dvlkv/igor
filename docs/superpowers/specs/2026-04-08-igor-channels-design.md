# Igor Channels — Design Spec

A multi-channel communication system that lets Igor receive tasks from any source (Linear, GitHub, Telegram, Slack), converse via Telegram DMs, ingest all conversations into memory, and execute work autonomously in isolated git worktrees.

## Architecture Overview

```
┌───────────────────────────────────────────────────────────┐
│                      Igor Channels                         │
│                                                            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐     │
│  │ Telegram │ │  Slack   │ │  Linear  │ │  GitHub  │     │
│  │ Adapter  │ │ Adapter  │ │ Adapter  │ │ Adapter  │     │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘     │
│       │            │            │             │           │
│       └────────────┴──────┬─────┴─────────────┘           │
│                           │                               │
│              ┌────────────▼────────────┐                  │
│              │      Orchestrator       │                  │
│              │  (routing + lifecycle)  │                  │
│              └──┬──────────────────┬───┘                  │
│                 │                  │                       │
│     ┌───────────▼───────┐  ┌──────▼──────────┐           │
│     │  Session Manager  │  │ Memory Ingestion │           │
│     │ (tmux + worktrees)│  │   (mempalace)    │           │
│     └───────────┬───────┘  └─────────────────┘           │
│                 │                                         │
│     ┌───────────▼───────┐                                │
│     │  Claude CLI (-p)  │                                │
│     │  per worktree     │                                │
│     └───────────────────┘                                │
└───────────────────────────────────────────────────────────┘
```

## Core Concepts

**Task Session** — the unit of work. Links together:
- A source (any adapter — Linear task, GitHub issue, Telegram command, Slack message)
- A git worktree path
- A tmux session name
- A Telegram DM thread for interaction
- A Claude CLI process

**General Session** — a persistent, always-on session for ad-hoc questions, memory queries, and conversations not tied to a specific task.

**Memory Ingestion** — all conversations from all adapters flow into mempalace, split by project. Every message Igor sees becomes searchable memory.

## Components

### 1. ChannelAdapter Interface

All adapters share one interface. Each adapter decides which capabilities it supports:

```typescript
interface IncomingMessage {
  channelType: "telegram" | "slack" | "linear" | "github";
  threadId: string;
  text: string;
  author: string;
  metadata: Record<string, unknown>;
}

interface TaskAssignment {
  source: "telegram" | "slack" | "linear" | "github";
  taskId: string;
  title: string;
  description: string;
  url?: string;
  repo?: string;
  labels?: string[];
}

interface ChannelAdapter {
  name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  onMessage(handler: (msg: IncomingMessage) => void): void;
  onTaskAssigned(handler: (task: TaskAssignment) => void): void;
  sendMessage?(threadId: string, text: string): Promise<void>;
  createThread?(title: string): Promise<string>;
}
```

`sendMessage` and `createThread` are optional — Slack doesn't send outbound, but all adapters emit messages and task assignments. The orchestrator decides what to do with them.

### 2. Telegram Adapter

- Uses `grammy` (TypeScript-first, clean API)
- DM threaded mode: bot communicates with the user in direct messages
- Each task session gets a thread (reply chain) within the DM
- Creates threads by sending a root message ("Starting task: <title>") and using the message_id as thread anchor
- Routes incoming DM replies by `message_thread_id`
- Long polling (no public URL needed)
- Task assignment: user sends a command like `/task <title>` or bot detects intent
- All messages emitted to `onMessage` for memory ingestion

### 3. Slack Adapter

- Uses `@slack/bolt` with Socket Mode
- Listens to all messages across configured channels
- Maps channels to projects via config for memory organization
- Task assignment: detects messages mentioning Igor or explicit task commands
- All messages emitted to `onMessage` for memory ingestion
- `sendMessage` not implemented — Slack is read-only for outbound

### 4. Linear Adapter

- Webhook listener (Express route) for `Issue` events
- Filters for assignments to Igor's user ID
- Emits task assignments and issue comments as messages
- All events emitted to `onMessage` for memory ingestion
- `sendMessage` not implemented (could add Linear comment posting later)

### 5. GitHub Adapter

- Webhook listener (Express route) for `issues` events
- Filters for assignments to Igor's login
- Emits task assignments and issue/PR comments as messages
- All events emitted to `onMessage` for memory ingestion
- `sendMessage` not implemented (could add GitHub comment posting later)

### 6. Orchestrator

Central coordinator with two jobs: **routing** and **lifecycle management**.

**On task assignment (from any adapter):**
1. `git worktree add .worktrees/<task-id> -b igor/<task-id>`
2. Create Telegram DM thread with task title
3. Spawn tmux session running Claude in the worktree
4. Persist `TaskSession` to state file
5. Post "Started working on <title>" to Telegram thread

**On incoming message:**
1. If message matches a task thread → route to Claude session
2. If message matches general thread → route to general Claude session
3. Always pass message to memory ingestion pipeline

**On task completion:**
1. Post summary to Telegram DM thread
2. Update session status
3. Clean up worktree + tmux session

State:

```typescript
interface TaskSession {
  taskId: string;
  source: "telegram" | "slack" | "linear" | "github";
  title: string;
  url?: string;
  worktreePath: string;
  branch: string;
  tmuxSession: string;
  telegramThreadId: string;
  status: "active" | "completed";
  createdAt: string;
}
```

### 7. Session Manager

Handles tmux and Claude process lifecycle:

```typescript
interface SessionManager {
  createSession(opts: {
    name: string;
    worktreePath: string;
    prompt: string;
    mcpConfig?: string;
  }): Promise<void>;

  sendInput(sessionName: string, text: string): Promise<void>;
  readOutput(sessionName: string): AsyncIterable<string>;
  killSession(sessionName: string): Promise<void>;
  listSessions(): Promise<string[]>;
}
```

**Implementation:**
- `tmux new-session -d -s <name> -c <worktreePath>` to create
- Runs `claude -p "<prompt>" --output-format stream-json --allowedTools Read,Edit,Write,Bash,Glob,Grep`
- Ongoing conversation via `claude --resume <session-id>`
- Output capture: tmux pipe-pane to a file, tailed by the session manager
- Input: `tmux send-keys -t <session> "<text>" Enter`

### 8. Memory Ingestion

A pipeline that all adapter messages flow through:

- Buffers messages per project (determined by adapter + channel mapping)
- Periodically flushes to mempalace (`mempalace mine <buffer> --mode convos`)
- Telegram DM conversations → ingested under the relevant task's project
- Slack messages → ingested under the project mapped from channel config
- Linear/GitHub events → ingested under the repo/project name

### 9. General Session

Always-on session for non-task conversations:
- Dedicated Telegram DM thread
- Persistent Claude instance with mempalace MCP server
- Handles memory queries, project questions, status checks
- Can list active task sessions

## Data Flow

### Task Assignment → Session Creation

```
Any adapter (Linear webhook, GitHub webhook, Telegram /task command, Slack mention)
  → Adapter.onTaskAssigned()
  → Orchestrator.handleTaskAssignment()
    → git worktree add .worktrees/<id> -b igor/<id>
    → TelegramAdapter.createThread("Task: <title>")
    → SessionManager.createSession(...)
    → persist TaskSession
    → post "Started working on <title>" to Telegram thread
```

### User Message → Claude → Response

```
User types in Telegram DM thread
  → TelegramAdapter.onMessage()
  → Orchestrator.routeMessage()
    → memory ingestion (async)
    → lookup TaskSession by telegramThreadId
    → SessionManager.sendInput("igor-<id>", text)
    → SessionManager.readOutput("igor-<id>")
    → TelegramAdapter.sendMessage(threadId, output)
```

### Slack/Linear/GitHub → Memory

```
Message arrives from any adapter
  → Adapter.onMessage()
  → Orchestrator.routeMessage()
    → MemoryIngestion.buffer(projectName, message)
    → (every N minutes) mempalace mine <buffer> --mode convos
```

## Configuration

```json
{
  "telegram": {
    "botToken": "$TELEGRAM_BOT_TOKEN",
    "ownerChatId": 123456789
  },
  "slack": {
    "botToken": "$SLACK_BOT_TOKEN",
    "appToken": "$SLACK_APP_TOKEN",
    "channelProjectMap": {
      "C01-frontend": "webapp",
      "C02-backend": "api-server",
      "C03-infra": "infrastructure"
    }
  },
  "linear": {
    "webhookSecret": "$LINEAR_WEBHOOK_SECRET",
    "assigneeId": "igor-user-id"
  },
  "github": {
    "webhookSecret": "$GITHUB_WEBHOOK_SECRET",
    "assigneeLogin": "igor-bot"
  },
  "general": {
    "claudeArgs": ["--mcp-config", "mempalace-mcp.json"]
  },
  "memory": {
    "ingestIntervalMs": 300000,
    "bufferDir": ".igor/message-buffers"
  },
  "webhookPort": 3847,
  "stateFile": ".igor/sessions.json",
  "worktreeDir": ".worktrees"
}
```

Environment variables referenced with `$` prefix are resolved at startup.

## Project Structure

```
src/
  index.ts              # entry point, wires everything together
  types.ts              # shared interfaces
  config.ts             # config loading and validation
  orchestrator.ts       # routing + lifecycle
  session-manager.ts    # tmux + claude process management
  memory-ingestion.ts   # buffer + flush to mempalace
  adapters/
    telegram.ts         # grammy-based DM threaded adapter
    slack.ts            # bolt-based listener
    linear.ts           # webhook handler
    github.ts           # webhook handler
  state.ts              # JSON file persistence for TaskSession map
```

## Error Handling

- **Adapter connection failure:** Log, retry with exponential backoff, other adapters continue
- **Worktree creation failure:** Post error to Telegram DM, skip session creation
- **Claude crash:** Detect via tmux session exit, notify via Telegram, allow manual restart
- **Webhook delivery failure:** HTTP 500, rely on Linear/GitHub retry logic
- **Memory ingestion failure:** Log error, retry next interval, buffer persists on disk

Personal tooling — log clearly, fail visibly.

## Testing Strategy

- **Unit tests** for Orchestrator: mock adapters and session manager, verify routing and lifecycle
- **Unit tests** for each adapter: mock API clients, verify message parsing
- **Unit tests** for SessionManager: mock child_process, verify tmux command construction
- **Unit tests** for MemoryIngestion: mock mempalace CLI, verify buffering and flush
- **Integration test:** Mock webhook payloads, verify end-to-end flow

## Dependencies

- `grammy` — Telegram bot
- `@slack/bolt` — Slack listener
- `express` — webhook server for Linear/GitHub
- `typescript` — language
- `vitest` — testing

## Out of Scope

- Web UI / dashboard
- Multi-repo support (single repo assumed)
- Automatic PR creation (handled by existing superpowers skills)
- Sending messages to Slack/Linear/GitHub (can be added per-adapter later)
