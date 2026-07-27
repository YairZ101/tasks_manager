import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TaskComposer from './TaskComposer.js';
import { useAppStore } from '../hooks/useTaskStore.js';
import { api } from '../api/client.js';

vi.mock('../api/client.js', () => ({ api: { createTask: vi.fn() } }));

describe('TaskComposer', () => {
  beforeEach(() => {
    vi.mocked(api.createTask).mockResolvedValue({ task: { id: 7 } as any });
    useAppStore.setState({ workView: 'backlog', createOpen: true, refreshTasks: vi.fn(), selectTask: vi.fn(), setCreateOpen: vi.fn() });
  });
  test('always creates a task in Backlog', async () => {
    render(<TaskComposer />);
    fireEvent.change(screen.getByPlaceholderText('What should be different when this is done?'), { target: { value: 'Ship graph editor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(api.createTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Ship graph editor', run: false, queue_state: 'backlog' })));
    expect(screen.queryByText('Start a Run now')).not.toBeInTheDocument();
  });
});
