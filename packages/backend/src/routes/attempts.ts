import { Hono } from 'hono';
import { getDb } from '../db/database.js';
import type { Attempt, TaskLog } from '../types.js';

const attempts = new Hono();

attempts.get('/:id', (c) => {
  const db = getDb();
  const id = Number(c.req.param('id'));
  const attempt = db.query<Attempt, [number]>('SELECT * FROM attempts WHERE id = ?').get(id);
  if (!attempt) return c.json({ error: 'Attempt not found.' }, 404);
  const before = Number(c.req.query('before')) || Number.MAX_SAFE_INTEGER;
  const limit = Math.min(Math.max(Number(c.req.query('limit')) || 300, 1), 1000);
  const logs = db.query<TaskLog, [number, number, number]>('SELECT * FROM logs WHERE attempt_id = ? AND id < ? ORDER BY id DESC LIMIT ?').all(id, before, limit).reverse();
  return c.json({ attempt, logs, hasMore: logs.length === limit });
});

export default attempts;
