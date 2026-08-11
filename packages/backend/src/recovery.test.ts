import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { closeDb, getDb, initDb } from './db/database.js';
import { runCrashRecovery } from './recovery.js';

let root = '';
afterEach(() => { closeDb(); if (root) fs.rmSync(root, { recursive: true, force: true }); });

describe('run recovery', () => {
  test('marks running Attempts interrupted and leaves queued work queued', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-recovery-'));
    const db = initDb(root);
    db.exec(`
      INSERT INTO tasks(task_key,title) VALUES('TST-1','Task');
      INSERT INTO flows(name,is_default) VALUES('Flow',1);
      INSERT INTO flow_versions(flow_id,version,state,definition_json,compiled_json) VALUES(1,1,'published','{}','{}');
      INSERT INTO runs(task_id,flow_version_id,status) VALUES(1,1,'running');
      INSERT INTO attempts(run_id,block_id,sequence,block_attempt,status) VALUES(1,'agent',1,1,'running');
      INSERT INTO attempts(run_id,block_id,sequence,block_attempt,status) VALUES(1,'next',2,1,'queued');
    `);
    expect(runCrashRecovery()).toBe(1);
    expect(getDb().query<{ status: string }, []>('SELECT status FROM runs WHERE id=1').get()?.status).toBe('attention');
    expect(getDb().query<{ status: string }, []>('SELECT status FROM attempts WHERE id=1').get()?.status).toBe('interrupted');
    expect(getDb().query<{ status: string }, []>('SELECT status FROM attempts WHERE id=2').get()?.status).toBe('queued');
  });

  test('marks a running Workspace preparation interrupted', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-preparation-recovery-'));
    const db = initDb(root);
    db.exec(`
      INSERT INTO tasks(task_key,title) VALUES('TST-1','Task');
      INSERT INTO flows(name,is_default) VALUES('Flow',1);
      INSERT INTO flow_versions(flow_id,version,state,definition_json,compiled_json) VALUES(1,1,'published','{}','{}');
      INSERT INTO workspaces(task_id,repo_root,worktree_path,state) VALUES(1,'${root.replaceAll("'", "''")}', '${root.replaceAll("'", "''")}', 'active');
      INSERT INTO runs(task_id,flow_version_id,workspace_id,status) VALUES(1,1,1,'queued');
      INSERT INTO workspace_preparations(workspace_id,run_id,sequence,command,status) VALUES(1,1,1,'bun install','running');
    `);
    expect(runCrashRecovery()).toBe(1);
    expect(db.query<{ status: string }, []>('SELECT status FROM runs WHERE id=1').get()?.status).toBe('attention');
    expect(db.query<{ status: string }, []>('SELECT status FROM workspace_preparations WHERE id=1').get()?.status).toBe('interrupted');
  });
});
