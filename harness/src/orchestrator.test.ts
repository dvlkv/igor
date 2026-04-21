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
        findByBranch: vi.fn(),
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
    onTaskCompleted: vi.fn(),
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
    onTaskCompleted: vi.fn(),
    sendPermissionPrompt: vi.fn().mockResolvedValue(undefined),
    editMessage: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    deleteTopic: vi.fn().mockResolvedValue(undefined),
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

    it("deletes telegram topic on task completion", async () => {
      const mockTask: Task = {
        taskId: "LIN-200",
        projectName: "igor",
        source: "linear",
        title: "Topic test",
        worktreePath: "/tmp/worktrees/LIN-200",
        branch: "igor/LIN-200",
        sessionId: "LIN-200",
        telegramThreadId: "thread-200",
        status: "active",
        createdAt: new Date().toISOString(),
      };

      (taskStore.get as ReturnType<typeof vi.fn>).mockReturnValue(mockTask);

      const { exec } = await import("node:child_process");
      (exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        (_cmd: string, cb: Function) => {
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

      await orchestrator.completeTask("LIN-200");

      expect(telegramAdapter.deleteTopic).toHaveBeenCalledWith("thread-200");
    });

    it("skips topic deletion when no telegramThreadId", async () => {
      const mockTask: Task = {
        taskId: "GH-100",
        projectName: "igor",
        source: "github",
        title: "No thread",
        worktreePath: "/tmp/worktrees/GH-100",
        branch: "igor/GH-100",
        sessionId: "GH-100",
        status: "active",
        createdAt: new Date().toISOString(),
      };

      (taskStore.get as ReturnType<typeof vi.fn>).mockReturnValue(mockTask);

      const { exec } = await import("node:child_process");
      (exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        (_cmd: string, cb: Function) => {
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

      await orchestrator.completeTask("GH-100");

      expect(telegramAdapter.deleteTopic).not.toHaveBeenCalled();
    });

    it("completes task even if topic deletion fails", async () => {
      const mockTask: Task = {
        taskId: "LIN-300",
        projectName: "igor",
        source: "linear",
        title: "Delete fails",
        worktreePath: "/tmp/worktrees/LIN-300",
        branch: "igor/LIN-300",
        sessionId: "LIN-300",
        telegramThreadId: "thread-300",
        status: "active",
        createdAt: new Date().toISOString(),
      };

      (taskStore.get as ReturnType<typeof vi.fn>).mockReturnValue(mockTask);
      (telegramAdapter.deleteTopic as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("delete failed"),
      );

      const { exec } = await import("node:child_process");
      (exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        (_cmd: string, cb: Function) => {
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

      await orchestrator.completeTask("LIN-300");

      expect(taskStore.update).toHaveBeenCalledWith(
        "LIN-300",
        expect.objectContaining({ status: "completed" }),
      );
    });
  });

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
});
