import { describe, it, expect, vi } from "vitest";

vi.mock("@slack/bolt", () => {
  const app = {
    message: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
  return { App: vi.fn(() => app) };
});

import { SlackAdapter } from "./slack.js";

describe("SlackAdapter", () => {
  const config = {
    botToken: "xoxb-test",
    appToken: "xapp-test",
    channelProjectMap: { C123: "my-project", C456: "other-project" },
  };

  it("has correct name", () => {
    const adapter = new SlackAdapter(config);
    expect(adapter.name).toBe("slack");
  });

  it("maps channel to project name correctly", () => {
    const adapter = new SlackAdapter(config);
    expect(adapter.getProjectForChannel("C123")).toBe("my-project");
    expect(adapter.getProjectForChannel("C456")).toBe("other-project");
    expect(adapter.getProjectForChannel("C999")).toBeUndefined();
  });

  it("does not implement sendMessage", () => {
    const adapter = new SlackAdapter(config);
    expect(adapter.sendMessage).toBeUndefined();
  });

  it("does not implement createThread", () => {
    const adapter = new SlackAdapter(config);
    expect(adapter.createThread).toBeUndefined();
  });
});
