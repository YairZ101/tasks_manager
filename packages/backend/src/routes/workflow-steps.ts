import { Hono } from 'hono';
import { getDb } from '../db/database.js';
import { broadcaster } from '../sse/broadcaster.js';
import { STEP_CATALOG, getDefaultConfig } from '../workflow/step-catalog.js';
import { invalidateStatusCache } from '../workflow/workflow-utils.js';
import { cancelAgent } from '../executor/executor.js';
import type { WorkflowStep, Task } from '../types.js';

const workflowSteps = new Hono();

// GET /workflow-steps — list active steps
workflowSteps.get('/', (c) => {
  const db = getDb();
  const steps = db.query<WorkflowStep, []>(
    'SELECT * FROM workflow_steps ORDER BY sort_order ASC'
  ).all();
  return c.json({ steps });
});

// GET /workflow-steps/catalog — return full catalog with active status
workflowSteps.get('/catalog', (c) => {
  const db = getDb();
  const activeSteps = db.query<{ slug: string }, []>(
    'SELECT slug FROM workflow_steps'
  ).all();
  const activeSlugs = new Set(activeSteps.map(s => s.slug));

  const catalog = STEP_CATALOG.map(entry => ({
    ...entry,
    active: activeSlugs.has(entry.slug),
  }));

  return c.json({ catalog });
});

// POST /workflow-steps — add a step from the catalog
workflowSteps.post('/', async (c) => {
  const db = getDb();
  const body = await c.req.json().catch(() => null);
  if (!body) {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const { slug, position } = body;

  if (!slug || typeof slug !== 'string') {
    return c.json({ error: 'slug is required' }, 400);
  }

  const catalogEntry = STEP_CATALOG.find(s => s.slug === slug);
  if (!catalogEntry) {
    return c.json({ error: `"${slug}" is not in the step catalog` }, 400);
  }

  // Check if already active
  const existing = db.query<{ id: number }, [string]>(
    'SELECT id FROM workflow_steps WHERE slug = ?'
  ).get(slug);
  if (existing) {
    return c.json({ error: `"${slug}" is already in the workflow` }, 400);
  }

  // Check max columns (todo + steps + done = max 10)
  const count = db.query<{ cnt: number }, []>(
    'SELECT COUNT(*) as cnt FROM workflow_steps'
  ).get();
  if ((count?.cnt ?? 0) + 1 + 2 > 10) {
    return c.json({ error: 'Maximum 10 columns (including Todo and Done)' }, 400);
  }

  // Calculate sort_order
  let sortOrder: number;
  if (typeof position === 'number' && Number.isFinite(position)) {
    sortOrder = position;
  } else {
    const maxOrder = db.query<{ max_order: number | null }, []>(
      'SELECT MAX(sort_order) as max_order FROM workflow_steps'
    ).get();
    sortOrder = (maxOrder?.max_order ?? 0) + 1.0;
  }

  // Write defaults to config at creation time
  const config = JSON.stringify(getDefaultConfig(slug));

  db.query(
    'INSERT INTO workflow_steps (slug, name, requires_review, config, sort_order) VALUES (?, ?, ?, ?, ?)'
  ).run(slug, catalogEntry.name, catalogEntry.requiresReview ? 1 : 0, config, sortOrder);

  const step = db.query<WorkflowStep, [string]>(
    'SELECT * FROM workflow_steps WHERE slug = ?'
  ).get(slug)!;

  broadcaster.broadcast('workflow:updated', { action: 'added', step });
  invalidateStatusCache();

  return c.json({ step }, 201);
});

// PATCH /workflow-steps/:id — reorder or update config
workflowSteps.patch('/:id', async (c) => {
  const db = getDb();
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) {
    return c.json({ error: 'Invalid step ID' }, 400);
  }

  const step = db.query<WorkflowStep, [number]>(
    'SELECT * FROM workflow_steps WHERE id = ?'
  ).get(id);
  if (!step) {
    return c.json({ error: 'Step not found' }, 404);
  }

  const body = await c.req.json().catch(() => null);
  if (!body) {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const updates: string[] = [];
  const params: any[] = [];

  if (typeof body.sort_order === 'number' && Number.isFinite(body.sort_order)) {
    updates.push('sort_order = ?');
    params.push(body.sort_order);
  }

  if (typeof body.requires_review === 'boolean') {
    updates.push('requires_review = ?');
    params.push(body.requires_review ? 1 : 0);
  }

  if (body.config !== undefined) {
    if (typeof body.config !== 'object' || body.config === null) {
      return c.json({ error: 'config must be an object' }, 400);
    }

    // Validate config against catalog schema
    const catalogEntry = STEP_CATALOG.find(s => s.slug === step.slug);
    if (!catalogEntry) {
      // Legacy step not in catalog — only {} is valid
      if (Object.keys(body.config).length > 0) {
        return c.json({ error: 'This step does not support configuration' }, 400);
      }
    } else {
      const validKeys = new Set(catalogEntry.configSchema.map(s => s.key));
      for (const key of Object.keys(body.config)) {
        if (!validKeys.has(key)) {
          return c.json({ error: `Unknown config key: "${key}"` }, 400);
        }
      }
    }

    updates.push('config = ?');
    params.push(JSON.stringify(body.config));
  }

  if (updates.length === 0) {
    return c.json({ error: 'No valid fields to update' }, 400);
  }

  params.push(id);
  db.query(`UPDATE workflow_steps SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  const updated = db.query<WorkflowStep, [number]>(
    'SELECT * FROM workflow_steps WHERE id = ?'
  ).get(id)!;

  broadcaster.broadcast('workflow:updated', { action: 'updated', step: updated });

  return c.json({ step: updated });
});

// DELETE /workflow-steps/:id — remove a step
workflowSteps.delete('/:id', async (c) => {
  const db = getDb();
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) {
    return c.json({ error: 'Invalid step ID' }, 400);
  }

  const step = db.query<WorkflowStep, [number]>(
    'SELECT * FROM workflow_steps WHERE id = ?'
  ).get(id);
  if (!step) {
    return c.json({ error: 'Step not found' }, 404);
  }

  // Check minimum — need at least 1 workflow step
  const count = db.query<{ cnt: number }, []>(
    'SELECT COUNT(*) as cnt FROM workflow_steps'
  ).get();
  if ((count?.cnt ?? 0) <= 1) {
    return c.json({ error: 'Cannot remove the last workflow step' }, 400);
  }

  // Get move_tasks_to from body
  const body = await c.req.json().catch(() => null);
  const moveTasksTo = body?.move_tasks_to;

  // Check if any tasks are in this step
  const tasksInStep = db.query<{ cnt: number }, [string]>(
    'SELECT COUNT(*) as cnt FROM tasks WHERE status = ?'
  ).get(step.slug);

  if ((tasksInStep?.cnt ?? 0) > 0) {
    if (!moveTasksTo) {
      return c.json({
        error: `${tasksInStep!.cnt} task(s) are in this step. Provide "move_tasks_to" to relocate them.`,
        tasksInStep: tasksInStep!.cnt,
      }, 400);
    }

    // Validate move target
    const validTargets = ['todo', 'done'];
    const otherSteps = db.query<{ slug: string }, [number]>(
      'SELECT slug FROM workflow_steps WHERE id != ?'
    ).all(id);
    validTargets.push(...otherSteps.map(s => s.slug));

    if (!validTargets.includes(moveTasksTo)) {
      return c.json({ error: `Invalid move target: "${moveTasksTo}"` }, 400);
    }

    // Cancel any running agents in this step before moving tasks
    const runningTasks = db.query<Task, [string, string]>(
      'SELECT * FROM tasks WHERE status = ? AND agent_status = ?'
    ).all(step.slug, 'running');
    for (const rt of runningTasks) {
      try { await cancelAgent(rt.id); } catch {}
    }

    // Move tasks
    const maxOrder = db.query<{ max_order: number | null }, [string]>(
      'SELECT MAX(sort_order) as max_order FROM tasks WHERE status = ?'
    ).get(moveTasksTo);
    let nextOrder = (maxOrder?.max_order ?? 0) + 1.0;

    const tasksToMove = db.query<{ id: number }, [string]>(
      'SELECT id FROM tasks WHERE status = ? ORDER BY sort_order'
    ).all(step.slug);

    for (const t of tasksToMove) {
      db.query(
        'UPDATE tasks SET status = ?, sort_order = ?, agent_status = NULL, agent_pid = NULL, agent_started_at = NULL WHERE id = ?'
      ).run(moveTasksTo, nextOrder, t.id);
      const movedTask = db.query<Task, [number]>('SELECT * FROM tasks WHERE id = ?').get(t.id);
      if (movedTask) {
        broadcaster.broadcast('task:updated', { task: movedTask });
      }
      nextOrder += 1.0;
    }
  }

  db.query('DELETE FROM workflow_steps WHERE id = ?').run(id);

  broadcaster.broadcast('workflow:updated', { action: 'removed', step });
  invalidateStatusCache();

  return c.body(null, 204);
});

export default workflowSteps;
