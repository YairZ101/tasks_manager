import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useAppStore } from '../hooks/useTaskStore';
import type { Task } from '../hooks/useTaskStore';

vi.mock('../api/client', () => ({
  api: { updateTask: vi.fn(), cancelAgent: vi.fn() },
}));

import Board from './Board';

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 1,
  task_key: 'TST-1',
  title: 'Task One',
  description: '',
  acceptance: '',
  status: 'todo',
  agent_status: null,
  agent_pid: null,
  agent_started_at: null,
  agent_worktree: null,
  agent_branch: null,
  sort_order: 1,
  created_at: '',
  updated_at: '',
  ...overrides,
});

describe('Board', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('shows empty state when no board tasks', () => {
    useAppStore.setState({
      tasks: [],
      workflowSteps: [],
      showCreateTask: false,
    });
    render(<Board />);
    expect(screen.getByText('No tasks on the board yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Task' })).toBeInTheDocument();
  });

  test('shows empty state when only backlog tasks exist', () => {
    useAppStore.setState({
      tasks: [makeTask({ status: 'backlog' })],
      workflowSteps: [],
      showCreateTask: false,
    });
    render(<Board />);
    expect(screen.getByText('No tasks on the board yet')).toBeInTheDocument();
  });

  test('renders three columns when tasks exist', () => {
    useAppStore.setState({
      tasks: [makeTask({ status: 'todo' })],
      workflowSteps: [{ id: 1, slug: 'in-progress', name: 'In Progress', requires_review: 0, config: '{}', sort_order: 1, created_at: '' }],
      showCreateTask: false,
    });
    render(<Board />);
    expect(screen.getByText('Todo')).toBeInTheDocument();
    expect(screen.getByText('In Progress')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
  });

  test('renders tasks in correct columns', () => {
    useAppStore.setState({
      tasks: [
        makeTask({ id: 1, task_key: 'TST-1', title: 'Todo Item', status: 'todo' }),
        makeTask({ id: 2, task_key: 'TST-2', title: 'Done Item', status: 'done' }),
      ],
      workflowSteps: [{ id: 1, slug: 'in-progress', name: 'In Progress', requires_review: 0, config: '{}', sort_order: 1, created_at: '' }],
      showCreateTask: false,
    });
    render(<Board />);
    expect(screen.getByText('Todo Item')).toBeInTheDocument();
    expect(screen.getByText('Done Item')).toBeInTheDocument();
  });

  test('has New Task button when board has tasks', () => {
    useAppStore.setState({
      tasks: [makeTask({ status: 'todo' })],
      workflowSteps: [{ id: 1, slug: 'in-progress', name: 'In Progress', requires_review: 0, config: '{}', sort_order: 1, created_at: '' }],
      showCreateTask: false,
    });
    render(<Board />);
    expect(screen.getByRole('button', { name: /New Task/ })).toBeInTheDocument();
  });
});
