import { writeFileSync, mkdirSync } from "node:fs";
import { exec } from "node:child_process";
import { join } from "node:path";
import type { IncomingMessage } from "./types.js";
import type { Logger } from "./logger.js";

export interface MemoryIngestionOptions {
  bufferDir: string;
  ingestIntervalMs: number;
  logger?: Logger;
}

export class MemoryIngestion {
  private buffers = new Map<string, IncomingMessage[]>();
  private intervalHandle: ReturnType<typeof setInterval> | undefined;
  private readonly bufferDir: string;
  private readonly ingestIntervalMs: number;
  private readonly logger?: Logger;

  constructor(opts: MemoryIngestionOptions) {
    this.bufferDir = opts.bufferDir;
    this.ingestIntervalMs = opts.ingestIntervalMs;
    this.logger = opts.logger;
  }

  buffer(project: string, message: IncomingMessage): void {
    const list = this.buffers.get(project) ?? [];
    list.push(message);
    this.buffers.set(project, list);

    // Log every ingested message
    this.logger?.logMessage(
      project,
      message.channelType,
      message.author,
      message.text,
      message.metadata,
    );
  }

  getBufferSize(project: string): number {
    return this.buffers.get(project)?.length ?? 0;
  }

  async flush(): Promise<void> {
    mkdirSync(this.bufferDir, { recursive: true });

    const projects = [...this.buffers.entries()];
    for (const [project, messages] of projects) {
      if (messages.length === 0) continue;

      const projectDir = join(this.bufferDir, project);
      mkdirSync(projectDir, { recursive: true });
      const filePath = join(projectDir, `${project}.json`);
      writeFileSync(filePath, JSON.stringify(messages, null, 2));

      // Log the memory ingestion event
      this.logger?.logMemoryIngestion(project, messages.length, filePath);

      await new Promise<void>((resolve, reject) => {
        exec(`mempalace mine ${projectDir} --mode convos`, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      this.buffers.set(project, []);
    }
  }

  start(): void {
    this.intervalHandle = setInterval(() => {
      void this.flush();
    }, this.ingestIntervalMs);
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
  }
}
