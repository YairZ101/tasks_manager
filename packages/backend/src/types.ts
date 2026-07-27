import type { CompiledFlowDefinition, FlowDefinition, ResultCategory } from '@tasks-manager/flow-core';

export type TaskQueueState = 'backlog' | 'ready';
export type TaskResolution = 'open' | 'completed' | 'cancelled';
export type RunStatus = 'queued' | 'running' | 'waiting' | 'attention' | 'finished' | 'stopped';
export type AttemptStatus = 'queued' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'timed_out' | 'interrupted' | 'cancelled';
export type WorkspaceState = 'active' | 'retained' | 'cleanup_required' | 'removed' | 'orphaned';

export interface Task {
  id: number;
  task_key: string;
  title: string;
  description: string;
  acceptance: string;
  queue_state: TaskQueueState;
  resolution: TaskResolution;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface TaskWithState extends Task {
  operational_state: 'backlog' | 'ready' | 'active' | 'attention' | 'finished';
  active_run_id: number | null;
  active_run_status: RunStatus | null;
  active_block_id: string | null;
  active_block_name: string | null;
  workspace_state: WorkspaceState | null;
}

export interface AgentConfig {
  id: number;
  cli_cmd: string | null;
  cli_prompt_mode: 'stdin' | 'argument' | 'flag';
  cli_prompt_flag: string | null;
  timeout_ms: number;
  max_concurrent_executions: number;
  updated_at: string;
}

export interface ProjectConfig {
  id: number;
  task_prefix: string;
  next_task_number: number;
  repo_name: string;
  created_at: string;
}

export interface Flow {
  id: number;
  name: string;
  is_default: number;
  active_version_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface FlowVersionRow {
  id: number;
  flow_id: number;
  version: number;
  state: 'draft' | 'published' | 'archived';
  draft_revision: number;
  definition_json: string;
  compiled_json: string | null;
  created_at: string;
  published_at: string | null;
}

export interface FlowVersion extends Omit<FlowVersionRow, 'definition_json' | 'compiled_json'> {
  definition: FlowDefinition;
  compiled: CompiledFlowDefinition | null;
}

export interface WorkflowRun {
  id: number;
  task_id: number;
  flow_version_id: number;
  workspace_id: number | null;
  status: RunStatus;
  result_category: ResultCategory | null;
  reason: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface Attempt {
  id: number;
  run_id: number;
  block_id: string;
  parent_attempt_id: number | null;
  incoming_connection_id: string | null;
  sequence: number;
  block_attempt: number;
  status: AttemptStatus;
  outcome_id: string | null;
  result_json: string | null;
  decision_comment: string | null;
  pid: number | null;
  process_started_at: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface Workspace {
  id: number;
  task_id: number;
  repo_root: string;
  worktree_path: string;
  branch: string | null;
  state: WorkspaceState;
  is_dirty: number | null;
  created_at: string;
  updated_at: string;
}

export interface TaskLog {
  id: number;
  task_id: number;
  run_id: number;
  attempt_id: number;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'agent';
  message: string;
}

export interface PersistedEvent {
  id: number;
  topic: string;
  entity_type: string | null;
  entity_id: string | null;
  payload: string;
  created_at: string;
}

export interface RunnerState {
  activeCount: number;
  queuedCount: number;
  maxConcurrent: number;
  executions: Array<{ attemptId: number; runId: number; taskId: number; taskKey: string; blockName: string }>;
}
