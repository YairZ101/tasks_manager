import { Hono } from 'hono';
import { compileFlow, createBlankFlow, createRecommendedFlow, validateFlow, type FlowDefinition, type FlowNode } from '@flow/core';
import { getDb } from '../db/database.js';
import { emitEvent } from '../flow/events.js';
import { getFlowVersion, parseFlowVersion } from '../flow/repository.js';
import type { Flow, FlowVersionAction, FlowVersionActionKind, FlowVersionRow } from '../types.js';

const flows = new Hono();

const actionKinds = new Set<FlowVersionActionKind>(['initial', 'added', 'removed', 'changed', 'moved', 'connected', 'disconnected']);
const blockTypes = new Set<FlowNode['type']>(['begin', 'agent', 'check', 'decision', 'result', 'note']);

function parseDraftActions(actions: unknown): FlowVersionAction[] | null {
  if (actions === undefined) return [];
  if (!Array.isArray(actions)) return null;
  const parsed: FlowVersionAction[] = [];
  for (const action of actions) {
    if (!action || typeof action !== 'object') return null;
    const candidate = action as Record<string, unknown>;
    if (typeof candidate.kind !== 'string' || !actionKinds.has(candidate.kind as FlowVersionActionKind)) return null;
    if (typeof candidate.title !== 'string' || !candidate.title.trim() || candidate.title.length > 300) return null;
    if (candidate.detail !== undefined && (typeof candidate.detail !== 'string' || candidate.detail.length > 500)) return null;
    if (candidate.blockType !== undefined && (typeof candidate.blockType !== 'string' || !blockTypes.has(candidate.blockType as FlowNode['type']))) return null;
    if (typeof candidate.timestamp !== 'string' || Number.isNaN(new Date(candidate.timestamp).getTime())) return null;
    parsed.push({
      kind: candidate.kind as FlowVersionActionKind,
      title: candidate.title.trim(),
      ...(typeof candidate.detail === 'string' ? { detail: candidate.detail } : {}),
      ...(typeof candidate.blockType === 'string' ? { blockType: candidate.blockType as FlowNode['type'] } : {}),
      timestamp: new Date(candidate.timestamp).toISOString(),
    });
  }
  return parsed;
}

function appendDraftActions(history: FlowVersionAction[], actions: FlowVersionAction[]): FlowVersionAction[] {
  return actions.reduce<FlowVersionAction[]>((next, action) => {
    const previous = next.at(-1);
    if (action.kind === 'moved' && previous?.kind === 'moved' && previous.title === action.title && previous.blockType === action.blockType && new Date(action.timestamp).getTime() - new Date(previous.timestamp).getTime() < 750) {
      return [...next.slice(0, -1), action];
    }
    return [...next, action];
  }, history);
}

flows.get('/', (c) => {
  const db = getDb();
  const rows = db.query<Flow, []>('SELECT * FROM flows ORDER BY is_default DESC, name ASC').all();
  return c.json({ flows: rows.map((flow) => {
    const draft = db.query<FlowVersionRow, [number]>("SELECT * FROM flow_versions WHERE flow_id = ? AND state = 'draft'").get(flow.id);
    return {
      ...flow,
      activeVersion: flow.active_version_id ? getFlowVersion(flow.active_version_id) : null,
      draftVersion: draft ? parseFlowVersion(draft) : null,
    };
  }) });
});

flows.post('/', async (c) => {
  const db = getDb();
  const body = await c.req.json().catch(() => ({})) as { name?: string; definition?: FlowDefinition };
  const name = body.name?.trim();
  if (!name || name.length > 200) return c.json({ error: 'Flow name is required and must be at most 200 characters.' }, 400);
  const definition = body.definition ?? createBlankFlow();
  const result = db.transaction(() => {
    const inserted = db.query('INSERT INTO flows (name, is_default) VALUES (?, ?)').run(name, 0);
    const flowId = Number(inserted.lastInsertRowid);
    const draft = db.query("INSERT INTO flow_versions (flow_id, version, state, definition_json) VALUES (?, 1, 'draft', ?)").run(flowId, JSON.stringify(definition));
    return { flowId, draftId: Number(draft.lastInsertRowid) };
  })();
  emitEvent('flow:changed', { flowId: result.flowId }, 'flow', result.flowId);
  return c.json({ flow: db.query<Flow, [number]>('SELECT * FROM flows WHERE id = ?').get(result.flowId), draft: getFlowVersion(result.draftId) }, 201);
});

flows.post('/:id/duplicate', (c) => {
  const db = getDb();
  const id = Number(c.req.param('id'));
  const source = db.query<Flow, [number]>('SELECT * FROM flows WHERE id = ?').get(id);
  if (!source) return c.json({ error: 'Flow not found.' }, 404);

  const sourceDraft = db.query<FlowVersionRow, [number]>("SELECT * FROM flow_versions WHERE flow_id = ? AND state = 'draft'").get(id);
  const sourceVersion = sourceDraft ?? (source.active_version_id ? db.query<FlowVersionRow, [number]>('SELECT * FROM flow_versions WHERE id = ?').get(source.active_version_id) : null);
  const definition = sourceVersion ? sourceVersion.definition_json : JSON.stringify(createBlankFlow());
  const name = `Copy of ${source.name}`.slice(0, 200);
  const result = db.transaction(() => {
    const inserted = db.query('INSERT INTO flows (name, is_default) VALUES (?, 0)').run(name);
    const flowId = Number(inserted.lastInsertRowid);
    const draft = db.query("INSERT INTO flow_versions (flow_id, version, state, definition_json) VALUES (?, 1, 'draft', ?)").run(flowId, definition);
    return { flowId, draftId: Number(draft.lastInsertRowid) };
  })();

  emitEvent('flow:changed', { flowId: result.flowId, sourceFlowId: id, action: 'duplicated' }, 'flow', result.flowId);
  return c.json({ flow: db.query<Flow, [number]>('SELECT * FROM flows WHERE id = ?').get(result.flowId), draft: getFlowVersion(result.draftId) }, 201);
});

flows.patch('/:id', async (c) => {
  const db = getDb();
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({})) as { name?: string };
  const name = body.name?.trim();
  if (!name || name.length > 200) return c.json({ error: 'Flow name is required and must be at most 200 characters.' }, 400);
  const updated = db.query("UPDATE flows SET name = ?, updated_at = datetime('now') WHERE id = ?").run(name, id);
  if (!updated.changes) return c.json({ error: 'Flow not found.' }, 404);
  const flow = db.query<Flow, [number]>('SELECT * FROM flows WHERE id = ?').get(id)!;
  emitEvent('flow:changed', { flowId: id, action: 'renamed' }, 'flow', id);
  return c.json({ flow });
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
  const body = await c.req.json().catch(() => null) as { definition?: FlowDefinition; revision?: number; actions?: unknown } | null;
  if (!body?.definition || !Number.isInteger(body.revision)) return c.json({ error: 'definition and revision are required.' }, 400);
  const actions = parseDraftActions(body.actions);
  if (!actions) return c.json({ error: 'actions must be valid history entries.' }, 400);
  const validation = validateFlow(body.definition);
  const existing = db.query<FlowVersionRow, [number]>("SELECT * FROM flow_versions WHERE flow_id = ? AND state = 'draft'").get(id);
  if (!existing || existing.draft_revision !== body.revision) return c.json({ error: 'This draft changed elsewhere. Reload before saving again.', reason: 'revision_conflict' }, 409);
  const existingActions = JSON.parse(existing.action_history_json) as unknown;
  const actionHistory = appendDraftActions(Array.isArray(existingActions) ? existingActions as FlowVersionAction[] : [], actions).slice(-1_000);
  const updated = db.query("UPDATE flow_versions SET definition_json = ?, action_history_json = ?, draft_revision = draft_revision + 1 WHERE id = ? AND draft_revision = ?")
    .run(JSON.stringify(body.definition), JSON.stringify(actionHistory), existing.id, body.revision!);
  if (!updated.changes) return c.json({ error: 'This draft changed elsewhere. Reload before saving again.', reason: 'revision_conflict' }, 409);
  const row = db.query<FlowVersionRow, [number]>("SELECT * FROM flow_versions WHERE flow_id = ? AND state = 'draft'").get(id)!;
  emitEvent('flow:changed', { flowId: id, revision: row.draft_revision }, 'flow', id);
  return c.json({ draft: parseFlowVersion(row), validation });
});

flows.post('/:id/versions/:versionId/activate', (c) => {
  const db = getDb();
  const id = Number(c.req.param('id'));
  const versionId = Number(c.req.param('versionId'));
  const flow = db.query<Flow, [number]>('SELECT * FROM flows WHERE id = ?').get(id);
  if (!flow) return c.json({ error: 'Flow not found.' }, 404);
  const version = db.query<FlowVersionRow, [number, number]>('SELECT * FROM flow_versions WHERE id = ? AND flow_id = ?').get(versionId, id);
  if (!version) return c.json({ error: 'Flow version not found.' }, 404);
  if (version.state !== 'published' || !version.compiled_json) {
    return c.json({ error: 'Only a published Flow version can be activated.', reason: 'version_not_published' }, 409);
  }
  if (flow.active_version_id !== versionId) {
    db.query("UPDATE flows SET active_version_id = ?, updated_at = datetime('now') WHERE id = ?").run(versionId, id);
    emitEvent('flow:changed', { flowId: id, versionId, action: 'activated' }, 'flow', id);
  }
  const activeVersion = parseFlowVersion(version);
  const updatedFlow = db.query<Flow, [number]>('SELECT * FROM flows WHERE id = ?').get(id)!;
  return c.json({ flow: { ...updatedFlow, activeVersion }, version: activeVersion });
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
  const nextDraftId = db.transaction(() => {
    db.query("UPDATE flow_versions SET state = 'published', compiled_json = ?, published_at = datetime('now') WHERE id = ?").run(JSON.stringify(compiled), draft.id);
    db.query('UPDATE flows SET active_version_id = ? WHERE id = ?').run(draft.id, id);
    const nextDraft = db.query("INSERT INTO flow_versions (flow_id, version, state, definition_json) VALUES (?, ?, 'draft', ?)")
      .run(id, draft.version + 1, draft.definition_json);
    const defaultCount = db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM flows WHERE is_default = 1').get()!.count;
    if (!defaultCount) db.query('UPDATE flows SET is_default = 1 WHERE id = ?').run(id);
    return Number(nextDraft.lastInsertRowid);
  })();
  emitEvent('flow:published', { flowId: id, versionId: draft.id, draftVersionId: nextDraftId }, 'flow', id);
  return c.json({ version: getFlowVersion(draft.id), draft: getFlowVersion(nextDraftId) });
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

flows.delete('/:id', (c) => {
  const db = getDb();
  const id = Number(c.req.param('id'));
  const flow = db.query<Flow, [number]>('SELECT * FROM flows WHERE id = ?').get(id);
  if (!flow) return c.json({ error: 'Flow not found.' }, 404);
  if (flow.is_default) return c.json({ error: 'Set another published Flow as the default before deleting this one.', reason: 'default_flow' }, 409);
  const runCount = db.query<{ count: number }, [number]>('SELECT COUNT(*) AS count FROM runs INNER JOIN flow_versions ON flow_versions.id = runs.flow_version_id WHERE flow_versions.flow_id = ?').get(id)!.count;
  if (runCount) return c.json({ error: 'This Flow has run history and cannot be deleted.', reason: 'flow_has_runs' }, 409);
  db.query('DELETE FROM flows WHERE id = ?').run(id);
  emitEvent('flow:changed', { flowId: id, action: 'deleted' }, 'flow', id);
  return c.body(null, 204);
});

export default flows;
