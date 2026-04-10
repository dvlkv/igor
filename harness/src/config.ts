import { readFileSync } from "node:fs";
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

export function loadConfig(filePath: string): HarnessConfig {
  const raw = readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw);
  const resolved = resolveEnvVars(parsed) as Record<string, unknown>;

  if (!resolved.storage) {
    throw new Error(
      "Missing required 'storage' block in config. See harness.config.json.",
    );
  }

  return resolved as unknown as HarnessConfig;
}
