import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SessionManagerOptions } from "./types.js";

export interface ClaudeSessionManagerOptions {
  bridgeWsPort: number;
  channelBridgePath: string;
}

export class ClaudeSessionManager {
  private processes = new Map<string, ChildProcess>();
  private configPaths = new Map<string, string>();
  private bridgeWsPort: number;
  private channelBridgePath: string;

  constructor(opts: ClaudeSessionManagerOptions) {
    this.bridgeWsPort = opts.bridgeWsPort;
    this.channelBridgePath = opts.channelBridgePath;
  }

  async createSession(opts: SessionManagerOptions): Promise<number> {
    if (this.processes.has(opts.name) && this.isAlive(opts.name)) {
      console.log(`[session] "${opts.name}" already running (pid=${this.processes.get(opts.name)!.pid})`);
      return this.processes.get(opts.name)!.pid!;
    }

    console.log(`[session] creating "${opts.name}" cwd="${opts.worktreePath}" prompt="${opts.prompt.slice(0, 100)}"`);

    // Write per-session MCP config
    const configDir = join(tmpdir(), "harness-mcp");
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, `${opts.name}.json`);
    const mcpConfig = {
      mcpServers: {
        harness: {
          command: "node",
          args: [this.channelBridgePath],
          env: {
            SESSION_ID: opts.name,
            BRIDGE_WS_URL: `ws://127.0.0.1:${this.bridgeWsPort}`,
          },
        },
      },
    };
    writeFileSync(configPath, JSON.stringify(mcpConfig, null, 2));
    this.configPaths.set(opts.name, configPath);
    console.log(`[session] MCP config written to ${configPath}`);
    console.log(`[session] channelBridgePath=${this.channelBridgePath} bridgeWsPort=${this.bridgeWsPort}`);

    // Use stream-json input/output without --print so Claude stays alive
    // reading from stdin. Initial prompt is sent via stdin after spawn.
    // (Matches the approach from github.com/slopus/happy SDK)
    const args: string[] = [
      "--output-format", "stream-json",
      "--verbose",
      "--input-format", "stream-json",
      "--mcp-config", configPath,
      "--dangerously-skip-permissions",
      "--dangerously-load-development-channels", "server:harness",
    ];

    if (opts.systemPrompt) {
      args.push("--system-prompt", opts.systemPrompt);
    }

    if (opts.claudeArgs) {
      args.push(...opts.claudeArgs);
    }

    console.log(`[session] spawning: claude ${args.join(" ").slice(0, 300)}`);

    const child = spawn("claude", args, {
      cwd: opts.worktreePath,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    this.processes.set(opts.name, child);

    console.log(`[session] "${opts.name}" spawned: pid=${child.pid} stdin=${!!child.stdin} stdout=${!!child.stdout} stderr=${!!child.stderr}`);

    child.on("error", (err) => {
      console.log(`[session] "${opts.name}" spawn error: ${err.message}`);
    });

    child.stdout?.on("data", (data: Buffer) => {
      const lines = data.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        // Log every line raw first for debugging
        console.log(`[${opts.name}:stdout:raw] ${line.slice(0, 500)}`);
        try {
          const event = JSON.parse(line);
          if (event.type === "assistant" && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === "text") {
                console.log(`[${opts.name}:stdout] assistant text: ${block.text.slice(0, 200)}`);
              } else if (block.type === "tool_use") {
                console.log(`[${opts.name}:stdout] tool_use: ${block.name}(${JSON.stringify(block.input).slice(0, 150)})`);
              }
            }
          } else if (event.type === "result") {
            console.log(`[${opts.name}:stdout] result: ${JSON.stringify(event).slice(0, 200)}`);
          } else {
            console.log(`[${opts.name}:stdout] event type="${event.type}"`);
          }
        } catch {
          // Non-JSON, already logged raw above
        }
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      const text = data.toString().trimEnd();
      if (text) {
        for (const line of text.split("\n")) {
          console.log(`[${opts.name}:stderr] ${line}`);
        }
      }
    });

    child.on("exit", (code, signal) => {
      console.log(
        `Session "${opts.name}" exited (code=${code}, signal=${signal})`,
      );
      this.processes.delete(opts.name);
      this.cleanupConfig(opts.name);
    });

    console.log(
      `Session "${opts.name}" started (pid=${child.pid}, cwd=${opts.worktreePath})`,
    );

    // Send the initial prompt via stdin in stream-json format
    this.writeToStdin(opts.name, opts.prompt);

    return child.pid!;
  }

  /** Write a user message to the session's stdin in stream-json format. */
  private writeToStdin(name: string, text: string): boolean {
    const proc = this.processes.get(name);
    if (!proc || proc.exitCode !== null || !proc.stdin?.writable) {
      console.log(`[session] writeToStdin("${name}"): process not writable`);
      return false;
    }
    const msg = JSON.stringify({
      type: "user",
      message: { role: "user", content: text },
    });
    console.log(`[session] writeToStdin("${name}"): ${msg.slice(0, 200)}`);
    proc.stdin.write(msg + "\n");
    return true;
  }

  /** Send a follow-up message to an existing session via stdin. */
  sendMessage(name: string, text: string): boolean {
    return this.writeToStdin(name, text);
  }

  async killSession(name: string): Promise<void> {
    const proc = this.processes.get(name);
    if (proc) {
      proc.kill("SIGTERM");
      // Give it a moment to shut down gracefully
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (proc.exitCode === null) {
            proc.kill("SIGKILL");
          }
          resolve();
        }, 5000);
        proc.on("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
      this.processes.delete(name);
      this.cleanupConfig(name);
    }
  }

  isAlive(name: string): boolean {
    const proc = this.processes.get(name);
    return proc !== undefined && proc.exitCode === null;
  }

  listSessions(): string[] {
    return [...this.processes.keys()].filter((n) => this.isAlive(n));
  }

  getPid(name: string): number | undefined {
    return this.processes.get(name)?.pid ?? undefined;
  }

  private cleanupConfig(name: string): void {
    const configPath = this.configPaths.get(name);
    if (configPath) {
      try {
        unlinkSync(configPath);
      } catch {
        // ignore
      }
      this.configPaths.delete(name);
    }
  }

  async killAll(): Promise<void> {
    const names = [...this.processes.keys()];
    await Promise.all(names.map((n) => this.killSession(n)));
  }
}
