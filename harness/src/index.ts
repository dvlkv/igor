import express from "express";
import { loadConfig } from "./config.js";
import { TaskStore } from "./task-store.js";
import { ProjectStore } from "./project-store.js";
import { Logger } from "./logger.js";
import { initStorage } from "./storage.js";
import { ClaudeSessionManager } from "./session-manager.js";
import { MemoryIngestion } from "./memory-ingestion.js";
import { TelegramAdapter } from "./adapters/telegram.js";
import { SlackAdapter } from "./adapters/slack.js";
import { LinearAdapter } from "./adapters/linear.js";
import { GitHubAdapter } from "./adapters/github.js";
import { Orchestrator } from "./orchestrator.js";
import type { ChannelAdapter } from "./types.js";

const configPath = process.argv[2] ?? "harness.config.json";
const config = loadConfig(configPath);

// Initialize storage layout (directories + symlinks)
const storage = config.storage;
initStorage(storage);

const logger = new Logger(storage.logsDir);
const taskStore = new TaskStore(storage.tasksFile);
const projectStore = new ProjectStore(storage.projectsFile);
const sessionManager = new ClaudeSessionManager();
const memoryIngestion = new MemoryIngestion({
  bufferDir: storage.memoryBufferDir,
  ingestIntervalMs: config.memory.ingestIntervalMs,
  logger,
});

// Register igor itself as a project
if (!projectStore.get("igor")) {
  projectStore.register({
    name: "igor",
    path: storage.igorDir,
    remoteUrl: "git@github.com:dvlkv/igor.git",
    createdAt: new Date().toISOString(),
  });
  logger.logProjectEvent("igor", "registered", { path: storage.igorDir });
}

const adapters: ChannelAdapter[] = [];

let telegramAdapter: TelegramAdapter | undefined;
if (config.telegram.botToken) {
  telegramAdapter = new TelegramAdapter({
    botToken: config.telegram.botToken,
    ownerChatId: config.telegram.ownerChatId,
  });
  adapters.push(telegramAdapter);
} else {
  console.log("Telegram: skipped (no botToken configured)");
}

if (config.slack.botToken && config.slack.appToken) {
  adapters.push(
    new SlackAdapter({
      botToken: config.slack.botToken,
      appToken: config.slack.appToken,
      channelProjectMap: config.slack.channelProjectMap,
    }),
  );
} else {
  console.log("Slack: skipped (no env configured)");
}

if (config.linear.webhookSecret) {
  adapters.push(
    new LinearAdapter({
      webhookSecret: config.linear.webhookSecret,
      assigneeId: config.linear.assigneeId,
    }),
  );
} else {
  console.log("Linear: skipped (no env configured)");
}

if (config.github.webhookSecret) {
  adapters.push(
    new GitHubAdapter({
      webhookSecret: config.github.webhookSecret,
      assigneeLogin: config.github.assigneeLogin,
    }),
  );
} else {
  console.log("GitHub: skipped (no env configured)");
}

const orchestrator = new Orchestrator({
  adapters,
  telegram: telegramAdapter,
  taskStore,
  sessionManager,
  memoryIngestion,
  worktreeDir: storage.worktreeDir,
  generalProjectDir: storage.igorDir,
  generalClaudeArgs: config.general.claudeArgs,
  generalSystemPrompt: config.general.systemPrompt,
  taskClaudeArgs: config.task?.claudeArgs ?? [],
  taskSystemPrompt: config.task?.systemPrompt,
});

if (telegramAdapter) {
  telegramAdapter.onClear(() => {
    void orchestrator.clearGeneralSession();
  });
}

const app = express();
app.use(express.json());

const linearAdapter = adapters.find((a) => a.name === "linear") as
  | LinearAdapter
  | undefined;
const githubAdapter = adapters.find((a) => a.name === "github") as
  | GitHubAdapter
  | undefined;

app.post("/webhooks/linear", (req, res) => {
  if (linearAdapter) {
    linearAdapter.handleWebhook(req.body);
  }
  res.sendStatus(200);
});

app.post("/webhooks/github", (req, res) => {
  const event = req.headers["x-github-event"] as string;
  if (githubAdapter) {
    githubAdapter.handleWebhook(event, req.body);
  }
  res.sendStatus(200);
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    sessions: sessionManager.listSessions(),
    activeTasks: taskStore.getActive().length,
  });
});

async function main() {
  if (linearAdapter || githubAdapter) {
    app.listen(config.webhookPort, () => {
      console.log(`Webhook server listening on port ${config.webhookPort}`);
    });
  }

  await Promise.all(adapters.map((a) => a.start()));
  memoryIngestion.start();
  await orchestrator.startGeneralSession();

  console.log("Igor harness started (JSON I/O mode)");

  async function shutdown() {
    console.log("Shutting down...");
    memoryIngestion.stop();
    await Promise.all(adapters.map((a) => a.stop()));
    await sessionManager.killAll();
    process.exit(0);
  }

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
