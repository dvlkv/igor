import { readFileSync } from "node:fs";
import { defaultStorageConfig } from "./storage.js";
import type { HarnessConfig } from "./types.js";

function resolveEnvVars(obj: unknown): unknown {
  if (typeof obj === "string" && obj.startsWith("$")) {
    const varName = obj.slice(1);
    return process.env[varName] ?? "";
  }
  if (Array.isArray(obj)) {
    return obj.map(resolveEnvVars);
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      result[key] = resolveEnvVars(val);
    }
    return result;
  }
  return obj;
}

/**
 * Load config and migrate legacy fields into the new storage-based layout.
 *
 * Legacy fields (all optional, used as fallback when `storage` is absent):
 *   - general.projectDir  → storage.igorDir
 *   - memory.bufferDir    → storage.memoryBufferDir
 *   - stateFile           → (ignored, replaced by storage.tasksFile)
 *   - worktreeDir         → storage.worktreeDir
 */
export function loadConfig(filePath: string): HarnessConfig {
  const raw = readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw);
  const resolved = resolveEnvVars(parsed) as Record<string, unknown>;

  // Derive storage config: use explicit `storage` block, fall back to legacy fields
  if (!resolved.storage) {
    const legacy = resolved as Record<string, any>;
    const igorDir = legacy.general?.projectDir ?? process.cwd();
    const defaults = defaultStorageConfig(igorDir);

    // Override defaults with any legacy values that were set
    resolved.storage = {
      ...defaults,
      ...(legacy.worktreeDir ? { worktreeDir: legacy.worktreeDir } : {}),
      ...(legacy.memory?.bufferDir
        ? { memoryBufferDir: legacy.memory.bufferDir }
        : {}),
    };
  }

  // Strip legacy fields so the rest of the code doesn't use them
  delete resolved.stateFile;
  delete (resolved as any).worktreeDir;
  if ((resolved as any).general?.projectDir) {
    delete (resolved as any).general.projectDir;
  }
  if ((resolved as any).memory?.bufferDir) {
    delete (resolved as any).memory.bufferDir;
  }

  return resolved as unknown as HarnessConfig;
}
