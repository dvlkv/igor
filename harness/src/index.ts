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

new Orchestrator({
  adapters,
  telegram: telegramAdapter,
  stateStore,
  sessionManager,
  memoryIngestion,
  worktreeDir: config.worktreeDir,
});

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
