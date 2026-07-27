import { Hono } from 'hono';
import { compileFlow, createRecommendedFlow, validateFlow, type FlowDefinition } from '@tasks-manager/flow-core';
import { getDb } from '../db/database.js';
import { emitEvent } from '../flow/events.js';
import { getFlowVersion, parseFlowVersion } from '../flow/repository.js';
import type { Flow, FlowVersionRow } from '../types.js';

const flows = new Hono();

flows.get('/', (c) => {
  const db = getDb();
  const rows = db.query<Flow, []>('SELECT * FROM flows ORDER BY is_default DESC, name ASC').all();
  return c.json({ flows: rows.map((flow) => ({ ...flow, activeVersion: flow.active_version_id ? getFlowVersion(flow.active_version_id) : null })) });
});

flows.post('/', async (c) => {
  const db = getDb();
  const body = await c.req.json().catch(() => ({})) as { name?: string; definition?: FlowDefinition };
  const name = body.name?.trim();
  if (!name || name.length > 200) return c.json({ error: 'Flow name is required and must be at most 200 characters.' }, 400);
  const definition = body.definition ?? createRecommendedFlow();
  const result = db.transaction(() => {
    const inserted = db.query('INSERT INTO flows (name, is_default) VALUES (?, ?)').run(name, 0);
    const flowId = Number(inserted.lastInsertRowid);
    const draft = db.query("INSERT INTO flow_versions (flow_id, version, state, definition_json) VALUES (?, 1, 'draft', ?)").run(flowId, JSON.stringify(definition));
    return { flowId, draftId: Number(draft.lastInsertRowid) };
  })();
  emitEvent('flow:changed', { flowId: result.flowId }, 'flow', result.flowId);
  return c.json({ flow: db.query<Flow, [number]>('SELECT * FROM flows WHERE id = ?').get(result.flowId), draft: getFlowVersion(result.draftId) }, 201);
});

flows.get('/:id', (c) => {
  const db = getDb();
  const id = Number(c.req.param('id'));
  const flow = db.query<Flow, [number]>('SELECT * FROM flows WHERE id = ?').get(id);
  if (!flow) return c.json({ error: 'Flow not found.' }, 404);
  const versions = db.query<FlowVersionRow, [number]>('SELECT * FROM flow_versions WHERE flow_id = ? ORDER BY version DESC, state ASC').all(id).map(parseFlowVersion);
  return c.json({ flow, versions });
});

flows.get('/:id/draft', (c) => {
  const db = getDb();
  const id = Number(c.req.param('id'));
  let row = db.query<FlowVersionRow, [number]>("SELECT * FROM flow_versions WHERE flow_id = ? AND state = 'draft'").get(id);
  if (!row) {
    const flow = db.query<Flow, [number]>('SELECT * FROM flows WHERE id = ?').get(id);
    if (!flow) return c.json({ error: 'Flow not found.' }, 404);
    const source = flow.active_version_id ? getFlowVersion(flow.active_version_id) : null;
    const next = db.query<{ value: number }, [number]>('SELECT COALESCE(MAX(version), 0) + 1 AS value FROM flow_versions WHERE flow_id = ?').get(id)!.value;
    const inserted = db.query("INSERT INTO flow_versions (flow_id, version, state, definition_json) VALUES (?, ?, 'draft', ?)").run(id, next, JSON.stringify(source?.definition ?? createRecommendedFlow()));
    row = db.query<FlowVersionRow, [number]>('SELECT * FROM flow_versions WHERE id = ?').get(Number(inserted.lastInsertRowid))!;
  }
  return c.json({ draft: parseFlowVersion(row), validation: validateFlow(JSON.parse(row.definition_json)) });
});

flows.put('/:id/draft', async (c) => {
  const db = getDb();
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => null) as { definition?: FlowDefinition; revision?: number } | null;
  if (!body?.definition || !Number.isInteger(body.revision)) return c.json({ error: 'definition and revision are required.' }, 400);
  const validation = validateFlow(body.definition);
  const updated = db.query("UPDATE flow_versions SET definition_json = ?, draft_revision = draft_revision + 1 WHERE flow_id = ? AND state = 'draft' AND draft_revision = ?")
    .run(JSON.stringify(body.definition), id, body.revision!);
  if (!updated.changes) return c.json({ error: 'This draft changed elsewhere. Reload before saving again.', reason: 'revision_conflict' }, 409);
  const row = db.query<FlowVersionRow, [number]>("SELECT * FROM flow_versions WHERE flow_id = ? AND state = 'draft'").get(id)!;
  emitEvent('flow:changed', { flowId: id, revision: row.draft_revision }, 'flow', id);
  return c.json({ draft: parseFlowVersion(row), validation });
});

flows.post('/:id/publish', (c) => {
  const db = getDb();
  const id = Number(c.req.param('id'));
  const draft = db.query<FlowVersionRow, [number]>("SELECT * FROM flow_versions WHERE flow_id = ? AND state = 'draft'").get(id);
  if (!draft) return c.json({ error: 'Flow has no draft to publish.' }, 409);
  const definition = JSON.parse(draft.definition_json) as FlowDefinition;
  const validation = validateFlow(definition);
  if (!validation.valid) return c.json({ error: 'Fix Flow validation problems before publishing.', problems: validation.problems }, 422);
  const compiled = compileFlow(definition);
  db.transaction(() => {
    db.query("UPDATE flow_versions SET state = 'published', compiled_json = ?, published_at = datetime('now') WHERE id = ?").run(JSON.stringify(compiled), draft.id);
    db.query('UPDATE flows SET active_version_id = ? WHERE id = ?').run(draft.id, id);
    const defaultCount = db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM flows WHERE is_default = 1').get()!.count;
    if (!defaultCount) db.query('UPDATE flows SET is_default = 1 WHERE id = ?').run(id);
  })();
  emitEvent('flow:published', { flowId: id, versionId: draft.id }, 'flow', id);
  return c.json({ version: getFlowVersion(draft.id) });
});

flows.post('/:id/default', (c) => {
  const db = getDb();
  const id = Number(c.req.param('id'));
  const flow = db.query<Flow, [number]>('SELECT * FROM flows WHERE id = ?').get(id);
  if (!flow?.active_version_id) return c.json({ error: 'Only a published Flow can be the default.' }, 409);
  db.transaction(() => {
    db.query('UPDATE flows SET is_default = 0 WHERE is_default = 1').run();
    db.query('UPDATE flows SET is_default = 1 WHERE id = ?').run(id);
  })();
  emitEvent('flow:changed', { flowId: id }, 'flow', id);
  return c.json({ flow: db.query<Flow, [number]>('SELECT * FROM flows WHERE id = ?').get(id) });
});

export default flows;
