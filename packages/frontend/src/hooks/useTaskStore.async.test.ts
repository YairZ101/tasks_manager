import { describe, test, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from './useTaskStore';

vi.mock('../api/client', () => ({
  api: {
    getStatus: vi.fn(),
    getTasks: vi.fn(),
  },
}));

import { api } from '../api/client';

const makeTask = (overrides: any = {}) => ({
  id: 1,
  task_key: 'TST-1',
  title: 'Test',
  description: '',
  acceptance: '',
  status: 'backlog' as const,
  agent_status: null,
  agent_pid: null,
  agent_started_at: null,
  sort_order: 1,
  created_at: '2024-01-01',
  updated_at: '2024-01-01',
  ...overrides,
});

describe('useAppStore async actions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAppStore.setState({
      initialized: false,
      projectConfig: null,
      repoName: '',
      loading: true,
      tasks: [],
      selectedTaskId: null,
      currentView: 'board',
      sidebarCollapsed: false,
      showAgentConfig: false,
      showCreateTask: false,
      createTaskDefaultStatus: 'backlog',
    });
  });

  describe('checkStatus', () => {
    test('sets initialized and projectConfig on success', async () => {
      (api.getStatus as any).mockResolvedValue({
        initialized: true,
        projectConfig: { task_prefix: 'TST' },
        repoName: 'my-repo',
      });

      await useAppStore.getState().checkStatus();

      const state = useAppStore.getState();
      expect(state.initialized).toBe(true);
      expect(state.projectConfig).toEqual({ task_prefix: 'TST' });
      expect(state.repoName).toBe('my-repo');
      expect(state.loading).toBe(false);
    });

    test('sets loading false on error', async () => {
      (api.getStatus as any).mockRejectedValue(new Error('network'));

      await useAppStore.getState().checkStatus();

      expect(useAppStore.getState().loading).toBe(false);
      expect(useAppStore.getState().initialized).toBe(false);
    });

    test('handles missing repoName gracefully', async () => {
      (api.getStatus as any).mockResolvedValue({ initialized: false });

      await useAppStore.getState().checkStatus();

      expect(useAppStore.getState().repoName).toBe('');
    });
  });

  describe('fetchTasks', () => {
    test('populates tasks on success', async () => {
      const tasks = [makeTask({ id: 1 }), makeTask({ id: 2, task_key: 'TST-2' })];
      (api.getTasks as any).mockResolvedValue({ tasks });

      await useAppStore.getState().fetchTasks();

      expect(useAppStore.getState().tasks).toHaveLength(2);
    });

    test('does not throw on error', async () => {
      (api.getTasks as any).mockRejectedValue(new Error('fail'));

      await useAppStore.getState().fetchTasks();

      expect(useAppStore.getState().tasks).toEqual([]);
    });
  });
});
