import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { initDb, getDb, closeDb } from '../db/database.js';
import { buildPrompt, getRunnerState, startAgent, cancelAgent, shutdownAllAgents, awaitAllCompletions, initGitDetection } from './executor.js';
import type { Task } from '../types.js';

function gitSync(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

function initGitTmpDir(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-exec-git-'));
  gitSync(['init', '--initial-branch', 'main'], tmpDir);
  gitSync(['config', 'user.email', 'test@test.com'], tmpDir);
  gitSync(['config', 'user.name', 'Test'], tmpDir);
  fs.writeFileSync(path.join(tmpDir, 'README.md'), '# test\n');
  gitSync(['add', '.'], tmpDir);
  gitSync(['commit', '-m', 'initial commit'], tmpDir);
  fs.mkdirSync(path.join(tmpDir, '.tasks_manager'), { recursive: true });
  return tmpDir;
}

async function waitForRunnerIdle(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (getRunnerState().activeCount > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function ensureAllReleased() {
  await awaitAllCompletions();
  await waitForRunnerIdle();
  // If still active, cancel each
  const state = getRunnerState();
  for (const run of state.runs) {
    try { await cancelAgent(run.taskId); } catch { /* ignore */ }
  }
  await waitForRunnerIdle(3000);
}

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 1,
  task_key: 'TST-1',
  title: 'Test Task',
  description: '',
  acceptance: '',
  status: 'todo',
  agent_status: null,
  agent_pid: null,
  agent_started_at: null,
  agent_worktree: null,
  agent_branch: null,
  sort_order: 1,
  created_at: '2024-01-01',
  updated_at: '2024-01-01',
  ...overrides,
});

describe('buildPrompt', () => {
  test('includes repo path and task key', () => {
    const task = makeTask({ task_key: 'PROJ-5', title: 'Add login' });
    const prompt = buildPrompt(task, { workingDir: '/home/user/repo' });

    expect(prompt).toContain('/home/user/repo');
    expect(prompt).toContain('PROJ-5');
    expect(prompt).toContain('Add login');
  });

  test('includes description when present', () => {
    const task = makeTask({ description: 'Implement OAuth2 flow' });
    const prompt = buildPrompt(task, { workingDir: '/repo' });

    expect(prompt).toContain('### Description');
    expect(prompt).toContain('Implement OAuth2 flow');
  });

  test('omits description section when empty', () => {
    const task = makeTask({ description: '' });
    const prompt = buildPrompt(task, { workingDir: '/repo' });

    expect(prompt).not.toContain('### Description');
  });

  test('includes acceptance criteria when present', () => {
    const task = makeTask({ acceptance: '- Users can log in\n- Tokens refresh' });
    const prompt = buildPrompt(task, { workingDir: '/repo' });

    expect(prompt).toContain('### Acceptance Criteria');
    expect(prompt).toContain('Users can log in');
  });

  test('omits acceptance section when empty', () => {
    const task = makeTask({ acceptance: '' });
    const prompt = buildPrompt(task, { workingDir: '/repo' });

    expect(prompt).not.toContain('### Acceptance Criteria');
  });

  test('includes implementation instruction', () => {
    const task = makeTask();
    const prompt = buildPrompt(task, { workingDir: '/repo' });

    expect(prompt).toContain('Please implement the changes');
  });

  test('full prompt with all fields', () => {
    const task = makeTask({
      task_key: 'FIX-42',
      title: 'Fix crash on startup',
      description: 'App crashes when config is missing',
      acceptance: '- No crash without config\n- Log a warning',
    });

    const prompt = buildPrompt(task, { workingDir: '/workspace/app' });

    expect(prompt).toContain('/workspace/app');
    expect(prompt).toContain('FIX-42');
    expect(prompt).toContain('Fix crash on startup');
    expect(prompt).toContain('App crashes when config is missing');
    expect(prompt).toContain('No crash without config');
    expect(prompt).toContain('Log a warning');
  });

  test('includes branch context when branchName is provided', () => {
    const task = makeTask({ task_key: 'PROJ-5', title: 'Add login' });
    const prompt = buildPrompt(task, {
      workingDir: '/worktree/path',
      branchName: 'agent/PROJ-5',
      mainBranch: 'main',
      recentCommits: 'abc123 some commit',
    });

    expect(prompt).toContain('git worktree at: /worktree/path');
    expect(prompt).toContain('branch: agent/PROJ-5');
    expect(prompt).toContain('main branch is: main');
    expect(prompt).toContain('abc123 some commit');
    expect(prompt).toContain('## Git Guidelines');
  });

  test('omits worktree header when branchName is absent', () => {
    const task = makeTask();
    const prompt = buildPrompt(task, { workingDir: '/repo' });

    expect(prompt).not.toContain('worktree');
    expect(prompt).toContain('repository at: /repo');
  });

  test('includes git guidelines even without branch context', () => {
    const task = makeTask();
    const prompt = buildPrompt(task, { workingDir: '/repo' });

    expect(prompt).toContain('## Git Guidelines');
    expect(prompt).toContain('commit your changes');
  });

  test('omits recent commits block when recentCommits is empty', () => {
    const task = makeTask();
    const prompt = buildPrompt(task, { workingDir: '/repo', branchName: 'agent/TST-1', mainBranch: 'main', recentCommits: '' });

    expect(prompt).not.toContain('Recent commits for reference');
  });
});

describe('getRunnerState', () => {
  test('reports activeCount, maxConcurrent, runs', () => {
    const state = getRunnerState();
    expect(state).toHaveProperty('activeCount');
    expect(state).toHaveProperty('maxConcurrent');
    expect(state).toHaveProperty('runs');
  });
});

describe('startAgent (integration)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-exec-'));
    fs.mkdirSync(path.join(tmpDir, '.tasks_manager'), { recursive: true });
    initDb(tmpDir);
    // Force single-agent mode (non-git temp dirs)
    initGitDetection(tmpDir);
    const db = getDb();
    db.query("INSERT INTO project_config (id, task_prefix, repo_name) VALUES (1, 'TST', 'test-repo')").run();
  });

  afterEach(async () => {
    await ensureAllReleased();
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('throws 404 for non-existent task', async () => {
    try {
      await startAgent(999, tmpDir);
      expect.unreachable('should have thrown');
    } catch (err: any) {
      expect(err.status).toBe(404);
      expect(err.message).toContain('Task not found');
    }
  });

  test('updates task status to in-progress and completes', async () => {
    const db = getDb();
    db.query("UPDATE agent_config SET cli_cmd = 'echo hello', cli_prompt_mode = 'argument' WHERE id = 1").run();
    db.query("INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-1', 'Test', 'todo', 1)").run();
    const task = db.query("SELECT id FROM tasks WHERE task_key = 'TST-1'").get() as any;

    const result = await startAgent(task.id, tmpDir);
    expect(result.status).toBe('in-progress');
    expect(result.agent_status).toBe('running');

    await waitForRunnerIdle();

    const finalTask = db.query("SELECT * FROM tasks WHERE id = ?").get(task.id) as any;
    expect(finalTask.status).toBe('done');
    expect(finalTask.agent_status).toBe('completed');
  });

  test('agent failure marks task as failed', async () => {
    const db = getDb();
    db.query("UPDATE agent_config SET cli_cmd = 'sh -c \"exit 1\"', cli_prompt_mode = 'argument' WHERE id = 1").run();
    db.query("INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-1', 'Test', 'todo', 1)").run();
    const task = db.query("SELECT id FROM tasks WHERE task_key = 'TST-1'").get() as any;

    await startAgent(task.id, tmpDir);
    await waitForRunnerIdle();

    const finalTask = db.query("SELECT * FROM tasks WHERE id = ?").get(task.id) as any;
    expect(finalTask.agent_status).toBe('failed');
  });

  (process.env.CI ? test.skip : test)('concurrency limit blocks new agents in single-agent mode', async () => {
    const db = getDb();
    db.query("UPDATE agent_config SET cli_cmd = 'sh -c \"sleep 2\"', cli_prompt_mode = 'argument' WHERE id = 1").run();
    db.query("INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-1', 'First', 'todo', 1)").run();
    db.query("INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-2', 'Second', 'todo', 2)").run();
    const t1 = db.query("SELECT id FROM tasks WHERE task_key = 'TST-1'").get() as any;
    const t2 = db.query("SELECT id FROM tasks WHERE task_key = 'TST-2'").get() as any;

    await startAgent(t1.id, tmpDir);

    try {
      await startAgent(t2.id, tmpDir);
      expect.unreachable('should have thrown');
    } catch (err: any) {
      expect(err.status).toBe(409);
      expect(err.reason).toBe('concurrency_limit');
    }
  });

  test('creates task logs on agent run', async () => {
    const db = getDb();
    db.query("UPDATE agent_config SET cli_cmd = 'echo test-output-line', cli_prompt_mode = 'argument' WHERE id = 1").run();
    db.query("INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-1', 'Test', 'todo', 1)").run();
    const task = db.query("SELECT id FROM tasks WHERE task_key = 'TST-1'").get() as any;

    await startAgent(task.id, tmpDir);
    await waitForRunnerIdle();

    const logs = db.query("SELECT * FROM task_logs WHERE task_id = ?").all(task.id) as any[];
    expect(logs.length).toBeGreaterThan(0);
    const agentLogs = logs.filter((l: any) => l.level === 'agent');
    expect(agentLogs.some((l: any) => l.message.includes('test-output-line'))).toBe(true);
  });

  test('log buffer is flushed and all lines persisted after run', async () => {
    const db = getDb();
    db.query("UPDATE agent_config SET cli_cmd = 'printf \"line1\\nline2\\nline3\\n\"', cli_prompt_mode = 'argument' WHERE id = 1").run();
    db.query("INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-1', 'Test', 'todo', 1)").run();
    const task = db.query("SELECT id FROM tasks WHERE task_key = 'TST-1'").get() as any;

    await startAgent(task.id, tmpDir);
    await waitForRunnerIdle();

    const logs = db.query("SELECT * FROM task_logs WHERE task_id = ? AND level = 'agent'").all(task.id) as any[];
    const messages = logs.map((l: any) => l.message);
    expect(messages).toContain('line1');
    expect(messages).toContain('line2');
    expect(messages).toContain('line3');
  });

  test('logs are assigned the correct run_number', async () => {
    const db = getDb();
    db.query("UPDATE agent_config SET cli_cmd = 'echo run-check', cli_prompt_mode = 'argument' WHERE id = 1").run();
    db.query("INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-1', 'Test', 'todo', 1)").run();
    const task = db.query("SELECT id FROM tasks WHERE task_key = 'TST-1'").get() as any;

    await startAgent(task.id, tmpDir);
    await waitForRunnerIdle();

    const logs = db.query("SELECT DISTINCT run_number FROM task_logs WHERE task_id = ?").all(task.id) as any[];
    expect(logs).toHaveLength(1);
    expect(logs[0].run_number).toBe(1);
  });

  test('second run increments run_number', async () => {
    const db = getDb();
    db.query("UPDATE agent_config SET cli_cmd = 'echo hello', cli_prompt_mode = 'argument' WHERE id = 1").run();
    db.query("INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-1', 'Test', 'todo', 1)").run();
    const task = db.query("SELECT id FROM tasks WHERE task_key = 'TST-1'").get() as any;

    await startAgent(task.id, tmpDir);
    await waitForRunnerIdle();

    // Reset to todo so we can run again
    db.query("UPDATE tasks SET status = 'todo', agent_status = NULL WHERE id = ?").run(task.id);

    await startAgent(task.id, tmpDir);
    await waitForRunnerIdle();

    const runs = db.query("SELECT DISTINCT run_number FROM task_logs WHERE task_id = ? ORDER BY run_number").all(task.id) as any[];
    expect(runs.map((r: any) => r.run_number)).toEqual([1, 2]);
  });

  test('non-zero exit marks agent_status as failed (no error log — result path)', async () => {
    const db = getDb();
    db.query("UPDATE agent_config SET cli_cmd = 'sh -c \"exit 1\"', cli_prompt_mode = 'argument' WHERE id = 1").run();
    db.query("INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-1', 'Test', 'todo', 1)").run();
    const task = db.query("SELECT id FROM tasks WHERE task_key = 'TST-1'").get() as any;

    await startAgent(task.id, tmpDir);
    await waitForRunnerIdle();

    const finalTask = db.query("SELECT * FROM tasks WHERE id = ?").get(task.id) as any;
    expect(finalTask.agent_status).toBe('failed');

    const errorLogs = db.query("SELECT * FROM task_logs WHERE task_id = ? AND level = 'error'").all(task.id) as any[];
    expect(errorLogs).toHaveLength(0);
  });

  test('timeout uses signal.reason to generate correct error message', async () => {
    const db = getDb();
    db.query("UPDATE agent_config SET cli_cmd = 'sh -c \"sleep 10\"', cli_prompt_mode = 'argument', timeout_ms = 100 WHERE id = 1").run();
    db.query("INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-1', 'Test', 'todo', 1)").run();
    const task = db.query("SELECT id FROM tasks WHERE task_key = 'TST-1'").get() as any;

    await startAgent(task.id, tmpDir);
    await waitForRunnerIdle(10000);

    const errorLogs = db.query("SELECT * FROM task_logs WHERE task_id = ? AND level = 'error'").all(task.id) as any[];
    expect(errorLogs.length).toBeGreaterThan(0);
    expect(errorLogs.some((l: any) => l.message.includes('timed out'))).toBe(true);

    const finalTask = db.query("SELECT * FROM tasks WHERE id = ?").get(task.id) as any;
    expect(finalTask.agent_status).toBe('failed');
  });
});

describe('cancelAgent', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-exec-'));
    fs.mkdirSync(path.join(tmpDir, '.tasks_manager'), { recursive: true });
    initDb(tmpDir);
    initGitDetection(tmpDir);
    const db = getDb();
    db.query("INSERT INTO project_config (id, task_prefix, repo_name) VALUES (1, 'TST', 'test-repo')").run();
  });

  afterEach(async () => {
    await ensureAllReleased();
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('throws 404 for non-existent task', async () => {
    try {
      await cancelAgent(999);
      expect.unreachable('should have thrown');
    } catch (err: any) {
      expect(err.status).toBe(404);
    }
  });

  test('throws 400 when no agent is running', async () => {
    const db = getDb();
    db.query("INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-1', 'Test', 'todo', 1)").run();
    const task = db.query("SELECT id FROM tasks WHERE task_key = 'TST-1'").get() as any;

    try {
      await cancelAgent(task.id);
      expect.unreachable('should have thrown');
    } catch (err: any) {
      expect(err.status).toBe(400);
    }
  });

  (process.env.CI ? test.skip : test)('cancels a running agent', async () => {
    const db = getDb();
    db.query("UPDATE agent_config SET cli_cmd = 'sh -c \"sleep 2\"', cli_prompt_mode = 'argument' WHERE id = 1").run();
    db.query("INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-1', 'Test', 'todo', 1)").run();
    const task = db.query("SELECT id FROM tasks WHERE task_key = 'TST-1'").get() as any;

    await startAgent(task.id, tmpDir);

    const result = await cancelAgent(task.id);
    expect(result.agent_status).toBe('failed');

    const state = getRunnerState();
    expect(state.activeCount).toBe(0);
  });

  (process.env.CI ? test.skip : test)('writes cancelled-by-user info log after cancel', async () => {
    const db = getDb();
    db.query("UPDATE agent_config SET cli_cmd = 'sh -c \"sleep 2\"', cli_prompt_mode = 'argument' WHERE id = 1").run();
    db.query("INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-1', 'Test', 'todo', 1)").run();
    const task = db.query("SELECT id FROM tasks WHERE task_key = 'TST-1'").get() as any;

    await startAgent(task.id, tmpDir);
    await cancelAgent(task.id);

    const infoLogs = db.query("SELECT * FROM task_logs WHERE task_id = ? AND level = 'info'").all(task.id) as any[];
    expect(infoLogs.some((l: any) => l.message.includes('cancelled by user'))).toBe(true);

    const errorLogs = db.query("SELECT * FROM task_logs WHERE task_id = ? AND level = 'error'").all(task.id) as any[];
    expect(errorLogs).toHaveLength(0);
  });

  (process.env.CI ? test.skip : test)('concurrent cancel calls produce exactly one cancelled-by-user log', async () => {
    const db = getDb();
    db.query("UPDATE agent_config SET cli_cmd = 'sh -c \"sleep 2\"', cli_prompt_mode = 'argument' WHERE id = 1").run();
    db.query("INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-1', 'Test', 'todo', 1)").run();
    const task = db.query("SELECT id FROM tasks WHERE task_key = 'TST-1'").get() as any;

    await startAgent(task.id, tmpDir);

    // Fire two concurrent cancel requests
    await Promise.all([cancelAgent(task.id), cancelAgent(task.id)]);

    const cancelLogs = db.query(
      "SELECT * FROM task_logs WHERE task_id = ? AND message LIKE '%cancelled by user%'"
    ).all(task.id) as any[];
    expect(cancelLogs).toHaveLength(1);

    const finalTask = db.query("SELECT * FROM tasks WHERE id = ?").get(task.id) as any;
    expect(finalTask.agent_status).toBe('failed');
  });
});

describe('startAgent — adapter errors', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-exec-'));
    fs.mkdirSync(path.join(tmpDir, '.tasks_manager'), { recursive: true });
    initDb(tmpDir);
    initGitDetection(tmpDir);
    const db = getDb();
    db.query("INSERT INTO project_config (id, task_prefix, repo_name) VALUES (1, 'TST', 'test-repo')").run();
  });

  afterEach(async () => {
    await ensureAllReleased();
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('nonexistent binary logs error and marks task failed', async () => {
    const db = getDb();
    db.query("UPDATE agent_config SET cli_cmd = 'nonexistent-binary-xyz-12345', cli_prompt_mode = 'argument' WHERE id = 1").run();
    db.query("INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-1', 'Test', 'todo', 1)").run();
    const task = db.query("SELECT id FROM tasks WHERE task_key = 'TST-1'").get() as any;

    await startAgent(task.id, tmpDir);
    await waitForRunnerIdle(10000);

    const finalTask = db.query("SELECT * FROM tasks WHERE id = ?").get(task.id) as any;
    expect(finalTask.agent_status).toBe('failed');

    const errorLogs = db.query("SELECT * FROM task_logs WHERE task_id = ? AND level = 'error'").all(task.id) as any[];
    expect(errorLogs.length).toBeGreaterThan(0);
    expect(errorLogs.some((l: any) => l.message.includes('nonexistent-binary-xyz-12345'))).toBe(true);
  }, 15000);
});

describe('shutdownAllAgents', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-exec-'));
    fs.mkdirSync(path.join(tmpDir, '.tasks_manager'), { recursive: true });
    initDb(tmpDir);
    initGitDetection(tmpDir);
    const db = getDb();
    db.query("INSERT INTO project_config (id, task_prefix, repo_name) VALUES (1, 'TST', 'test-repo')").run();
  });

  afterEach(async () => {
    await ensureAllReleased();
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('resolves immediately when no agent is running', async () => {
    await shutdownAllAgents();
    const state = getRunnerState();
    expect(state.activeCount).toBe(0);
  });

  (process.env.CI ? test.skip : test)('sets agent_status to failed and writes shutdown log', async () => {
    const db = getDb();
    db.query("UPDATE agent_config SET cli_cmd = 'sh -c \"sleep 10\"', cli_prompt_mode = 'argument' WHERE id = 1").run();
    db.query("INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-1', 'Test', 'todo', 1)").run();
    const task = db.query("SELECT id FROM tasks WHERE task_key = 'TST-1'").get() as any;

    await startAgent(task.id, tmpDir);

    await shutdownAllAgents();

    const finalTask = db.query("SELECT * FROM tasks WHERE id = ?").get(task.id) as any;
    expect(finalTask.agent_status).toBe('failed');

    const errorLogs = db.query("SELECT * FROM task_logs WHERE task_id = ? AND level = 'error'").all(task.id) as any[];
    expect(errorLogs.some((l: any) => l.message.includes('shutting down'))).toBe(true);
  });

  (process.env.CI ? test.skip : test)('clears activeRuns after shutdown', async () => {
    const db = getDb();
    db.query("UPDATE agent_config SET cli_cmd = 'sh -c \"sleep 10\"', cli_prompt_mode = 'argument' WHERE id = 1").run();
    db.query("INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-1', 'Test', 'todo', 1)").run();
    const task = db.query("SELECT id FROM tasks WHERE task_key = 'TST-1'").get() as any;

    await startAgent(task.id, tmpDir);
    await shutdownAllAgents();

    const state = getRunnerState();
    expect(state.activeCount).toBe(0);
    expect(state.runs).toEqual([]);
  });
});

describe('startAgent — git worktree mode', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = initGitTmpDir();
    initDb(tmpDir);
    initGitDetection(tmpDir);
    const db = getDb();
    db.query("INSERT INTO project_config (id, task_prefix, repo_name) VALUES (1, 'TST', 'test-repo')").run();
  });

  afterEach(async () => {
    await ensureAllReleased();
    closeDb();
    try { gitSync(['worktree', 'prune'], tmpDir); } catch {}
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('git detection enables worktree mode', () => {
    const state = getRunnerState();
    expect(state.maxConcurrent).toBe(3);
  });

  test('agent runs in a worktree and completes', async () => {
    const db = getDb();
    db.query("UPDATE agent_config SET cli_cmd = 'echo hello', cli_prompt_mode = 'argument' WHERE id = 1").run();
    db.query("INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-1', 'Test', 'todo', 1)").run();
    const task = db.query("SELECT id FROM tasks WHERE task_key = 'TST-1'").get() as any;

    const result = await startAgent(task.id, tmpDir);
    expect(result.status).toBe('in-progress');
    expect(result.agent_status).toBe('running');

    await waitForRunnerIdle();

    const finalTask = db.query("SELECT * FROM tasks WHERE id = ?").get(task.id) as any;
    expect(finalTask.status).toBe('done');
    expect(finalTask.agent_status).toBe('completed');
    // Worktree columns should be cleared after completion
    expect(finalTask.agent_worktree).toBeNull();
    expect(finalTask.agent_branch).toBeNull();
  });

  test('worktree is cleaned up after agent completes', async () => {
    const db = getDb();
    db.query("UPDATE agent_config SET cli_cmd = 'echo hello', cli_prompt_mode = 'argument' WHERE id = 1").run();
    db.query("INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-1', 'Test', 'todo', 1)").run();
    const task = db.query("SELECT id FROM tasks WHERE task_key = 'TST-1'").get() as any;

    await startAgent(task.id, tmpDir);
    await waitForRunnerIdle();

    const worktreePath = path.join(tmpDir, '.tasks_manager', 'worktrees', 'TST-1');
    expect(fs.existsSync(worktreePath)).toBe(false);
  });

  test('agent branch is created and kept after completion', async () => {
    const db = getDb();
    db.query("UPDATE agent_config SET cli_cmd = 'echo hello', cli_prompt_mode = 'argument' WHERE id = 1").run();
    db.query("INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-1', 'Test', 'todo', 1)").run();
    const task = db.query("SELECT id FROM tasks WHERE task_key = 'TST-1'").get() as any;

    await startAgent(task.id, tmpDir);
    await waitForRunnerIdle();

    // The branch should still exist (for the user to merge)
    const branches = gitSync(['branch', '--list', 'agent/TST-1'], tmpDir);
    expect(branches).toContain('agent/TST-1');
  });

  test('worktree columns are set while agent runs', async () => {
    const db = getDb();
    db.query("UPDATE agent_config SET cli_cmd = 'sh -c \"sleep 2\"', cli_prompt_mode = 'argument' WHERE id = 1").run();
    db.query("INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-1', 'Test', 'todo', 1)").run();
    const task = db.query("SELECT id FROM tasks WHERE task_key = 'TST-1'").get() as any;

    await startAgent(task.id, tmpDir);

    // Poll until worktree columns are set (worktree creation is async)
    const deadline = Date.now() + 5000;
    let running: any;
    while (Date.now() < deadline) {
      running = db.query("SELECT agent_worktree, agent_branch FROM tasks WHERE id = ?").get(task.id) as any;
      if (running.agent_worktree) break;
      await new Promise(r => setTimeout(r, 50));
    }

    expect(running.agent_worktree).toContain('.tasks_manager/worktrees/TST-1');
    expect(running.agent_branch).toBe('agent/TST-1');
  });

  test('agent failure in git mode cleans up worktree', async () => {
    const db = getDb();
    db.query("UPDATE agent_config SET cli_cmd = 'sh -c \"exit 1\"', cli_prompt_mode = 'argument' WHERE id = 1").run();
    db.query("INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-1', 'Test', 'todo', 1)").run();
    const task = db.query("SELECT id FROM tasks WHERE task_key = 'TST-1'").get() as any;

    await startAgent(task.id, tmpDir);
    await waitForRunnerIdle();

    const finalTask = db.query("SELECT * FROM tasks WHERE id = ?").get(task.id) as any;
    expect(finalTask.agent_status).toBe('failed');
    expect(finalTask.agent_worktree).toBeNull();
    expect(finalTask.agent_branch).toBeNull();

    const worktreePath = path.join(tmpDir, '.tasks_manager', 'worktrees', 'TST-1');
    expect(fs.existsSync(worktreePath)).toBe(false);
  });

  test('warns when agent leaves uncommitted files', async () => {
    const db = getDb();
    db.query("UPDATE agent_config SET cli_cmd = 'sh -c \"echo dirty > uncommitted.txt\"', cli_prompt_mode = 'argument' WHERE id = 1").run();
    db.query("INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-1', 'Test', 'todo', 1)").run();
    const task = db.query("SELECT id FROM tasks WHERE task_key = 'TST-1'").get() as any;

    await startAgent(task.id, tmpDir);
    await waitForRunnerIdle();

    const warnLogs = db.query("SELECT * FROM task_logs WHERE task_id = ? AND level = 'warn'").all(task.id) as any[];
    expect(warnLogs.some((l: any) => l.message.includes('uncommitted file(s)'))).toBe(true);
  });

  test('agent cwd is set to worktree path', async () => {
    const db = getDb();
    // Use sh -c pwd so the prompt argument doesn't interfere with the command
    db.query("UPDATE agent_config SET cli_cmd = 'sh -c pwd', cli_prompt_mode = 'argument' WHERE id = 1").run();
    db.query("INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-1', 'Test', 'todo', 1)").run();
    const task = db.query("SELECT id FROM tasks WHERE task_key = 'TST-1'").get() as any;

    await startAgent(task.id, tmpDir);
    await waitForRunnerIdle();

    const logs = db.query("SELECT * FROM task_logs WHERE task_id = ? AND level = 'agent'").all(task.id) as any[];
    const cwdLog = logs.find((l: any) => l.message.includes('.tasks_manager/worktrees/TST-1'));
    expect(cwdLog).toBeTruthy();
  });

  (process.env.CI ? test.skip : test)('two agents can run concurrently in git mode', async () => {
    const db = getDb();
    db.query("UPDATE agent_config SET cli_cmd = 'sh -c \"sleep 1 && echo done\"', cli_prompt_mode = 'argument' WHERE id = 1").run();
    db.query("INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-1', 'First', 'todo', 1)").run();
    db.query("INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-2', 'Second', 'todo', 2)").run();
    const t1 = db.query("SELECT id FROM tasks WHERE task_key = 'TST-1'").get() as any;
    const t2 = db.query("SELECT id FROM tasks WHERE task_key = 'TST-2'").get() as any;

    await startAgent(t1.id, tmpDir);
    await startAgent(t2.id, tmpDir);

    // Both should be running simultaneously
    const state = getRunnerState();
    expect(state.activeCount).toBe(2);
    expect(state.runs).toHaveLength(2);

    await waitForRunnerIdle(10000);

    const ft1 = db.query("SELECT * FROM tasks WHERE id = ?").get(t1.id) as any;
    const ft2 = db.query("SELECT * FROM tasks WHERE id = ?").get(t2.id) as any;
    expect(ft1.agent_status).toBe('completed');
    expect(ft2.agent_status).toBe('completed');
  });

  (process.env.CI ? test.skip : test)('concurrency limit is enforced in git mode', async () => {
    const db = getDb();
    db.query("UPDATE agent_config SET cli_cmd = 'sh -c \"sleep 2\"', cli_prompt_mode = 'argument', max_concurrent_agents = 2 WHERE id = 1").run();
    db.query("INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-1', 'First', 'todo', 1)").run();
    db.query("INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-2', 'Second', 'todo', 2)").run();
    db.query("INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-3', 'Third', 'todo', 3)").run();
    const t1 = db.query("SELECT id FROM tasks WHERE task_key = 'TST-1'").get() as any;
    const t2 = db.query("SELECT id FROM tasks WHERE task_key = 'TST-2'").get() as any;
    const t3 = db.query("SELECT id FROM tasks WHERE task_key = 'TST-3'").get() as any;

    await startAgent(t1.id, tmpDir);
    await startAgent(t2.id, tmpDir);

    try {
      await startAgent(t3.id, tmpDir);
      expect.unreachable('should have thrown');
    } catch (err: any) {
      expect(err.status).toBe(409);
      expect(err.reason).toBe('concurrency_limit');
    }

    expect(getRunnerState().activeCount).toBe(2);
  });

  (process.env.CI ? test.skip : test)('cannot start the same task twice', async () => {
    const db = getDb();
    db.query("UPDATE agent_config SET cli_cmd = 'sh -c \"sleep 2\"', cli_prompt_mode = 'argument' WHERE id = 1").run();
    db.query("INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-1', 'Test', 'todo', 1)").run();
    const task = db.query("SELECT id FROM tasks WHERE task_key = 'TST-1'").get() as any;

    await startAgent(task.id, tmpDir);

    try {
      await startAgent(task.id, tmpDir);
      expect.unreachable('should have thrown');
    } catch (err: any) {
      expect(err.status).toBe(409);
      expect(err.reason).toBe('task_already_running');
    }
  });

  (process.env.CI ? test.skip : test)('cancel in git mode cleans up worktree', async () => {
    const db = getDb();
    db.query("UPDATE agent_config SET cli_cmd = 'sh -c \"sleep 10\"', cli_prompt_mode = 'argument' WHERE id = 1").run();
    db.query("INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-1', 'Test', 'todo', 1)").run();
    const task = db.query("SELECT id FROM tasks WHERE task_key = 'TST-1'").get() as any;

    await startAgent(task.id, tmpDir);

    const result = await cancelAgent(task.id);
    expect(result.agent_status).toBe('failed');

    const worktreePath = path.join(tmpDir, '.tasks_manager', 'worktrees', 'TST-1');
    expect(fs.existsSync(worktreePath)).toBe(false);

    const finalTask = db.query("SELECT * FROM tasks WHERE id = ?").get(task.id) as any;
    expect(finalTask.agent_worktree).toBeNull();
  });
});

describe('shutdownAllAgents — git mode with multiple agents', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = initGitTmpDir();
    initDb(tmpDir);
    initGitDetection(tmpDir);
    const db = getDb();
    db.query("INSERT INTO project_config (id, task_prefix, repo_name) VALUES (1, 'TST', 'test-repo')").run();
  });

  afterEach(async () => {
    await ensureAllReleased();
    closeDb();
    try { gitSync(['worktree', 'prune'], tmpDir); } catch {}
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  (process.env.CI ? test.skip : test)('shuts down multiple concurrent agents', async () => {
    const db = getDb();
    db.query("UPDATE agent_config SET cli_cmd = 'sh -c \"sleep 10\"', cli_prompt_mode = 'argument' WHERE id = 1").run();
    db.query("INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-1', 'First', 'todo', 1)").run();
    db.query("INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-2', 'Second', 'todo', 2)").run();
    const t1 = db.query("SELECT id FROM tasks WHERE task_key = 'TST-1'").get() as any;
    const t2 = db.query("SELECT id FROM tasks WHERE task_key = 'TST-2'").get() as any;

    await startAgent(t1.id, tmpDir);
    await startAgent(t2.id, tmpDir);
    expect(getRunnerState().activeCount).toBe(2);

    await shutdownAllAgents();

    const state = getRunnerState();
    expect(state.activeCount).toBe(0);

    const ft1 = db.query("SELECT * FROM tasks WHERE id = ?").get(t1.id) as any;
    const ft2 = db.query("SELECT * FROM tasks WHERE id = ?").get(t2.id) as any;
    expect(ft1.agent_status).toBe('failed');
    expect(ft2.agent_status).toBe('failed');

    // Both worktrees should be cleaned up
    expect(fs.existsSync(path.join(tmpDir, '.tasks_manager', 'worktrees', 'TST-1'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, '.tasks_manager', 'worktrees', 'TST-2'))).toBe(false);

    // Shutdown logs for both
    const logs1 = db.query("SELECT * FROM task_logs WHERE task_id = ? AND level = 'error'").all(t1.id) as any[];
    const logs2 = db.query("SELECT * FROM task_logs WHERE task_id = ? AND level = 'error'").all(t2.id) as any[];
    expect(logs1.some((l: any) => l.message.includes('shutting down'))).toBe(true);
    expect(logs2.some((l: any) => l.message.includes('shutting down'))).toBe(true);
  });
});
