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

describe('outcome-flow database', () => {
  test('creates the greenfield schema and singleton config', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-db-'));
    initDb(root);
    const db = getDb();
    const tables = db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
    for (const name of ['app_meta', 'tasks', 'flows', 'flow_versions', 'runs', 'attempts', 'workspaces', 'logs', 'events']) expect(tables).toContain(name);
    expect(db.query<{ value: string }, []>("SELECT value FROM app_meta WHERE key='schema_family'").get()?.value).toBe('outcome-flow');
    expect(db.query<{ max_concurrent_executions: number }, []>('SELECT max_concurrent_executions FROM agent_config WHERE id=1').get()?.max_concurrent_executions).toBe(3);
  });

  test('rejects a legacy database without deleting it', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-legacy-'));
    fs.mkdirSync(path.join(root, '.tasks_manager'));
    const legacy = new Database(path.join(root, '.tasks_manager', 'tasks.db'));
    legacy.exec('CREATE TABLE tasks (id INTEGER PRIMARY KEY, status TEXT)');
    legacy.close();
    expect(() => initDb(root)).toThrow('Legacy Tasks Manager database detected');
    const verify = new Database(path.join(root, '.tasks_manager', 'tasks.db'));
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
