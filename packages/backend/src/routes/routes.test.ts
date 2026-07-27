import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { closeDb, getDb, initDb } from '../db/database.js';
import { createApp } from '../app.js';
import { compileFlow, createMinimalFlow, createRecommendedFlow } from '@flow/core';
import { initEngine, shutdownEngine } from '../flow/engine.js';

let root = '';
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-routes-'));
  initDb(root);
  const db = getDb();
  db.query("INSERT INTO project_config(id,task_prefix,repo_name) VALUES(1,'TST','test')").run();
  const definition = createMinimalFlow();
  const compiled = compileFlow(definition);
  const flow = db.query("INSERT INTO flows(name,is_default) VALUES('Default',1)").run();
  const version = db.query("INSERT INTO flow_versions(flow_id,version,state,definition_json,compiled_json,published_at) VALUES(?,1,'published',?,?,datetime('now'))")
    .run(Number(flow.lastInsertRowid), JSON.stringify(definition), JSON.stringify(compiled));
  db.query('UPDATE flows SET active_version_id=? WHERE id=?').run(Number(version.lastInsertRowid), Number(flow.lastInsertRowid));
  app = createApp(root);
  initEngine(root);
});

afterEach(async () => { await shutdownEngine(); closeDb(); fs.rmSync(root, { recursive: true, force: true }); });

describe('Flow routes', () => {
  test('creates, lists, and edits tasks using queue semantics', async () => {
    const created = await app.request('/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Ship graph', queue_state: 'ready' }) });
    expect(created.status).toBe(201);
    const task = (await created.json() as any).task;
    expect(task.task_key).toBe('TST-1');
    expect(task.operational_state).toBe('ready');
    const patched = await app.request(`/tasks/${task.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ queue_state: 'backlog' }) });
    expect((await patched.json() as any).task.operational_state).toBe('backlog');
    const listed = await app.request('/tasks?state=backlog');
    expect((await listed.json() as any).tasks).toHaveLength(1);
  });

  test('uses optimistic revisions and refuses an invalid publish', async () => {
    const created = await app.request('/flows', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Review flow', definition: createRecommendedFlow() }) });
    const flow = (await created.json() as any).flow;
    const draftResponse = await app.request(`/flows/${flow.id}/draft`);
    const draft = (await draftResponse.json() as any).draft;
    const invalid = { ...draft.definition, connections: [] };
    const save = await app.request(`/flows/${flow.id}/draft`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ definition: invalid, revision: draft.draft_revision }) });
    expect(save.status).toBe(200);
    const stale = await app.request(`/flows/${flow.id}/draft`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ definition: invalid, revision: draft.draft_revision }) });
    expect(stale.status).toBe(409);
    const publish = await app.request(`/flows/${flow.id}/publish`, { method: 'POST' });
    expect(publish.status).toBe(422);
  });

  test('starts at a Decision and resolves to a Result exactly once', async () => {
    const db = getDb();
    const definition: any = {
      schemaVersion: 1,
      nodes: [
        { id: 'begin', type: 'begin', typeVersion: 1, position: { x: 0, y: 0 }, config: { name: 'Begin' } },
        { id: 'review', type: 'decision', typeVersion: 1, position: { x: 1, y: 0 }, config: { name: 'Review', choices: [{ id: 'yes', label: 'Approve', commentRequired: false, tone: 'positive' }] } },
        { id: 'done', type: 'result', typeVersion: 1, position: { x: 2, y: 0 }, config: { name: 'Completed', category: 'completed' } },
      ],
      connections: [
        { id: 'a', sourceNodeId: 'begin', sourceOutcomeId: 'started', targetNodeId: 'review' },
        { id: 'b', sourceNodeId: 'review', sourceOutcomeId: 'yes', targetNodeId: 'done' },
      ],
    };
    const compiled = compileFlow(definition);
    const flow = db.query("INSERT INTO flows(name) VALUES('Decision')").run();
    const version = db.query("INSERT INTO flow_versions(flow_id,version,state,definition_json,compiled_json,published_at) VALUES(?,1,'published',?,?,datetime('now'))")
      .run(Number(flow.lastInsertRowid), JSON.stringify(definition), JSON.stringify(compiled));
    db.query('UPDATE flows SET active_version_id=? WHERE id=?').run(Number(version.lastInsertRowid), Number(flow.lastInsertRowid));
    const task = await app.request('/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Review me', queue_state: 'ready' }) });
    const taskId = (await task.json() as any).task.id;
    const started = await app.request('/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task_id: taskId, flow_id: Number(flow.lastInsertRowid) }) });
    const run = (await started.json() as any).run;
    expect(run.status).toBe('waiting');
    db.query("UPDATE runs SET status = 'attention', reason = 'Agent needs review' WHERE id = ?").run(run.id);
    const listedTask = (await (await app.request('/tasks')).json() as any).tasks.find((candidate: any) => candidate.id === taskId);
    expect(listedTask).toMatchObject({ operational_state: 'attention', active_run_reason: 'Agent needs review' });
    db.query("UPDATE runs SET status = 'waiting', reason = NULL WHERE id = ?").run(run.id);
    const detail = await app.request(`/runs/${run.id}`);
    const attempt = (await detail.json() as any).attempts.at(-1);
    const decided = await app.request(`/runs/${run.id}/decisions/${attempt.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ outcome_id: 'yes' }) });
    expect((await decided.json() as any).run.status).toBe('finished');
    const repeated = await app.request(`/runs/${run.id}/decisions/${attempt.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ outcome_id: 'yes' }) });
    expect(repeated.status).toBe(200);
  });

  test('tests a proposed Agent command without saving it first', async () => {
    const response = await app.request('/agent-config/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cli_cmd: 'sh -c "printf OK"', cli_prompt_mode: 'argument', cli_prompt_flag: '' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, output: 'OK' });
    expect(getDb().query<{ cli_cmd: string | null }, []>('SELECT cli_cmd FROM agent_config WHERE id = 1').get()?.cli_cmd).toBeNull();
  });

  test('streams proposed Agent output to the setup screen', async () => {
    const response = await app.request('/agent-config/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ cli_cmd: 'sh -c "printf OK"', cli_prompt_mode: 'argument', cli_prompt_flag: '', stream: true }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    await expect(response.text()).resolves.toContain('event: complete');
  });

  test('initializes the agent, project, and selected Flow in one final request', async () => {
    const db = getDb();
    db.exec('DELETE FROM flow_versions; DELETE FROM flows; DELETE FROM project_config;');
    const response = await app.request('/init/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prefix: 'FLOW',
        repoName: 'flow',
        flowTemplate: 'blank',
        agent: { cli_cmd: 'codex exec --full-auto', cli_prompt_mode: 'stdin', cli_prompt_flag: '' },
      }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ projectConfig: { task_prefix: 'FLOW', repo_name: 'flow' } });
    expect(db.query<{ cli_cmd: string }, []>('SELECT cli_cmd FROM agent_config WHERE id = 1').get()?.cli_cmd).toBe('codex exec --full-auto');
    const version = db.query<{ definition_json: string }, []>("SELECT definition_json FROM flow_versions WHERE state = 'published'").get()!;
    expect(JSON.parse(version.definition_json).nodes.map((node: { type: string }) => node.type)).toEqual(['begin', 'result']);
    expect((await app.request('/status')).json()).resolves.toMatchObject({ initialized: true });
  });

  test('does not partially initialize when the final setup request is invalid', async () => {
    const db = getDb();
    db.exec('DELETE FROM flow_versions; DELETE FROM flows; DELETE FROM project_config;');
    const response = await app.request('/init/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prefix: 'FLOW', flowTemplate: 'minimal', agent: { cli_cmd: '', cli_prompt_mode: 'stdin' } }),
    });
    expect(response.status).toBe(400);
    expect(db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM project_config').get()?.count).toBe(0);
    expect(db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM flows').get()?.count).toBe(0);
  });
});
