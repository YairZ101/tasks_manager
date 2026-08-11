import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { closeDb, getDb, initDb } from '../db/database.js';
import { createApp } from '../app.js';
import { compileFlow, createBlankFlow, createMinimalFlow, createRecommendedFlow } from '@flow/core';
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
  test('creates new Flows with the blank canvas template', async () => {
    const created = await app.request('/flows', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Blank delivery' }) });
    expect(created.status).toBe(201);
    const { flow, draft } = await created.json() as any;
    expect(flow).toMatchObject({ name: 'Blank delivery', active_version_id: null });
    expect(draft.definition).toEqual(createBlankFlow());
  });

  test('duplicates a Flow from its current draft into a new editable Flow', async () => {
    const source = getDb().query<{ id: number }, []>("SELECT id FROM flows WHERE name = 'Default'").get()!;
    const sourceDraft = (await (await app.request(`/flows/${source.id}/draft`)).json() as any).draft;
    const definition = createRecommendedFlow();
    const saved = await app.request(`/flows/${source.id}/draft`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ definition, revision: sourceDraft.draft_revision }),
    });
    expect(saved.status).toBe(200);

    const duplicated = await app.request(`/flows/${source.id}/duplicate`, { method: 'POST' });
    expect(duplicated.status).toBe(201);
    const { flow, draft } = await duplicated.json() as any;
    expect(flow).toMatchObject({ name: 'Copy of Default', is_default: 0, active_version_id: null });
    expect(draft).toMatchObject({ flow_id: flow.id, version: 1, state: 'draft', definition });
    expect((await app.request(`/flows/${flow.id}`)).status).toBe(200);
    const listed = await app.request('/flows');
    const listedCopy = (await listed.json() as any).flows.find((candidate: any) => candidate.id === flow.id);
    expect(listedCopy.draftVersion).toMatchObject({ id: draft.id, definition });
    expect((await app.request('/flows/99999/duplicate', { method: 'POST' })).status).toBe(404);
  });

  test('renames a Flow and validates its name', async () => {
    const flow = getDb().query<{ id: number }, []>("SELECT id FROM flows WHERE name = 'Default'").get()!;
    const renamed = await app.request(`/flows/${flow.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '  Release train  ' }) });
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({ flow: { id: flow.id, name: 'Release train' } });

    const invalid = await app.request(`/flows/${flow.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '   ' }) });
    expect(invalid.status).toBe(400);

    const tooLong = await app.request(`/flows/${flow.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'a'.repeat(201) }) });
    expect(tooLong.status).toBe(400);
    expect((await app.request('/flows/99999', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Missing Flow' }) })).status).toBe(404);
  });

  test('activates an older published version without removing newer versions or the draft', async () => {
    const db = getDb();
    const flow = db.query<{ id: number; active_version_id: number }, []>("SELECT id, active_version_id FROM flows WHERE name = 'Default'").get()!;
    const firstVersionId = flow.active_version_id;
    const definition = createMinimalFlow();
    const second = db.query("INSERT INTO flow_versions(flow_id,version,state,definition_json,compiled_json,published_at) VALUES(?,2,'published',?,?,datetime('now'))")
      .run(flow.id, JSON.stringify(definition), JSON.stringify(compileFlow(definition)));
    const secondVersionId = Number(second.lastInsertRowid);
    const draft = db.query("INSERT INTO flow_versions(flow_id,version,state,definition_json) VALUES(?,3,'draft',?)")
      .run(flow.id, JSON.stringify(definition));
    db.query('UPDATE flows SET active_version_id = ? WHERE id = ?').run(secondVersionId, flow.id);

    const activated = await app.request(`/flows/${flow.id}/versions/${firstVersionId}/activate`, { method: 'POST' });
    expect(activated.status).toBe(200);
    expect(await activated.json()).toMatchObject({
      flow: { id: flow.id, active_version_id: firstVersionId },
      version: { id: firstVersionId, version: 1, state: 'published' },
    });

    const detail = await app.request(`/flows/${flow.id}`);
    expect((await detail.json() as any).versions.map((version: any) => ({ id: version.id, version: version.version, state: version.state }))).toEqual([
      { id: Number(draft.lastInsertRowid), version: 3, state: 'draft' },
      { id: secondVersionId, version: 2, state: 'published' },
      { id: firstVersionId, version: 1, state: 'published' },
    ]);

    const task = await app.request('/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Use restored version' }) });
    const taskId = (await task.json() as any).task.id;
    const started = await app.request('/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task_id: taskId, flow_id: flow.id }) });
    expect(started.status).toBe(201);
    expect((await started.json() as any).run.flow_version_id).toBe(firstVersionId);

    const rejectedDraft = await app.request(`/flows/${flow.id}/versions/${Number(draft.lastInsertRowid)}/activate`, { method: 'POST' });
    expect(rejectedDraft.status).toBe(409);
    expect(await rejectedDraft.json()).toMatchObject({ reason: 'version_not_published' });
    expect((await app.request(`/flows/${flow.id}/versions/99999/activate`, { method: 'POST' })).status).toBe(404);
  });

  test('deletes an unused non-default Flow and protects default or used Flows', async () => {
    const created = await app.request('/flows', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Disposable' }) });
    const disposable = (await created.json() as any).flow;
    expect((await app.request(`/flows/${disposable.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await app.request(`/flows/${disposable.id}`)).status).toBe(404);

    const defaultFlow = getDb().query<{ id: number }, []>('SELECT id FROM flows WHERE is_default = 1').get()!;
    const defaultResponse = await app.request(`/flows/${defaultFlow.id}`, { method: 'DELETE' });
    expect(defaultResponse.status).toBe(409);
    expect(await defaultResponse.json()).toMatchObject({ reason: 'default_flow' });

    const db = getDb();
    const used = db.query("INSERT INTO flows(name) VALUES('Used')").run();
    const usedId = Number(used.lastInsertRowid);
    const definition = createMinimalFlow();
    const version = db.query("INSERT INTO flow_versions(flow_id,version,state,definition_json,compiled_json,published_at) VALUES(?,1,'published',?,?,datetime('now'))").run(usedId, JSON.stringify(definition), JSON.stringify(compileFlow(definition)));
    db.query('INSERT INTO tasks(task_key,title) VALUES(?,?)').run('TST-99', 'Historical task');
    const taskId = db.query<{ id: number }, []>("SELECT id FROM tasks WHERE task_key = 'TST-99'").get()!.id;
    db.query("INSERT INTO runs(task_id,flow_version_id,status) VALUES(?,?,'finished')").run(taskId, Number(version.lastInsertRowid));
    const usedResponse = await app.request(`/flows/${usedId}`, { method: 'DELETE' });
    expect(usedResponse.status).toBe(409);
    expect(await usedResponse.json()).toMatchObject({ reason: 'flow_has_runs' });
  });

  test('creates and lists open tasks in Backlog', async () => {
    const created = await app.request('/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Ship graph' }) });
    expect(created.status).toBe(201);
    const task = (await created.json() as any).task;
    expect(task.task_key).toBe('TST-1');
    expect(task.operational_state).toBe('backlog');
    const listed = await app.request('/tasks?state=backlog');
    expect((await listed.json() as any).tasks).toHaveLength(1);
    expect((await app.request('/tasks?state=ready')).status).toBe(400);
  });

  test('creates a task and starts the selected Flow in one request', async () => {
    const db = getDb();
    const definition = createMinimalFlow();
    const alternate = db.query("INSERT INTO flows(name) VALUES('Focused delivery')").run();
    const alternateId = Number(alternate.lastInsertRowid);
    const version = db.query("INSERT INTO flow_versions(flow_id,version,state,definition_json,compiled_json,published_at) VALUES(?,1,'published',?,?,datetime('now'))")
      .run(alternateId, JSON.stringify(definition), JSON.stringify(compileFlow(definition)));
    const versionId = Number(version.lastInsertRowid);
    db.query('UPDATE flows SET active_version_id = ? WHERE id = ?').run(versionId, alternateId);

    const response = await app.request('/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Ship the focused delivery', run: true, flow_id: alternateId }),
    });

    expect(response.status).toBe(201);
    const { task, run } = await response.json() as any;
    expect(run).toMatchObject({ task_id: task.id, flow_version_id: versionId });
    expect(task).toMatchObject({ active_run_id: run.id, resolution: 'open' });
  });

  test('persists a task Flow preference and uses it when starting a Run', async () => {
    const db = getDb();
    const definition = createMinimalFlow();
    const alternate = db.query("INSERT INTO flows(name) VALUES('Focused delivery')").run();
    const alternateId = Number(alternate.lastInsertRowid);
    const version = db.query("INSERT INTO flow_versions(flow_id,version,state,definition_json,compiled_json,published_at) VALUES(?,1,'published',?,?,datetime('now'))")
      .run(alternateId, JSON.stringify(definition), JSON.stringify(compileFlow(definition)));
    const versionId = Number(version.lastInsertRowid);
    db.query('UPDATE flows SET active_version_id = ? WHERE id = ?').run(versionId, alternateId);
    const created = await app.request('/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Use the focused delivery Flow' }) });
    const taskId = (await created.json() as any).task.id;
    const updated = await app.request(`/tasks/${taskId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ preferred_flow_id: alternateId }) });
    expect(updated.status).toBe(200);
    expect((await updated.json() as any).task).toMatchObject({ preferred_flow_id: alternateId });
    const started = await app.request('/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task_id: taskId }) });
    expect(started.status).toBe(201);
    expect((await started.json() as any).run).toMatchObject({ flow_version_id: versionId });
  });

  test('stores typed task links once and presents each task perspective', async () => {
    const prerequisite = await app.request('/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Create the API contract' }) });
    const prerequisiteTask = (await prerequisite.json() as any).task;
    const created = await app.request('/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Build the client', task_links: [{ task_id: prerequisiteTask.id, relationship: 'is_blocked_by' }] }) });
    expect(created.status).toBe(201);
    const body = await created.json() as any;
    expect(body.links).toEqual([expect.objectContaining({ linked_task_id: prerequisiteTask.id, relationship: 'is_blocked_by', task_key: prerequisiteTask.task_key, title: 'Create the API contract' })]);

    const detail = await app.request(`/tasks/${body.task.id}`);
    expect(await detail.json()).toMatchObject({ links: [expect.objectContaining({ linked_task_id: prerequisiteTask.id, relationship: 'is_blocked_by' })] });
    const inverse = await app.request(`/tasks/${prerequisiteTask.id}`);
    expect(await inverse.json()).toMatchObject({ links: [expect.objectContaining({ linked_task_id: body.task.id, relationship: 'blocks' })] });
    const replaced = await app.request(`/tasks/${body.task.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task_links: [{ task_id: prerequisiteTask.id, relationship: 'relates_to' }] }) });
    expect(replaced.status).toBe(200);
    expect(await replaced.json()).toMatchObject({ links: [expect.objectContaining({ linked_task_id: prerequisiteTask.id, relationship: 'relates_to' })] });
    const cleared = await app.request(`/tasks/${body.task.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task_links: [] }) });
    expect(cleared.status).toBe(200);
    expect((await cleared.json() as any).links).toEqual([]);
    const self = await app.request(`/tasks/${body.task.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task_links: [{ task_id: body.task.id, relationship: 'blocks' }] }) });
    expect(self.status).toBe(400);
    const missing = await app.request(`/tasks/${body.task.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task_links: [{ task_id: 99999, relationship: 'relates_to' }] }) });
    expect(missing.status).toBe(400);
  });

  test('uses optimistic revisions and refuses an invalid publish', async () => {
    const created = await app.request('/flows', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Review flow', definition: createRecommendedFlow() }) });
    expect(created.status).toBe(201);
    const flow = (await created.json() as any).flow;
    expect(flow).toMatchObject({ name: 'Review flow', active_version_id: null });
    const draftResponse = await app.request(`/flows/${flow.id}/draft`);
    expect(draftResponse.status).toBe(200);
    const draft = (await draftResponse.json() as any).draft;
    expect(draft).toMatchObject({ flow_id: flow.id, state: 'draft', version: 1 });
    const invalid = { ...draft.definition, connections: [] };
    const save = await app.request(`/flows/${flow.id}/draft`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ definition: invalid, revision: draft.draft_revision }) });
    expect(save.status).toBe(200);
    const stale = await app.request(`/flows/${flow.id}/draft`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ definition: invalid, revision: draft.draft_revision }) });
    expect(stale.status).toBe(409);
    const publish = await app.request(`/flows/${flow.id}/publish`, { method: 'POST' });
    expect(publish.status).toBe(422);
  });

  test('persists independently timestamped actions with a Flow version', async () => {
    const flow = getDb().query<{ id: number }, []>("SELECT id FROM flows WHERE name = 'Default'").get()!;
    const draftResponse = await app.request(`/flows/${flow.id}/draft`);
    const draft = (await draftResponse.json() as any).draft;
    const actions = [
      { kind: 'added', title: 'Added Check block', blockType: 'check', timestamp: '2026-08-04T08:13:00.000Z' },
      { kind: 'changed', title: 'Changed instructions', blockType: 'agent', timestamp: '2026-08-04T08:14:32.000Z' },
    ];

    const saved = await app.request(`/flows/${flow.id}/draft`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ definition: draft.definition, revision: draft.draft_revision, actions }),
    });
    expect(saved.status).toBe(200);
    expect((await saved.json() as any).draft.action_history).toEqual(actions);

    const published = await app.request(`/flows/${flow.id}/publish`, { method: 'POST' });
    expect(published.status).toBe(200);
    expect((await published.json() as any).version.action_history).toEqual(actions);
  });

  test('rejects malformed history actions and appends each saved batch', async () => {
    const flow = getDb().query<{ id: number }, []>("SELECT id FROM flows WHERE name = 'Default'").get()!;
    const draft = (await (await app.request(`/flows/${flow.id}/draft`)).json() as any).draft;
    const malformed = await app.request(`/flows/${flow.id}/draft`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ definition: draft.definition, revision: draft.draft_revision, actions: [{ kind: 'changed', title: 'Changed instructions', blockType: 'agent', timestamp: 'not-a-timestamp' }] }),
    });
    expect(malformed.status).toBe(400);

    // Layout is not behaviour: 'moved' is not a kind the route accepts.
    const layout = await app.request(`/flows/${flow.id}/draft`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ definition: draft.definition, revision: draft.draft_revision, actions: [{ kind: 'moved', title: 'Moved Begin', blockType: 'begin', timestamp: '2026-08-04T08:13:00.000Z' }] }),
    });
    expect(layout.status).toBe(400);

    const firstEdit = { kind: 'changed', title: 'Renamed Begin to Start', blockType: 'begin', timestamp: '2026-08-04T08:13:00.000Z' };
    const firstSave = await app.request(`/flows/${flow.id}/draft`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ definition: draft.definition, revision: draft.draft_revision, actions: [firstEdit] }),
    });
    const savedDraft = (await firstSave.json() as any).draft;
    const laterEdit = { kind: 'connected', title: 'Connected Start', detail: 'completed → Planning', timestamp: '2026-08-04T08:19:12.000Z' };
    const secondSave = await app.request(`/flows/${flow.id}/draft`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ definition: draft.definition, revision: savedDraft.draft_revision, actions: [laterEdit] }),
    });
    expect(secondSave.status).toBe(200);
    expect((await secondSave.json() as any).draft.action_history).toEqual([firstEdit, laterEdit]);
  });

  test('publishes an immutable version and immediately prepares the next draft', async () => {
    const created = await app.request('/flows', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Release flow', definition: createRecommendedFlow() }) });
    const { flow } = await created.json() as any;

    const published = await app.request(`/flows/${flow.id}/publish`, { method: 'POST' });
    expect(published.status).toBe(200);
    const body = await published.json() as any;
    expect(body).toMatchObject({
      version: { flow_id: flow.id, version: 1, state: 'published' },
      draft: { flow_id: flow.id, version: 2, state: 'draft', draft_revision: 1, definition: createRecommendedFlow() },
    });

    const detail = await app.request(`/flows/${flow.id}`);
    expect((await detail.json() as any).versions.map((version: any) => ({ version: version.version, state: version.state }))).toEqual([
      { version: 2, state: 'draft' },
      { version: 1, state: 'published' },
    ]);
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
    const task = await app.request('/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Review me' }) });
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

  test('lists, creates, updates, and deletes Agent presets', async () => {
    const listed = await app.request('/agent-presets');
    expect(listed.status).toBe(200);
    expect((await listed.json() as any).presets).toEqual(expect.arrayContaining([
      expect.objectContaining({ preset_key: 'development', name: 'Development', system_prompt: expect.stringContaining('Implement the task') }),
    ]));

    const created = await app.request('/agent-presets', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Release Engineer', description: 'Prepares a release.', system_prompt: 'Prepare and verify the release.' }),
    });
    expect(created.status).toBe(201);
    const preset = (await created.json() as any).preset;
    expect(preset).toMatchObject({ preset_key: 'release-engineer', name: 'Release Engineer' });
    expect(preset).not.toHaveProperty('effect_level');

    const updated = await app.request(`/agent-presets/${preset.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ system_prompt: 'Prepare, verify, and publish the release.' }),
    });
    expect(updated.status).toBe(200);
    expect((await updated.json() as any).preset.system_prompt).toBe('Prepare, verify, and publish the release.');
    expect((await app.request(`/agent-presets/${preset.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await app.request(`/agent-presets/${preset.id}`, { method: 'DELETE' })).status).toBe(404);
  });

  test('validates required Agent preset configuration', async () => {
    const response = await app.request('/agent-presets', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Incomplete', description: '', system_prompt: '' }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('System prompt') });
  });

  test('refuses to delete an Agent that a Flow still uses, and names the Flows', async () => {
    // Create a Flow whose draft references the Development agent.
    const definition = { schemaVersion: 1, nodes: [{ id: 'a', type: 'agent', typeVersion: 1, position: { x: 0, y: 0 }, config: { name: 'Dev', preset: 'development' } }], connections: [] };
    const flow = await app.request('/flows', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Uses agents', definition }) });
    expect(flow.status).toBe(201);
    const development = (await (await app.request('/agent-presets')).json() as any).presets.find((preset: any) => preset.preset_key === 'development');

    const blocked = await app.request(`/agent-presets/${development.id}`, { method: 'DELETE' });
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ reason: 'agent_in_use', flows: expect.arrayContaining(['Uses agents']) });
    // The agent is untouched after the blocked delete.
    expect(getDb().query<{ count: number }, [number]>('SELECT COUNT(*) AS count FROM agent_presets WHERE id = ?').get(development.id)?.count).toBe(1);
  });
});
