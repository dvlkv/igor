import { exec } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SessionManagerOptions } from "./types.js";

function run(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout.trim());
    });
  });
}

export class TmuxSessionManager {
  async createSession(opts: SessionManagerOptions): Promise<void> {
    await run(`tmux new-session -d -s ${opts.name} -c ${opts.worktreePath}`);

    let claudeCmd = `claude --dangerously-skip-permissions`;
    if (opts.mcpConfig) {
      claudeCmd += ` --mcp-config ${opts.mcpConfig}`;
    }
    claudeCmd += ` -p '${opts.prompt.replace(/'/g, "'\\''")}'`;

    await run(`tmux send-keys -t ${opts.name} '${claudeCmd}' Enter`);
  }

  async sendInput(sessionName: string, text: string): Promise<void> {
    await run(`tmux send-keys -t ${sessionName} '${text}' Enter`);
  }

  async *readOutput(sessionName: string): AsyncIterable<string> {
    const pipePath = join(tmpdir(), `tmux-${sessionName}.pipe`);
    await run(`tmux pipe-pane -t ${sessionName} 'cat > ${pipePath}'`);
    yield pipePath;
  }

  async killSession(sessionName: string): Promise<void> {
    await run(`tmux kill-session -t ${sessionName}`);
  }

  async listSessions(): Promise<string[]> {
    try {
      const output = await run(`tmux list-sessions -F '#{session_name}'`);
      if (!output) return [];
      return output.split("\n").filter(Boolean);
    } catch {
      return [];
    }
  }
}
