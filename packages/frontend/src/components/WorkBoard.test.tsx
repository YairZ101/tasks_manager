import { beforeEach, describe, expect, test } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import WorkBoard from './WorkBoard.js';
import { useAppStore } from '../hooks/useTaskStore.js';
import type { Task } from '../domain.js';

const task = (id: number, operational_state: Task['operational_state'], title: string): Task => ({
  id, task_key: `TST-${id}`, title, description: '', acceptance: '', queue_state: operational_state === 'backlog' ? 'backlog' : 'ready',
  resolution: operational_state === 'finished' ? 'completed' : 'open', sort_order: id, operational_state,
  active_run_id: operational_state === 'active' ? id : null, active_run_status: operational_state === 'active' ? 'running' : null,
  active_block_id: null, active_block_name: operational_state === 'active' ? 'Development' : null, workspace_state: null,
  created_at: '', updated_at: '',
});

describe('WorkBoard', () => {
  beforeEach(() => useAppStore.setState({ tasks: [task(1, 'backlog', 'Explore graph'), task(2, 'active', 'Build graph')], selectedTaskId: null, workView: 'ready' }));
  test('renders the selected operational queue', () => {
    render(<WorkBoard />);
    expect(screen.getByRole('heading', { name: 'Ready' })).toBeInTheDocument();
    expect(screen.queryByText('Explore graph')).not.toBeInTheDocument();
    expect(screen.getByText('No ready tasks')).toBeInTheDocument();
  });
  test('shows only one queue at a time', () => {
    useAppStore.setState({ workView: 'active' });
    render(<WorkBoard />);
    expect(document.querySelectorAll('.work-column')).toHaveLength(0);
    expect(screen.getByText('Build graph')).toBeInTheDocument();
  });
  test('selects a task from its card', () => {
    useAppStore.setState({ workView: 'active' });
    render(<WorkBoard />);
    fireEvent.click(screen.getByText('Build graph'));
    expect(useAppStore.getState().selectedTaskId).toBe(2);
  });
  test('explains the intervention needed on attention cards', () => {
    useAppStore.setState({ tasks: [{ ...task(3, 'attention', 'Approve release'), active_run_id: 9, active_run_status: 'waiting', active_block_name: 'Release approval' }], workView: 'attention' });
    render(<WorkBoard />);
    expect(screen.getByText('Decision required in Release approval')).toBeInTheDocument();
    expect(screen.getByText('Review')).toBeInTheDocument();
  });
  test('keeps creation guidance in Backlog when an empty workspace is viewed in Ready', () => {
    useAppStore.setState({ tasks: [], workView: 'ready' });
    render(<WorkBoard />);
    expect(screen.getByText('Nothing is ready yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new task/i })).not.toBeInTheDocument();
  });
});
