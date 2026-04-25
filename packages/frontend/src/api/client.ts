const BASE = '';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (res.status === 204) return undefined as T;

  const data = await res.json();

  if (!res.ok) {
    const error: any = new Error(data.error || 'Request failed');
    error.status = res.status;
    error.data = data;
    throw error;
  }

  return data;
}

export const api = {
  // Status
  getStatus: () => request<{ initialized: boolean; projectConfig?: any; repoName?: string }>('/status'),

  // Tasks
  getTasks: (params?: { q?: string; status?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.q) searchParams.set('q', params.q);
    if (params?.status) searchParams.set('status', params.status);
    const qs = searchParams.toString();
    return request<{ tasks: any[] }>(`/tasks${qs ? `?${qs}` : ''}`);
  },

  createTask: (data: { title: string; description?: string; acceptance?: string; status?: string; run?: boolean }) =>
    request<{ task: any }>('/tasks', { method: 'POST', body: JSON.stringify(data) }),

  getTask: (id: number) => request<{ task: any }>(`/tasks/${id}`),

  updateTask: (id: number, data: any) =>
    request<{ task: any }>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  deleteTask: (id: number) => request<void>(`/tasks/${id}`, { method: 'DELETE' }),

  // Logs
  getTaskLogs: (id: number, params?: { before_id?: number; limit?: number; run_number?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.before_id) searchParams.set('before_id', String(params.before_id));
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.run_number) searchParams.set('run_number', String(params.run_number));
    const qs = searchParams.toString();
    return request<{ logs: any[]; hasMore: boolean }>(`/tasks/${id}/logs${qs ? `?${qs}` : ''}`);
  },

  // Agent Control
  startAgent: (id: number) => request<{ task: any }>(`/tasks/${id}/agent/start`, { method: 'POST' }),
  cancelAgent: (id: number) => request<{ task: any }>(`/tasks/${id}/agent/cancel`, { method: 'POST' }),

  // Agent Config
  getAgentConfig: () => request<{ config: any }>('/agent-config'),
  updateAgentConfig: (data: any) =>
    request<{ config: any }>('/agent-config', { method: 'PUT', body: JSON.stringify(data) }),
  testAgentConfig: () =>
    request<{ success: boolean; durationMs: number; error?: string }>('/agent-config/test', { method: 'POST' }),

  // Init
  generatePrefix: (repoName: string) =>
    request<{ prefix: string }>('/init/generate-prefix', {
      method: 'POST',
      body: JSON.stringify({ repoName }),
    }),
  savePrefix: (prefix: string, repoName?: string) =>
    request<{ projectConfig: any }>('/init/save-prefix', {
      method: 'POST',
      body: JSON.stringify({ prefix, repoName }),
    }),
};
