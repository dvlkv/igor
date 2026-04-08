import { describe, it, expect, vi } from "vitest";
import { LinearAdapter } from "./linear.js";

const ASSIGNEE_ID = "user-123";

function createAdapter() {
  return new LinearAdapter({
    webhookSecret: "secret",
    assigneeId: ASSIGNEE_ID,
  });
}

describe("LinearAdapter", () => {
  it("has correct name", () => {
    expect(createAdapter().name).toBe("linear");
  });

  it("emits task assignment on matching issue webhook", () => {
    const adapter = createAdapter();
    const handler = vi.fn();
    adapter.onTaskAssigned(handler);

    adapter.handleWebhook({
      type: "Issue",
      data: {
        id: "issue-1",
        title: "Fix the bug",
        description: "It is broken",
        url: "https://linear.app/issue-1",
        assignee: { id: ASSIGNEE_ID },
      },
    });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "issue-1",
        title: "Fix the bug",
        source: "linear",
      }),
    );
  });

  it("ignores issue webhook for different assignee", () => {
    const adapter = createAdapter();
    const handler = vi.fn();
    adapter.onTaskAssigned(handler);

    adapter.handleWebhook({
      type: "Issue",
      data: {
        id: "issue-2",
        title: "Not mine",
        description: "",
        assignee: { id: "someone-else" },
      },
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("emits message for issue comments", () => {
    const adapter = createAdapter();
    const handler = vi.fn();
    adapter.onMessage(handler);

    adapter.handleWebhook({
      type: "Comment",
      data: {
        body: "Looks good!",
        issue: { id: "issue-1" },
        user: { name: "Alice" },
      },
    });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Looks good!",
        threadId: "issue-1",
      }),
    );
  });
});
