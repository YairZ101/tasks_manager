import { beforeEach, describe, expect, test } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import WorkBoard from './WorkBoard.js';
import { useAppStore } from '../hooks/useTaskStore.js';
import type { Task } from '../domain.js';

const task = (id: number, operational_state: Task['operational_state'], title: string): Task => ({
  id, task_key: `TST-${id}`, title, description: '', acceptance: '', preferred_flow_id: null,
  resolution: operational_state === 'finished' ? 'completed' : 'open', sort_order: id, operational_state,
  active_run_id: operational_state === 'active' ? id : null, active_run_status: operational_state === 'active' ? 'running' : null,
  active_block_id: null, active_block_name: operational_state === 'active' ? 'Development' : null, workspace_state: null,
  created_at: '', updated_at: '',
});

describe('WorkBoard', () => {
  beforeEach(() => useAppStore.setState({ tasks: [task(1, 'backlog', 'Explore graph'), task(2, 'active', 'Build graph')], selectedTaskId: null, workView: 'backlog' }));
  test('renders the selected operational queue', () => {
    render(<WorkBoard />);
    expect(screen.getByRole('heading', { name: 'Backlog' })).toBeInTheDocument();
    expect(screen.getByText('Explore graph')).toBeInTheDocument();
    expect(screen.queryByText('Build graph')).not.toBeInTheDocument();
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
  test('keeps a long unbroken title in the task card name', () => {
    const longTitle = 'implementation'.repeat(40);
    useAppStore.setState({ tasks: [task(3, 'backlog', longTitle)], workView: 'backlog' });
    render(<WorkBoard />);
    expect(screen.getByRole('button', { name: `TST-3: ${longTitle}` })).toBeInTheDocument();
  });
  test('uses the same footer structure with and without task context', () => {
    useAppStore.setState({ tasks: [{ ...task(3, 'backlog', 'Documented task'), description: 'Useful background' }, task(4, 'backlog', 'Lean task')], workView: 'backlog' });
    render(<WorkBoard />);
    expect(document.querySelectorAll('.queue-stack .task-card')).toHaveLength(2);
    expect(document.querySelectorAll('.queue-stack .task-card-foot')).toHaveLength(2);
  });
  test('does not repeat the task creation action below a populated backlog', () => {
    useAppStore.setState({ workView: 'backlog' });
    render(<WorkBoard />);
    expect(screen.queryByRole('button', { name: /Add task/ })).not.toBeInTheDocument();
  });
  test('explains the intervention needed on attention cards', () => {
    useAppStore.setState({ tasks: [{ ...task(3, 'attention', 'Approve release'), active_run_id: 9, active_run_status: 'waiting', active_block_name: 'Release approval' }], workView: 'attention' });
    render(<WorkBoard />);
    expect(screen.getByText('Decision required in Release approval')).toBeInTheDocument();
    expect(screen.getByText('Review')).toBeInTheDocument();
  });
  test('offers task creation from an empty Backlog', () => {
    useAppStore.setState({ tasks: [], workView: 'backlog' });
    render(<WorkBoard />);
    expect(screen.getByText('Start with one task')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new task/i })).toBeInTheDocument();
  });
});
