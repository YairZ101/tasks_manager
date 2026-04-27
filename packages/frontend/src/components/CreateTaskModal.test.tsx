import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAppStore } from '../hooks/useTaskStore';

vi.mock('../api/client', () => ({
  api: {
    createTask: vi.fn(),
  },
}));

import { api } from '../api/client';
import CreateTaskModal from './CreateTaskModal';

describe('CreateTaskModal', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAppStore.setState({
      showCreateTask: true,
      createTaskDefaultStatus: 'backlog',
      tasks: [],
    });
  });

  test('renders form fields', () => {
    render(<CreateTaskModal />);
    expect(screen.getByText('Create Task')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('What needs to be done?')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Detailed description/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/How will the agent know/)).toBeInTheDocument();
  });

  test('has Create and Create & Run buttons', () => {
    render(<CreateTaskModal />);
    expect(screen.getByText('Create')).toBeInTheDocument();
    expect(screen.getByText('Create & Run')).toBeInTheDocument();
  });

  test('Create button is disabled when title is empty', () => {
    render(<CreateTaskModal />);
    const createBtn = screen.getByText('Create');
    expect(createBtn).toBeDisabled();
  });

  test('Cancel closes modal', () => {
    render(<CreateTaskModal />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(useAppStore.getState().showCreateTask).toBe(false);
  });

  test('backdrop click closes modal', () => {
    const { container } = render(<CreateTaskModal />);
    const backdrop = container.querySelector('.absolute.inset-0');
    if (backdrop) fireEvent.click(backdrop);
    expect(useAppStore.getState().showCreateTask).toBe(false);
  });

  test('submits task on Create click', async () => {
    (api.createTask as any).mockResolvedValue({
      task: { id: 1, task_key: 'TST-1', title: 'New Task', status: 'backlog' },
    });

    render(<CreateTaskModal />);

    const input = screen.getByPlaceholderText('What needs to be done?');
    await userEvent.type(input, 'New Task');

    fireEvent.click(screen.getByText('Create'));

    await waitFor(() => {
      expect(api.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'New Task',
          run: false,
        })
      );
    });
  });

  test('submits with run=true on Create & Run click', async () => {
    (api.createTask as any).mockResolvedValue({
      task: { id: 1, task_key: 'TST-1', title: 'Run Task', status: 'backlog' },
    });

    render(<CreateTaskModal />);

    const input = screen.getByPlaceholderText('What needs to be done?');
    await userEvent.type(input, 'Run Task');

    fireEvent.click(screen.getByText('Create & Run'));

    await waitFor(() => {
      expect(api.createTask).toHaveBeenCalledWith(
        expect.objectContaining({ run: true })
      );
    });
  });

  test('Create button stays disabled for whitespace-only title', async () => {
    render(<CreateTaskModal />);

    const input = screen.getByPlaceholderText('What needs to be done?');
    await userEvent.type(input, '   ');

    const createBtn = screen.getByRole('button', { name: 'Create' });
    expect(createBtn).toBeDisabled();
  });

  test('close button (X) closes modal', () => {
    render(<CreateTaskModal />);
    const closeBtn = screen.getByTitle('Close');
    fireEvent.click(closeBtn);
    expect(useAppStore.getState().showCreateTask).toBe(false);
  });

  test('shows error toast on API failure', async () => {
    (api.createTask as any).mockRejectedValue({
      data: { error: 'Server error' },
      message: 'fail',
    });

    render(<CreateTaskModal />);

    const input = screen.getByPlaceholderText('What needs to be done?');
    await userEvent.type(input, 'Task');
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(api.createTask).toHaveBeenCalled();
    });

    // Modal should still be open (not closed on error)
    expect(useAppStore.getState().showCreateTask).toBe(true);
  });
});
