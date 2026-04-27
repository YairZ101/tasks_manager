import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { initDb, getDb, closeDb } from './db/database.js';
import { runCrashRecovery } from './recovery.js';

describe('runCrashRecovery', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-recovery-'));
    fs.mkdirSync(path.join(tmpDir, '.tasks_manager'), { recursive: true });
    initDb(tmpDir);
    const db = getDb();
    db.query("INSERT INTO project_config (id, task_prefix, repo_name) VALUES (1, 'TST', 'test-repo')").run();
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('does nothing when no running tasks', () => {
    const db = getDb();
    db.query(
      "INSERT INTO tasks (task_key, title, status, agent_status, sort_order) VALUES ('TST-1', 'Done', 'done', 'completed', 1)"
    ).run();

    runCrashRecovery();

    const task = db.query("SELECT * FROM tasks WHERE task_key = 'TST-1'").get() as any;
    expect(task.agent_status).toBe('completed');
  });

  test('marks orphaned running tasks as failed', () => {
    const db = getDb();
    db.query(
      "INSERT INTO tasks (task_key, title, status, agent_status, agent_pid, sort_order) VALUES ('TST-1', 'Orphaned', 'in-progress', 'running', 99999999, 1)"
    ).run();

    runCrashRecovery();

    const task = db.query("SELECT * FROM tasks WHERE task_key = 'TST-1'").get() as any;
    expect(task.agent_status).toBe('failed');
    expect(task.agent_pid).toBeNull();
    expect(task.agent_started_at).toBeNull();
  });

  test('adds a recovery log entry', () => {
    const db = getDb();
    db.query(
      "INSERT INTO tasks (task_key, title, status, agent_status, agent_pid, sort_order) VALUES ('TST-1', 'Orphaned', 'in-progress', 'running', 99999999, 1)"
    ).run();
    const task = db.query("SELECT id FROM tasks WHERE task_key = 'TST-1'").get() as any;

    runCrashRecovery();

    const logs = db.query("SELECT * FROM task_logs WHERE task_id = ?").all(task.id) as any[];
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.some((l: any) => l.level === 'error' && l.message.includes('restarted'))).toBe(true);
  });

  test('handles multiple orphaned tasks', () => {
    const db = getDb();
    db.query(
      "INSERT INTO tasks (task_key, title, status, agent_status, agent_pid, sort_order) VALUES ('TST-1', 'One', 'in-progress', 'running', 99999998, 1)"
    ).run();
    db.query(
      "INSERT INTO tasks (task_key, title, status, agent_status, agent_pid, sort_order) VALUES ('TST-2', 'Two', 'in-progress', 'running', 99999997, 2)"
    ).run();

    runCrashRecovery();

    const t1 = db.query("SELECT agent_status FROM tasks WHERE task_key = 'TST-1'").get() as any;
    const t2 = db.query("SELECT agent_status FROM tasks WHERE task_key = 'TST-2'").get() as any;
    expect(t1.agent_status).toBe('failed');
    expect(t2.agent_status).toBe('failed');
  });

  test('does not touch non-running tasks', () => {
    const db = getDb();
    db.query(
      "INSERT INTO tasks (task_key, title, status, agent_status, sort_order) VALUES ('TST-1', 'Failed', 'in-progress', 'failed', 1)"
    ).run();
    db.query(
      "INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-2', 'Backlog', 'backlog', 2)"
    ).run();

    runCrashRecovery();

    const t1 = db.query("SELECT agent_status FROM tasks WHERE task_key = 'TST-1'").get() as any;
    const t2 = db.query("SELECT agent_status FROM tasks WHERE task_key = 'TST-2'").get() as any;
    expect(t1.agent_status).toBe('failed');
    expect(t2.agent_status).toBeNull();
  });
});
