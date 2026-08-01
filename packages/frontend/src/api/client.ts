import type { FlowDefinition, ValidationResult } from '@flow/core';
import type { Attempt, Flow, FlowVersion, RunDetail, Runner, Task, TaskLink, TaskLinkRelationship, TaskLog } from '../domain.js';

export type AgentSetup = {
  cli_cmd: string;
  cli_prompt_mode: 'stdin' | 'argument' | 'flag';
  cli_prompt_flag?: string;
};

export type FlowTemplate = 'recommended' | 'minimal' | 'blank';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } });
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || `Request failed (${response.status})`), { status: response.status, data });
  return data as T;
}

async function streamAgentTest(candidate: AgentSetup, onOutput: (line: string) => void): Promise<{ success: boolean; durationMs: number; error?: string }> {
  const response = await fetch('/agent-config/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ ...candidate, stream: true }),
  });
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}));
    throw Object.assign(new Error(data.error || `Request failed (${response.status})`), { status: response.status, data });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let complete: { success: boolean; durationMs: number; error?: string } | null = null;
  const consumeEvent = (raw: string) => {
    const event = raw.match(/^event: (.+)$/m)?.[1];
    const data = raw.match(/^data: (.+)$/m)?.[1];
    if (!event || !data) return;
    const payload = JSON.parse(data) as { line?: string; success?: boolean; durationMs?: number; error?: string };
    if (event === 'output' && payload.line !== undefined) onOutput(payload.line);
    if (event === 'complete' && typeof payload.success === 'boolean' && typeof payload.durationMs === 'number') complete = { success: payload.success, durationMs: payload.durationMs, error: payload.error };
  };

  while (true) {
    const chunk = await reader.read();
    pending += decoder.decode(chunk.value, { stream: !chunk.done });
    const events = pending.split('\n\n');
    pending = events.pop() ?? '';
    events.forEach(consumeEvent);
    if (chunk.done) break;
  }
  if (!complete) throw new Error('Agent test ended without a result.');
  return complete;
}

export const api = {
  status: () => request<{ initialized: boolean; projectConfig?: unknown; repoName: string; runner: Runner; isGitRepo: boolean }>('/status'),
  listTasks: (params?: { q?: string; state?: string }) => {
    const search = new URLSearchParams();
    if (params?.q) search.set('q', params.q);
    if (params?.state) search.set('state', params.state);
    return request<{ tasks: Task[] }>(`/tasks${search.size ? `?${search}` : ''}`);
  },
  createTask: (data: { title: string; description?: string; acceptance?: string; task_links?: Array<{ task_id: number; relationship: TaskLinkRelationship }>; queue_state?: 'backlog' | 'ready'; run?: boolean; flow_id?: number }) =>
    request<{ task: Task; links: TaskLink[]; run?: { id: number } }>('/tasks', { method: 'POST', body: JSON.stringify(data) }),
  getTask: (id: number) => request<{ task: Task; links: TaskLink[] }>(`/tasks/${id}`),
  updateTask: (id: number, data: Partial<Pick<Task, 'title' | 'description' | 'acceptance' | 'preferred_flow_id' | 'queue_state' | 'resolution' | 'sort_order'>> & { task_links?: Array<{ task_id: number; relationship: TaskLinkRelationship }> }) =>
    request<{ task: Task; links: TaskLink[] }>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteTask: (id: number, force = false) => request<void>(`/tasks/${id}${force ? '?force=true' : ''}`, { method: 'DELETE' }),
  listFlows: () => request<{ flows: Flow[] }>('/flows'),
  createFlow: (name: string) => request<{ flow: Flow; draft: FlowVersion }>('/flows', { method: 'POST', body: JSON.stringify({ name }) }),
  updateFlow: (id: number, data: Pick<Flow, 'name'>) => request<{ flow: Flow }>(`/flows/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  getDraft: (flowId: number) => request<{ draft: FlowVersion; validation: ValidationResult }>(`/flows/${flowId}/draft`),
  saveDraft: (flowId: number, definition: FlowDefinition, revision: number) =>
    request<{ draft: FlowVersion; validation: ValidationResult }>(`/flows/${flowId}/draft`, { method: 'PUT', body: JSON.stringify({ definition, revision }) }),
  publishFlow: (flowId: number) => request<{ version: FlowVersion }>(`/flows/${flowId}/publish`, { method: 'POST' }),
  makeDefault: (flowId: number) => request<{ flow: Flow }>(`/flows/${flowId}/default`, { method: 'POST' }),
  deleteFlow: (flowId: number) => request<void>(`/flows/${flowId}`, { method: 'DELETE' }),
  startRun: (taskId: number, flowId?: number) => request<{ run: { id: number } }>('/runs', { method: 'POST', body: JSON.stringify({ task_id: taskId, flow_id: flowId }) }),
  getRun: (id: number) => request<RunDetail>(`/runs/${id}`),
  listRuns: (taskId: number) => request<{ runs: RunDetail['run'][] }>(`/runs?task_id=${taskId}`),
  decide: (runId: number, attemptId: number, outcome_id: string, comment?: string) => request<{ run: RunDetail['run'] }>(`/runs/${runId}/decisions/${attemptId}`, { method: 'POST', body: JSON.stringify({ outcome_id, comment }) }),
  stopRun: (runId: number) => request<{ run: RunDetail['run'] }>(`/runs/${runId}/stop`, { method: 'POST' }),
  retryRun: (runId: number) => request<{ run: RunDetail['run'] }>(`/runs/${runId}/retry`, { method: 'POST' }),
  getAttempt: (attemptId: number) => request<{ attempt: Attempt; logs: TaskLog[]; hasMore: boolean }>(`/attempts/${attemptId}`),
  getAgentConfig: () => request<{ config: Record<string, unknown> }>('/agent-config'),
  updateAgentConfig: (data: Record<string, unknown>) => request<{ config: Record<string, unknown> }>('/agent-config', { method: 'PUT', body: JSON.stringify(data) }),
  testAgentConfig: (candidate?: AgentSetup) => request<{ success: boolean; durationMs: number; output?: string; error?: string }>('/agent-config/test', { method: 'POST', body: candidate ? JSON.stringify(candidate) : undefined }),
  testAgentConfigStream: (candidate: AgentSetup, onOutput: (line: string) => void) => streamAgentTest(candidate, onOutput),
  savePrefix: (prefix: string, repoName: string) => request('/init/save-prefix', { method: 'POST', body: JSON.stringify({ prefix, repoName }) }),
  completeInitialization: (data: { prefix: string; repoName: string; flowTemplate: FlowTemplate; agent: AgentSetup }) =>
    request<{ projectConfig: unknown; flow: { id: number; versionId: number } }>('/init/complete', { method: 'POST', body: JSON.stringify(data) }),
};
