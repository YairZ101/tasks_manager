import { Hono } from 'hono';
import { getDb } from '../db/database.js';
import { decide, retryRun, startRun, stopRun } from '../flow/engine.js';
import { getRunDetail } from '../flow/repository.js';
import type { WorkflowRun } from '../types.js';

const runs = new Hono();

runs.post('/', async (c) => {
  const body = await c.req.json().catch(() => null) as { task_id?: number; flow_id?: number } | null;
  if (!body?.task_id) return c.json({ error: 'task_id is required.' }, 400);
  return c.json({ run: await startRun(body.task_id, body.flow_id) }, 201);
});

runs.get('/', (c) => {
  const db = getDb();
  const taskId = Number(c.req.query('task_id'));
  const rows = Number.isInteger(taskId) && taskId > 0
    ? db.query<WorkflowRun, [number]>('SELECT * FROM runs WHERE task_id = ? ORDER BY id DESC').all(taskId)
    : db.query<WorkflowRun, []>('SELECT * FROM runs ORDER BY id DESC LIMIT 100').all();
  return c.json({ runs: rows });
});

runs.get('/:id', (c) => {
  const detail = getRunDetail(Number(c.req.param('id')));
  return detail ? c.json(detail) : c.json({ error: 'Run not found.' }, 404);
});

runs.post('/:id/stop', async (c) => c.json({ run: await stopRun(Number(c.req.param('id'))) }));
runs.post('/:id/retry', async (c) => c.json({ run: await retryRun(Number(c.req.param('id'))) }));

runs.post('/:id/decisions/:attemptId', async (c) => {
  const db = getDb();
  const runId = Number(c.req.param('id'));
  const attemptId = Number(c.req.param('attemptId'));
  const owned = db.query<{ run_id: number }, [number]>('SELECT run_id FROM attempts WHERE id = ?').get(attemptId);
  if (!owned) return c.json({ error: 'Attempt not found.' }, 404);
  if (owned.run_id !== runId) return c.json({ error: 'Attempt does not belong to this Run.' }, 400);
  const body = await c.req.json().catch(() => null) as { outcome_id?: string; comment?: string } | null;
  if (!body?.outcome_id) return c.json({ error: 'outcome_id is required.' }, 400);
  const run = await decide(attemptId, body.outcome_id, body.comment);
  return c.json({ run });
});

export default runs;
