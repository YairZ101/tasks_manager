import { Hono } from 'hono';
import { getDb } from '../db/database.js';
import { emitEvent, emitTask } from '../flow/events.js';
import { getTask, getTaskWithState, listTaskLinks, listTasks } from '../flow/repository.js';
import { startRun } from '../flow/engine.js';
import { cleanupWorkspace, inspectWorkspace } from '../flow/workspaces.js';
import type { ProjectConfig, WorkflowRun, Workspace } from '../types.js';

const tasks = new Hono();

function idFrom(value: string): number | null {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

type TaskLinkInput = { task_id: number; relationship: 'blocks' | 'is_blocked_by' | 'relates_to' };

function parseTaskLinks(value: unknown): TaskLinkInput[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const links = value.map((candidate) => {
    if (!candidate || typeof candidate !== 'object') return null;
    const item = candidate as Record<string, unknown>;
    const taskId = item.task_id;
    const relationship = item.relationship;
    return typeof taskId === 'number' && Number.isInteger(taskId) && taskId > 0
      && (relationship === 'blocks' || relationship === 'is_blocked_by' || relationship === 'relates_to')
      ? { task_id: taskId, relationship }
      : null;
  });
  if (links.some((link) => link === null)) return null;
  const unique = new Map<string, TaskLinkInput>();
  for (const link of links as TaskLinkInput[]) unique.set(`${link.task_id}:${link.relationship}`, link);
  return [...unique.values()];
}

function linkTargetsExist(links: TaskLinkInput[], database = getDb()): boolean {
  const ids = [...new Set(links.map((link) => link.task_id))];
  if (!ids.length) return true;
  const placeholders = ids.map(() => '?').join(', ');
  const rows = database.query<{ id: number }, number[]>(`SELECT id FROM tasks WHERE id IN (${placeholders})`).all(...ids);
  return rows.length === ids.length;
}

function parsePreferredFlowId(value: unknown): number | null | 'invalid' {
  if (value === undefined || value === null) return null;
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 'invalid';
}

function hasPublishedFlow(flowId: number, database = getDb()): boolean {
  return Boolean(database.query<{ active_version_id: number | null }, [number]>('SELECT active_version_id FROM flows WHERE id = ?').get(flowId)?.active_version_id);
}

function replaceTaskLinks(taskId: number, links: TaskLinkInput[], database = getDb()): void {
  database.query('DELETE FROM task_links WHERE source_task_id = ? OR target_task_id = ?').run(taskId, taskId);
  const insert = database.query('INSERT OR IGNORE INTO task_links (source_task_id, target_task_id, link_type) VALUES (?, ?, ?)');
  for (const link of links) {
    if (link.relationship === 'blocks') insert.run(taskId, link.task_id, 'blocks');
    else if (link.relationship === 'is_blocked_by') insert.run(link.task_id, taskId, 'blocks');
    else insert.run(Math.min(taskId, link.task_id), Math.max(taskId, link.task_id), 'relates_to');
  }
}

tasks.get('/', (c) => {
  const state = c.req.query('state');
  if (state && !['backlog', 'active', 'attention', 'finished'].includes(state)) return c.json({ error: 'Invalid operational state.' }, 400);
  return c.json({ tasks: listTasks({ q: c.req.query('q'), state }) });
});

tasks.post('/', async (c) => {
  const db = getDb();
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return c.json({ error: 'Invalid JSON.' }, 400);
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > 500) return c.json({ error: 'Title is required and must be at most 500 characters.' }, 400);
  const description = typeof body.description === 'string' ? body.description : '';
  const acceptance = typeof body.acceptance === 'string' ? body.acceptance : '';
  if (description.length > 50_000 || acceptance.length > 50_000) return c.json({ error: 'Description and acceptance criteria must be at most 50,000 characters.' }, 400);
  const taskLinks = parseTaskLinks(body.task_links);
  if (!taskLinks) return c.json({ error: 'task_links must be an array of typed task links.' }, 400);
  if (!linkTargetsExist(taskLinks, db)) return c.json({ error: 'One or more linked tasks do not exist.' }, 400);
  const preferredFlowId = parsePreferredFlowId(body.preferred_flow_id);
  if (preferredFlowId === 'invalid') return c.json({ error: 'preferred_flow_id must be a published Flow ID or null.' }, 400);
  if (preferredFlowId && !hasPublishedFlow(preferredFlowId, db)) return c.json({ error: 'Choose a Flow with a published version.' }, 400);
  const config = db.query<ProjectConfig, []>('SELECT * FROM project_config WHERE id = 1').get();
  if (!config) return c.json({ error: 'Project not initialized.' }, 409);

  const taskId = db.transaction(() => {
    const sequence = db.query<{ value: number }, []>(
      'UPDATE project_config SET next_task_number = next_task_number + 1 WHERE id = 1 RETURNING next_task_number - 1 AS value'
    ).get()!.value;
    const order = db.query<{ value: number }, []>("SELECT COALESCE(MAX(sort_order), 0) + 1 AS value FROM tasks WHERE resolution = 'open'").get()!.value;
    const result = db.query(
      'INSERT INTO tasks (task_key, title, description, acceptance, preferred_flow_id, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(`${config.task_prefix}-${sequence}`, title, description, acceptance, preferredFlowId, order);
    const id = Number(result.lastInsertRowid);
    replaceTaskLinks(id, taskLinks, db);
    return id;
  })();
  emitTask(taskId);
  let run: WorkflowRun | undefined;
  if (body.run === true) run = await startRun(taskId, typeof body.flow_id === 'number' ? body.flow_id : undefined);
  return c.json({ task: getTaskWithState(taskId), links: listTaskLinks(taskId), run }, 201);
});

tasks.get('/:id', (c) => {
  const id = idFrom(c.req.param('id'));
  if (!id) return c.json({ error: 'Invalid task ID.' }, 400);
  const task = getTaskWithState(id);
  return task ? c.json({ task, links: listTaskLinks(id) }) : c.json({ error: 'Task not found.' }, 404);
});

tasks.patch('/:id', async (c) => {
  const db = getDb();
  const id = idFrom(c.req.param('id'));
  if (!id) return c.json({ error: 'Invalid task ID.' }, 400);
  const current = getTask(id);
  if (!current) return c.json({ error: 'Task not found.' }, 404);
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return c.json({ error: 'Invalid JSON.' }, 400);
  const taskLinks = body.task_links === undefined ? null : parseTaskLinks(body.task_links);
  if (body.task_links !== undefined && !taskLinks) return c.json({ error: 'task_links must be an array of typed task links.' }, 400);
  if (taskLinks?.some((link) => link.task_id === id)) return c.json({ error: 'A task cannot link to itself.' }, 400);
  if (taskLinks && !linkTargetsExist(taskLinks, db)) return c.json({ error: 'One or more linked tasks do not exist.' }, 400);
  const preferredFlowId = body.preferred_flow_id === undefined ? undefined : parsePreferredFlowId(body.preferred_flow_id);
  if (preferredFlowId === 'invalid') return c.json({ error: 'preferred_flow_id must be a published Flow ID or null.' }, 400);
  if (typeof preferredFlowId === 'number' && !hasPublishedFlow(preferredFlowId, db)) return c.json({ error: 'Choose a Flow with a published version.' }, 400);
  const active = db.query<{ id: number }, [number]>("SELECT id FROM runs WHERE task_id = ? AND status IN ('queued','running','waiting','attention')").get(id);
  if (active && body.resolution !== undefined) return c.json({ error: 'Stop the active Run before changing task state.' }, 409);
  const updates: string[] = [];
  const params: unknown[] = [];
  for (const field of ['title', 'description', 'acceptance'] as const) {
    if (body[field] !== undefined) {
      if (typeof body[field] !== 'string') return c.json({ error: `${field} must be a string.` }, 400);
      const value = field === 'title' ? body[field].trim() : body[field];
      if (field === 'title' && !value) return c.json({ error: 'Title cannot be empty.' }, 400);
      updates.push(`${field} = ?`); params.push(value);
    }
  }
  if (body.resolution !== undefined) {
    if (!['open', 'completed', 'cancelled'].includes(String(body.resolution))) return c.json({ error: 'Invalid resolution.' }, 400);
    updates.push('resolution = ?'); params.push(body.resolution);
  }
  if (body.sort_order !== undefined) {
    if (typeof body.sort_order !== 'number' || !Number.isFinite(body.sort_order)) return c.json({ error: 'sort_order must be a finite number.' }, 400);
    updates.push('sort_order = ?'); params.push(body.sort_order);
  }
  if (preferredFlowId !== undefined) {
    updates.push('preferred_flow_id = ?'); params.push(preferredFlowId);
  }
  db.transaction(() => {
    if (updates.length) db.query(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...params, id);
    if (taskLinks) replaceTaskLinks(id, taskLinks, db);
  })();
  emitTask(id);
  return c.json({ task: getTaskWithState(id), links: listTaskLinks(id) });
});

tasks.delete('/:id', async (c) => {
  const db = getDb();
  const id = idFrom(c.req.param('id'));
  if (!id) return c.json({ error: 'Invalid task ID.' }, 400);
  if (!getTask(id)) return c.json({ error: 'Task not found.' }, 404);
  const active = db.query<{ id: number }, [number]>("SELECT id FROM runs WHERE task_id = ? AND status IN ('queued','running','waiting','attention')").get(id);
  if (active) return c.json({ error: 'Stop the active Run before deleting this task.' }, 409);
  const workspace = db.query<Workspace, [number]>("SELECT * FROM workspaces WHERE task_id = ? AND state != 'removed' ORDER BY id DESC LIMIT 1").get(id);
  const force = c.req.query('force') === 'true';
  if (workspace) {
    const inspection = await inspectWorkspace(workspace);
    if (inspection.dirty && !force) return c.json({ error: `Workspace has uncommitted changes (${inspection.summary}).`, reason: 'workspace_dirty', workspaceId: workspace.id }, 409);
    await cleanupWorkspace(workspace.id, force);
  }
  db.query('DELETE FROM tasks WHERE id = ?').run(id);
  emitEvent('task:deleted', { taskId: id }, 'task', id);
  return c.body(null, 204);
});

export default tasks;
