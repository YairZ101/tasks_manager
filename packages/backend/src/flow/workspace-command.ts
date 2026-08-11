import { spawn } from 'child_process';
import { parseWorkspaceCommand } from './workspace-config.js';

export type WorkspaceCommandResult = { exitCode: number | null; timedOut: boolean; durationMs: number };

export async function runWorkspaceCommand(options: {
  command: string;
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
  onOutput: (level: 'info' | 'error', line: string) => void;
  onPid?: (pid: number) => void;
}): Promise<WorkspaceCommandResult> {
  const argv = parseWorkspaceCommand(options.command);
  const startedAt = Date.now();
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs);
  const child = spawn(argv[0]!, argv.slice(1), { cwd: options.cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  if (child.pid) options.onPid?.(child.pid);
  const terminate = () => {
    if (child.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
    try { child.kill('SIGTERM'); } catch {}
  };
  controller.signal.addEventListener('abort', terminate, { once: true });
  const consume = (stream: NodeJS.ReadableStream | null, level: 'info' | 'error') => {
    let pending = '';
    stream?.on('data', (chunk: Buffer) => {
      pending += chunk.toString('utf8');
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) options.onOutput(level, line);
    });
    stream?.on('end', () => { if (pending) options.onOutput(level, pending); });
  };
  consume(child.stdout, 'info');
  consume(child.stderr, 'error');
  try {
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    return { exitCode, timedOut, durationMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', terminate);
  }
}
