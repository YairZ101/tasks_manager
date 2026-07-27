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
  test('renders the five fixed operational views', () => {
    render(<WorkBoard />);
    for (const label of ['Backlog', 'Ready', 'Active', 'Needs attention', 'Finished']) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    expect(screen.getByText('Explore graph')).toBeInTheDocument();
    expect(screen.getByText('Development')).toBeInTheDocument();
  });
  test('keeps every operational view visible while marking the current rail selection', () => {
    render(<WorkBoard />);
    expect(document.querySelectorAll('.work-column')).toHaveLength(5);
    expect(document.querySelector('.work-column.focused')?.textContent).toContain('Ready');
  });
  test('selects a task from its card', () => {
    render(<WorkBoard />);
    fireEvent.click(screen.getByText('Build graph'));
    expect(useAppStore.getState().selectedTaskId).toBe(2);
  });
});
