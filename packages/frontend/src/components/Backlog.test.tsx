import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useAppStore } from '../hooks/useTaskStore';
import type { Task } from '../hooks/useTaskStore';

vi.mock('../api/client', () => ({
  api: { updateTask: vi.fn(), deleteTask: vi.fn() },
}));

import Backlog from './Backlog';

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 1,
  task_key: 'TST-1',
  title: 'Backlog Item',
  description: 'desc',
  acceptance: '',
  status: 'backlog',
  agent_status: null,
  agent_pid: null,
  agent_started_at: null,
  sort_order: 1,
  created_at: '',
  updated_at: '',
  ...overrides,
});

describe('Backlog', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('shows empty state when no backlog tasks', () => {
    useAppStore.setState({ tasks: [], showCreateTask: false });
    render(<Backlog />);
    expect(screen.getByText('Your backlog is empty')).toBeInTheDocument();
  });

  test('renders backlog tasks', () => {
    useAppStore.setState({
      tasks: [
        makeTask({ id: 1, task_key: 'TST-1', title: 'First' }),
        makeTask({ id: 2, task_key: 'TST-2', title: 'Second', sort_order: 2 }),
      ],
      showCreateTask: false,
    });
    render(<Backlog />);
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
    expect(screen.getByText('TST-1')).toBeInTheDocument();
  });

  test('does not show non-backlog tasks', () => {
    useAppStore.setState({
      tasks: [
        makeTask({ id: 1, title: 'In Backlog', status: 'backlog' }),
        makeTask({ id: 2, title: 'In Todo', status: 'todo' }),
      ],
      showCreateTask: false,
    });
    render(<Backlog />);
    expect(screen.getByText('In Backlog')).toBeInTheDocument();
    expect(screen.queryByText('In Todo')).not.toBeInTheDocument();
  });

  test('search filters tasks', async () => {
    useAppStore.setState({
      tasks: [
        makeTask({ id: 1, title: 'Alpha feature' }),
        makeTask({ id: 2, title: 'Beta bug', sort_order: 2 }),
      ],
      showCreateTask: false,
    });
    render(<Backlog />);

    const searchInput = screen.getByPlaceholderText('Search backlog...');
    fireEvent.change(searchInput, { target: { value: 'Alpha' } });

    expect(screen.getByText('Alpha feature')).toBeInTheDocument();
    expect(screen.queryByText('Beta bug')).not.toBeInTheDocument();
  });

  test('shows no-match message when search has no results', () => {
    useAppStore.setState({
      tasks: [makeTask({ id: 1, title: 'Something' })],
      showCreateTask: false,
    });
    render(<Backlog />);

    const searchInput = screen.getByPlaceholderText('Search backlog...');
    fireEvent.change(searchInput, { target: { value: 'zzzzz' } });

    expect(screen.getByText(/No tasks match/)).toBeInTheDocument();
  });

  test('has New Task button', () => {
    useAppStore.setState({ tasks: [], showCreateTask: false });
    render(<Backlog />);
    expect(screen.getByRole('button', { name: /New Task/ })).toBeInTheDocument();
  });

  test('shows description when present', () => {
    useAppStore.setState({
      tasks: [makeTask({ description: 'Some description text' })],
      showCreateTask: false,
    });
    render(<Backlog />);
    expect(screen.getByText('Some description text')).toBeInTheDocument();
  });
});
