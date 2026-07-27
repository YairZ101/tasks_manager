import { getDb } from '../db/database.js';
import { broadcaster } from '../sse/broadcaster.js';

export function emitEvent(topic: string, data: unknown, entityType?: string, entityId?: string | number): number {
  const db = getDb();
  const result = db.query(
    'INSERT INTO events (topic, entity_type, entity_id, payload) VALUES (?, ?, ?, ?)'
  ).run(topic, entityType ?? null, entityId == null ? null : String(entityId), JSON.stringify(data));
  const id = Number(result.lastInsertRowid);
  db.query('DELETE FROM events WHERE id <= (SELECT MAX(id) - 1000 FROM events)').run();
  broadcaster.broadcastPersisted({ id, event: topic, data });
  return id;
}

export function emitTask(taskId: number): void {
  emitEvent('task:changed', { taskId }, 'task', taskId);
}

export function emitRun(runId: number, taskId: number): void {
  emitEvent('run:changed', { runId, taskId }, 'run', runId);
  emitTask(taskId);
}
