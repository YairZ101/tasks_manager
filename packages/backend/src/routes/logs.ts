import { Hono } from 'hono';
import { getDb } from '../db/database.js';
import type { TaskLog } from '../types.js';

const logs = new Hono();

// GET /tasks/:id/logs — paginated logs
logs.get('/', (c) => {
  const db = getDb();
  const taskId = parseInt(c.req.param('id'), 10);

  if (isNaN(taskId)) {
    return c.json({ error: 'Invalid task ID' }, 400);
  }

  // Check task exists
  const task = db.query('SELECT id FROM tasks WHERE id = ?').get(taskId);
  if (!task) {
    return c.json({ error: 'Task not found' }, 404);
  }

  const beforeId = c.req.query('before_id') ? parseInt(c.req.query('before_id')!, 10) : undefined;
  const limitParam = parseInt(c.req.query('limit') || '500', 10);
  const limit = Math.min(Number.isNaN(limitParam) ? 500 : limitParam, 1000);
  const runNumber = c.req.query('run_number')
    ? parseInt(c.req.query('run_number')!, 10)
    : undefined;

  if (beforeId !== undefined && isNaN(beforeId)) {
    return c.json({ error: 'Invalid before_id' }, 400);
  }
  if (runNumber !== undefined && isNaN(runNumber)) {
    return c.json({ error: 'Invalid run_number' }, 400);
  }

  let sql = 'SELECT * FROM task_logs WHERE task_id = ?';
  const params: any[] = [taskId];

  if (runNumber !== undefined) {
    sql += ' AND run_number = ?';
    params.push(runNumber);
  }

  if (beforeId !== undefined) {
    sql += ' AND id < ?';
    params.push(beforeId);
  }

  // Get one extra to check hasMore
  sql += ' ORDER BY id DESC LIMIT ?';
  params.push(limit + 1);

  const rows = db.query<TaskLog, any[]>(sql).all(...params);

  const hasMore = rows.length > limit;
  if (hasMore) {
    rows.pop();
  }

  // Return in ascending order
  rows.reverse();

  return c.json({ logs: rows, hasMore });
});

export default logs;
