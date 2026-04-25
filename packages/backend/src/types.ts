export interface Task {
  id: number;
  task_key: string;
  title: string;
  description: string;
  acceptance: string;
  status: 'backlog' | 'todo' | 'in-progress' | 'done';
  agent_status: 'running' | 'completed' | 'failed' | null;
  agent_pid: number | null;
  agent_started_at: string | null;
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
  type: 'cli' | 'api';
  cli_cmd: string | null;
  cli_prompt_mode: 'stdin' | 'argument' | 'flag';
  cli_prompt_flag: string | null;
  api_url: string | null;
  api_headers: string | null;
  api_model: string | null;
  api_request_format: 'openai' | 'ollama';
  api_stream_format: 'sse' | 'ndjson' | 'none';
  timeout_ms: number;
  updated_at: string;
}

export interface ProjectConfig {
  id: number;
  task_prefix: string;
  next_task_number: number;
  repo_name: string;
  created_at: string;
}

export type TaskStatus = Task['status'];
export type AgentStatus = NonNullable<Task['agent_status']>;

export interface AgentResult {
  success: boolean;
  summary: string;
}

export interface AgentAdapter {
  execute(params: {
    task: Task;
    workingDir: string;
    onOutput: (line: string) => void;
    signal: AbortSignal;
  }): Promise<AgentResult>;
}
