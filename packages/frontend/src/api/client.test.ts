import { describe, test, expect, vi, beforeEach } from 'vitest';
import { api } from './client';

describe('api client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function mockFetch(status: number, body: any) {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        status === 204 ? null : JSON.stringify(body),
        { status, headers: { 'Content-Type': 'application/json' } }
      )
    );
  }

  describe('getStatus', () => {
    test('calls /status', async () => {
      mockFetch(200, { initialized: true, repoName: 'repo' });
      const result = await api.getStatus();
      expect(result.initialized).toBe(true);
      expect(fetch).toHaveBeenCalledWith('/status', expect.anything());
    });
  });

  describe('getTasks', () => {
    test('calls /tasks with no params', async () => {
      mockFetch(200, { tasks: [] });
      const result = await api.getTasks();
      expect(result.tasks).toEqual([]);
      expect(fetch).toHaveBeenCalledWith('/tasks', expect.anything());
    });

    test('appends query params', async () => {
      mockFetch(200, { tasks: [] });
      await api.getTasks({ q: 'search', status: 'todo' });
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('q=search'),
        expect.anything()
      );
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('status=todo'),
        expect.anything()
      );
    });
  });

  describe('createTask', () => {
    test('POSTs to /tasks', async () => {
      mockFetch(201, { task: { id: 1, title: 'New' } });
      const result = await api.createTask({ title: 'New' });
      expect(result.task.title).toBe('New');
      expect(fetch).toHaveBeenCalledWith('/tasks', expect.objectContaining({
        method: 'POST',
      }));
    });
  });

  describe('getTask', () => {
    test('calls /tasks/:id', async () => {
      mockFetch(200, { task: { id: 5 } });
      const result = await api.getTask(5);
      expect(result.task.id).toBe(5);
      expect(fetch).toHaveBeenCalledWith('/tasks/5', expect.anything());
    });
  });

  describe('updateTask', () => {
    test('PATCHes /tasks/:id', async () => {
      mockFetch(200, { task: { id: 1, title: 'Updated' } });
      const result = await api.updateTask(1, { title: 'Updated' });
      expect(result.task.title).toBe('Updated');
      expect(fetch).toHaveBeenCalledWith('/tasks/1', expect.objectContaining({
        method: 'PATCH',
      }));
    });
  });

  describe('deleteTask', () => {
    test('DELETEs /tasks/:id', async () => {
      mockFetch(204, null);
      await api.deleteTask(1);
      expect(fetch).toHaveBeenCalledWith('/tasks/1', expect.objectContaining({
        method: 'DELETE',
      }));
    });
  });

  describe('getTaskLogs', () => {
    test('calls /tasks/:id/logs', async () => {
      mockFetch(200, { logs: [], hasMore: false });
      const result = await api.getTaskLogs(3);
      expect(result.logs).toEqual([]);
      expect(fetch).toHaveBeenCalledWith('/tasks/3/logs', expect.anything());
    });

    test('appends log query params', async () => {
      mockFetch(200, { logs: [], hasMore: false });
      await api.getTaskLogs(3, { before_id: 10, limit: 50, run_number: 2 });
      const url = (fetch as any).mock.calls[0][0];
      expect(url).toContain('before_id=10');
      expect(url).toContain('limit=50');
      expect(url).toContain('run_number=2');
    });
  });

  describe('agent control', () => {
    test('startAgent POSTs to /tasks/:id/agent/start', async () => {
      mockFetch(200, { task: { id: 1, agent_status: 'running' } });
      const result = await api.startAgent(1);
      expect(result.task.agent_status).toBe('running');
      expect(fetch).toHaveBeenCalledWith('/tasks/1/agent/start', expect.objectContaining({
        method: 'POST',
      }));
    });

    test('cancelAgent POSTs to /tasks/:id/agent/cancel', async () => {
      mockFetch(200, { task: { id: 1, agent_status: 'failed' } });
      const result = await api.cancelAgent(1);
      expect(result.task.agent_status).toBe('failed');
      expect(fetch).toHaveBeenCalledWith('/tasks/1/agent/cancel', expect.objectContaining({
        method: 'POST',
      }));
    });
  });

  describe('agent config', () => {
    test('getAgentConfig calls /agent-config', async () => {
      mockFetch(200, { config: { type: 'cli' } });
      const result = await api.getAgentConfig();
      expect(result.config.type).toBe('cli');
    });

    test('updateAgentConfig PUTs /agent-config', async () => {
      mockFetch(200, { config: { type: 'api' } });
      const result = await api.updateAgentConfig({ type: 'api' });
      expect(result.config.type).toBe('api');
      expect(fetch).toHaveBeenCalledWith('/agent-config', expect.objectContaining({
        method: 'PUT',
      }));
    });

    test('testAgentConfig POSTs /agent-config/test', async () => {
      mockFetch(200, { success: true, durationMs: 123 });
      const result = await api.testAgentConfig();
      expect(result.success).toBe(true);
      expect(result.durationMs).toBe(123);
    });
  });

  describe('init', () => {
    test('generatePrefix POSTs repoName', async () => {
      mockFetch(200, { prefix: 'PROJ' });
      const result = await api.generatePrefix('my-project');
      expect(result.prefix).toBe('PROJ');
    });

    test('savePrefix POSTs prefix', async () => {
      mockFetch(200, { projectConfig: { task_prefix: 'TST' } });
      const result = await api.savePrefix('TST', 'repo');
      expect(result.projectConfig.task_prefix).toBe('TST');
    });
  });

  describe('error handling', () => {
    test('throws with error message and status', async () => {
      mockFetch(404, { error: 'Not found' });
      try {
        await api.getTask(999);
        expect.unreachable('should throw');
      } catch (err: any) {
        expect(err.message).toBe('Not found');
        expect(err.status).toBe(404);
        expect(err.data).toEqual({ error: 'Not found' });
      }
    });

    test('throws generic message when no error field', async () => {
      mockFetch(500, {});
      try {
        await api.getTasks();
        expect.unreachable('should throw');
      } catch (err: any) {
        expect(err.message).toBe('Request failed');
      }
    });
  });
});
