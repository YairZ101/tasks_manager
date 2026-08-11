import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Database } from 'bun:sqlite';
import { closeDb, getDb, initDb } from './database.js';

let root = '';
afterEach(() => {
  closeDb();
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

describe('Flow database', () => {
  test('creates the greenfield schema and singleton config', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-db-'));
    initDb(root);
    const db = getDb();
    const tables = db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
    for (const name of ['app_meta', 'tasks', 'flows', 'flow_versions', 'runs', 'attempts', 'workspaces', 'logs', 'events', 'agent_presets', 'workspace_config', 'workspace_preparations', 'workspace_preparation_logs']) expect(tables).toContain(name);
    const taskColumns = db.query<{ name: string }, []>('PRAGMA table_info(tasks)').all().map((column) => column.name);
    expect(taskColumns).not.toContain('queue_state');
    const runColumns = db.query<{ name: string }, []>('PRAGMA table_info(runs)').all().map((column) => column.name);
    expect(runColumns).toContain('agent_prompts_json');
    expect(db.query<{ name: string }, []>('PRAGMA table_info(agent_presets)').all().map((column) => column.name)).not.toContain('effect_level');
    expect(db.query<{ value: string }, []>("SELECT value FROM app_meta WHERE key='schema_family'").get()?.value).toBe('flow');
    expect(db.query<{ value: string }, []>("SELECT value FROM app_meta WHERE key='schema_version'").get()?.value).toBe('2');
    expect(db.query<{ max_concurrent_executions: number }, []>('SELECT max_concurrent_executions FROM agent_config WHERE id=1').get()?.max_concurrent_executions).toBe(3);
    expect(db.query<{ setup_command: string | null; timeout_ms: number }, []>('SELECT setup_command, timeout_ms FROM workspace_config WHERE id=1').get()).toEqual({ setup_command: null, timeout_ms: 600000 });
    expect(db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM agent_presets').get()?.count).toBe(5);
  });

  test('seeds Agent presets once without restoring presets the user removed', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-agent-presets-'));
    initDb(root);
    getDb().exec('DELETE FROM agent_presets');
    closeDb();
    initDb(root);
    expect(getDb().query<{ count: number }, []>('SELECT COUNT(*) AS count FROM agent_presets').get()?.count).toBe(0);
  });

  test('rejects a legacy database without deleting it', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-legacy-'));
    fs.mkdirSync(path.join(root, '.flow'));
    const legacy = new Database(path.join(root, '.flow', 'tasks.db'));
    legacy.exec('CREATE TABLE tasks (id INTEGER PRIMARY KEY, status TEXT)');
    legacy.close();
    expect(() => initDb(root)).toThrow('Legacy Flow database detected');
    const verify = new Database(path.join(root, '.flow', 'tasks.db'));
    expect(verify.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM tasks').get()?.count).toBe(0);
    verify.close();
  });

  test('enforces one active run per task and one draft per flow', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-constraints-'));
    const db = initDb(root);
    db.exec("INSERT INTO project_config (id,task_prefix,repo_name) VALUES (1,'TST','test'); INSERT INTO tasks(task_key,title) VALUES('TST-1','Task'); INSERT INTO flows(name,is_default) VALUES('Flow',1);");
    const definition = JSON.stringify({ schemaVersion: 1, nodes: [], connections: [] });
    db.query("INSERT INTO flow_versions(flow_id,version,state,definition_json) VALUES(1,1,'draft',?)").run(definition);
    expect(() => db.query("INSERT INTO flow_versions(flow_id,version,state,definition_json) VALUES(1,2,'draft',?)").run(definition)).toThrow();
  });
});
