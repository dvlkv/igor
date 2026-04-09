import { readFileSync } from "node:fs";
import type { ChannelsConfig } from "./types.js";

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

export function loadConfig(filePath: string): ChannelsConfig {
  const raw = readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw);
  return resolveEnvVars(parsed) as ChannelsConfig;
}
