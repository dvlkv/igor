import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

// --- Config ---

const STATE_FILE =
  process.env.IGOR_STATE_FILE || "/home/pi/igor/harness/state.json";
const PROJECTS_DIR = process.env.IGOR_PROJECTS_DIR || "/home/pi/projects";
const IGOR_DIR = process.env.IGOR_DIR || "/home/pi/igor";

// --- Helpers ---

interface TaskSession {
  taskId: string;
  source: string;
  title: string;
  url?: string;
  worktreePath: string;
  branch: string;
  sessionId: string;
  telegramThreadId: string;
  status: "active" | "completed";
  createdAt: string;
  claudePid?: number;
}

interface StateData {
  sessions: TaskSession[];
}

function readState(): StateData {
  if (!existsSync(STATE_FILE)) {
    return { sessions: [] };
  }
  return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
}

function writeState(data: StateData): void {
  writeFileSync(STATE_FILE, JSON.stringify(data, null, 2), "utf-8");
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

interface WorktreeEntry {
  path: string;
  commit: string;
  branch: string;
  project: string;
}

function listWorktreesForRepo(repoPath: string): WorktreeEntry[] {
  try {
    const output = execSync("git worktree list --porcelain", {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: 5000,
    });

    const entries: WorktreeEntry[] = [];
    let current: Partial<WorktreeEntry> = {};

    for (const line of output.split("\n")) {
      if (line.startsWith("worktree ")) {
        if (current.path) {
          current.project = repoPath;
          entries.push(current as WorktreeEntry);
        }
        current = { path: line.slice(9) };
      } else if (line.startsWith("HEAD ")) {
        current.commit = line.slice(5);
      } else if (line.startsWith("branch ")) {
        current.branch = line.slice(7).replace("refs/heads/", "");
      } else if (line === "detached") {
        current.branch = "(detached)";
      }
    }
    if (current.path) {
      current.project = repoPath;
      entries.push(current as WorktreeEntry);
    }

    return entries;
  } catch {
    return [];
  }
}

function discoverProjectDirs(): { name: string; path: string }[] {
  const projects: { name: string; path: string }[] = [];

  // Always include igor itself
  projects.push({ name: "igor", path: IGOR_DIR });

  // Scan projects directory
  if (existsSync(PROJECTS_DIR)) {
    try {
      for (const entry of readdirSync(PROJECTS_DIR)) {
        const fullPath = join(PROJECTS_DIR, entry);
        if (
          statSync(fullPath).isDirectory() &&
          existsSync(join(fullPath, ".git"))
        ) {
          projects.push({ name: entry, path: fullPath });
        }
      }
    } catch {
      // ignore read errors
    }
  }

  return projects;
}

// --- MCP Server ---

const server = new McpServer({
  name: "igor-context",
  version: "0.1.0",
});

// --- Tools ---

server.tool(
  "list_tasks",
  "List igor task sessions with optional status filter",
  { status: z.enum(["active", "completed", "all"]).optional().describe("Filter by status (default: all)") },
  async ({ status }) => {
    const state = readState();
    const filter = status ?? "all";
    const sessions =
      filter === "all"
        ? state.sessions
        : state.sessions.filter((s) => s.status === filter);

    const lines = sessions.map((s) => {
      const alive =
        s.claudePid != null ? (isPidAlive(s.claudePid) ? "alive" : "dead") : "no-pid";
      return `[${s.status}] ${s.taskId}: ${s.title || "(untitled)"} | branch=${s.branch} | pid=${s.claudePid ?? "?"} (${alive}) | ${s.source} | ${s.createdAt}`;
    });

    return {
      content: [
        {
          type: "text" as const,
          text: lines.length > 0 ? lines.join("\n") : "No tasks found.",
        },
      ],
    };
  },
);

server.tool(
  "get_task",
  "Get full details of a specific task by ID",
  { task_id: z.string().describe("Task ID to look up") },
  async ({ task_id }) => {
    const state = readState();
    const session = state.sessions.find((s) => s.taskId === task_id);

    if (!session) {
      return {
        content: [{ type: "text" as const, text: `Task "${task_id}" not found.` }],
      };
    }

    const alive =
      session.claudePid != null
        ? isPidAlive(session.claudePid)
          ? "alive"
          : "dead"
        : "no-pid";

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ ...session, processAlive: alive }, null, 2),
        },
      ],
    };
  },
);

server.tool(
  "update_task",
  "Update a task session (e.g. mark as completed)",
  {
    task_id: z.string().describe("Task ID to update"),
    status: z.enum(["active", "completed"]).optional().describe("New status"),
    title: z.string().optional().describe("New title"),
  },
  async ({ task_id, status, title }) => {
    const state = readState();
    const session = state.sessions.find((s) => s.taskId === task_id);

    if (!session) {
      return {
        content: [{ type: "text" as const, text: `Task "${task_id}" not found.` }],
      };
    }

    if (status) session.status = status;
    if (title) session.title = title;

    writeState(state);

    return {
      content: [
        {
          type: "text" as const,
          text: `Task "${task_id}" updated. ${JSON.stringify({ status: session.status, title: session.title })}`,
        },
      ],
    };
  },
);

server.tool(
  "list_worktrees",
  "List git worktrees across all known projects",
  {
    project: z.string().optional().describe("Filter by project name (optional)"),
  },
  async ({ project }) => {
    const projects = discoverProjectDirs();
    const filtered = project
      ? projects.filter((p) => p.name === project)
      : projects;

    if (filtered.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: project
              ? `Project "${project}" not found.`
              : "No projects found.",
          },
        ],
      };
    }

    const allEntries: (WorktreeEntry & { projectName: string })[] = [];
    for (const p of filtered) {
      const entries = listWorktreesForRepo(p.path);
      for (const e of entries) {
        allEntries.push({ ...e, projectName: p.name });
      }
    }

    const lines = allEntries.map(
      (e) =>
        `[${e.projectName}] ${e.branch} | ${e.path} | ${e.commit?.slice(0, 8)}`,
    );

    return {
      content: [
        {
          type: "text" as const,
          text:
            lines.length > 0 ? lines.join("\n") : "No worktrees found.",
        },
      ],
    };
  },
);

server.tool(
  "list_projects",
  "List all known project directories",
  {},
  async () => {
    const projects = discoverProjectDirs();

    const lines = projects.map((p) => {
      const hasWorktrees = listWorktreesForRepo(p.path).length > 1;
      return `${p.name}: ${p.path}${hasWorktrees ? " (has worktrees)" : ""}`;
    });

    return {
      content: [
        {
          type: "text" as const,
          text:
            lines.length > 0 ? lines.join("\n") : "No projects found.",
        },
      ],
    };
  },
);

server.tool(
  "list_sessions",
  "List active Claude sessions with process status",
  {},
  async () => {
    const state = readState();
    const active = state.sessions.filter((s) => s.status === "active");

    const lines = active.map((s) => {
      const alive =
        s.claudePid != null
          ? isPidAlive(s.claudePid)
            ? "alive"
            : "dead"
          : "no-pid";
      return `${s.sessionId}: pid=${s.claudePid ?? "?"} (${alive}) | task=${s.taskId} "${s.title || "(untitled)"}" | ${s.source}`;
    });

    return {
      content: [
        {
          type: "text" as const,
          text:
            lines.length > 0
              ? lines.join("\n")
              : "No active sessions.",
        },
      ],
    };
  },
);

server.tool(
  "kill_session",
  "Kill a Claude session by task/session ID (sends SIGTERM then SIGKILL)",
  {
    task_id: z.string().describe("Task/session ID to kill"),
  },
  async ({ task_id }) => {
    const state = readState();
    const session = state.sessions.find(
      (s) => s.taskId === task_id || s.sessionId === task_id,
    );

    if (!session) {
      return {
        content: [{ type: "text" as const, text: `Session "${task_id}" not found.` }],
      };
    }

    if (!session.claudePid) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Session "${task_id}" has no PID recorded.`,
          },
        ],
      };
    }

    if (!isPidAlive(session.claudePid)) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Session "${task_id}" (pid=${session.claudePid}) is already dead.`,
          },
        ],
      };
    }

    try {
      // Send SIGTERM first
      process.kill(session.claudePid, "SIGTERM");

      // Wait a moment, then check and SIGKILL if needed
      await new Promise((r) => setTimeout(r, 2000));

      if (isPidAlive(session.claudePid)) {
        process.kill(session.claudePid, "SIGKILL");
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Session "${task_id}" (pid=${session.claudePid}) killed.`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to kill session "${task_id}": ${err}`,
          },
        ],
      };
    }
  },
);

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("igor-context MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
