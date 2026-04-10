import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs");

import {
  mkdirSync,
  existsSync,
  symlinkSync,
  lstatSync,
  readlinkSync,
} from "node:fs";
import { initStorage, defaultStorageConfig } from "./storage.js";
import type { StorageConfig } from "./types.js";

const mMkdirSync = vi.mocked(mkdirSync);
const mExistsSync = vi.mocked(existsSync);
const mSymlinkSync = vi.mocked(symlinkSync);
const mLstatSync = vi.mocked(lstatSync);
const mReadlinkSync = vi.mocked(readlinkSync);

function makeConfig(overrides: Partial<StorageConfig> = {}): StorageConfig {
  return {
    projectsDir: "/home/pi/projects",
    igorDir: "/home/pi/igor",
    worktreeDir: "/home/pi/igor/worktrees",
    logsDir: "/home/pi/igor/data/logs",
    projectsFile: "/home/pi/igor/data/projects.json",
    tasksFile: "/home/pi/igor/data/tasks.json",
    ...overrides,
  };
}

describe("initStorage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates all required directories", () => {
    mExistsSync.mockReturnValue(false);
    const config = makeConfig();

    initStorage(config);

    expect(mMkdirSync).toHaveBeenCalledWith("/home/pi/projects", {
      recursive: true,
    });
    expect(mMkdirSync).toHaveBeenCalledWith("/home/pi/igor/worktrees", {
      recursive: true,
    });
    expect(mMkdirSync).toHaveBeenCalledWith("/home/pi/igor/data/logs", {
      recursive: true,
    });
    expect(mMkdirSync).toHaveBeenCalledWith(
      "/home/pi/igor/data/logs/messages",
      { recursive: true },
    );
    expect(mMkdirSync).toHaveBeenCalledWith("/home/pi/igor/data/logs/memory", {
      recursive: true,
    });
    expect(mMkdirSync).toHaveBeenCalledWith("/home/pi/igor/data/logs/tasks", {
      recursive: true,
    });
  });

  it("creates symlink when it does not exist", () => {
    mExistsSync.mockReturnValue(false);
    const config = makeConfig();

    initStorage(config);

    expect(mSymlinkSync).toHaveBeenCalledWith(
      "/home/pi/igor",
      "/home/pi/projects/igor",
    );
  });

  it("does not recreate symlink when it already exists and points correctly", () => {
    mExistsSync.mockReturnValue(true);
    mLstatSync.mockReturnValue({
      isSymbolicLink: () => true,
    } as ReturnType<typeof lstatSync>);
    mReadlinkSync.mockReturnValue("/home/pi/igor");

    const config = makeConfig();
    initStorage(config);

    expect(mSymlinkSync).not.toHaveBeenCalled();
  });
});

describe("defaultStorageConfig", () => {
  it("generates config based on igor directory", () => {
    const original = process.env.HOME;
    process.env.HOME = "/home/testuser";

    const config = defaultStorageConfig("/home/testuser/igor");

    expect(config.projectsDir).toBe("/home/testuser/projects");
    expect(config.igorDir).toBe("/home/testuser/igor");
    expect(config.worktreeDir).toBe("/home/testuser/igor/worktrees");
    expect(config.logsDir).toBe("/home/testuser/igor/data/logs");

    process.env.HOME = original;
  });
});
