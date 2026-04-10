import type {
  ChannelAdapter,
  IncomingMessage,
  TaskAssignment,
} from "../types.js";

export interface GitHubConfig {
  webhookSecret: string;
  assigneeLogin: string;
}

export class GitHubAdapter implements ChannelAdapter {
  readonly name = "github";
  readonly sendMessage = undefined;
  readonly createThread = undefined;

  private config: GitHubConfig;
  private messageHandlers: Array<(msg: IncomingMessage) => void> = [];
  private taskHandlers: Array<(task: TaskAssignment) => void> = [];
  private taskCompletedHandlers: Array<(branch: string) => void> = [];

  constructor(config: GitHubConfig) {
    this.config = config;
  }

  onMessage(handler: (msg: IncomingMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  onTaskAssigned(handler: (task: TaskAssignment) => void): void {
    this.taskHandlers.push(handler);
  }

  onTaskCompleted(handler: (branch: string) => void): void {
    this.taskCompletedHandlers.push(handler);
  }

  handleWebhook(event: string, payload: any): void {
    if (
      event === "issues" &&
      payload.action === "assigned" &&
      payload.assignee?.login === this.config.assigneeLogin
    ) {
      const repo = payload.repository.full_name;
      const issue = payload.issue;
      const task: TaskAssignment = {
        source: "github",
        taskId: `${repo}#${issue.number}`,
        title: issue.title,
        description: issue.body ?? "",
        url: issue.html_url,
        repo,
        labels: issue.labels?.map((l: any) => l.name) ?? [],
      };
      for (const handler of this.taskHandlers) {
        handler(task);
      }
    }

    if (event === "issue_comment" && payload.action === "created") {
      const repo = payload.repository.full_name;
      const issue = payload.issue;
      const comment = payload.comment;
      const msg: IncomingMessage = {
        channelType: "github",
        threadId: `${repo}#${issue.number}`,
        text: comment.body,
        author: comment.user.login,
        metadata: {},
      };
      for (const handler of this.messageHandlers) {
        handler(msg);
      }
    }

    if (
      event === "pull_request" &&
      payload.action === "closed" &&
      payload.pull_request?.merged === true
    ) {
      const branch = payload.pull_request.head.ref;
      for (const handler of this.taskCompletedHandlers) {
        handler(branch);
      }
    }
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}
