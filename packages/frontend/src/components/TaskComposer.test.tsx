import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TaskComposer from './TaskComposer.js';
import { useAppStore } from '../hooks/useTaskStore.js';
import { api } from '../api/client.js';

vi.mock('../api/client.js', () => ({ api: { createTask: vi.fn() } }));

describe('TaskComposer', () => {
  beforeEach(() => {
    vi.mocked(api.createTask).mockResolvedValue({ task: { id: 7 } as any, links: [] });
    useAppStore.setState({ workView: 'backlog', createOpen: true, refreshTasks: vi.fn(), selectTask: vi.fn(), setCreateOpen: vi.fn() });
  });
  test('always creates a task in Backlog', async () => {
    render(<TaskComposer />);
    fireEvent.change(screen.getByPlaceholderText('What should be different when this is done?'), { target: { value: 'Ship graph editor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(api.createTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Ship graph editor', run: false, queue_state: 'backlog' })));
    expect(screen.queryByText('Start a Run now')).not.toBeInTheDocument();
  });

  test('only sends detail sections selected for this task', async () => {
    render(<TaskComposer />);
    fireEvent.change(screen.getByPlaceholderText('What should be different when this is done?'), { target: { value: 'Link tasks' } });
    fireEvent.click(screen.getByRole('button', { name: 'Context' }));
    fireEvent.change(screen.getByPlaceholderText('Why this matters, constraints, useful links…'), { target: { value: 'Only shown when useful.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(api.createTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Link tasks', description: 'Only shown when useful.', acceptance: '', task_links: [] })));
  });

  test('finds tasks by title or key before adding a link', async () => {
    useAppStore.setState({ tasks: [{ id: 4, task_key: 'TST-4', title: 'Publish the API contract', resolution: 'open' } as any] });
    render(<TaskComposer />);
    fireEvent.change(screen.getByPlaceholderText('What should be different when this is done?'), { target: { value: 'Link work' } });
    fireEvent.click(screen.getByRole('button', { name: 'Linked tasks' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Search tasks by title or key' }), { target: { value: 'contract' } });
    fireEvent.click(screen.getByRole('option', { name: /TST-4 Publish the API contract/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(api.createTask).toHaveBeenCalledWith(expect.objectContaining({ task_links: [{ task_id: 4, relationship: 'is_blocked_by' }] })));
  });
});
