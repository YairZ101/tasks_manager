import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { initDb, getDb, closeDb } from '../db/database.js';
import { buildPrompt, getMutexState, startAgent, cancelAgent } from './executor.js';
import type { Task } from '../types.js';

async function waitForMutexRelease(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (getMutexState().held && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
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
    const state = getMutexState();
    if (state.held && state.taskId) {
      try { await cancelAgent(state.taskId); } catch { /* ignore */ }
    }
    await waitForMutexRelease();
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

  test('mutex blocks concurrent agents', async () => {
    const db = getDb();
    db.query("UPDATE agent_config SET cli_cmd = 'sh -c \"sleep 300\"', cli_prompt_mode = 'argument' WHERE id = 1").run();
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
    const state = getMutexState();
    if (state.held && state.taskId) {
      try { await cancelAgent(state.taskId); } catch { /* ignore */ }
    }
    await waitForMutexRelease();
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

  test('cancels a running agent', async () => {
    const db = getDb();
    db.query("UPDATE agent_config SET cli_cmd = 'sh -c \"sleep 300\"', cli_prompt_mode = 'argument' WHERE id = 1").run();
    db.query("INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-1', 'Test', 'todo', 1)").run();
    const task = db.query("SELECT id FROM tasks WHERE task_key = 'TST-1'").get() as any;

    await startAgent(task.id, tmpDir);

    const result = await cancelAgent(task.id);
    expect(result.agent_status).toBe('failed');

    const state = getMutexState();
    expect(state.held).toBe(false);
  });
});
