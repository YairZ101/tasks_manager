import type { FlowDefinition, ResultCategory } from '@tasks-manager/flow-core';

export type OperationalState = 'backlog' | 'ready' | 'active' | 'attention' | 'finished';

export interface Task {
  id: number; task_key: string; title: string; description: string; acceptance: string;
  queue_state: 'backlog' | 'ready'; resolution: 'open' | 'completed' | 'cancelled'; sort_order: number;
  operational_state: OperationalState; active_run_id: number | null; active_run_status: string | null;
  active_block_id: string | null; active_block_name: string | null; workspace_state: string | null;
  created_at: string; updated_at: string;
}

export interface FlowVersion {
  id: number; flow_id: number; version: number; state: 'draft' | 'published' | 'archived';
  draft_revision: number; definition: FlowDefinition; compiled: FlowDefinition | null; published_at: string | null;
}

export interface Flow {
  id: number; name: string; is_default: number; active_version_id: number | null; activeVersion: FlowVersion | null;
  created_at: string; updated_at: string;
}

export interface Run {
  id: number; task_id: number; flow_version_id: number; workspace_id: number | null;
  status: 'queued' | 'running' | 'waiting' | 'attention' | 'finished' | 'stopped';
  result_category: ResultCategory | null; reason: string | null; created_at: string; started_at: string | null; finished_at: string | null;
}

export interface Attempt {
  id: number; run_id: number; block_id: string; sequence: number; block_attempt: number;
  status: string; outcome_id: string | null; decision_comment: string | null; result_json: string | null;
  started_at: string | null; finished_at: string | null;
}

export interface TaskLog { id: number; attempt_id: number; level: string; message: string; timestamp: string }
export interface RunDetail { run: Run; task: Task; flowVersion: FlowVersion; attempts: Attempt[]; workspace: { id: number; state: string; worktree_path: string; branch: string | null } | null }
export interface Runner { activeCount: number; queuedCount: number; maxConcurrent: number; executions: Array<{ attemptId: number; taskKey: string; blockName: string }> }
