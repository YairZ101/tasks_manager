import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { CliAdapter } from './cli-adapter.js';
import { initDb, closeDb } from '../db/database.js';
import type { AgentConfig, Task } from '../types.js';

const makeConfig = (overrides: Partial<AgentConfig> = {}): AgentConfig => ({
  id: 1,
  type: 'cli',
  cli_cmd: 'echo test',
  cli_prompt_mode: 'argument',
  cli_prompt_flag: null,
  api_url: null,
  api_headers: null,
  api_model: null,
  api_request_format: 'openai',
  api_stream_format: 'sse',
  timeout_ms: 30000,
  updated_at: '',
  ...overrides,
});

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 1,
  task_key: 'TST-1',
  title: 'Test Task',
  description: '',
  acceptance: '',
  status: 'in-progress',
  agent_status: 'running',
  agent_pid: null,
  agent_started_at: null,
  sort_order: 1,
  created_at: '2024-01-01',
  updated_at: '2024-01-01',
  ...overrides,
});

describe('CliAdapter', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-cli-'));
    fs.mkdirSync(path.join(tmpDir, '.tasks_manager'), { recursive: true });
    initDb(tmpDir);
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('throws when cli_cmd is not configured', async () => {
    const adapter = new CliAdapter(makeConfig({ cli_cmd: null }));
    const controller = new AbortController();

    await expect(
      adapter.execute({
        task: makeTask(),
        prompt: 'test',
        workingDir: tmpDir,
        onOutput: () => {},
        signal: controller.signal,
      })
    ).rejects.toThrow('CLI command not configured');
  });

  test('throws when cli_cmd is empty string', async () => {
    const adapter = new CliAdapter(makeConfig({ cli_cmd: '' }));
    const controller = new AbortController();

    await expect(
      adapter.execute({
        task: makeTask(),
        prompt: 'test',
        workingDir: tmpDir,
        onOutput: () => {},
        signal: controller.signal,
      })
    ).rejects.toThrow('CLI command not configured');
  });

  test('executes command and captures output', async () => {
    const adapter = new CliAdapter(makeConfig({ cli_cmd: 'echo hello-from-cli' }));
    const controller = new AbortController();
    const output: string[] = [];

    const result = await adapter.execute({
      task: makeTask(),
      prompt: 'test prompt',
      workingDir: tmpDir,
      onOutput: (line) => output.push(line),
      signal: controller.signal,
    });

    expect(result.success).toBe(true);
    expect(result.summary).toContain('completed successfully');
    expect(output.some((l) => l.includes('hello-from-cli'))).toBe(true);
  });

  test('reports failure on non-zero exit', async () => {
    const adapter = new CliAdapter(makeConfig({ cli_cmd: 'sh -c "exit 42"' }));
    const controller = new AbortController();

    const result = await adapter.execute({
      task: makeTask(),
      prompt: 'test',
      workingDir: tmpDir,
      onOutput: () => {},
      signal: controller.signal,
    });

    expect(result.success).toBe(false);
    expect(result.summary).toContain('42');
  });

  test('passes prompt as argument when mode=argument', async () => {
    const adapter = new CliAdapter(
      makeConfig({ cli_cmd: 'echo', cli_prompt_mode: 'argument' })
    );
    const controller = new AbortController();
    const output: string[] = [];

    await adapter.execute({
      task: makeTask(),
      prompt: 'MY_PROMPT_TEXT',
      workingDir: tmpDir,
      onOutput: (line) => output.push(line),
      signal: controller.signal,
    });

    expect(output.some((l) => l.includes('MY_PROMPT_TEXT'))).toBe(true);
  });

  test('passes prompt via flag when mode=flag', async () => {
    const adapter = new CliAdapter(
      makeConfig({ cli_cmd: 'echo', cli_prompt_mode: 'flag', cli_prompt_flag: '--prompt' })
    );
    const controller = new AbortController();
    const output: string[] = [];

    await adapter.execute({
      task: makeTask(),
      prompt: 'FLAG_PROMPT',
      workingDir: tmpDir,
      onOutput: (line) => output.push(line),
      signal: controller.signal,
    });

    expect(output.some((l) => l.includes('--prompt'))).toBe(true);
    expect(output.some((l) => l.includes('FLAG_PROMPT'))).toBe(true);
  });

  test('pipes prompt to stdin when mode=stdin', async () => {
    const adapter = new CliAdapter(
      makeConfig({ cli_cmd: 'cat', cli_prompt_mode: 'stdin' })
    );
    const controller = new AbortController();
    const output: string[] = [];

    await adapter.execute({
      task: makeTask(),
      prompt: 'STDIN_INPUT',
      workingDir: tmpDir,
      onOutput: (line) => output.push(line),
      signal: controller.signal,
    });

    expect(output.some((l) => l.includes('STDIN_INPUT'))).toBe(true);
  });

  test('captures stderr output', async () => {
    const adapter = new CliAdapter(
      makeConfig({ cli_cmd: 'sh -c "echo error-msg >&2"' })
    );
    const controller = new AbortController();
    const output: string[] = [];

    await adapter.execute({
      task: makeTask(),
      prompt: 'test',
      workingDir: tmpDir,
      onOutput: (line) => output.push(line),
      signal: controller.signal,
    });

    expect(output.some((l) => l.includes('error-msg'))).toBe(true);
  });

  test('throws immediately when signal is already aborted before execute', async () => {
    const adapter = new CliAdapter(
      makeConfig({ cli_cmd: 'sh -c "sleep 300"', cli_prompt_mode: 'argument' })
    );
    const controller = new AbortController();
    controller.abort();

    await expect(
      adapter.execute({
        task: makeTask(),
        prompt: '',
        workingDir: tmpDir,
        onOutput: () => {},
        signal: controller.signal,
      })
    ).rejects.toThrow('cancelled');
  });

  (process.env.CI ? test.skip : test)('abort signal cancels the process without delay', async () => {
    const adapter = new CliAdapter(
      makeConfig({ cli_cmd: 'sh -c "sleep 300"', cli_prompt_mode: 'argument' })
    );
    const controller = new AbortController();

    const promise = adapter.execute({
      task: makeTask(),
      prompt: '',
      workingDir: tmpDir,
      onOutput: () => {},
      signal: controller.signal,
    });

    await new Promise((r) => setTimeout(r, 500));
    const abortTime = Date.now();
    controller.abort();

    await expect(promise).rejects.toThrow('cancelled');
    const elapsed = Date.now() - abortTime;
    expect(elapsed).toBeLessThan(3000);
  }, 15000);

  test('preserves empty lines in output', async () => {
    const adapter = new CliAdapter(
      makeConfig({ cli_cmd: 'sh -c "printf \'line1\\n\\n\\nline2\\n\'"', cli_prompt_mode: 'stdin' })
    );
    const controller = new AbortController();
    const output: string[] = [];

    await adapter.execute({
      task: makeTask(),
      prompt: '',
      workingDir: tmpDir,
      onOutput: (line) => output.push(line),
      signal: controller.signal,
    });

    expect(output).toEqual(['line1', '', '', 'line2']);
  });

  test('skips leading empty lines', async () => {
    const adapter = new CliAdapter(
      makeConfig({ cli_cmd: `sh -c "printf '\\n\\nfirst\\nsecond\\n'"`, cli_prompt_mode: 'argument' })
    );
    const controller = new AbortController();
    const output: string[] = [];

    await adapter.execute({
      task: makeTask(),
      prompt: '',
      workingDir: tmpDir,
      onOutput: (line) => output.push(line),
      signal: controller.signal,
    });

    expect(output).toEqual(['first', 'second']);
  });

  test('runs in the specified working directory', async () => {
    const adapter = new CliAdapter(makeConfig({ cli_cmd: 'pwd', cli_prompt_mode: 'stdin' }));
    const controller = new AbortController();
    const output: string[] = [];

    await adapter.execute({
      task: makeTask(),
      prompt: '',
      workingDir: tmpDir,
      onOutput: (line) => output.push(line),
      signal: controller.signal,
    });

    const joined = output.join('\n');
    // tmpDir on macOS goes through /var -> /private/var, check either form
    expect(joined.includes(tmpDir) || joined.includes(fs.realpathSync(tmpDir))).toBe(true);
  });
});
