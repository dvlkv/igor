import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { Task } from "./types.js";

interface TaskData {
  tasks: Task[];
}

export class TaskStore {
  private filePath: string;
  private data: TaskData;

  constructor(filePath: string) {
    this.filePath = filePath;
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, "utf-8");
      this.data = JSON.parse(raw);
    } else {
      this.data = { tasks: [] };
    }
  }

  private persist(): void {
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf-8");
  }

  save(task: Task): void {
    const idx = this.data.tasks.findIndex((t) => t.taskId === task.taskId);
    if (idx >= 0) {
      this.data.tasks[idx] = task;
    } else {
      this.data.tasks.push(task);
    }
    this.persist();
  }

  get(taskId: string): Task | undefined {
    return this.data.tasks.find((t) => t.taskId === taskId);
  }

  update(taskId: string, updates: Partial<Task>): void {
    const task = this.data.tasks.find((t) => t.taskId === taskId);
    if (task) {
      Object.assign(task, updates);
      this.persist();
    }
  }

  getAll(): Task[] {
    return this.data.tasks;
  }

  getActive(): Task[] {
    return this.data.tasks.filter((t) => t.status === "active");
  }

  getByProject(projectName: string): Task[] {
    return this.data.tasks.filter((t) => t.projectName === projectName);
  }

  findByTelegramThread(threadId: string): Task | undefined {
    return this.data.tasks.find((t) => t.telegramThreadId === threadId);
  }

  findBySlackThread(channelId: string, threadTs: string): Task | undefined {
    return this.data.tasks.find(
      (t) => t.slackChannelId === channelId && t.slackThreadTs === threadTs,
    );
  }

  findByLinearIssue(issueId: string): Task | undefined {
    return this.data.tasks.find((t) => t.linearIssueId === issueId);
  }

  findByGithubIssue(issueNumber: number): Task | undefined {
    return this.data.tasks.find((t) => t.githubIssueNumber === issueNumber);
  }
}
