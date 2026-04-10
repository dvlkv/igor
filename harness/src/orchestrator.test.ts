import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  ChannelAdapter,
  IncomingMessage,
  TaskAssignment,
  Task,
} from "./types.js";

vi.mock("./task-store.js", () => {
  return {
    TaskStore: vi.fn().mockImplementation(function () {
      return {
        save: vi.fn(),
        get: vi.fn(),
        update: vi.fn(),
        getAll: vi.fn().mockReturnValue([]),
        getActive: vi.fn().mockReturnValue([]),
        getByProject: vi.fn().mockReturnValue([]),
        findByTelegramThread: vi.fn(),
        findBySlackThread: vi.fn(),
        findByLinearIssue: vi.fn(),
        findByGithubIssue: vi.fn(),
      };
    }),
  };
});

vi.mock("./session-manager.js", () => {
  return {
    ClaudeSessionManager: vi.fn().mockImplementation(function () {
      return {
        createSession: vi.fn().mockResolvedValue(12345),
        killSession: vi.fn().mockResolvedValue(undefined),
        isAlive: vi.fn().mockReturnValue(false),
        listSessions: vi.fn().mockReturnValue([]),
        killAll: vi.fn().mockResolvedValue(undefined),
        sendMessage: vi.fn().mockReturnValue(true),
        onOutput: vi.fn(),
        onToolUse: vi.fn(),
        onAssistantText: vi.fn(),
      };
    }),
  };
});

vi.mock("./memory-ingestion.js", () => {
  return {
    MemoryIngestion: vi.fn().mockImplementation(function () {
      return {
        buffer: vi.fn(),
        flush: vi.fn().mockResolvedValue(undefined),
        start: vi.fn(),
        stop: vi.fn(),
      };
    }),
  };
});

vi.mock("./thread-name.js", () => {
  return {
    generateThreadName: vi.fn(async (title: string) => title),
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
import { TaskStore } from "./task-store.js";
import { ClaudeSessionManager } from "./session-manager.js";
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
    sendMessage: vi.fn().mockResolvedValue(100),
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

function createMockTelegramAdapter() {
  const base = createMockAdapter("telegram");
  return {
    ...base,
    onClear: vi.fn(),
    onPermissionResponse: vi.fn(),
    sendPermissionPrompt: vi.fn().mockResolvedValue(undefined),
    editMessage: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
  };
}

describe("Orchestrator", () => {
  let taskStore: InstanceType<typeof TaskStore>;
  let sessionManager: InstanceType<typeof ClaudeSessionManager>;
  let memoryIngestion: InstanceType<typeof MemoryIngestion>;
  let telegramAdapter: ReturnType<typeof createMockTelegramAdapter>;
  let linearAdapter: ReturnType<typeof createMockAdapter>;

  beforeEach(() => {
    vi.clearAllMocks();
    taskStore = new TaskStore("/tmp/test-tasks.json");
    sessionManager = new ClaudeSessionManager();
    memoryIngestion = new MemoryIngestion({
      bufferDir: "/tmp/buffers",
      ingestIntervalMs: 60000,
    });
    telegramAdapter = createMockTelegramAdapter();
    linearAdapter = createMockAdapter("linear");
  });

  it("creates task on assignment", async () => {
    const orchestrator = new Orchestrator({
      adapters: [telegramAdapter, linearAdapter],
      telegram: telegramAdapter as any,
      taskStore,
      sessionManager,
      memoryIngestion,
      worktreeDir: "/tmp/worktrees",
      generalProjectDir: "/tmp/project",
      generalClaudeArgs: [],
      taskClaudeArgs: [],
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
      "Fix the bug",
    );
    expect(sessionManager.createSession).toHaveBeenCalled();
    expect(taskStore.save).toHaveBeenCalled();

    const savedTask = (taskStore.save as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Task;
    expect(savedTask.sessionId).toBe("LIN-123");
    expect(savedTask.claudePid).toBe(12345);
    expect(savedTask.projectName).toBe("igor");
    expect(savedTask.linearIssueUrl).toBe("https://linear.app/issue/LIN-123");
  });

  it("routes telegram message to session via stdin", async () => {
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

    (
      taskStore.findByTelegramThread as ReturnType<typeof vi.fn>
    ).mockReturnValue(mockTask);
    (sessionManager.isAlive as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const orchestrator = new Orchestrator({
      adapters: [telegramAdapter, linearAdapter],
      telegram: telegramAdapter as any,
      taskStore,
      sessionManager,
      memoryIngestion,
      worktreeDir: "/tmp/worktrees",
      generalProjectDir: "/tmp/project",
      generalClaudeArgs: [],
      taskClaudeArgs: [],
    });

    telegramAdapter.fireMessage({
      channelType: "telegram",
      threadId: "thread-456",
      text: "Please also fix the typo",
      author: "user",
      metadata: { chat_id: "320784056", message_id: "789" },
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(sessionManager.sendMessage).toHaveBeenCalledWith(
      "LIN-123",
      "Please also fix the typo",
    );
  });

  it("routes general telegram messages to general session via stdin", async () => {
    (sessionManager.isAlive as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const orchestrator = new Orchestrator({
      adapters: [telegramAdapter],
      telegram: telegramAdapter as any,
      taskStore,
      sessionManager,
      memoryIngestion,
      worktreeDir: "/tmp/worktrees",
      generalProjectDir: "/tmp/project",
      generalClaudeArgs: [],
      taskClaudeArgs: [],
    });

    telegramAdapter.fireMessage({
      channelType: "telegram",
      threadId: "general",
      text: "Hello world",
      author: "user",
      metadata: { chat_id: "320784056" },
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(sessionManager.sendMessage).toHaveBeenCalledWith(
      "igor-general",
      "Hello world",
    );
  });

  it("routes claude output back to adapter", () => {
    let outputCallback: ((sessionId: string, text: string) => void) | undefined;
    (sessionManager.onOutput as ReturnType<typeof vi.fn>).mockImplementation(
      (handler: (sessionId: string, text: string) => void) => {
        outputCallback = handler;
      },
    );

    (sessionManager.isAlive as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const orchestrator = new Orchestrator({
      adapters: [telegramAdapter],
      telegram: telegramAdapter as any,
      taskStore,
      sessionManager,
      memoryIngestion,
      worktreeDir: "/tmp/worktrees",
      generalProjectDir: "/tmp/project",
      generalClaudeArgs: [],
      taskClaudeArgs: [],
    });

    // Send a message to set the reply context
    telegramAdapter.fireMessage({
      channelType: "telegram",
      threadId: "general",
      text: "Hello",
      author: "user",
      metadata: { chat_id: "320784056" },
    });

    // Simulate Claude responding
    outputCallback!("igor-general", "Hi there!");

    expect(telegramAdapter.sendMessage).toHaveBeenCalledWith(
      "general",
      "Hi there!",
    );
  });

  it("sends progress message on first tool_use and edits on subsequent", async () => {
    let outputCallback: ((sessionId: string, text: string) => void) | undefined;
    let toolUseCallback:
      | ((sessionId: string, toolName: string, input: Record<string, unknown>) => void)
      | undefined;

    (sessionManager.onOutput as ReturnType<typeof vi.fn>).mockImplementation(
      (handler: (sessionId: string, text: string) => void) => {
        outputCallback = handler;
      },
    );
    (sessionManager.onToolUse as ReturnType<typeof vi.fn>).mockImplementation(
      (handler: (sessionId: string, toolName: string, input: Record<string, unknown>) => void) => {
        toolUseCallback = handler;
      },
    );
    (sessionManager.isAlive as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const orchestrator = new Orchestrator({
      adapters: [telegramAdapter],
      telegram: telegramAdapter as any,
      taskStore,
      sessionManager,
      memoryIngestion,
      worktreeDir: "/tmp/worktrees",
      generalProjectDir: "/tmp/project",
      generalClaudeArgs: [],
      taskClaudeArgs: [],
    });

    // Set reply context
    telegramAdapter.fireMessage({
      channelType: "telegram",
      threadId: "general",
      text: "Hello",
      author: "user",
      metadata: { chat_id: "320784056" },
    });

    await new Promise((r) => setTimeout(r, 10));

    // The "thinking..." indicator was already sent when the message arrived
    expect(telegramAdapter.sendMessage).toHaveBeenCalledWith(
      "general",
      "⚙️ _thinking..._",
    );

    // First tool_use: should edit the existing "thinking..." progress message
    toolUseCallback!("igor-general", "Bash", { command: "ls" });
    await new Promise((r) => setTimeout(r, 10));

    expect(telegramAdapter.editMessage).toHaveBeenCalledWith(
      "general",
      100,
      "⚙️ _Running command..._\n\n`ls`",
    );

    // Second tool_use: should edit the same progress message
    toolUseCallback!("igor-general", "Read", { file_path: "/tmp/x" });
    await new Promise((r) => setTimeout(r, 10));

    expect(telegramAdapter.editMessage).toHaveBeenCalledWith(
      "general",
      100,
      "⚙️ _Reading files..._\n\n/tmp/x",
    );
  });

  it("deletes progress message and sends result as new message", async () => {
    let outputCallback: ((sessionId: string, text: string) => void) | undefined;
    let toolUseCallback:
      | ((sessionId: string, toolName: string, input: Record<string, unknown>) => void)
      | undefined;

    (sessionManager.onOutput as ReturnType<typeof vi.fn>).mockImplementation(
      (handler: (sessionId: string, text: string) => void) => {
        outputCallback = handler;
      },
    );
    (sessionManager.onToolUse as ReturnType<typeof vi.fn>).mockImplementation(
      (handler: (sessionId: string, toolName: string, input: Record<string, unknown>) => void) => {
        toolUseCallback = handler;
      },
    );
    (sessionManager.isAlive as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const orchestrator = new Orchestrator({
      adapters: [telegramAdapter],
      telegram: telegramAdapter as any,
      taskStore,
      sessionManager,
      memoryIngestion,
      worktreeDir: "/tmp/worktrees",
      generalProjectDir: "/tmp/project",
      generalClaudeArgs: [],
      taskClaudeArgs: [],
    });

    // Set reply context
    telegramAdapter.fireMessage({
      channelType: "telegram",
      threadId: "general",
      text: "Hello",
      author: "user",
      metadata: { chat_id: "320784056" },
    });

    await new Promise((r) => setTimeout(r, 10));

    // Send a tool_use first
    toolUseCallback!("igor-general", "Bash", { command: "ls" });
    await new Promise((r) => setTimeout(r, 10));

    // Reset mocks to isolate result behavior
    (telegramAdapter.sendMessage as ReturnType<typeof vi.fn>).mockClear();
    (telegramAdapter.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(200);

    // Now the result comes in
    outputCallback!("igor-general", "Here is your answer");

    expect(telegramAdapter.deleteMessage).toHaveBeenCalledWith(100);
    expect(telegramAdapter.sendMessage).toHaveBeenCalledWith(
      "general",
      "Here is your answer",
    );
  });

  it("ingests all messages to memory", () => {
    const orchestrator = new Orchestrator({
      adapters: [telegramAdapter, linearAdapter],
      telegram: telegramAdapter as any,
      taskStore,
      sessionManager,
      memoryIngestion,
      worktreeDir: "/tmp/worktrees",
      generalProjectDir: "/tmp/project",
      generalClaudeArgs: [],
      taskClaudeArgs: [],
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
