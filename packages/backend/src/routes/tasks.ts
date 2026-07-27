import { Hono } from 'hono';
import { getDb } from '../db/database.js';
import { emitEvent, emitTask } from '../flow/events.js';
import { getTask, getTaskWithState, listTasks } from '../flow/repository.js';
import { startRun } from '../flow/engine.js';
import { cleanupWorkspace, inspectWorkspace } from '../flow/workspaces.js';
import type { ProjectConfig, WorkflowRun, Workspace } from '../types.js';

const tasks = new Hono();

function idFrom(value: string): number | null {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

tasks.get('/', (c) => {
  const state = c.req.query('state');
  if (state && !['backlog', 'ready', 'active', 'attention', 'finished'].includes(state)) return c.json({ error: 'Invalid operational state.' }, 400);
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
  const queueState = body.queue_state === 'ready' || body.run === true ? 'ready' : 'backlog';
  const config = db.query<ProjectConfig, []>('SELECT * FROM project_config WHERE id = 1').get();
  if (!config) return c.json({ error: 'Project not initialized.' }, 409);

  const taskId = db.transaction(() => {
    const sequence = db.query<{ value: number }, []>(
      'UPDATE project_config SET next_task_number = next_task_number + 1 WHERE id = 1 RETURNING next_task_number - 1 AS value'
    ).get()!.value;
    const order = db.query<{ value: number }, [string]>('SELECT COALESCE(MAX(sort_order), 0) + 1 AS value FROM tasks WHERE queue_state = ? AND resolution = \'open\'').get(queueState)!.value;
    const result = db.query(
      'INSERT INTO tasks (task_key, title, description, acceptance, queue_state, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(`${config.task_prefix}-${sequence}`, title, description, acceptance, queueState, order);
    return Number(result.lastInsertRowid);
  })();
  emitTask(taskId);
  let run: WorkflowRun | undefined;
  if (body.run === true) run = await startRun(taskId, typeof body.flow_id === 'number' ? body.flow_id : undefined);
  return c.json({ task: getTaskWithState(taskId), run }, 201);
});

tasks.get('/:id', (c) => {
  const id = idFrom(c.req.param('id'));
  if (!id) return c.json({ error: 'Invalid task ID.' }, 400);
  const task = getTaskWithState(id);
  return task ? c.json({ task }) : c.json({ error: 'Task not found.' }, 404);
});

tasks.patch('/:id', async (c) => {
  const db = getDb();
  const id = idFrom(c.req.param('id'));
  if (!id) return c.json({ error: 'Invalid task ID.' }, 400);
  const current = getTask(id);
  if (!current) return c.json({ error: 'Task not found.' }, 404);
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return c.json({ error: 'Invalid JSON.' }, 400);
  const active = db.query<{ id: number }, [number]>("SELECT id FROM runs WHERE task_id = ? AND status IN ('queued','running','waiting','attention')").get(id);
  if (active && (body.queue_state !== undefined || body.resolution !== undefined)) return c.json({ error: 'Stop the active Run before changing task state.' }, 409);
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
  if (body.queue_state !== undefined) {
    if (!['backlog', 'ready'].includes(String(body.queue_state))) return c.json({ error: 'queue_state must be backlog or ready.' }, 400);
    updates.push('queue_state = ?'); params.push(body.queue_state);
  }
  if (body.resolution !== undefined) {
    if (!['open', 'completed', 'cancelled'].includes(String(body.resolution))) return c.json({ error: 'Invalid resolution.' }, 400);
    updates.push('resolution = ?'); params.push(body.resolution);
  }
  if (body.sort_order !== undefined) {
    if (typeof body.sort_order !== 'number' || !Number.isFinite(body.sort_order)) return c.json({ error: 'sort_order must be a finite number.' }, 400);
    updates.push('sort_order = ?'); params.push(body.sort_order);
  }
  if (updates.length) db.query(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...params, id);
  emitTask(id);
  return c.json({ task: getTaskWithState(id) });
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
