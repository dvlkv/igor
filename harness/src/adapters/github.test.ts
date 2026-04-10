import { describe, it, expect, vi } from "vitest";
import { GitHubAdapter } from "./github.js";
import type { TaskAssignment, IncomingMessage } from "../types.js";

describe("GitHubAdapter", () => {
  const config = { webhookSecret: "secret", assigneeLogin: "igor-bot" };

  it('has correct name "github"', () => {
    const adapter = new GitHubAdapter(config);
    expect(adapter.name).toBe("github");
  });

  it("emits task assignment on issue assigned event", () => {
    const adapter = new GitHubAdapter(config);
    const tasks: TaskAssignment[] = [];
    adapter.onTaskAssigned((t) => tasks.push(t));

    adapter.handleWebhook("issues", {
      action: "assigned",
      assignee: { login: "igor-bot" },
      repository: { full_name: "org/repo" },
      issue: {
        number: 42,
        title: "Fix the bug",
        body: "Details here",
        html_url: "https://github.com/org/repo/issues/42",
        labels: [{ name: "bug" }],
      },
    });

    expect(tasks).toHaveLength(1);
    expect(tasks[0].taskId).toBe("org/repo#42");
    expect(tasks[0].title).toBe("Fix the bug");
    expect(tasks[0].repo).toBe("org/repo");
    expect(tasks[0].source).toBe("github");
  });

  it("ignores assignment to other user", () => {
    const adapter = new GitHubAdapter(config);
    const tasks: TaskAssignment[] = [];
    adapter.onTaskAssigned((t) => tasks.push(t));

    adapter.handleWebhook("issues", {
      action: "assigned",
      assignee: { login: "someone-else" },
      repository: { full_name: "org/repo" },
      issue: {
        number: 10,
        title: "Not mine",
        body: "",
        html_url: "https://github.com/org/repo/issues/10",
        labels: [],
      },
    });

    expect(tasks).toHaveLength(0);
  });

  it("emits message for issue comments", () => {
    const adapter = new GitHubAdapter(config);
    const messages: IncomingMessage[] = [];
    adapter.onMessage((m) => messages.push(m));

    adapter.handleWebhook("issue_comment", {
      action: "created",
      repository: { full_name: "org/repo" },
      issue: { number: 42 },
      comment: {
        body: "Looks good to me",
        user: { login: "reviewer" },
      },
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe("Looks good to me");
    expect(messages[0].threadId).toBe("org/repo#42");
  });

  it("emits task completed on PR merged", () => {
    const adapter = new GitHubAdapter({
      webhookSecret: "test-secret",
      assigneeLogin: "igor-bot",
    });

    const completedBranches: string[] = [];
    adapter.onTaskCompleted((branch) => completedBranches.push(branch));

    adapter.handleWebhook("pull_request", {
      action: "closed",
      pull_request: {
        merged: true,
        head: { ref: "igor/LIN-123" },
      },
    });

    expect(completedBranches).toEqual(["igor/LIN-123"]);
  });

  it("ignores closed but not merged PR", () => {
    const adapter = new GitHubAdapter({
      webhookSecret: "test-secret",
      assigneeLogin: "igor-bot",
    });

    const completedBranches: string[] = [];
    adapter.onTaskCompleted((branch) => completedBranches.push(branch));

    adapter.handleWebhook("pull_request", {
      action: "closed",
      pull_request: {
        merged: false,
        head: { ref: "igor/LIN-123" },
      },
    });

    expect(completedBranches).toEqual([]);
  });
});
