export interface Task {
  id: number;
  task_key: string;
  title: string;
  description: string;
  acceptance: string;
  status: string;
  agent_status: 'running' | 'completed' | 'failed' | null;
  agent_pid: number | null;
  agent_started_at: string | null;
  agent_worktree: string | null;
  agent_branch: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface TaskLog {
  id: number;
  task_id: number;
  run_number: number;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'agent';
  message: string;
}

export interface AgentConfig {
  id: number;
  cli_cmd: string | null;
  cli_prompt_mode: 'stdin' | 'argument' | 'flag';
  cli_prompt_flag: string | null;
  timeout_ms: number;
  max_concurrent_agents: number;
  updated_at: string;
}

export interface ProjectConfig {
  id: number;
  task_prefix: string;
  next_task_number: number;
  repo_name: string;
  created_at: string;
}

export type TaskStatus = string;
export type AgentStatus = NonNullable<Task['agent_status']>;

export interface WorkflowStep {
  id: number;
  slug: string;
  name: string;
  requires_review: number;
  config: string;
  sort_order: number;
  fixed: number;
  created_at: string;
}

export interface RunnerState {
  activeCount: number;
  maxConcurrent: number;
  runs: Array<{ taskId: number; taskKey: string }>;
}
