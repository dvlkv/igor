import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { TaskSession } from "./types.js";

interface StateData {
  sessions: TaskSession[];
}

export class StateStore {
  private filePath: string;
  private data: StateData;

  constructor(filePath: string) {
    this.filePath = filePath;
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, "utf-8");
      this.data = JSON.parse(raw);
    } else {
      this.data = { sessions: [] };
    }
  }

  private persist(): void {
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf-8");
  }

  save(session: TaskSession): void {
    const idx = this.data.sessions.findIndex((s) => s.taskId === session.taskId);
    if (idx >= 0) {
      this.data.sessions[idx] = session;
    } else {
      this.data.sessions.push(session);
    }
    this.persist();
  }

  get(taskId: string): TaskSession | undefined {
    return this.data.sessions.find((s) => s.taskId === taskId);
  }

  update(taskId: string, updates: Partial<TaskSession>): void {
    const session = this.data.sessions.find((s) => s.taskId === taskId);
    if (session) {
      Object.assign(session, updates);
      this.persist();
    }
  }

  getAll(): TaskSession[] {
    return this.data.sessions;
  }

  getActive(): TaskSession[] {
    return this.data.sessions.filter((s) => s.status === "active");
  }

  findByTelegramThread(threadId: string): TaskSession | undefined {
    return this.data.sessions.find((s) => s.telegramThreadId === threadId);
  }
}
