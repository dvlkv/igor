import {
  mkdirSync,
  existsSync,
  symlinkSync,
  lstatSync,
  readlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { StorageConfig } from "./types.js";

/**
 * Default storage layout — data lives in ~/.igor, NOT inside the repo.
 *
 * Directory structure:
 *   ~/projects/              — cloned project repos (main branch)
 *     igor -> ~/igor         — symlink to igor's own repo
 *   ~/.igor/
 *     projects.json          — project registry
 *     tasks.json             — task registry
 *     worktrees/             — git worktrees for active tasks
 *     logs/
 *       messages/            — raw JSONL message logs
 *       memory/              — memory ingestion logs
 *       tasks/               — task lifecycle logs
 */

export function defaultStorageConfig(igorDir: string): StorageConfig {
  const home = homedir();
  const dotIgor = join(home, ".igor");
  return {
    projectsDir: join(home, "projects"),
    igorDir: resolve(igorDir),
    worktreeDir: join(dotIgor, "worktrees"),
    logsDir: join(dotIgor, "logs"),
    projectsFile: join(dotIgor, "projects.json"),
    tasksFile: join(dotIgor, "tasks.json"),
  };
}

/**
 * Ensure all storage directories exist and igor is symlinked into projectsDir.
 */
export function initStorage(config: StorageConfig): void {
  // Create all required directories
  const dirs = [
    config.projectsDir,
    config.worktreeDir,
    config.logsDir,
    join(config.logsDir, "messages"),
    join(config.logsDir, "memory"),
    join(config.logsDir, "tasks"),
  ];

  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true });
  }

  // Symlink igor into projects directory
  const symlinkPath = join(config.projectsDir, "igor");
  const targetPath = resolve(config.igorDir);

  if (existsSync(symlinkPath)) {
    // Verify it points to the right place
    const stat = lstatSync(symlinkPath);
    if (stat.isSymbolicLink()) {
      const current = readlinkSync(symlinkPath);
      if (resolve(current) !== targetPath) {
        console.warn(
          `[storage] symlink ${symlinkPath} points to ${current}, expected ${targetPath}`,
        );
      }
    }
  } else {
    symlinkSync(targetPath, symlinkPath);
    console.log(`[storage] created symlink ${symlinkPath} -> ${targetPath}`);
  }
}
