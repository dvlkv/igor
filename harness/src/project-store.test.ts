import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Project } from "./types.js";

vi.mock("node:fs");

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { ProjectStore } from "./project-store.js";

const mExistsSync = vi.mocked(existsSync);
const mReadFileSync = vi.mocked(readFileSync);
const mWriteFileSync = vi.mocked(writeFileSync);

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    name: "test-project",
    path: "/home/pi/projects/test-project",
    createdAt: "2026-04-10T00:00:00Z",
    ...overrides,
  };
}

describe("ProjectStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts empty when no file exists", () => {
    mExistsSync.mockReturnValue(false);
    const store = new ProjectStore("/tmp/projects.json");
    expect(store.getAll()).toEqual([]);
  });

  it("loads existing projects from disk", () => {
    const project = makeProject();
    mExistsSync.mockReturnValue(true);
    mReadFileSync.mockReturnValue(
      JSON.stringify({ projects: [project] }),
    );

    const store = new ProjectStore("/tmp/projects.json");
    expect(store.getAll()).toEqual([project]);
  });

  it("registers and retrieves a project", () => {
    mExistsSync.mockReturnValue(false);
    const store = new ProjectStore("/tmp/projects.json");
    const project = makeProject();

    store.register(project);

    expect(store.get("test-project")).toEqual(project);
    expect(mWriteFileSync).toHaveBeenCalled();
  });

  it("updates an existing project by name", () => {
    mExistsSync.mockReturnValue(false);
    const store = new ProjectStore("/tmp/projects.json");
    store.register(makeProject());

    store.register(makeProject({ remoteUrl: "git@github.com:foo/bar.git" }));

    expect(store.getAll()).toHaveLength(1);
    expect(store.get("test-project")?.remoteUrl).toBe(
      "git@github.com:foo/bar.git",
    );
  });

  it("removes a project", () => {
    mExistsSync.mockReturnValue(false);
    const store = new ProjectStore("/tmp/projects.json");
    store.register(makeProject());

    expect(store.remove("test-project")).toBe(true);
    expect(store.getAll()).toHaveLength(0);
    expect(store.remove("nonexistent")).toBe(false);
  });
});
