import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { initDb, getDb, closeDb } from '../db/database.js';
import { buildPrompt, getMutexState, startAgent, cancelAgent, shutdownAgent, awaitCompletion } from './executor.js';
import type { Task } from '../types.js';

async function waitForMutexRelease(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (getMutexState().held && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function ensureMutexReleased() {
  // First try: await the background executeAgent to finish naturally
  await awaitCompletion();
  await waitForMutexRelease();
  // If still held (e.g. test didn't trigger the agent properly), force-cancel
  const state = getMutexState();
  if (state.held && state.taskId) {
    try { await cancelAgent(state.taskId); } catch { /* ignore */ }
    await waitForMutexRelease(3000);
  }
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
  sort_order: 1,
  created_at: '2024-01-01',
  updated_at: '2024-01-01',
  ...overrides,
});

describe('buildPrompt', () => {
  test('includes repo path and task key', () => {
    const task = makeTask({ task_key: 'PROJ-5', title: 'Add login' });
    const prompt = buildPrompt(task, '/home/user/repo');

    expect(prompt).toContain('/home/user/repo');
    expect(prompt).toContain('PROJ-5');
    expect(prompt).toContain('Add login');
  });

  test('includes description when present', () => {
    const task = makeTask({ description: 'Implement OAuth2 flow' });
    const prompt = buildPrompt(task, '/repo');

    expect(prompt).toContain('### Description');
    expect(prompt).toContain('Implement OAuth2 flow');
  });

  test('omits description section when empty', () => {
    const task = makeTask({ description: '' });
    const prompt = buildPrompt(task, '/repo');

    expect(prompt).not.toContain('### Description');
  });

  test('includes acceptance criteria when present', () => {
    const task = makeTask({ acceptance: '- Users can log in\n- Tokens refresh' });
    const prompt = buildPrompt(task, '/repo');

    expect(prompt).toContain('### Acceptance Criteria');
    expect(prompt).toContain('Users can log in');
  });

  test('omits acceptance section when empty', () => {
    const task = makeTask({ acceptance: '' });
    const prompt = buildPrompt(task, '/repo');

    expect(prompt).not.toContain('### Acceptance Criteria');
  });

  test('includes implementation instruction', () => {
    const task = makeTask();
    const prompt = buildPrompt(task, '/repo');

    expect(prompt).toContain('Please implement the changes');
  });

  test('full prompt with all fields', () => {
    const task = makeTask({
      task_key: 'FIX-42',
      title: 'Fix crash on startup',
      description: 'App crashes when config is missing',
      acceptance: '- No crash without config\n- Log a warning',
    });

    const prompt = buildPrompt(task, '/workspace/app');

    expect(prompt).toContain('/workspace/app');
    expect(prompt).toContain('FIX-42');
    expect(prompt).toContain('Fix crash on startup');
    expect(prompt).toContain('App crashes when config is missing');
    expect(prompt).toContain('No crash without config');
    expect(prompt).toContain('Log a warning');
  });
});

describe('getMutexState', () => {
  test('reports held/taskKey/taskId', () => {
    const state = getMutexState();
    expect(state).toHaveProperty('held');
    expect(state).toHaveProperty('taskKey');
    expect(state).toHaveProperty('taskId');
  });
});

describe('startAgent (integration)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-exec-'));
    fs.mkdirSync(path.join(tmpDir, '.tasks_manager'), { recursive: true });
    initDb(tmpDir);
    const db = getDb();
    db.query("INSERT INTO project_config (id, task_prefix, repo_name) VALUES (1, 'TST', 'test-repo')").run();
  });

  afterEach(async () => {
    await ensureMutexReleased();
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

    await waitForMutexRelease();

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
    await waitForMutexRelease();

    const finalTask = db.query("SELECT * FROM tasks WHERE id = ?").get(task.id) as any;
    expect(finalTask.agent_status).toBe('failed');
  });

  (process.env.CI ? test.skip : test)('mutex blocks concurrent agents', async () => {
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
      expect(err.message).toContain('busy');
    }
  });

  test('creates task logs on agent run', async () => {
    const db = getDb();
    db.query("UPDATE agent_config SET cli_cmd = 'echo test-output-line', cli_prompt_mode = 'argument' WHERE id = 1").run();
    db.query("INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-1', 'Test', 'todo', 1)").run();
    const task = db.query("SELECT id FROM tasks WHERE task_key = 'TST-1'").get() as any;

    await startAgent(task.id, tmpDir);
    await waitForMutexRelease();

    const logs = db.query("SELECT * FROM task_logs WHERE task_id = ?").all(task.id) as any[];
    expect(logs.length).toBeGreaterThan(0);
    const agentLogs = logs.filter((l: any) => l.level === 'agent');
    expect(agentLogs.some((l: any) => l.message.includes('test-output-line'))).toBe(true);
  });

  test('log buffer is flushed and all lines persisted after run', async () => {
    const db = getDb();
    // Print multiple lines so the buffer has to flush more than one entry
    db.query("UPDATE agent_config SET cli_cmd = 'printf \"line1\\nline2\\nline3\\n\"', cli_prompt_mode = 'argument' WHERE id = 1").run();
    db.query("INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-1', 'Test', 'todo', 1)").run();
    const task = db.query("SELECT id FROM tasks WHERE task_key = 'TST-1'").get() as any;

    await startAgent(task.id, tmpDir);
    await waitForMutexRelease();

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
    await waitForMutexRelease();

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
    await waitForMutexRelease();

    // Reset to todo so we can run again
    db.query("UPDATE tasks SET status = 'todo', agent_status = NULL WHERE id = ?").run(task.id);

    await startAgent(task.id, tmpDir);
    await waitForMutexRelease();

    const runs = db.query("SELECT DISTINCT run_number FROM task_logs WHERE task_id = ? ORDER BY run_number").all(task.id) as any[];
    expect(runs.map((r: any) => r.run_number)).toEqual([1, 2]);
  });

  test('non-zero exit marks agent_status as failed (no error log — result path)', async () => {
    const db = getDb();
    // Non-zero exit is handled via AgentResult.success=false, not an exception,
    // so the executor sets agent_status='failed' but does not write an error-level log.
    db.query("UPDATE agent_config SET cli_cmd = 'sh -c \"exit 1\"', cli_prompt_mode = 'argument' WHERE id = 1").run();
    db.query("INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-1', 'Test', 'todo', 1)").run();
    const task = db.query("SELECT id FROM tasks WHERE task_key = 'TST-1'").get() as any;

    await startAgent(task.id, tmpDir);
    await waitForMutexRelease();

    const finalTask = db.query("SELECT * FROM tasks WHERE id = ?").get(task.id) as any;
    expect(finalTask.agent_status).toBe('failed');

    // No error-level log is expected for a clean non-zero exit
    const errorLogs = db.query("SELECT * FROM task_logs WHERE task_id = ? AND level = 'error'").all(task.id) as any[];
    expect(errorLogs).toHaveLength(0);
  });

  test('timeout uses signal.reason to generate correct error message', async () => {
    const db = getDb();
    // Set a 100ms timeout and a command that sleeps longer
    db.query("UPDATE agent_config SET cli_cmd = 'sh -c \"sleep 10\"', cli_prompt_mode = 'argument', timeout_ms = 100 WHERE id = 1").run();
    db.query("INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-1', 'Test', 'todo', 1)").run();
    const task = db.query("SELECT id FROM tasks WHERE task_key = 'TST-1'").get() as any;

    await startAgent(task.id, tmpDir);
    await waitForMutexRelease(10000);

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
    const db = getDb();
    db.query("INSERT INTO project_config (id, task_prefix, repo_name) VALUES (1, 'TST', 'test-repo')").run();
  });

  afterEach(async () => {
    await ensureMutexReleased();
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

    const state = getMutexState();
    expect(state.held).toBe(false);
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
    const db = getDb();
    db.query("INSERT INTO project_config (id, task_prefix, repo_name) VALUES (1, 'TST', 'test-repo')").run();
  });

  afterEach(async () => {
    await ensureMutexReleased();
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('nonexistent binary logs error and marks task failed', async () => {
    const db = getDb();
    db.query("UPDATE agent_config SET cli_cmd = 'nonexistent-binary-xyz-12345', cli_prompt_mode = 'argument' WHERE id = 1").run();
    db.query("INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-1', 'Test', 'todo', 1)").run();
    const task = db.query("SELECT id FROM tasks WHERE task_key = 'TST-1'").get() as any;

    await startAgent(task.id, tmpDir);
    await waitForMutexRelease(10000);

    const finalTask = db.query("SELECT * FROM tasks WHERE id = ?").get(task.id) as any;
    expect(finalTask.agent_status).toBe('failed');

    const errorLogs = db.query("SELECT * FROM task_logs WHERE task_id = ? AND level = 'error'").all(task.id) as any[];
    expect(errorLogs.length).toBeGreaterThan(0);
    expect(errorLogs.some((l: any) => l.message.includes('nonexistent-binary-xyz-12345'))).toBe(true);
  }, 15000);
});

describe('shutdownAgent', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-exec-'));
    fs.mkdirSync(path.join(tmpDir, '.tasks_manager'), { recursive: true });
    initDb(tmpDir);
    const db = getDb();
    db.query("INSERT INTO project_config (id, task_prefix, repo_name) VALUES (1, 'TST', 'test-repo')").run();
  });

  afterEach(async () => {
    await ensureMutexReleased();
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns null when no agent is running', () => {
    const result = shutdownAgent();
    expect(result).toBeNull();
  });

  (process.env.CI ? test.skip : test)('sets agent_status to failed and writes shutdown log', async () => {
    const db = getDb();
    db.query("UPDATE agent_config SET cli_cmd = 'sh -c \"sleep 10\"', cli_prompt_mode = 'argument' WHERE id = 1").run();
    db.query("INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-1', 'Test', 'todo', 1)").run();
    const task = db.query("SELECT id FROM tasks WHERE task_key = 'TST-1'").get() as any;

    await startAgent(task.id, tmpDir);

    shutdownAgent();
    await waitForMutexRelease();

    const finalTask = db.query("SELECT * FROM tasks WHERE id = ?").get(task.id) as any;
    expect(finalTask.agent_status).toBe('failed');

    const errorLogs = db.query("SELECT * FROM task_logs WHERE task_id = ? AND level = 'error'").all(task.id) as any[];
    expect(errorLogs.some((l: any) => l.message.includes('shutting down'))).toBe(true);
  });

  (process.env.CI ? test.skip : test)('releases mutex after shutdown', async () => {
    const db = getDb();
    db.query("UPDATE agent_config SET cli_cmd = 'sh -c \"sleep 10\"', cli_prompt_mode = 'argument' WHERE id = 1").run();
    db.query("INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-1', 'Test', 'todo', 1)").run();
    const task = db.query("SELECT id FROM tasks WHERE task_key = 'TST-1'").get() as any;

    await startAgent(task.id, tmpDir);
    shutdownAgent();

    const state = getMutexState();
    expect(state.held).toBe(false);
    expect(state.taskId).toBeNull();
  });
});
