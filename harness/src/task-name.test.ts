import { describe, it, expect, vi } from "vitest";
import { slugify } from "./task-name.js";

describe("slugify", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(slugify("Fix Login Timeout")).toBe("fix-login-timeout");
  });

  it("strips non-alphanumeric characters", () => {
    expect(slugify("Add dark mode (v2)!")).toBe("add-dark-mode-v2");
  });

  it("collapses consecutive hyphens", () => {
    expect(slugify("fix -- the   bug")).toBe("fix-the-bug");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("  -fix bug-  ")).toBe("fix-bug");
  });

  it("returns fallback for empty input", () => {
    expect(slugify("")).toBe("task");
  });

  it("returns fallback for whitespace-only input", () => {
    expect(slugify("   ")).toBe("task");
  });

  it("truncates long slugs", () => {
    const long = "a very long task name that goes on and on and on and should be truncated at some point";
    const result = slugify(long);
    expect(result.length).toBeLessThanOrEqual(50);
    expect(result.endsWith("-")).toBe(false);
  });
});
