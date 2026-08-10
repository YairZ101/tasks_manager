import type { FlowDefinition, FlowNode, ResultCategory } from '@flow/core';

export type OperationalState = 'backlog' | 'active' | 'attention' | 'finished';

export interface Task {
  id: number; task_key: string; title: string; description: string; acceptance: string;
  preferred_flow_id: number | null;
  resolution: 'open' | 'completed' | 'cancelled'; sort_order: number;
  operational_state: OperationalState; active_run_id: number | null; active_run_status: string | null;
  active_run_reason?: string | null;
  active_block_id: string | null; active_block_name: string | null; workspace_state: string | null;
  created_at: string; updated_at: string;
}

export type TaskLinkRelationship = 'blocks' | 'is_blocked_by' | 'relates_to';

export type FlowVersionActionKind = 'initial' | 'added' | 'removed' | 'changed' | 'moved' | 'connected' | 'disconnected';

export interface FlowVersionAction {
  kind: FlowVersionActionKind;
  title: string;
  detail?: string;
  blockType?: FlowNode['type'];
  timestamp: string;
}

export interface TaskLink {
  id: number; link_type: 'blocks' | 'relates_to'; relationship: TaskLinkRelationship; linked_task_id: number; created_at: string;
  task_key: string; title: string; resolution: Task['resolution'];
}

export interface FlowVersion {
  id: number; flow_id: number; version: number; state: 'draft' | 'published' | 'archived';
  draft_revision: number; definition: FlowDefinition; compiled: FlowDefinition | null; action_history?: FlowVersionAction[]; created_at?: string; published_at: string | null;
}

export interface Flow {
  id: number; name: string; is_default: number; active_version_id: number | null; activeVersion: FlowVersion | null; draftVersion?: FlowVersion | null;
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

export interface AgentPreset {
  id: number;
  preset_key: string;
  name: string;
  description: string;
  system_prompt: string;
  created_at: string;
  updated_at: string;
}
