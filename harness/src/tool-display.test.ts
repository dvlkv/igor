import { describe, it, expect } from "vitest";
import { toolDisplayName } from "./tool-display.js";

describe("toolDisplayName", () => {
  it("maps known tool names to descriptions", () => {
    expect(toolDisplayName("Bash")).toBe("Running command");
    expect(toolDisplayName("Read")).toBe("Reading files");
    expect(toolDisplayName("Grep")).toBe("Searching codebase");
    expect(toolDisplayName("Edit")).toBe("Editing files");
    expect(toolDisplayName("Agent")).toBe("Running subagent");
    expect(toolDisplayName("AskUserQuestion")).toBe("Asking a question");
  });

  it("returns 'Working' for unknown tools", () => {
    expect(toolDisplayName("SomeUnknownTool")).toBe("Working");
  });
});
