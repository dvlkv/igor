import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { LogEntry } from "./types.js";

/**
 * Append-only JSONL logger that writes to date-partitioned files.
 *
 * Layout:
 *   logsDir/
 *     messages/2026-04-10.jsonl   — raw channel messages
 *     memory/2026-04-10.jsonl     — memory ingestion events
 *     tasks/2026-04-10.jsonl      — task lifecycle events
 */
export class Logger {
  private logsDir: string;

  constructor(logsDir: string) {
    this.logsDir = logsDir;
  }

  private dateStamp(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private categoryDir(category: string): string {
    // Map categories to subdirectories
    switch (category) {
      case "message":
        return "messages";
      case "memory":
        return "memory";
      case "task":
        return "tasks";
      case "project":
        return "tasks"; // project events go to tasks log
      default:
        return "system";
    }
  }

  log(entry: LogEntry): void {
    const subDir = join(this.logsDir, this.categoryDir(entry.category));
    mkdirSync(subDir, { recursive: true });

    const filePath = join(subDir, `${this.dateStamp()}.jsonl`);
    const line = JSON.stringify(entry) + "\n";
    appendFileSync(filePath, line, "utf-8");
  }

  /** Convenience: log an incoming message */
  logMessage(
    project: string,
    channel: string,
    author: string,
    text: string,
    metadata?: Record<string, unknown>,
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      level: "info",
      category: "message",
      project,
      data: { channel, author, text, ...metadata },
    });
  }

  /** Convenience: log a memory ingestion event */
  logMemoryIngestion(
    project: string,
    messageCount: number,
    bufferFile: string,
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      level: "info",
      category: "memory",
      project,
      data: { messageCount, bufferFile },
    });
  }

  /** Convenience: log a task lifecycle event */
  logTaskEvent(
    taskId: string,
    project: string,
    event: string,
    details?: Record<string, unknown>,
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      level: "info",
      category: "task",
      project,
      taskId,
      data: { event, ...details },
    });
  }

  /** Convenience: log a project lifecycle event */
  logProjectEvent(
    project: string,
    event: string,
    details?: Record<string, unknown>,
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      level: "info",
      category: "project",
      project,
      data: { event, ...details },
    });
  }
}
