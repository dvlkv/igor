import { writeFileSync, mkdirSync } from "node:fs";
import { exec } from "node:child_process";
import { join } from "node:path";
import type { IncomingMessage } from "./types.js";

export interface MemoryIngestionOptions {
  bufferDir: string;
  ingestIntervalMs: number;
}

export class MemoryIngestion {
  private buffers = new Map<string, IncomingMessage[]>();
  private intervalHandle: ReturnType<typeof setInterval> | undefined;
  private readonly bufferDir: string;
  private readonly ingestIntervalMs: number;

  constructor(opts: MemoryIngestionOptions) {
    this.bufferDir = opts.bufferDir;
    this.ingestIntervalMs = opts.ingestIntervalMs;
  }

  buffer(project: string, message: IncomingMessage): void {
    const list = this.buffers.get(project) ?? [];
    list.push(message);
    this.buffers.set(project, list);
  }

  getBufferSize(project: string): number {
    return this.buffers.get(project)?.length ?? 0;
  }

  async flush(): Promise<void> {
    mkdirSync(this.bufferDir, { recursive: true });

    const projects = [...this.buffers.entries()];
    for (const [project, messages] of projects) {
      if (messages.length === 0) continue;

      const filePath = join(this.bufferDir, `${project}.json`);
      writeFileSync(filePath, JSON.stringify(messages, null, 2));

      await new Promise<void>((resolve, reject) => {
        exec(`mempalace mine ${filePath} --mode convos`, (err) => {
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
