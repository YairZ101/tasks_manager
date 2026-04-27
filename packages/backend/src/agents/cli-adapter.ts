import { parse } from 'shell-quote';
import { spawn as nodeSpawn } from 'child_process';
import type { AgentAdapter, AgentConfig, AgentResult, Task } from '../types.js';
import { getDb } from '../db/database.js';

const ANSI_REGEX = /\x1b\[[0-9;]*m/g;
const MAX_LINE_LENGTH = 10240; // 10KB

function sanitizeLine(line: string): string {
  // Strip ANSI escape sequences
  let clean = line.replace(ANSI_REGEX, '');

  // Replace non-UTF-8 sequences (already handled by TextDecoder, but check for binary)
  if (/[\x00-\x08\x0e-\x1f]/.test(clean)) {
    const size = Buffer.byteLength(clean, 'utf-8');
    clean = `[binary data, ${size} bytes]`;
  }

  // Truncate long lines
  if (clean.length > MAX_LINE_LENGTH) {
    clean = clean.substring(0, MAX_LINE_LENGTH) + '... [truncated]';
  }

  return clean;
}

export class CliAdapter implements AgentAdapter {
  private config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
  }

  async execute(params: {
    task: Task;
    prompt: string;
    workingDir: string;
    onOutput: (line: string) => void;
    signal: AbortSignal;
  }): Promise<AgentResult> {
    const { task, prompt, workingDir, onOutput, signal } = params;

    if (!this.config.cli_cmd) {
      throw new Error('CLI command not configured');
    }

    // Parse command using shell-quote
    const argv = parse(this.config.cli_cmd).filter(
      (arg): arg is string => typeof arg === 'string'
    );

    if (argv.length === 0) {
      throw new Error('CLI command is empty');
    }

    // Build final argv based on prompt mode
    const finalArgv = [...argv];

    if (this.config.cli_prompt_mode === 'argument') {
      finalArgv.push(prompt);
    } else if (this.config.cli_prompt_mode === 'flag' && this.config.cli_prompt_flag) {
      const flagParts = this.config.cli_prompt_flag.split(/\s+/).filter(Boolean);
      finalArgv.push(...flagParts, prompt);
    }

    const useStdin = this.config.cli_prompt_mode === 'stdin';

    const proc = nodeSpawn(finalArgv[0], finalArgv.slice(1), {
      cwd: workingDir,
      stdio: [useStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      env: { ...process.env },
      detached: true,
    });

    const pid = proc.pid!;

    // Store PID for crash recovery
    try {
      const db = getDb();
      db.query(
        `UPDATE tasks SET agent_pid = ?, agent_started_at = ? WHERE id = ?`
      ).run(pid, new Date().toISOString(), task.id);
    } catch {
      // Non-fatal
    }

    // Write prompt to stdin if needed
    if (useStdin && proc.stdin) {
      proc.stdin.write(prompt);
      proc.stdin.end();
    }

    // Handle abort signal — kill entire process group
    const abortHandler = () => {
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        try {
          proc.kill('SIGTERM');
        } catch {
          // Already dead
        }
      }
      setTimeout(() => {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          try {
            proc.kill('SIGKILL');
          } catch {
            // Already dead
          }
        }
      }, 5000);
    };

    signal.addEventListener('abort', abortHandler, { once: true });

    // Read stdout and stderr
    const readStream = async (
      stream: NodeJS.ReadableStream | null,
      handler: (line: string) => void
    ) => {
      if (!stream) return;

      return new Promise<void>((resolve) => {
        let buffer = '';

        stream.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf-8');
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const sanitized = sanitizeLine(line);
            if (sanitized) handler(sanitized);
          }
        });

        stream.on('end', () => {
          if (buffer) {
            const sanitized = sanitizeLine(buffer);
            if (sanitized) handler(sanitized);
          }
          resolve();
        });

        stream.on('error', () => resolve());
      });
    };

    await Promise.all([
      readStream(proc.stdout, onOutput),
      readStream(proc.stderr, onOutput),
    ]);

    const exitCode = await new Promise<number | null>((resolve) => {
      proc.on('exit', (code) => resolve(code));
    });

    signal.removeEventListener('abort', abortHandler);

    if (signal.aborted) {
      throw new Error('Agent was cancelled');
    }

    return {
      success: exitCode === 0,
      summary: exitCode === 0 ? 'completed successfully' : `process exited with code ${exitCode}`,
    };
  }
}
