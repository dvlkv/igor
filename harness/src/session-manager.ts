import { spawn, type ChildProcess } from "node:child_process";
import type { SessionManagerOptions } from "./types.js";

export class ClaudeSessionManager {
  private processes = new Map<string, ChildProcess>();
  private outputHandler?: (sessionId: string, text: string) => void;

  onOutput(handler: (sessionId: string, text: string) => void): void {
    this.outputHandler = handler;
  }

  async createSession(opts: SessionManagerOptions): Promise<number> {
    if (this.processes.has(opts.name) && this.isAlive(opts.name)) {
      console.log(
        `[session] "${opts.name}" already running (pid=${this.processes.get(opts.name)!.pid})`,
      );
      return this.processes.get(opts.name)!.pid!;
    }

    console.log(
      `[session] creating "${opts.name}" cwd="${opts.worktreePath}" prompt="${opts.prompt.slice(0, 100)}"`,
    );

    const args: string[] = [
      "--output-format",
      "stream-json",
      "--verbose",
      "--input-format",
      "stream-json",
      "--dangerously-skip-permissions",
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

    const sessionName = opts.name;
    this.processes.set(sessionName, child);

    console.log(
      `[session] "${sessionName}" spawned: pid=${child.pid}`,
    );

    child.on("error", (err) => {
      console.log(`[session] "${sessionName}" spawn error: ${err.message}`);
    });

    child.stdout?.on("data", (data: Buffer) => {
      const lines = data.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          if (event.type === "assistant" && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === "text") {
                console.log(
                  `[${sessionName}:stdout] assistant: ${block.text.slice(0, 200)}`,
                );
              } else if (block.type === "tool_use") {
                console.log(
                  `[${sessionName}:stdout] tool_use: ${block.name}(${JSON.stringify(block.input).slice(0, 150)})`,
                );
              }
            }
          } else if (event.type === "result" && event.result) {
            console.log(
              `[${sessionName}:stdout] result: ${String(event.result).slice(0, 200)}`,
            );
            this.outputHandler?.(sessionName, event.result);
          }
        } catch {
          // non-JSON line, ignore
        }
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      const text = data.toString().trimEnd();
      if (text) {
        for (const line of text.split("\n")) {
          console.log(`[${sessionName}:stderr] ${line}`);
        }
      }
    });

    child.on("exit", (code, signal) => {
      console.log(
        `Session "${sessionName}" exited (code=${code}, signal=${signal})`,
      );
      this.processes.delete(sessionName);
    });

    console.log(
      `Session "${sessionName}" started (pid=${child.pid}, cwd=${opts.worktreePath})`,
    );

    // Send the initial prompt via stdin in stream-json format
    this.writeToStdin(sessionName, opts.prompt);

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

  async killAll(): Promise<void> {
    const names = [...this.processes.keys()];
    await Promise.all(names.map((n) => this.killSession(n)));
  }
}
