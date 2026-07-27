import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TaskComposer from './TaskComposer.js';
import { useAppStore } from '../hooks/useTaskStore.js';
import { api } from '../api/client.js';

vi.mock('../api/client.js', () => ({ api: { createTask: vi.fn() } }));

describe('TaskComposer', () => {
  beforeEach(() => {
    vi.mocked(api.createTask).mockResolvedValue({ task: { id: 7 } as any });
    useAppStore.setState({ flows: [{ id: 2, name: 'Delivery', is_default: 1, active_version_id: 3 } as any], workView: 'ready', createOpen: true, refreshTasks: vi.fn(), selectTask: vi.fn(), setCreateOpen: vi.fn() });
  });
  test('creates and immediately runs a task with the selected Flow', async () => {
    render(<TaskComposer />);
    fireEvent.change(screen.getByPlaceholderText('What should be different when this is done?'), { target: { value: 'Ship graph editor' } });
    fireEvent.click(screen.getByText('Start a Run now'));
    fireEvent.click(screen.getByRole('button', { name: 'Create & run' }));
    await waitFor(() => expect(api.createTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Ship graph editor', run: true, flow_id: 2, queue_state: 'ready' })));
  });
});
