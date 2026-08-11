import type { Database } from 'bun:sqlite';
import type { FlowDefinition } from '@flow/core';
import { getDb } from '../db/database.js';
import type { Flow, FlowVersion, FlowVersionRow, Task, TaskLink, TaskWithState, WorkflowRun, WorkspacePreparation, WorkspacePreparationLog } from '../types.js';

export function parseFlowVersion(row: FlowVersionRow): FlowVersion {
  const { definition_json, compiled_json, action_history_json, ...version } = row;
  const actionHistory = JSON.parse(action_history_json) as unknown;
  return {
    ...version,
    definition: JSON.parse(definition_json) as FlowDefinition,
    compiled: compiled_json ? JSON.parse(compiled_json) : null,
    action_history: Array.isArray(actionHistory) ? actionHistory : [],
  };
}

export function getFlowVersion(id: number, database: Database = getDb()): FlowVersion | null {
  const row = database.query<FlowVersionRow, [number]>('SELECT * FROM flow_versions WHERE id = ?').get(id);
  return row ? parseFlowVersion(row) : null;
}

export function getDefaultFlow(database: Database = getDb()): (Flow & { active_version: FlowVersion | null }) | null {
  const flow = database.query<Flow, []>('SELECT * FROM flows WHERE is_default = 1').get();
  if (!flow) return null;
  return { ...flow, active_version: flow.active_version_id ? getFlowVersion(flow.active_version_id, database) : null };
}

export function getTask(id: number, database: Database = getDb()): Task | null {
  return database.query<Task, [number]>('SELECT * FROM tasks WHERE id = ?').get(id);
}

const TASK_WITH_STATE_SQL = `
  SELECT t.*,
    CASE
      WHEN t.resolution != 'open' THEN 'finished'
      WHEN r.status IN ('waiting', 'attention') THEN 'attention'
      WHEN r.status IN ('queued', 'running') THEN 'active'
      ELSE 'backlog'
    END AS operational_state,
    r.id AS active_run_id,
    r.status AS active_run_status,
    r.reason AS active_run_reason,
    a.block_id AS active_block_id,
    CASE WHEN EXISTS (
      SELECT 1 FROM workspace_preparations wp WHERE wp.run_id = r.id AND wp.status IN ('queued', 'running')
    ) THEN 'Preparing workspace' WHEN (
      SELECT wp.status FROM workspace_preparations wp WHERE wp.run_id = r.id ORDER BY wp.sequence DESC LIMIT 1
    ) IN ('failed', 'timed_out', 'interrupted') THEN 'Workspace setup' ELSE (
      SELECT json_extract(value, '$.config.name')
        FROM json_each(COALESCE(fv.compiled_json, fv.definition_json), '$.nodes')
        WHERE json_extract(value, '$.id') = a.block_id LIMIT 1
    ) END AS active_block_name,
    w.state AS workspace_state
  FROM tasks t
  LEFT JOIN runs r ON r.task_id = t.id AND r.status IN ('queued', 'running', 'waiting', 'attention')
  LEFT JOIN flow_versions fv ON fv.id = r.flow_version_id
  LEFT JOIN attempts a ON a.id = (
    SELECT a2.id FROM attempts a2 WHERE a2.run_id = r.id ORDER BY a2.sequence DESC LIMIT 1
  )
  LEFT JOIN workspaces w ON w.id = COALESCE(r.workspace_id, (
    SELECT w2.id FROM workspaces w2 WHERE w2.task_id = t.id AND w2.state != 'removed' ORDER BY w2.id DESC LIMIT 1
  ))
`;

export function getTaskWithState(id: number, database: Database = getDb()): TaskWithState | null {
  return database.query<TaskWithState, [number]>(`${TASK_WITH_STATE_SQL} WHERE t.id = ?`).get(id);
}

export function listTaskLinks(taskId: number, database: Database = getDb()): TaskLink[] {
  return database.query<TaskLink, [number, number, number, number, number]>(`
    SELECT tl.id, tl.link_type, tl.created_at,
      CASE WHEN tl.source_task_id = ? THEN tl.target_task_id ELSE tl.source_task_id END AS linked_task_id,
      CASE
        WHEN tl.link_type = 'relates_to' THEN 'relates_to'
        WHEN tl.source_task_id = ? THEN 'blocks'
        ELSE 'is_blocked_by'
      END AS relationship,
      t.task_key, t.title, t.resolution
    FROM task_links tl
    JOIN tasks t ON t.id = CASE WHEN tl.source_task_id = ? THEN tl.target_task_id ELSE tl.source_task_id END
    WHERE tl.source_task_id = ? OR tl.target_task_id = ?
    ORDER BY tl.id ASC
  `).all(taskId, taskId, taskId, taskId, taskId);
}

export function listTasks(options: { q?: string; state?: string } = {}, database: Database = getDb()): TaskWithState[] {
  const params: string[] = [];
  const filters: string[] = [];
  if (options.q) {
    filters.push('(t.title LIKE ? OR t.description LIKE ? OR t.task_key LIKE ?)');
    const q = `%${options.q}%`;
    params.push(q, q, q);
  }
  const where = filters.length ? ` WHERE ${filters.join(' AND ')}` : '';
  const rows = database.query<TaskWithState, string[]>(`${TASK_WITH_STATE_SQL}${where} ORDER BY t.sort_order ASC, t.id ASC`).all(...params);
  return options.state ? rows.filter((task) => task.operational_state === options.state) : rows;
}

export function getRun(id: number, database: Database = getDb()): WorkflowRun | null {
  return database.query<WorkflowRun, [number]>('SELECT * FROM runs WHERE id = ?').get(id);
}

export function getRunDetail(id: number, database: Database = getDb()) {
  const run = getRun(id, database);
  if (!run) return null;
  const task = getTask(run.task_id, database);
  const version = getFlowVersion(run.flow_version_id, database);
  const attempts = database.query('SELECT * FROM attempts WHERE run_id = ? ORDER BY sequence ASC').all(id);
  const workspace = run.workspace_id
    ? database.query('SELECT * FROM workspaces WHERE id = ?').get(run.workspace_id)
    : null;
  const preparations = database.query<WorkspacePreparation, [number]>('SELECT * FROM workspace_preparations WHERE run_id = ? ORDER BY sequence ASC').all(id)
    .map((preparation) => ({
      ...preparation,
      logs: database.query<WorkspacePreparationLog, [number]>('SELECT * FROM workspace_preparation_logs WHERE preparation_id = ? ORDER BY id ASC').all(preparation.id),
    }));
  return { run, task, flowVersion: version, attempts, workspace, preparations };
}
