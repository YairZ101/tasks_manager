import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { initDb, getDb, closeDb } from './database.js';

describe('Database initialization', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-db-'));
    fs.mkdirSync(path.join(tmpDir, '.tasks_manager'), { recursive: true });
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('initDb creates database and returns it', () => {
    const db = initDb(tmpDir);
    expect(db).toBeDefined();
    expect(fs.existsSync(path.join(tmpDir, '.tasks_manager', 'tasks.db'))).toBe(true);
  });

  test('getDb returns the initialized database', () => {
    initDb(tmpDir);
    const db = getDb();
    expect(db).toBeDefined();
  });

  test('getDb throws if not initialized', () => {
    expect(() => getDb()).toThrow('Database not initialized');
  });

  test('creates all tables', () => {
    initDb(tmpDir);
    const db = getDb();
    const tables = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all()
      .map((r) => r.name);

    expect(tables).toContain('tasks');
    expect(tables).toContain('task_logs');
    expect(tables).toContain('agent_config');
    expect(tables).toContain('project_config');
  });

  test('agent_config has default row', () => {
    initDb(tmpDir);
    const db = getDb();
    const config = db.query('SELECT * FROM agent_config WHERE id = 1').get() as any;
    expect(config).not.toBeNull();
    expect(config.type).toBe('cli');
    expect(config.timeout_ms).toBe(1800000);
  });

  test('user_version is set to 1', () => {
    initDb(tmpDir);
    const db = getDb();
    const row = db.query<{ user_version: number }, []>('PRAGMA user_version').get();
    expect(row?.user_version).toBe(1);
  });

  test('idempotent — calling initDb twice does not error', () => {
    closeDb();
    initDb(tmpDir);
    closeDb();
    const db = initDb(tmpDir);
    expect(db).toBeDefined();
  });
});

describe('Task CRUD via real DB', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-db-'));
    fs.mkdirSync(path.join(tmpDir, '.tasks_manager'), { recursive: true });
    initDb(tmpDir);
    const db = getDb();
    db.query(
      "INSERT INTO project_config (id, task_prefix, repo_name) VALUES (1, 'TST', 'test-repo')"
    ).run();
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('insert and retrieve a task', () => {
    const db = getDb();
    db.query(
      "INSERT INTO tasks (task_key, title, description, acceptance, status, sort_order) VALUES ('TST-1', 'Test Task', 'desc', 'acc', 'backlog', 1)"
    ).run();

    const task = db.query("SELECT * FROM tasks WHERE task_key = 'TST-1'").get() as any;
    expect(task).not.toBeNull();
    expect(task.title).toBe('Test Task');
    expect(task.status).toBe('backlog');
  });

  test('rejects invalid status', () => {
    const db = getDb();
    expect(() => {
      db.query(
        "INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-2', 'Bad', 'invalid', 1)"
      ).run();
    }).toThrow();
  });

  test('rejects empty title', () => {
    const db = getDb();
    expect(() => {
      db.query(
        "INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-3', '', 'backlog', 1)"
      ).run();
    }).toThrow();
  });

  test('rejects invalid agent_status', () => {
    const db = getDb();
    db.query(
      "INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-4', 'Valid', 'backlog', 1)"
    ).run();
    expect(() => {
      db.query("UPDATE tasks SET agent_status = 'bogus' WHERE task_key = 'TST-4'").run();
    }).toThrow();
  });

  test('allows valid agent_status values', () => {
    const db = getDb();
    db.query(
      "INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-5', 'Valid', 'in-progress', 1)"
    ).run();

    for (const status of ['running', 'completed', 'failed']) {
      db.query("UPDATE tasks SET agent_status = ? WHERE task_key = 'TST-5'").run(status);
      const task = db.query("SELECT agent_status FROM tasks WHERE task_key = 'TST-5'").get() as any;
      expect(task.agent_status).toBe(status);
    }

    db.query("UPDATE tasks SET agent_status = NULL WHERE task_key = 'TST-5'").run();
    const task = db.query("SELECT agent_status FROM tasks WHERE task_key = 'TST-5'").get() as any;
    expect(task.agent_status).toBeNull();
  });

  test('updated_at trigger fires on update', () => {
    const db = getDb();
    db.query(
      "INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-6', 'Before', 'backlog', 1)"
    ).run();
    db.query("UPDATE tasks SET updated_at = '2000-01-01 00:00:00' WHERE task_key = 'TST-6'").run();
    db.query("UPDATE tasks SET title = 'After' WHERE task_key = 'TST-6'").run();
    const after = db.query("SELECT updated_at FROM tasks WHERE task_key = 'TST-6'").get() as any;
    expect(after.updated_at).not.toBe('2000-01-01 00:00:00');
  });

  test('task_key must be unique', () => {
    const db = getDb();
    db.query(
      "INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-7', 'First', 'backlog', 1)"
    ).run();
    expect(() => {
      db.query(
        "INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-7', 'Dupe', 'backlog', 2)"
      ).run();
    }).toThrow();
  });

  test('cascading delete removes task_logs', () => {
    const db = getDb();
    db.query(
      "INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-8', 'With logs', 'backlog', 1)"
    ).run();
    const task = db.query("SELECT id FROM tasks WHERE task_key = 'TST-8'").get() as any;

    db.query("INSERT INTO task_logs (task_id, run_number, level, message) VALUES (?, 1, 'info', 'hello')").run(task.id);
    db.query('DELETE FROM tasks WHERE id = ?').run(task.id);

    const logsAfter = db.query('SELECT COUNT(*) as cnt FROM task_logs WHERE task_id = ?').get(task.id) as any;
    expect(logsAfter.cnt).toBe(0);
  });
});

describe('Task logs', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-db-'));
    fs.mkdirSync(path.join(tmpDir, '.tasks_manager'), { recursive: true });
    initDb(tmpDir);
    const db = getDb();
    db.query("INSERT INTO project_config (id, task_prefix, repo_name) VALUES (1, 'TST', 'test-repo')").run();
    db.query("INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-1', 'Test', 'backlog', 1)").run();
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('insert and query logs', () => {
    const db = getDb();
    const task = db.query("SELECT id FROM tasks WHERE task_key = 'TST-1'").get() as any;

    db.query("INSERT INTO task_logs (task_id, run_number, level, message) VALUES (?, 1, 'info', 'line 1')").run(task.id);
    db.query("INSERT INTO task_logs (task_id, run_number, level, message) VALUES (?, 1, 'agent', 'line 2')").run(task.id);
    db.query("INSERT INTO task_logs (task_id, run_number, level, message) VALUES (?, 2, 'error', 'line 3')").run(task.id);

    const allLogs = db.query('SELECT * FROM task_logs WHERE task_id = ? ORDER BY id').all(task.id) as any[];
    expect(allLogs).toHaveLength(3);

    const run1Logs = db.query('SELECT * FROM task_logs WHERE task_id = ? AND run_number = 1').all(task.id) as any[];
    expect(run1Logs).toHaveLength(2);
  });

  test('rejects invalid log level', () => {
    const db = getDb();
    const task = db.query("SELECT id FROM tasks WHERE task_key = 'TST-1'").get() as any;
    expect(() => {
      db.query("INSERT INTO task_logs (task_id, run_number, level, message) VALUES (?, 1, 'debug', 'bad')").run(task.id);
    }).toThrow();
  });
});

describe('Project config', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-db-'));
    fs.mkdirSync(path.join(tmpDir, '.tasks_manager'), { recursive: true });
    initDb(tmpDir);
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('insert and query project config', () => {
    const db = getDb();
    db.query("INSERT INTO project_config (id, task_prefix, repo_name) VALUES (1, 'PROJ', 'my-repo')").run();
    const config = db.query('SELECT * FROM project_config WHERE id = 1').get() as any;
    expect(config.task_prefix).toBe('PROJ');
    expect(config.repo_name).toBe('my-repo');
    expect(config.next_task_number).toBe(1);
  });

  test('rejects invalid prefix (lowercase)', () => {
    const db = getDb();
    expect(() => {
      db.query("INSERT INTO project_config (id, task_prefix, repo_name) VALUES (1, 'abc', 'repo')").run();
    }).toThrow();
  });

  test('rejects prefix longer than 5 chars', () => {
    const db = getDb();
    expect(() => {
      db.query("INSERT INTO project_config (id, task_prefix, repo_name) VALUES (1, 'ABCDEF', 'repo')").run();
    }).toThrow();
  });

  test('next_task_number increment pattern', () => {
    const db = getDb();
    db.query("INSERT INTO project_config (id, task_prefix, repo_name) VALUES (1, 'TST', 'repo')").run();

    const row1 = db.query(
      'UPDATE project_config SET next_task_number = next_task_number + 1 WHERE id = 1 RETURNING next_task_number - 1 AS seq'
    ).get() as any;
    expect(row1.seq).toBe(1);

    const row2 = db.query(
      'UPDATE project_config SET next_task_number = next_task_number + 1 WHERE id = 1 RETURNING next_task_number - 1 AS seq'
    ).get() as any;
    expect(row2.seq).toBe(2);
  });

  test('only allows id = 1', () => {
    const db = getDb();
    db.query("INSERT INTO project_config (id, task_prefix, repo_name) VALUES (1, 'TST', 'repo')").run();
    expect(() => {
      db.query("INSERT INTO project_config (id, task_prefix, repo_name) VALUES (2, 'FOO', 'repo')").run();
    }).toThrow();
  });
});
