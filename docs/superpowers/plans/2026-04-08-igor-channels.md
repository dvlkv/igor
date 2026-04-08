# Igor Channels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a multi-channel communication system that receives tasks from Telegram/Slack/Linear/GitHub, spawns Claude sessions in isolated git worktrees via tmux, and ingests all conversations into mempalace.

**Architecture:** Single Node.js daemon with a unified `ChannelAdapter` interface. Four adapters (Telegram, Slack, Linear, GitHub) emit messages and task assignments to an Orchestrator, which manages session lifecycle (tmux + worktrees) and memory ingestion (mempalace). Telegram is the bidirectional interaction channel; Slack is read-only for outbound.

**Tech Stack:** TypeScript, grammy (Telegram), @slack/bolt (Slack), express (webhooks), vitest (testing)

---

### Task 1: Project Scaffolding

**Files:**
- Create: `src/package.json`
- Create: `src/tsconfig.json`
- Create: `src/vitest.config.ts`

- [ ] **Step 1: Create package.json**

```bash
mkdir -p src
```

```json
{
  "name": "igor-channels",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "grammy": "^1.35.0",
    "@slack/bolt": "^4.3.0",
    "express": "^5.1.0"
  },
  "devDependencies": {
    "typescript": "^5.8.0",
    "@types/express": "^5.0.0",
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "vitest": "^3.1.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
  },
});
```

- [ ] **Step 4: Install dependencies**

Run: `cd src && npm install`
Expected: `node_modules` created, no errors

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd src && npx tsc --noEmit`
Expected: No errors (no source files yet, should be clean)

- [ ] **Step 6: Commit**

```bash
git add src/package.json src/tsconfig.json src/vitest.config.ts src/package-lock.json
git commit -m "chore: scaffold igor-channels project"
```

---

### Task 2: Shared Types

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Create types.ts with all shared interfaces**

```typescript
export type ChannelType = "telegram" | "slack" | "linear" | "github";

export interface IncomingMessage {
  channelType: ChannelType;
  threadId: string;
  text: string;
  author: string;
  metadata: Record<string, unknown>;
}

export interface TaskAssignment {
  source: ChannelType;
  taskId: string;
  title: string;
  description: string;
  url?: string;
  repo?: string;
  labels?: string[];
}

export interface ChannelAdapter {
  name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  onMessage(handler: (msg: IncomingMessage) => void): void;
  onTaskAssigned(handler: (task: TaskAssignment) => void): void;
  sendMessage?(threadId: string, text: string): Promise<void>;
  createThread?(title: string): Promise<string>;
}

export interface TaskSession {
  taskId: string;
  source: ChannelType;
  title: string;
  url?: string;
  worktreePath: string;
  branch: string;
  tmuxSession: string;
  telegramThreadId: string;
  status: "active" | "completed";
  createdAt: string;
}

export interface SessionManagerOptions {
  name: string;
  worktreePath: string;
  prompt: string;
  mcpConfig?: string;
}

export interface SessionManager {
  createSession(opts: SessionManagerOptions): Promise<void>;
  sendInput(sessionName: string, text: string): Promise<void>;
  readOutput(sessionName: string): AsyncIterable<string>;
  killSession(sessionName: string): Promise<void>;
  listSessions(): Promise<string[]>;
}

export interface ChannelsConfig {
  telegram: {
    botToken: string;
    ownerChatId: number;
  };
  slack: {
    botToken: string;
    appToken: string;
    channelProjectMap: Record<string, string>;
  };
  linear: {
    webhookSecret: string;
    assigneeId: string;
  };
  github: {
    webhookSecret: string;
    assigneeLogin: string;
  };
  general: {
    claudeArgs: string[];
  };
  memory: {
    ingestIntervalMs: number;
    bufferDir: string;
  };
  webhookPort: number;
  stateFile: string;
  worktreeDir: string;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd src && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(channels): add shared type definitions"
```

---

### Task 3: Config Loading

**Files:**
- Create: `src/config.ts`
- Create: `src/config.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadConfig } from "./config.js";
import * as fs from "node:fs";

vi.mock("node:fs");

const VALID_CONFIG = {
  telegram: { botToken: "$TG_TOKEN", ownerChatId: 123 },
  slack: {
    botToken: "$SLACK_TOKEN",
    appToken: "$SLACK_APP",
    channelProjectMap: { C01: "webapp" },
  },
  linear: { webhookSecret: "$LIN_SECRET", assigneeId: "user-1" },
  github: { webhookSecret: "$GH_SECRET", assigneeLogin: "igor-bot" },
  general: { claudeArgs: [] },
  memory: { ingestIntervalMs: 300000, bufferDir: ".igor/buffers" },
  webhookPort: 3847,
  stateFile: ".igor/sessions.json",
  worktreeDir: ".worktrees",
};

describe("loadConfig", () => {
  beforeEach(() => {
    process.env.TG_TOKEN = "tg-secret";
    process.env.SLACK_TOKEN = "slack-secret";
    process.env.SLACK_APP = "slack-app-secret";
    process.env.LIN_SECRET = "lin-secret";
    process.env.GH_SECRET = "gh-secret";
  });

  afterEach(() => {
    delete process.env.TG_TOKEN;
    delete process.env.SLACK_TOKEN;
    delete process.env.SLACK_APP;
    delete process.env.LIN_SECRET;
    delete process.env.GH_SECRET;
  });

  it("loads config and resolves env vars", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(VALID_CONFIG));
    const config = loadConfig("channels.config.json");
    expect(config.telegram.botToken).toBe("tg-secret");
    expect(config.slack.botToken).toBe("slack-secret");
    expect(config.linear.webhookSecret).toBe("lin-secret");
  });

  it("throws if config file is missing", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    expect(() => loadConfig("missing.json")).toThrow("ENOENT");
  });

  it("throws if env var is not set", () => {
    delete process.env.TG_TOKEN;
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(VALID_CONFIG));
    expect(() => loadConfig("channels.config.json")).toThrow(
      "Environment variable TG_TOKEN is not set"
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src && npx vitest run config.test.ts`
Expected: FAIL — module `./config.js` not found

- [ ] **Step 3: Write minimal implementation**

```typescript
import * as fs from "node:fs";
import type { ChannelsConfig } from "./types.js";

function resolveEnvVars(obj: unknown): unknown {
  if (typeof obj === "string" && obj.startsWith("$")) {
    const varName = obj.slice(1);
    const value = process.env[varName];
    if (!value) {
      throw new Error(`Environment variable ${varName} is not set`);
    }
    return value;
  }
  if (Array.isArray(obj)) {
    return obj.map(resolveEnvVars);
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      result[key] = resolveEnvVars(val);
    }
    return result;
  }
  return obj;
}

export function loadConfig(path: string): ChannelsConfig {
  const raw = fs.readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw);
  return resolveEnvVars(parsed) as ChannelsConfig;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src && npx vitest run config.test.ts`
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.ts src/config.test.ts
git commit -m "feat(channels): config loading with env var resolution"
```

---

### Task 4: State Persistence

**Files:**
- Create: `src/state.ts`
- Create: `src/state.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { StateStore } from "./state.js";
import * as fs from "node:fs";
import type { TaskSession } from "./types.js";

vi.mock("node:fs");

const SESSION: TaskSession = {
  taskId: "TASK-1",
  source: "linear",
  title: "Fix auth bug",
  url: "https://linear.app/task/TASK-1",
  worktreePath: ".worktrees/TASK-1",
  branch: "igor/TASK-1",
  tmuxSession: "igor-TASK-1",
  telegramThreadId: "123",
  status: "active",
  createdAt: "2026-04-08T00:00:00Z",
};

describe("StateStore", () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as any);
  });

  it("starts empty when no state file exists", () => {
    const store = new StateStore("/tmp/state.json");
    expect(store.getAll()).toEqual([]);
  });

  it("loads existing state from disk", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ sessions: [SESSION] })
    );
    const store = new StateStore("/tmp/state.json");
    expect(store.getAll()).toEqual([SESSION]);
  });

  it("saves and retrieves a session", () => {
    const store = new StateStore("/tmp/state.json");
    store.save(SESSION);
    expect(store.get("TASK-1")).toEqual(SESSION);
    expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalled();
  });

  it("updates a session", () => {
    const store = new StateStore("/tmp/state.json");
    store.save(SESSION);
    store.update("TASK-1", { status: "completed" });
    expect(store.get("TASK-1")?.status).toBe("completed");
  });

  it("finds session by telegram thread ID", () => {
    const store = new StateStore("/tmp/state.json");
    store.save(SESSION);
    expect(store.findByTelegramThread("123")).toEqual(SESSION);
    expect(store.findByTelegramThread("999")).toBeUndefined();
  });

  it("returns active sessions only", () => {
    const store = new StateStore("/tmp/state.json");
    store.save(SESSION);
    store.save({ ...SESSION, taskId: "TASK-2", status: "completed" });
    expect(store.getActive()).toHaveLength(1);
    expect(store.getActive()[0].taskId).toBe("TASK-1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src && npx vitest run state.test.ts`
Expected: FAIL — `StateStore` not found

- [ ] **Step 3: Write minimal implementation**

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import type { TaskSession } from "./types.js";

interface StateData {
  sessions: TaskSession[];
}

export class StateStore {
  private sessions: Map<string, TaskSession> = new Map();
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }

  private load(): void {
    if (fs.existsSync(this.filePath)) {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      const data: StateData = JSON.parse(raw);
      for (const session of data.sessions) {
        this.sessions.set(session.taskId, session);
      }
    }
  }

  private persist(): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const data: StateData = { sessions: Array.from(this.sessions.values()) };
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
  }

  save(session: TaskSession): void {
    this.sessions.set(session.taskId, session);
    this.persist();
  }

  get(taskId: string): TaskSession | undefined {
    return this.sessions.get(taskId);
  }

  update(taskId: string, updates: Partial<TaskSession>): void {
    const session = this.sessions.get(taskId);
    if (session) {
      Object.assign(session, updates);
      this.persist();
    }
  }

  getAll(): TaskSession[] {
    return Array.from(this.sessions.values());
  }

  getActive(): TaskSession[] {
    return this.getAll().filter((s) => s.status === "active");
  }

  findByTelegramThread(threadId: string): TaskSession | undefined {
    return this.getAll().find((s) => s.telegramThreadId === threadId);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src && npx vitest run state.test.ts`
Expected: 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/state.ts src/state.test.ts
git commit -m "feat(channels): JSON file state persistence"
```

---

### Task 5: Session Manager (tmux + Claude)

**Files:**
- Create: `src/session-manager.ts`
- Create: `src/session-manager.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TmuxSessionManager } from "./session-manager.js";
import * as child_process from "node:child_process";

vi.mock("node:child_process");

describe("TmuxSessionManager", () => {
  let manager: TmuxSessionManager;

  beforeEach(() => {
    manager = new TmuxSessionManager();
    vi.mocked(child_process.execSync).mockReturnValue(Buffer.from(""));
  });

  it("creates a tmux session with correct command", async () => {
    vi.mocked(child_process.exec).mockImplementation(
      (_cmd, _opts, cb) => {
        if (cb) (cb as Function)(null, "", "");
        return {} as any;
      }
    );
    await manager.createSession({
      name: "igor-TASK-1",
      worktreePath: "/tmp/worktree",
      prompt: "Fix the auth bug",
    });
    const calls = vi.mocked(child_process.exec).mock.calls;
    const tmuxCmd = calls[0][0] as string;
    expect(tmuxCmd).toContain("tmux new-session -d -s igor-TASK-1");
    expect(tmuxCmd).toContain("-c /tmp/worktree");
  });

  it("sends input via tmux send-keys", async () => {
    vi.mocked(child_process.exec).mockImplementation(
      (_cmd, _opts, cb) => {
        if (cb) (cb as Function)(null, "", "");
        return {} as any;
      }
    );
    await manager.sendInput("igor-TASK-1", "hello world");
    const calls = vi.mocked(child_process.exec).mock.calls;
    const cmd = calls[0][0] as string;
    expect(cmd).toContain("tmux send-keys -t igor-TASK-1");
    expect(cmd).toContain("hello world");
  });

  it("kills a tmux session", async () => {
    vi.mocked(child_process.exec).mockImplementation(
      (_cmd, _opts, cb) => {
        if (cb) (cb as Function)(null, "", "");
        return {} as any;
      }
    );
    await manager.killSession("igor-TASK-1");
    const cmd = vi.mocked(child_process.exec).mock.calls[0][0] as string;
    expect(cmd).toContain("tmux kill-session -t igor-TASK-1");
  });

  it("lists active tmux sessions", async () => {
    vi.mocked(child_process.exec).mockImplementation(
      (_cmd, _opts, cb) => {
        if (cb)
          (cb as Function)(null, "igor-TASK-1\nigor-TASK-2\n", "");
        return {} as any;
      }
    );
    const sessions = await manager.listSessions();
    expect(sessions).toEqual(["igor-TASK-1", "igor-TASK-2"]);
  });

  it("returns empty list when no tmux sessions exist", async () => {
    vi.mocked(child_process.exec).mockImplementation(
      (_cmd, _opts, cb) => {
        if (cb) (cb as Function)(new Error("no server running"), "", "");
        return {} as any;
      }
    );
    const sessions = await manager.listSessions();
    expect(sessions).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src && npx vitest run session-manager.test.ts`
Expected: FAIL — `TmuxSessionManager` not found

- [ ] **Step 3: Write minimal implementation**

```typescript
import { exec } from "node:child_process";
import type { SessionManagerOptions } from "./types.js";

function run(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, {}, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout.toString());
    });
  });
}

export class TmuxSessionManager {
  async createSession(opts: SessionManagerOptions): Promise<void> {
    const { name, worktreePath, prompt, mcpConfig } = opts;

    await run(`tmux new-session -d -s ${name} -c ${worktreePath}`);

    const claudeArgs = [
      "claude",
      "-p",
      JSON.stringify(prompt),
      "--output-format",
      "stream-json",
      "--allowedTools",
      "Read,Edit,Write,Bash,Glob,Grep",
    ];
    if (mcpConfig) {
      claudeArgs.push("--mcp-config", mcpConfig);
    }

    await run(`tmux send-keys -t ${name} '${claudeArgs.join(" ")}' Enter`);
  }

  async sendInput(sessionName: string, text: string): Promise<void> {
    const escaped = text.replace(/'/g, "'\\''");
    await run(`tmux send-keys -t ${sessionName} '${escaped}' Enter`);
  }

  async *readOutput(sessionName: string): AsyncIterable<string> {
    const pipePath = `/tmp/igor-${sessionName}.pipe`;
    await run(
      `tmux pipe-pane -t ${sessionName} -o 'cat >> ${pipePath}'`
    );
    // Caller tails the pipe file for streaming output
    yield pipePath;
  }

  async killSession(sessionName: string): Promise<void> {
    await run(`tmux kill-session -t ${sessionName}`);
  }

  async listSessions(): Promise<string[]> {
    try {
      const output = await run(
        "tmux list-sessions -F '#{session_name}'"
      );
      return output
        .trim()
        .split("\n")
        .filter((s) => s.length > 0);
    } catch {
      return [];
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src && npx vitest run session-manager.test.ts`
Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/session-manager.ts src/session-manager.test.ts
git commit -m "feat(channels): tmux session manager for Claude processes"
```

---

### Task 6: Memory Ingestion

**Files:**
- Create: `src/memory-ingestion.ts`
- Create: `src/memory-ingestion.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryIngestion } from "./memory-ingestion.js";
import * as fs from "node:fs";
import * as child_process from "node:child_process";

vi.mock("node:fs");
vi.mock("node:child_process");

describe("MemoryIngestion", () => {
  let ingestion: MemoryIngestion;

  beforeEach(() => {
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as any);
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.existsSync).mockReturnValue(false);
    ingestion = new MemoryIngestion({
      bufferDir: "/tmp/buffers",
      ingestIntervalMs: 60000,
    });
  });

  afterEach(() => {
    ingestion.stop();
  });

  it("buffers messages by project", () => {
    ingestion.buffer("webapp", {
      channelType: "slack",
      threadId: "t1",
      text: "hello",
      author: "alice",
      metadata: {},
    });
    ingestion.buffer("webapp", {
      channelType: "slack",
      threadId: "t1",
      text: "world",
      author: "bob",
      metadata: {},
    });
    ingestion.buffer("api", {
      channelType: "linear",
      threadId: "t2",
      text: "fix bug",
      author: "carol",
      metadata: {},
    });
    expect(ingestion.getBufferSize("webapp")).toBe(2);
    expect(ingestion.getBufferSize("api")).toBe(1);
  });

  it("flushes buffers to disk and calls mempalace", async () => {
    vi.mocked(child_process.exec).mockImplementation(
      (_cmd, _opts, cb) => {
        if (cb) (cb as Function)(null, "", "");
        return {} as any;
      }
    );
    ingestion.buffer("webapp", {
      channelType: "slack",
      threadId: "t1",
      text: "hello",
      author: "alice",
      metadata: {},
    });
    await ingestion.flush();
    expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalled();
    const writeCall = vi.mocked(fs.writeFileSync).mock.calls.find(
      (c) => (c[0] as string).includes("webapp")
    );
    expect(writeCall).toBeDefined();

    const execCalls = vi.mocked(child_process.exec).mock.calls;
    const mineCmd = execCalls[0][0] as string;
    expect(mineCmd).toContain("mempalace mine");
    expect(mineCmd).toContain("--mode convos");
  });

  it("clears buffer after successful flush", async () => {
    vi.mocked(child_process.exec).mockImplementation(
      (_cmd, _opts, cb) => {
        if (cb) (cb as Function)(null, "", "");
        return {} as any;
      }
    );
    ingestion.buffer("webapp", {
      channelType: "slack",
      threadId: "t1",
      text: "hello",
      author: "alice",
      metadata: {},
    });
    await ingestion.flush();
    expect(ingestion.getBufferSize("webapp")).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src && npx vitest run memory-ingestion.test.ts`
Expected: FAIL — `MemoryIngestion` not found

- [ ] **Step 3: Write minimal implementation**

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import { exec } from "node:child_process";
import type { IncomingMessage } from "./types.js";

function run(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, {}, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout.toString());
    });
  });
}

interface MemoryIngestionConfig {
  bufferDir: string;
  ingestIntervalMs: number;
}

export class MemoryIngestion {
  private buffers: Map<string, IncomingMessage[]> = new Map();
  private config: MemoryIngestionConfig;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(config: MemoryIngestionConfig) {
    this.config = config;
  }

  buffer(project: string, message: IncomingMessage): void {
    if (!this.buffers.has(project)) {
      this.buffers.set(project, []);
    }
    this.buffers.get(project)!.push(message);
  }

  getBufferSize(project: string): number {
    return this.buffers.get(project)?.length ?? 0;
  }

  async flush(): Promise<void> {
    fs.mkdirSync(this.config.bufferDir, { recursive: true });

    for (const [project, messages] of this.buffers.entries()) {
      if (messages.length === 0) continue;

      const content = messages
        .map((m) => `[${m.author}]: ${m.text}`)
        .join("\n");

      const bufferFile = path.join(
        this.config.bufferDir,
        `${project}-${Date.now()}.txt`
      );
      fs.writeFileSync(bufferFile, content);

      await run(`mempalace mine ${bufferFile} --mode convos`);

      this.buffers.set(project, []);
    }
  }

  start(): void {
    this.timer = setInterval(() => this.flush(), this.config.ingestIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src && npx vitest run memory-ingestion.test.ts`
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/memory-ingestion.ts src/memory-ingestion.test.ts
git commit -m "feat(channels): memory ingestion pipeline with mempalace"
```

---

### Task 7: Telegram Adapter

**Files:**
- Create: `src/adapters/telegram.ts`
- Create: `src/adapters/telegram.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TelegramAdapter } from "./telegram.js";
import type { IncomingMessage, TaskAssignment } from "../types.js";

// Mock grammy
vi.mock("grammy", () => {
  const handlers: Record<string, Function[]> = {};
  const bot = {
    command: (name: string, handler: Function) => {
      handlers[`command:${name}`] = handlers[`command:${name}`] || [];
      handlers[`command:${name}`].push(handler);
    },
    on: (event: string, handler: Function) => {
      handlers[event] = handlers[event] || [];
      handlers[event].push(handler);
    },
    start: vi.fn(),
    stop: vi.fn(),
    api: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 42 }),
    },
    _handlers: handlers,
  };
  return { Bot: vi.fn(() => bot) };
});

describe("TelegramAdapter", () => {
  let adapter: TelegramAdapter;
  let receivedMessages: IncomingMessage[];
  let receivedTasks: TaskAssignment[];

  beforeEach(async () => {
    receivedMessages = [];
    receivedTasks = [];
    adapter = new TelegramAdapter({
      botToken: "test-token",
      ownerChatId: 123,
    });
    adapter.onMessage((msg) => receivedMessages.push(msg));
    adapter.onTaskAssigned((task) => receivedTasks.push(task));
  });

  it("creates a thread by sending a root message", async () => {
    const threadId = await adapter.createThread("Fix auth bug");
    expect(threadId).toBe("42");
  });

  it("has correct name", () => {
    expect(adapter.name).toBe("telegram");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src && npx vitest run adapters/telegram.test.ts`
Expected: FAIL — `TelegramAdapter` not found

- [ ] **Step 3: Write minimal implementation**

```typescript
import { Bot } from "grammy";
import type {
  ChannelAdapter,
  IncomingMessage,
  TaskAssignment,
} from "../types.js";

interface TelegramConfig {
  botToken: string;
  ownerChatId: number;
}

export class TelegramAdapter implements ChannelAdapter {
  readonly name = "telegram";
  private bot: Bot;
  private config: TelegramConfig;
  private messageHandlers: ((msg: IncomingMessage) => void)[] = [];
  private taskHandlers: ((task: TaskAssignment) => void)[] = [];

  constructor(config: TelegramConfig) {
    this.config = config;
    this.bot = new Bot(config.botToken);
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.bot.command("task", (ctx) => {
      const text = ctx.message?.text ?? "";
      const parts = text.replace("/task", "").trim();
      const firstNewline = parts.indexOf("\n");
      const title =
        firstNewline > -1 ? parts.slice(0, firstNewline).trim() : parts;
      const description =
        firstNewline > -1 ? parts.slice(firstNewline + 1).trim() : "";
      const taskId = `tg-${Date.now()}`;

      for (const handler of this.taskHandlers) {
        handler({
          source: "telegram",
          taskId,
          title,
          description,
        });
      }
    });

    this.bot.on("message:text", (ctx) => {
      const msg = ctx.message;
      if (!msg) return;

      const threadId = String(
        msg.message_thread_id ?? msg.reply_to_message?.message_id ?? "general"
      );

      for (const handler of this.messageHandlers) {
        handler({
          channelType: "telegram",
          threadId,
          text: msg.text ?? "",
          author: msg.from?.username ?? String(msg.from?.id ?? "unknown"),
          metadata: { chatId: msg.chat.id, messageId: msg.message_id },
        });
      }
    });
  }

  async start(): Promise<void> {
    this.bot.start();
  }

  async stop(): Promise<void> {
    this.bot.stop();
  }

  onMessage(handler: (msg: IncomingMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  onTaskAssigned(handler: (task: TaskAssignment) => void): void {
    this.taskHandlers.push(handler);
  }

  async sendMessage(threadId: string, text: string): Promise<void> {
    await this.bot.api.sendMessage(this.config.ownerChatId, text, {
      reply_parameters:
        threadId !== "general"
          ? { message_id: Number(threadId) }
          : undefined,
    });
  }

  async createThread(title: string): Promise<string> {
    const msg = await this.bot.api.sendMessage(
      this.config.ownerChatId,
      `📋 ${title}`
    );
    return String(msg.message_id);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src && npx vitest run adapters/telegram.test.ts`
Expected: 2 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/adapters/telegram.ts src/adapters/telegram.test.ts
git commit -m "feat(channels): Telegram DM threaded adapter"
```

---

### Task 8: Slack Adapter

**Files:**
- Create: `src/adapters/slack.ts`
- Create: `src/adapters/slack.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SlackAdapter } from "./slack.js";
import type { IncomingMessage } from "../types.js";

vi.mock("@slack/bolt", () => {
  const messageHandlers: Function[] = [];
  const app = {
    message: (handler: Function) => messageHandlers.push(handler),
    start: vi.fn(),
    stop: vi.fn(),
    _messageHandlers: messageHandlers,
  };
  return { App: vi.fn(() => app) };
});

describe("SlackAdapter", () => {
  let adapter: SlackAdapter;
  let receivedMessages: IncomingMessage[];

  beforeEach(() => {
    receivedMessages = [];
    adapter = new SlackAdapter({
      botToken: "xoxb-test",
      appToken: "xapp-test",
      channelProjectMap: { C01: "webapp", C02: "api" },
    });
    adapter.onMessage((msg) => receivedMessages.push(msg));
  });

  it("has correct name", () => {
    expect(adapter.name).toBe("slack");
  });

  it("maps channel to project name", () => {
    expect(adapter.getProjectForChannel("C01")).toBe("webapp");
    expect(adapter.getProjectForChannel("C02")).toBe("api");
    expect(adapter.getProjectForChannel("C99")).toBeUndefined();
  });

  it("does not implement sendMessage", () => {
    expect(adapter.sendMessage).toBeUndefined();
  });

  it("does not implement createThread", () => {
    expect(adapter.createThread).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src && npx vitest run adapters/slack.test.ts`
Expected: FAIL — `SlackAdapter` not found

- [ ] **Step 3: Write minimal implementation**

```typescript
import { App } from "@slack/bolt";
import type {
  ChannelAdapter,
  IncomingMessage,
  TaskAssignment,
} from "../types.js";

interface SlackConfig {
  botToken: string;
  appToken: string;
  channelProjectMap: Record<string, string>;
}

export class SlackAdapter implements ChannelAdapter {
  readonly name = "slack";
  readonly sendMessage = undefined;
  readonly createThread = undefined;
  private app: App;
  private config: SlackConfig;
  private messageHandlers: ((msg: IncomingMessage) => void)[] = [];
  private taskHandlers: ((task: TaskAssignment) => void)[] = [];

  constructor(config: SlackConfig) {
    this.config = config;
    this.app = new App({
      token: config.botToken,
      appToken: config.appToken,
      socketMode: true,
    });
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.app.message(async ({ message }) => {
      if (!("text" in message) || message.subtype) return;

      const threadId = message.thread_ts ?? message.ts ?? "";
      const channelId = message.channel ?? "";

      for (const handler of this.messageHandlers) {
        handler({
          channelType: "slack",
          threadId,
          text: message.text ?? "",
          author: ("user" in message ? message.user : undefined) ?? "unknown",
          metadata: {
            channelId,
            project: this.getProjectForChannel(channelId),
            ts: message.ts,
          },
        });
      }
    });
  }

  getProjectForChannel(channelId: string): string | undefined {
    return this.config.channelProjectMap[channelId];
  }

  async start(): Promise<void> {
    await this.app.start();
  }

  async stop(): Promise<void> {
    await this.app.stop();
  }

  onMessage(handler: (msg: IncomingMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  onTaskAssigned(handler: (task: TaskAssignment) => void): void {
    this.taskHandlers.push(handler);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src && npx vitest run adapters/slack.test.ts`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/adapters/slack.ts src/adapters/slack.test.ts
git commit -m "feat(channels): Slack read-only ingestion adapter"
```

---

### Task 9: Linear Adapter

**Files:**
- Create: `src/adapters/linear.ts`
- Create: `src/adapters/linear.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearAdapter } from "./linear.js";
import type { IncomingMessage, TaskAssignment } from "../types.js";

describe("LinearAdapter", () => {
  let adapter: LinearAdapter;
  let receivedMessages: IncomingMessage[];
  let receivedTasks: TaskAssignment[];

  beforeEach(() => {
    receivedMessages = [];
    receivedTasks = [];
    adapter = new LinearAdapter({
      webhookSecret: "test-secret",
      assigneeId: "user-igor",
    });
    adapter.onMessage((msg) => receivedMessages.push(msg));
    adapter.onTaskAssigned((task) => receivedTasks.push(task));
  });

  it("has correct name", () => {
    expect(adapter.name).toBe("linear");
  });

  it("emits task assignment on matching webhook", () => {
    adapter.handleWebhook({
      action: "update",
      type: "Issue",
      data: {
        id: "issue-1",
        title: "Fix auth",
        description: "Auth is broken",
        url: "https://linear.app/issue/issue-1",
        assignee: { id: "user-igor" },
        labels: [{ name: "bug" }],
      },
    });
    expect(receivedTasks).toHaveLength(1);
    expect(receivedTasks[0].taskId).toBe("issue-1");
    expect(receivedTasks[0].title).toBe("Fix auth");
    expect(receivedTasks[0].source).toBe("linear");
  });

  it("ignores webhook for different assignee", () => {
    adapter.handleWebhook({
      action: "update",
      type: "Issue",
      data: {
        id: "issue-2",
        title: "Other task",
        description: "",
        url: "https://linear.app/issue/issue-2",
        assignee: { id: "user-other" },
        labels: [],
      },
    });
    expect(receivedTasks).toHaveLength(0);
  });

  it("emits message for issue comments", () => {
    adapter.handleWebhook({
      action: "create",
      type: "Comment",
      data: {
        id: "comment-1",
        body: "Please check this",
        issue: { id: "issue-1" },
        user: { name: "Alice" },
      },
    });
    expect(receivedMessages).toHaveLength(1);
    expect(receivedMessages[0].text).toBe("Please check this");
    expect(receivedMessages[0].threadId).toBe("issue-1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src && npx vitest run adapters/linear.test.ts`
Expected: FAIL — `LinearAdapter` not found

- [ ] **Step 3: Write minimal implementation**

```typescript
import type {
  ChannelAdapter,
  IncomingMessage,
  TaskAssignment,
} from "../types.js";

interface LinearConfig {
  webhookSecret: string;
  assigneeId: string;
}

export class LinearAdapter implements ChannelAdapter {
  readonly name = "linear";
  readonly sendMessage = undefined;
  readonly createThread = undefined;
  private config: LinearConfig;
  private messageHandlers: ((msg: IncomingMessage) => void)[] = [];
  private taskHandlers: ((task: TaskAssignment) => void)[] = [];

  constructor(config: LinearConfig) {
    this.config = config;
  }

  handleWebhook(payload: any): void {
    if (payload.type === "Issue" && payload.data?.assignee?.id === this.config.assigneeId) {
      for (const handler of this.taskHandlers) {
        handler({
          source: "linear",
          taskId: payload.data.id,
          title: payload.data.title,
          description: payload.data.description ?? "",
          url: payload.data.url,
          labels: payload.data.labels?.map((l: any) => l.name),
        });
      }
    }

    if (payload.type === "Comment") {
      for (const handler of this.messageHandlers) {
        handler({
          channelType: "linear",
          threadId: payload.data.issue?.id ?? "",
          text: payload.data.body ?? "",
          author: payload.data.user?.name ?? "unknown",
          metadata: { commentId: payload.data.id },
        });
      }
    }
  }

  async start(): Promise<void> {
    // Webhook routes are registered by the orchestrator's Express server
  }

  async stop(): Promise<void> {}

  onMessage(handler: (msg: IncomingMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  onTaskAssigned(handler: (task: TaskAssignment) => void): void {
    this.taskHandlers.push(handler);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src && npx vitest run adapters/linear.test.ts`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/adapters/linear.ts src/adapters/linear.test.ts
git commit -m "feat(channels): Linear webhook adapter"
```

---

### Task 10: GitHub Adapter

**Files:**
- Create: `src/adapters/github.ts`
- Create: `src/adapters/github.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitHubAdapter } from "./github.js";
import type { IncomingMessage, TaskAssignment } from "../types.js";

describe("GitHubAdapter", () => {
  let adapter: GitHubAdapter;
  let receivedMessages: IncomingMessage[];
  let receivedTasks: TaskAssignment[];

  beforeEach(() => {
    receivedMessages = [];
    receivedTasks = [];
    adapter = new GitHubAdapter({
      webhookSecret: "test-secret",
      assigneeLogin: "igor-bot",
    });
    adapter.onMessage((msg) => receivedMessages.push(msg));
    adapter.onTaskAssigned((task) => receivedTasks.push(task));
  });

  it("has correct name", () => {
    expect(adapter.name).toBe("github");
  });

  it("emits task assignment on issue assigned event", () => {
    adapter.handleWebhook("issues", {
      action: "assigned",
      assignee: { login: "igor-bot" },
      issue: {
        number: 42,
        title: "Fix login page",
        body: "Login is broken",
        html_url: "https://github.com/org/repo/issues/42",
        labels: [{ name: "bug" }],
      },
      repository: { full_name: "org/repo" },
    });
    expect(receivedTasks).toHaveLength(1);
    expect(receivedTasks[0].taskId).toBe("org/repo#42");
    expect(receivedTasks[0].title).toBe("Fix login page");
    expect(receivedTasks[0].repo).toBe("org/repo");
    expect(receivedTasks[0].source).toBe("github");
  });

  it("ignores assignment to other user", () => {
    adapter.handleWebhook("issues", {
      action: "assigned",
      assignee: { login: "other-user" },
      issue: {
        number: 43,
        title: "Other issue",
        body: "",
        html_url: "https://github.com/org/repo/issues/43",
        labels: [],
      },
      repository: { full_name: "org/repo" },
    });
    expect(receivedTasks).toHaveLength(0);
  });

  it("emits message for issue comments", () => {
    adapter.handleWebhook("issue_comment", {
      action: "created",
      comment: {
        body: "What about this approach?",
        user: { login: "alice" },
      },
      issue: {
        number: 42,
      },
      repository: { full_name: "org/repo" },
    });
    expect(receivedMessages).toHaveLength(1);
    expect(receivedMessages[0].text).toBe("What about this approach?");
    expect(receivedMessages[0].threadId).toBe("org/repo#42");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src && npx vitest run adapters/github.test.ts`
Expected: FAIL — `GitHubAdapter` not found

- [ ] **Step 3: Write minimal implementation**

```typescript
import type {
  ChannelAdapter,
  IncomingMessage,
  TaskAssignment,
} from "../types.js";

interface GitHubConfig {
  webhookSecret: string;
  assigneeLogin: string;
}

export class GitHubAdapter implements ChannelAdapter {
  readonly name = "github";
  readonly sendMessage = undefined;
  readonly createThread = undefined;
  private config: GitHubConfig;
  private messageHandlers: ((msg: IncomingMessage) => void)[] = [];
  private taskHandlers: ((task: TaskAssignment) => void)[] = [];

  constructor(config: GitHubConfig) {
    this.config = config;
  }

  handleWebhook(event: string, payload: any): void {
    if (
      event === "issues" &&
      payload.action === "assigned" &&
      payload.assignee?.login === this.config.assigneeLogin
    ) {
      const issue = payload.issue;
      const repo = payload.repository.full_name;
      for (const handler of this.taskHandlers) {
        handler({
          source: "github",
          taskId: `${repo}#${issue.number}`,
          title: issue.title,
          description: issue.body ?? "",
          url: issue.html_url,
          repo,
          labels: issue.labels?.map((l: any) => l.name),
        });
      }
    }

    if (event === "issue_comment" && payload.action === "created") {
      const repo = payload.repository.full_name;
      const issueNum = payload.issue.number;
      for (const handler of this.messageHandlers) {
        handler({
          channelType: "github",
          threadId: `${repo}#${issueNum}`,
          text: payload.comment.body ?? "",
          author: payload.comment.user?.login ?? "unknown",
          metadata: { repo, issueNumber: issueNum },
        });
      }
    }
  }

  async start(): Promise<void> {
    // Webhook routes are registered by the orchestrator's Express server
  }

  async stop(): Promise<void> {}

  onMessage(handler: (msg: IncomingMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  onTaskAssigned(handler: (task: TaskAssignment) => void): void {
    this.taskHandlers.push(handler);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src && npx vitest run adapters/github.test.ts`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/adapters/github.ts src/adapters/github.test.ts
git commit -m "feat(channels): GitHub webhook adapter"
```

---

### Task 11: Orchestrator

**Files:**
- Create: `src/orchestrator.ts`
- Create: `src/orchestrator.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Orchestrator } from "./orchestrator.js";
import type {
  ChannelAdapter,
  IncomingMessage,
  TaskAssignment,
  TaskSession,
} from "./types.js";
import { StateStore } from "./state.js";
import { TmuxSessionManager } from "./session-manager.js";
import { MemoryIngestion } from "./memory-ingestion.js";

vi.mock("./state.js");
vi.mock("./session-manager.js");
vi.mock("./memory-ingestion.js");
vi.mock("node:child_process");

function createMockAdapter(name: string): ChannelAdapter & {
  fireMessage: (msg: IncomingMessage) => void;
  fireTask: (task: TaskAssignment) => void;
} {
  let msgHandler: (msg: IncomingMessage) => void = () => {};
  let taskHandler: (task: TaskAssignment) => void = () => {};
  return {
    name,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    onMessage: (h) => (msgHandler = h),
    onTaskAssigned: (h) => (taskHandler = h),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    createThread: vi.fn().mockResolvedValue("thread-123"),
    fireMessage: (msg) => msgHandler(msg),
    fireTask: (task) => taskHandler(task),
  };
}

describe("Orchestrator", () => {
  let orchestrator: Orchestrator;
  let telegramAdapter: ReturnType<typeof createMockAdapter>;
  let stateStore: StateStore;
  let sessionManager: TmuxSessionManager;
  let memoryIngestion: MemoryIngestion;

  beforeEach(() => {
    telegramAdapter = createMockAdapter("telegram");
    stateStore = new StateStore("/tmp/state.json");
    sessionManager = new TmuxSessionManager();
    memoryIngestion = new MemoryIngestion({
      bufferDir: "/tmp/buffers",
      ingestIntervalMs: 60000,
    });

    vi.mocked(stateStore.save).mockImplementation(() => {});
    vi.mocked(stateStore.findByTelegramThread).mockReturnValue(undefined);
    vi.mocked(stateStore.getActive).mockReturnValue([]);
    vi.mocked(sessionManager.createSession).mockResolvedValue(undefined);
    vi.mocked(sessionManager.sendInput).mockResolvedValue(undefined);
    vi.mocked(memoryIngestion.buffer).mockImplementation(() => {});

    orchestrator = new Orchestrator({
      adapters: [telegramAdapter],
      telegram: telegramAdapter,
      stateStore,
      sessionManager,
      memoryIngestion,
      worktreeDir: "/tmp/worktrees",
    });
  });

  it("creates task session on assignment", async () => {
    const mockExec = vi.fn((_cmd: string, _opts: any, cb: Function) => {
      cb(null, "", "");
      return {} as any;
    });
    const cp = await import("node:child_process");
    vi.mocked(cp.exec).mockImplementation(mockExec as any);

    telegramAdapter.fireTask({
      source: "linear",
      taskId: "TASK-1",
      title: "Fix auth bug",
      description: "Auth is broken",
      url: "https://linear.app/TASK-1",
    });

    // Wait for async handling
    await new Promise((r) => setTimeout(r, 10));

    expect(telegramAdapter.createThread).toHaveBeenCalledWith(
      "Task: Fix auth bug"
    );
    expect(sessionManager.createSession).toHaveBeenCalled();
    expect(stateStore.save).toHaveBeenCalled();
  });

  it("routes telegram message to correct session", async () => {
    const session: TaskSession = {
      taskId: "TASK-1",
      source: "linear",
      title: "Fix auth bug",
      worktreePath: "/tmp/worktrees/TASK-1",
      branch: "igor/TASK-1",
      tmuxSession: "igor-TASK-1",
      telegramThreadId: "thread-456",
      status: "active",
      createdAt: "2026-04-08T00:00:00Z",
    };
    vi.mocked(stateStore.findByTelegramThread).mockReturnValue(session);

    telegramAdapter.fireMessage({
      channelType: "telegram",
      threadId: "thread-456",
      text: "Check the tests",
      author: "user",
      metadata: {},
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(sessionManager.sendInput).toHaveBeenCalledWith(
      "igor-TASK-1",
      "Check the tests"
    );
  });

  it("ingests all messages to memory", () => {
    telegramAdapter.fireMessage({
      channelType: "telegram",
      threadId: "general",
      text: "Hello",
      author: "user",
      metadata: {},
    });

    expect(memoryIngestion.buffer).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src && npx vitest run orchestrator.test.ts`
Expected: FAIL — `Orchestrator` not found

- [ ] **Step 3: Write minimal implementation**

```typescript
import { exec } from "node:child_process";
import type {
  ChannelAdapter,
  IncomingMessage,
  TaskAssignment,
  TaskSession,
} from "./types.js";
import type { StateStore } from "./state.js";
import type { TmuxSessionManager } from "./session-manager.js";
import type { MemoryIngestion } from "./memory-ingestion.js";

function run(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, {}, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout.toString());
    });
  });
}

interface OrchestratorOptions {
  adapters: ChannelAdapter[];
  telegram: ChannelAdapter;
  stateStore: StateStore;
  sessionManager: TmuxSessionManager;
  memoryIngestion: MemoryIngestion;
  worktreeDir: string;
}

export class Orchestrator {
  private opts: OrchestratorOptions;

  constructor(opts: OrchestratorOptions) {
    this.opts = opts;
    this.wireAdapters();
  }

  private wireAdapters(): void {
    for (const adapter of this.opts.adapters) {
      adapter.onMessage((msg) => this.handleMessage(msg));
      adapter.onTaskAssigned((task) => this.handleTaskAssignment(task));
    }
  }

  private async handleTaskAssignment(task: TaskAssignment): Promise<void> {
    const sanitizedId = task.taskId.replace(/[^a-zA-Z0-9-]/g, "-");
    const branch = `igor/${sanitizedId}`;
    const worktreePath = `${this.opts.worktreeDir}/${sanitizedId}`;

    try {
      await run(`git worktree add ${worktreePath} -b ${branch}`);
    } catch (err) {
      console.error(`Failed to create worktree for ${task.taskId}:`, err);
      return;
    }

    const telegram = this.opts.telegram;
    let telegramThreadId = "";
    if (telegram.createThread) {
      telegramThreadId = await telegram.createThread(`Task: ${task.title}`);
    }

    const tmuxSession = `igor-${sanitizedId}`;
    const prompt = `Task: ${task.title}\n\n${task.description}${task.url ? `\n\nSource: ${task.url}` : ""}`;

    await this.opts.sessionManager.createSession({
      name: tmuxSession,
      worktreePath,
      prompt,
    });

    const session: TaskSession = {
      taskId: task.taskId,
      source: task.source,
      title: task.title,
      url: task.url,
      worktreePath,
      branch,
      tmuxSession,
      telegramThreadId,
      status: "active",
      createdAt: new Date().toISOString(),
    };

    this.opts.stateStore.save(session);

    if (telegram.sendMessage && telegramThreadId) {
      await telegram.sendMessage(
        telegramThreadId,
        `Started working on: ${task.title}`
      );
    }
  }

  private async handleMessage(msg: IncomingMessage): Promise<void> {
    // Always ingest to memory
    const project = (msg.metadata.project as string) ?? msg.channelType;
    this.opts.memoryIngestion.buffer(project, msg);

    // Route telegram messages to the correct Claude session
    if (msg.channelType === "telegram") {
      const session = this.opts.stateStore.findByTelegramThread(msg.threadId);
      if (session && session.status === "active") {
        await this.opts.sessionManager.sendInput(
          session.tmuxSession,
          msg.text
        );
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src && npx vitest run orchestrator.test.ts`
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator.ts src/orchestrator.test.ts
git commit -m "feat(channels): orchestrator with routing and lifecycle"
```

---

### Task 12: Entry Point and Webhook Server

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Write the entry point**

```typescript
import express from "express";
import { loadConfig } from "./config.js";
import { StateStore } from "./state.js";
import { TmuxSessionManager } from "./session-manager.js";
import { MemoryIngestion } from "./memory-ingestion.js";
import { TelegramAdapter } from "./adapters/telegram.js";
import { SlackAdapter } from "./adapters/slack.js";
import { LinearAdapter } from "./adapters/linear.js";
import { GitHubAdapter } from "./adapters/github.js";
import { Orchestrator } from "./orchestrator.js";
import type { ChannelAdapter } from "./types.js";

const configPath = process.argv[2] ?? "channels.config.json";
const config = loadConfig(configPath);

const stateStore = new StateStore(config.stateFile);
const sessionManager = new TmuxSessionManager();
const memoryIngestion = new MemoryIngestion({
  bufferDir: config.memory.bufferDir,
  ingestIntervalMs: config.memory.ingestIntervalMs,
});

const telegramAdapter = new TelegramAdapter({
  botToken: config.telegram.botToken,
  ownerChatId: config.telegram.ownerChatId,
});

const slackAdapter = new SlackAdapter({
  botToken: config.slack.botToken,
  appToken: config.slack.appToken,
  channelProjectMap: config.slack.channelProjectMap,
});

const linearAdapter = new LinearAdapter({
  webhookSecret: config.linear.webhookSecret,
  assigneeId: config.linear.assigneeId,
});

const githubAdapter = new GitHubAdapter({
  webhookSecret: config.github.webhookSecret,
  assigneeLogin: config.github.assigneeLogin,
});

const adapters: ChannelAdapter[] = [
  telegramAdapter,
  slackAdapter,
  linearAdapter,
  githubAdapter,
];

const orchestrator = new Orchestrator({
  adapters,
  telegram: telegramAdapter,
  stateStore,
  sessionManager,
  memoryIngestion,
  worktreeDir: config.worktreeDir,
});

// Webhook server for Linear and GitHub
const app = express();
app.use(express.json());

app.post("/webhooks/linear", (req, res) => {
  linearAdapter.handleWebhook(req.body);
  res.sendStatus(200);
});

app.post("/webhooks/github", (req, res) => {
  const event = req.headers["x-github-event"] as string;
  githubAdapter.handleWebhook(event, req.body);
  res.sendStatus(200);
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", sessions: stateStore.getActive().length });
});

async function main() {
  app.listen(config.webhookPort, () => {
    console.log(`Webhook server listening on port ${config.webhookPort}`);
  });

  await Promise.all(adapters.map((a) => a.start()));
  memoryIngestion.start();

  console.log("Igor Channels started");

  process.on("SIGINT", async () => {
    console.log("Shutting down...");
    memoryIngestion.stop();
    await Promise.all(adapters.map((a) => a.stop()));
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify it compiles**

Run: `cd src && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat(channels): entry point with webhook server"
```
