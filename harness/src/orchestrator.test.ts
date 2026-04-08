import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  ChannelAdapter,
  IncomingMessage,
  TaskAssignment,
  TaskSession,
} from "./types.js";

vi.mock("./state.js", () => {
  return {
    StateStore: vi.fn().mockImplementation(() => ({
      save: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
      getAll: vi.fn().mockReturnValue([]),
      getActive: vi.fn().mockReturnValue([]),
      findByTelegramThread: vi.fn(),
    })),
  };
});

vi.mock("./session-manager.js", () => {
  return {
    TmuxSessionManager: vi.fn().mockImplementation(() => ({
      createSession: vi.fn().mockResolvedValue(undefined),
      sendInput: vi.fn().mockResolvedValue(undefined),
      readOutput: vi.fn(),
      killSession: vi.fn().mockResolvedValue(undefined),
      listSessions: vi.fn().mockResolvedValue([]),
    })),
  };
});

vi.mock("./memory-ingestion.js", () => {
  return {
    MemoryIngestion: vi.fn().mockImplementation(() => ({
      buffer: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined),
      start: vi.fn(),
      stop: vi.fn(),
    })),
  };
});

vi.mock("node:child_process", () => {
  return {
    exec: vi.fn((_cmd: string, cb: Function) => {
      cb(null, "", "");
    }),
  };
});

import { Orchestrator } from "./orchestrator.js";
import { StateStore } from "./state.js";
import { TmuxSessionManager } from "./session-manager.js";
import { MemoryIngestion } from "./memory-ingestion.js";

type MessageHandler = (msg: IncomingMessage) => void;
type TaskHandler = (task: TaskAssignment) => void;

function createMockAdapter(name: string) {
  let messageHandler: MessageHandler | undefined;
  let taskHandler: TaskHandler | undefined;

  const adapter: ChannelAdapter & {
    fireMessage: (msg: IncomingMessage) => void;
    fireTask: (task: TaskAssignment) => void;
  } = {
    name,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    onMessage: vi.fn((handler: MessageHandler) => {
      messageHandler = handler;
    }),
    onTaskAssigned: vi.fn((handler: TaskHandler) => {
      taskHandler = handler;
    }),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    createThread: vi.fn().mockResolvedValue("thread-123"),
    fireMessage(msg: IncomingMessage) {
      messageHandler?.(msg);
    },
    fireTask(task: TaskAssignment) {
      taskHandler?.(task);
    },
  };

  return adapter;
}

describe("Orchestrator", () => {
  let stateStore: InstanceType<typeof StateStore>;
  let sessionManager: InstanceType<typeof TmuxSessionManager>;
  let memoryIngestion: InstanceType<typeof MemoryIngestion>;
  let telegramAdapter: ReturnType<typeof createMockAdapter>;
  let linearAdapter: ReturnType<typeof createMockAdapter>;

  beforeEach(() => {
    vi.clearAllMocks();
    stateStore = new StateStore("/tmp/test-state.json");
    sessionManager = new TmuxSessionManager();
    memoryIngestion = new MemoryIngestion({
      bufferDir: "/tmp/buffers",
      ingestIntervalMs: 60000,
    });
    telegramAdapter = createMockAdapter("telegram");
    linearAdapter = createMockAdapter("linear");
  });

  it("creates task session on assignment", async () => {
    const orchestrator = new Orchestrator({
      adapters: [telegramAdapter, linearAdapter],
      telegram: telegramAdapter,
      stateStore,
      sessionManager,
      memoryIngestion,
      worktreeDir: "/tmp/worktrees",
    });

    linearAdapter.fireTask({
      source: "linear",
      taskId: "LIN-123",
      title: "Fix the bug",
      description: "There is a bug that needs fixing",
      url: "https://linear.app/issue/LIN-123",
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(telegramAdapter.createThread).toHaveBeenCalledWith(
      "Task: Fix the bug",
    );
    expect(sessionManager.createSession).toHaveBeenCalled();
    expect(stateStore.save).toHaveBeenCalled();
  });

  it("routes telegram message to correct session", async () => {
    const mockSession: TaskSession = {
      taskId: "LIN-123",
      source: "linear",
      title: "Fix the bug",
      worktreePath: "/tmp/worktrees/LIN-123",
      branch: "igor/LIN-123",
      tmuxSession: "LIN-123",
      telegramThreadId: "thread-456",
      status: "active",
      createdAt: new Date().toISOString(),
    };

    (stateStore.findByTelegramThread as ReturnType<typeof vi.fn>).mockReturnValue(
      mockSession,
    );

    const orchestrator = new Orchestrator({
      adapters: [telegramAdapter, linearAdapter],
      telegram: telegramAdapter,
      stateStore,
      sessionManager,
      memoryIngestion,
      worktreeDir: "/tmp/worktrees",
    });

    telegramAdapter.fireMessage({
      channelType: "telegram",
      threadId: "thread-456",
      text: "Please also fix the typo",
      author: "user",
      metadata: {},
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(sessionManager.sendInput).toHaveBeenCalledWith(
      "LIN-123",
      "Please also fix the typo",
    );
  });

  it("ingests all messages to memory", () => {
    const orchestrator = new Orchestrator({
      adapters: [telegramAdapter, linearAdapter],
      telegram: telegramAdapter,
      stateStore,
      sessionManager,
      memoryIngestion,
      worktreeDir: "/tmp/worktrees",
    });

    telegramAdapter.fireMessage({
      channelType: "telegram",
      threadId: "thread-789",
      text: "Hello world",
      author: "user",
      metadata: { project: "my-project" },
    });

    expect(memoryIngestion.buffer).toHaveBeenCalledWith(
      "my-project",
      expect.objectContaining({ text: "Hello world" }),
    );
  });
});
