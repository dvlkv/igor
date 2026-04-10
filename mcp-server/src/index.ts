import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
  lstatSync,
  readlinkSync,
} from "node:fs";
import { execSync } from "node:child_process";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

// --- Config ---

const DOT_IGOR = join(homedir(), ".igor");
const TASKS_FILE = process.env.IGOR_TASKS_FILE || join(DOT_IGOR, "tasks.json");
const PROJECTS_FILE =
  process.env.IGOR_PROJECTS_FILE || join(DOT_IGOR, "projects.json");
const PROJECTS_DIR = process.env.IGOR_PROJECTS_DIR || join(homedir(), "projects");
const IGOR_DIR = process.env.IGOR_DIR || join(homedir(), "igor");

// --- Types (mirrors harness/src/types.ts) ---

interface Task {
  taskId: string;
  projectName: string;
  source: string;
  title: string;
  description?: string;
  worktreePath: string;
  branch: string;
  sessionId: string;
  status: "active" | "completed" | "abandoned";
  createdAt: string;
  completedAt?: string;
  claudePid?: number;
  telegramThreadId?: string;
  slackThreadTs?: string;
  slackChannelId?: string;
  linearIssueId?: string;
  linearIssueUrl?: string;
  githubIssueNumber?: number;
  githubIssueUrl?: string;
}

interface TaskData {
  tasks: Task[];
}

interface Project {
  name: string;
  path: string;
  remoteUrl?: string;
  createdAt: string;
}

interface ProjectData {
  projects: Project[];
}

// --- Helpers ---

function readTasks(): Task[] {
  if (existsSync(TASKS_FILE)) {
    try {
      const data: TaskData = JSON.parse(readFileSync(TASKS_FILE, "utf-8"));
      return data.tasks;
    } catch {
      // fall through
    }
  }
  return [];
}

function writeTasks(tasks: Task[]): void {
  const data: TaskData = { tasks };
  writeFileSync(TASKS_FILE, JSON.stringify(data, null, 2), "utf-8");
}

function readProjects(): Project[] {
  if (existsSync(PROJECTS_FILE)) {
    try {
      const data: ProjectData = JSON.parse(
        readFileSync(PROJECTS_FILE, "utf-8"),
      );
      return data.projects;
    } catch {
      // fall through
    }
  }
  return [];
}

function discoverProjectDirs(): { name: string; path: string; registered: boolean }[] {
  const registered = readProjects();
  const seen = new Set<string>();
  const result: { name: string; path: string; registered: boolean }[] = [];

  // Registered projects first
  for (const p of registered) {
    seen.add(p.name);
    result.push({ name: p.name, path: p.path, registered: true });
  }

  // Always include igor itself
  if (!seen.has("igor")) {
    result.push({ name: "igor", path: IGOR_DIR, registered: false });
    seen.add("igor");
  }

  // Scan projects directory for unregistered repos
  if (existsSync(PROJECTS_DIR)) {
    try {
      for (const entry of readdirSync(PROJECTS_DIR)) {
        if (seen.has(entry)) continue;
        const fullPath = join(PROJECTS_DIR, entry);
        try {
          const st = lstatSync(fullPath);
          const targetPath = st.isSymbolicLink()
            ? resolve(readlinkSync(fullPath))
            : fullPath;
          if (
            existsSync(targetPath) &&
            statSync(targetPath).isDirectory() &&
            existsSync(join(targetPath, ".git"))
          ) {
            result.push({ name: entry, path: targetPath, registered: false });
            seen.add(entry);
          }
        } catch {
          // skip broken entries
        }
      }
    } catch {
      // ignore read errors
    }
  }

  return result;
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

// --- MCP Server ---

const server = new McpServer({
  name: "igor-context",
  version: "0.2.0",
});

// --- Tools ---

server.tool(
  "list_tasks",
  "List igor tasks with optional status filter",
  {
    status: z
      .enum(["active", "completed", "abandoned", "all"])
      .optional()
      .describe("Filter by status (default: all)"),
    project: z.string().optional().describe("Filter by project name"),
  },
  async ({ status, project }) => {
    let tasks = readTasks();
    const filter = status ?? "all";

    if (filter !== "all") {
      tasks = tasks.filter((t) => t.status === filter);
    }
    if (project) {
      tasks = tasks.filter((t) => t.projectName === project);
    }

    const lines = tasks.map((t) => {
      const alive =
        t.claudePid != null
          ? isPidAlive(t.claudePid)
            ? "alive"
            : "dead"
          : "no-pid";
      return `[${t.status}] ${t.taskId}: ${t.title || "(untitled)"} | project=${t.projectName} | branch=${t.branch} | pid=${t.claudePid ?? "?"} (${alive}) | ${t.source} | ${t.createdAt}`;
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
    const tasks = readTasks();
    const task = tasks.find((t) => t.taskId === task_id);

    if (!task) {
      return {
        content: [
          { type: "text" as const, text: `Task "${task_id}" not found.` },
        ],
      };
    }

    const alive =
      task.claudePid != null
        ? isPidAlive(task.claudePid)
          ? "alive"
          : "dead"
        : "no-pid";

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ ...task, processAlive: alive }, null, 2),
        },
      ],
    };
  },
);

server.tool(
  "update_task",
  "Update a task (e.g. mark as completed or abandoned)",
  {
    task_id: z.string().describe("Task ID to update"),
    status: z
      .enum(["active", "completed", "abandoned"])
      .optional()
      .describe("New status"),
    title: z.string().optional().describe("New title"),
  },
  async ({ task_id, status, title }) => {
    const tasks = readTasks();
    const task = tasks.find((t) => t.taskId === task_id);

    if (!task) {
      return {
        content: [
          { type: "text" as const, text: `Task "${task_id}" not found.` },
        ],
      };
    }

    if (status) {
      task.status = status;
      if (status === "completed" || status === "abandoned") {
        task.completedAt = new Date().toISOString();
      }
    }
    if (title) task.title = title;

    writeTasks(tasks);

    return {
      content: [
        {
          type: "text" as const,
          text: `Task "${task_id}" updated. ${JSON.stringify({ status: task.status, title: task.title })}`,
        },
      ],
    };
  },
);

server.tool(
  "list_worktrees",
  "List git worktrees across all known projects",
  {
    project: z
      .string()
      .optional()
      .describe("Filter by project name (optional)"),
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
          text: lines.length > 0 ? lines.join("\n") : "No worktrees found.",
        },
      ],
    };
  },
);

server.tool(
  "list_projects",
  "List all known project directories (registered + discovered)",
  {},
  async () => {
    const projects = discoverProjectDirs();

    const lines = projects.map((p) => {
      const worktreeCount = listWorktreesForRepo(p.path).length;
      const extra = [
        p.registered ? "registered" : "discovered",
        worktreeCount > 1 ? `${worktreeCount} worktrees` : undefined,
      ]
        .filter(Boolean)
        .join(", ");
      return `${p.name}: ${p.path} (${extra})`;
    });

    return {
      content: [
        {
          type: "text" as const,
          text: lines.length > 0 ? lines.join("\n") : "No projects found.",
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
    const tasks = readTasks().filter((t) => t.status === "active");

    const lines = tasks.map((t) => {
      const alive =
        t.claudePid != null
          ? isPidAlive(t.claudePid)
            ? "alive"
            : "dead"
          : "no-pid";
      return `${t.sessionId}: pid=${t.claudePid ?? "?"} (${alive}) | task=${t.taskId} "${t.title || "(untitled)"}" | project=${t.projectName} | ${t.source}`;
    });

    return {
      content: [
        {
          type: "text" as const,
          text: lines.length > 0 ? lines.join("\n") : "No active sessions.",
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
    const tasks = readTasks();
    const task = tasks.find(
      (t) => t.taskId === task_id || t.sessionId === task_id,
    );

    if (!task) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Session "${task_id}" not found.`,
          },
        ],
      };
    }

    if (!task.claudePid) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Session "${task_id}" has no PID recorded.`,
          },
        ],
      };
    }

    if (!isPidAlive(task.claudePid)) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Session "${task_id}" (pid=${task.claudePid}) is already dead.`,
          },
        ],
      };
    }

    try {
      process.kill(task.claudePid, "SIGTERM");

      await new Promise((r) => setTimeout(r, 2000));

      if (isPidAlive(task.claudePid)) {
        process.kill(task.claudePid, "SIGKILL");
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Session "${task_id}" (pid=${task.claudePid}) killed.`,
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
