import type { CompiledFlowDefinition, FlowDefinition, FlowNode, ResultCategory } from '@flow/core';

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
  preferred_flow_id: number | null;
  resolution: TaskResolution;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface TaskWithState extends Task {
  operational_state: 'backlog' | 'active' | 'attention' | 'finished';
  active_run_id: number | null;
  active_run_status: RunStatus | null;
  active_run_reason: string | null;
  active_block_id: string | null;
  active_block_name: string | null;
  workspace_state: WorkspaceState | null;
}

export type TaskLinkRelationship = 'blocks' | 'is_blocked_by' | 'relates_to';

export interface TaskLink {
  id: number;
  link_type: 'blocks' | 'relates_to';
  relationship: TaskLinkRelationship;
  linked_task_id: number;
  created_at: string;
  task_key: string;
  title: string;
  resolution: TaskResolution;
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

export interface AgentPreset {
  id: number;
  preset_key: string;
  name: string;
  description: string;
  system_prompt: string;
  created_at: string;
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
  action_history_json: string;
  created_at: string;
  published_at: string | null;
}

export type FlowVersionActionKind = 'initial' | 'added' | 'removed' | 'changed' | 'connected' | 'disconnected';

export interface FlowVersionAction {
  kind: FlowVersionActionKind;
  title: string;
  detail?: string;
  blockType?: FlowNode['type'];
  timestamp: string;
}

export interface FlowVersion extends Omit<FlowVersionRow, 'definition_json' | 'compiled_json' | 'action_history_json'> {
  definition: FlowDefinition;
  compiled: CompiledFlowDefinition | null;
  action_history: FlowVersionAction[];
}

export interface WorkflowRun {
  id: number;
  task_id: number;
  flow_version_id: number;
  workspace_id: number | null;
  status: RunStatus;
  result_category: ResultCategory | null;
  reason: string | null;
  // Snapshot of { [agentKey]: systemPrompt } captured when the Run started, so it stays consistent
  // even if the underlying agents are edited mid-run.
  agent_prompts_json: string | null;
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
