import { beforeEach, describe, expect, test, vi } from 'vitest';
import { api } from '../api/client.js';
import { useAppStore } from './useTaskStore.js';

vi.mock('../api/client.js', () => ({ api: { status: vi.fn(), listTasks: vi.fn(), listFlows: vi.fn() } }));

describe('application store', () => {
  beforeEach(() => {
    vi.mocked(api.status).mockResolvedValue({ initialized: true, repoName: 'demo', isGitRepo: true, runner: { activeCount: 1, queuedCount: 2, maxConcurrent: 3, executions: [] } });
    vi.mocked(api.listTasks).mockResolvedValue({ tasks: [{ id: 1, title: 'Task' } as any] });
    vi.mocked(api.listFlows).mockResolvedValue({ flows: [{ id: 1, name: 'Flow' } as any] });
    useAppStore.setState({ loading: true, initialized: false, tasks: [], flows: [] });
  });
  test('bootstraps status, tasks, and flows together', async () => {
    await useAppStore.getState().bootstrap();
    expect(useAppStore.getState()).toMatchObject({ initialized: true, loading: false, repoName: 'demo', isGitRepo: true });
    expect(useAppStore.getState().tasks).toHaveLength(1);
    expect(useAppStore.getState().flows).toHaveLength(1);
  });
});
