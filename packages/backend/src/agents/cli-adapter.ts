import { parse } from 'shell-quote';
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
    task: Task & { _prompt?: string };
    workingDir: string;
    onOutput: (line: string) => void;
    signal: AbortSignal;
  }): Promise<AgentResult> {
    const { task, workingDir, onOutput, signal } = params;
    const prompt = (task as any)._prompt || task.title;

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

    const proc = Bun.spawn(finalArgv, {
      cwd: workingDir,
      stdin: useStdin ? 'pipe' : 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env },
    });

    // Store PID for crash recovery
    try {
      const db = getDb();
      db.query(
        `UPDATE tasks SET agent_pid = ?, agent_started_at = ? WHERE id = ?`
      ).run(proc.pid, new Date().toISOString(), task.id);
    } catch {
      // Non-fatal
    }

    // Write prompt to stdin if needed
    if (useStdin && proc.stdin) {
      const writer = proc.stdin.getWriter();
      await writer.write(new TextEncoder().encode(prompt));
      await writer.close();
    }

    // Handle abort signal
    const abortHandler = () => {
      try {
        proc.kill('SIGTERM');
        setTimeout(() => {
          try {
            proc.kill('SIGKILL');
          } catch {
            // Already dead
          }
        }, 5000);
      } catch {
        // Already dead
      }
    };

    signal.addEventListener('abort', abortHandler, { once: true });

    // Read stdout and stderr
    const readStream = async (
      stream: ReadableStream<Uint8Array> | null,
      handler: (line: string) => void
    ) => {
      if (!stream) return;
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const sanitized = sanitizeLine(line);
            if (sanitized) handler(sanitized);
          }
        }

        // Flush remaining buffer
        if (buffer) {
          const sanitized = sanitizeLine(buffer);
          if (sanitized) handler(sanitized);
        }
      } catch {
        // Stream closed
      }
    };

    await Promise.all([
      readStream(proc.stdout, onOutput),
      readStream(proc.stderr, onOutput),
    ]);

    const exitCode = await proc.exited;

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
