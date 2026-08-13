import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import WorkBoard from './WorkBoard.js';
import { useAppStore } from '../hooks/useTaskStore.js';
import type { Flow, Task } from '../domain.js';
import { api } from '../api/client.js';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../api/client.js', () => ({ api: { listTasks: vi.fn(), startRun: vi.fn() } }));

const task = (id: number, operational_state: Task['operational_state'], title: string): Task => ({
  id, task_key: `TST-${id}`, title, description: '', acceptance: '', preferred_flow_id: null,
  resolution: operational_state === 'finished' ? 'completed' : 'open', sort_order: id, operational_state,
  active_run_id: operational_state === 'active' ? id : null, active_run_status: operational_state === 'active' ? 'running' : null,
  active_block_id: null, active_block_name: operational_state === 'active' ? 'Development' : null, workspace_state: null,
  created_at: `2026-01-${String(id).padStart(2, '0')}T00:00:00Z`, updated_at: `2026-02-${String(id).padStart(2, '0')}T00:00:00Z`,
});

const flow = (id: number, name: string): Flow => ({ id, name, is_default: 0, active_version_id: null, activeVersion: null, created_at: '', updated_at: '' });
const publishedFlow = (id: number, name: string, isDefault = 1): Flow => ({
  ...flow(id, name), is_default: isDefault, active_version_id: id,
  activeVersion: { id, flow_id: id, version: 1, state: 'published', draft_revision: 0, compiled: null, published_at: '', definition: { schemaVersion: 1, nodes: [], connections: [] } },
});

function openFilters() {
  fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
}

function selectOption(label: string, option: string) {
  fireEvent.click(screen.getByRole('combobox', { name: label }));
  fireEvent.click(screen.getByRole('option', { name: option }));
}

describe('WorkBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    useAppStore.setState({ tasks: [task(1, 'backlog', 'Explore graph'), task(2, 'active', 'Build graph')], flows: [], selectedTaskId: null, workView: 'open', createOpen: false });
    vi.mocked(api.listTasks).mockImplementation(async () => ({ tasks: useAppStore.getState().tasks }));
    vi.mocked(api.startRun).mockResolvedValue({ run: { id: 99 } });
  });

  test('starts as one open task list grouped by operational state', () => {
    render(<WorkBoard />);
    expect(screen.getByRole('region', { name: 'Tasks' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Tasks' })).toBeVisible();
    expect(screen.queryByRole('group', { name: 'Task view' })).not.toBeInTheDocument();
    openFilters();
    expect(screen.getByRole('combobox', { name: 'Resolution' })).toHaveTextContent('Open');
    expect(screen.getByRole('heading', { name: 'Active' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Backlog' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Needs attention' })).not.toBeInTheDocument();
    expect(screen.getByText('Explore graph')).toBeInTheDocument();
    expect(screen.getByText('Build graph')).toBeInTheDocument();
  });

  test('opens task creation from the shared page action', () => {
    render(<WorkBoard />);
    const header = document.querySelector('.page-header');
    expect(header).not.toBeNull();
    const newTask = within(header as HTMLElement).getByRole('button', { name: 'New task' });
    expect(newTask).toHaveClass('page-header-action');

    fireEvent.click(newTask);

    expect(useAppStore.getState().createOpen).toBe(true);
  });

  test('moves between open, all, and finished from the Resolution filter', () => {
    useAppStore.setState({ tasks: [task(1, 'backlog', 'Explore graph'), task(3, 'finished', 'Shipped graph')] });
    render(<WorkBoard />);
    expect(screen.queryByText('Shipped graph')).not.toBeInTheDocument();
    openFilters();
    selectOption('Resolution', 'All tasks');
    expect(screen.getByText('Explore graph')).toBeInTheDocument();
    expect(screen.getByText('Shipped graph')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Resolution: All tasks/ })).toBeInTheDocument();
    selectOption('Resolution', 'Finished');
    expect(screen.getByText('Shipped graph')).toBeInTheDocument();
    expect(screen.queryByText('Explore graph')).not.toBeInTheDocument();
  });

  test('searches task keys, titles, descriptions, and acceptance criteria', () => {
    useAppStore.setState({ tasks: [
      { ...task(1, 'backlog', 'Explore graph'), description: 'Investigate layout' },
      { ...task(2, 'backlog', 'Build graph'), acceptance: 'Keyboard support works' },
    ] });
    render(<WorkBoard />);
    const search = screen.getByPlaceholderText('Search tasks');
    fireEvent.change(search, { target: { value: 'keyboard' } });
    expect(screen.getByText('Build graph')).toBeInTheDocument();
    expect(screen.queryByText('Explore graph')).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'TST-1' } });
    expect(screen.getByText('Explore graph')).toBeInTheDocument();
  });

  test('focuses search with slash and clears it with Escape', () => {
    render(<WorkBoard />);
    const search = screen.getByPlaceholderText('Search tasks');
    fireEvent.keyDown(window, { key: '/' });
    expect(search).toHaveFocus();
    fireEvent.change(search, { target: { value: 'Build' } });
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(search).toHaveValue('');
    expect(search).not.toHaveFocus();
  });

  test('does not steal dropdown keystrokes for the search shortcut', () => {
    render(<WorkBoard />);
    const group = screen.getByRole('combobox', { name: 'Group tasks by' });
    group.focus();
    fireEvent.keyDown(group, { key: '/' });
    expect(screen.getByPlaceholderText('Search tasks')).not.toHaveFocus();
    expect(group).toHaveFocus();
  });

  test('filters by state and exposes removable filter chips', () => {
    render(<WorkBoard />);
    openFilters();
    selectOption('Operational state', 'Active');
    expect(screen.getByText('Build graph')).toBeInTheDocument();
    expect(screen.queryByText('Explore graph')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /State: Active/ }));
    expect(screen.getByText('Explore graph')).toBeInTheDocument();
  });

  test('filters by preferred flow and workspace state', () => {
    useAppStore.setState({
      flows: [flow(7, 'Release flow')],
      tasks: [{ ...task(1, 'backlog', 'Default task'), workspace_state: null }, { ...task(2, 'backlog', 'Release task'), preferred_flow_id: 7, workspace_state: 'cleanup_required' }],
    });
    render(<WorkBoard />);
    openFilters();
    selectOption('Preferred flow', 'Release flow');
    selectOption('Workspace state', 'Needs cleanup');
    expect(screen.getByText('Release task')).toBeInTheDocument();
    expect(screen.queryByText('Default task')).not.toBeInTheDocument();
  });

  test('changes grouping and sorting without changing task data', () => {
    render(<WorkBoard />);
    selectOption('Group tasks by', 'No grouping');
    selectOption('Sort tasks by', 'Task key');
    const list = screen.getByRole('list', { name: 'Tasks tasks' });
    const rows = within(list).getAllByRole('button', { name: /TST-/ });
    expect(rows[0]).toHaveAccessibleName(/TST-1/);
    expect(rows[1]).toHaveAccessibleName(/TST-2/);
  });

  test('puts no grouping first and preserves a marked current option in every selector', () => {
    render(<WorkBoard />);
    const group = screen.getByRole('combobox', { name: 'Group tasks by' });
    expect(group).toHaveTextContent('State');
    expect(screen.getByRole('combobox', { name: 'Sort tasks by' })).toHaveTextContent('Recently updated');
    fireEvent.click(group);
    const groupOptions = screen.getAllByRole('option');
    expect(groupOptions[0]).toHaveTextContent('No grouping');
    expect(screen.getByRole('option', { name: 'State' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(group);
    openFilters();
    for (const name of ['Resolution', 'Operational state', 'Preferred flow', 'Workspace state']) {
      const select = screen.getByRole('combobox', { name });
      fireEvent.click(select);
      expect(screen.getByRole('option', { selected: true })).toBeInTheDocument();
      fireEvent.click(select);
    }
  });

  test('keeps the selection mark visible while the selected option is hovered', () => {
    render(<WorkBoard />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Group tasks by' }));
    const selected = screen.getByRole('option', { name: 'State' });
    fireEvent.mouseEnter(selected);
    expect(selected).toHaveAttribute('aria-selected', 'true');
    expect(selected.querySelector('[data-icon="check"]')).not.toBeNull();
  });

  test('supports keyboard selection and returns focus to the trigger', () => {
    render(<WorkBoard />);
    const group = screen.getByRole('combobox', { name: 'Group tasks by' });
    fireEvent.keyDown(group, { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('listbox', { name: 'Group tasks by options' }), { key: 'Home' });
    fireEvent.keyDown(screen.getByRole('listbox', { name: 'Group tasks by options' }), { key: 'Enter' });
    expect(group).toHaveTextContent('No grouping');
    expect(group).toHaveFocus();
  });

  test('closes Filters on an outside click and Escape', () => {
    render(<WorkBoard />);
    const trigger = screen.getByRole('button', { name: 'Filters' });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.pointerDown(document.body);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  test('closes a nested selection before closing Filters with Escape', () => {
    render(<WorkBoard />);
    openFilters();
    const filters = screen.getByRole('button', { name: 'Filters' });
    const resolution = screen.getByRole('combobox', { name: 'Resolution' });
    fireEvent.click(resolution);
    fireEvent.keyDown(screen.getByRole('listbox', { name: 'Resolution options' }), { key: 'Escape' });
    expect(screen.queryByRole('listbox', { name: 'Resolution options' })).not.toBeInTheDocument();
    expect(filters).toHaveAttribute('aria-expanded', 'true');
    expect(resolution).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(filters).toHaveAttribute('aria-expanded', 'false');
  });

  test('collapses and restores a task group', () => {
    render(<WorkBoard />);
    const backlog = screen.getByRole('button', { name: /Backlog Available to start 1/ });
    const heading = screen.getByRole('heading', { name: 'Backlog' });
    fireEvent.click(backlog);
    expect(backlog).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('heading', { name: 'Backlog' })).toBe(heading);
    expect(screen.queryByText('Explore graph')).not.toBeInTheDocument();
    fireEvent.click(backlog);
    expect(screen.getByText('Explore graph')).toBeInTheDocument();
  });

  test('persists grouping and filters for the next visit', () => {
    render(<WorkBoard />);
    selectOption('Group tasks by', 'Resolution');
    openFilters();
    selectOption('Operational state', 'Active');
    expect(JSON.parse(window.localStorage.getItem('flow.task-explorer.v1') ?? '{}')).toMatchObject({ groupBy: 'resolution', stateFilter: 'active' });
  });

  test('ignores invalid persisted explorer options', () => {
    window.localStorage.setItem('flow.task-explorer.v1', JSON.stringify({ version: 1, groupBy: 'cards', sortBy: 'priority', stateFilter: 'ready' }));
    render(<WorkBoard />);
    expect(screen.getByRole('combobox', { name: 'Group tasks by' })).toHaveTextContent('State');
    expect(screen.getByRole('combobox', { name: 'Sort tasks by' })).toHaveTextContent('Recently updated');
    openFilters();
    expect(screen.getByRole('combobox', { name: 'Operational state' })).toHaveTextContent('Any state');
  });

  test('selects a task from its row', () => {
    render(<WorkBoard />);
    expect(screen.getByText('TST-2').closest('button')).toHaveClass('task-row-main');
    fireEvent.click(screen.getByText('Build graph'));
    expect(useAppStore.getState().selectedTaskId).toBe(2);
  });

  test('starts a backlog task with its project default Flow', async () => {
    const backlogTask = task(1, 'backlog', 'Explore graph');
    useAppStore.setState({ tasks: [backlogTask], flows: [publishedFlow(7, 'Delivery')], selectedTaskId: null });
    render(<WorkBoard />);
    const start = screen.getByRole('button', { name: 'Start run' });
    expect(start).toHaveAttribute('title', 'Start with Delivery');
    fireEvent.click(start);
    await waitFor(() => expect(api.startRun).toHaveBeenCalledWith(1, 7));
    expect(useAppStore.getState().selectedTaskId).toBeNull();
  });

  test('starts a backlog task with its published preferred Flow', async () => {
    useAppStore.setState({
      tasks: [{ ...task(1, 'backlog', 'Explore graph'), preferred_flow_id: 8 }],
      flows: [publishedFlow(7, 'Default delivery'), publishedFlow(8, 'Focused delivery', 0)],
    });
    render(<WorkBoard />);
    fireEvent.click(screen.getByRole('button', { name: 'Start run' }));
    await waitFor(() => expect(api.startRun).toHaveBeenCalledWith(1, 8));
  });

  test('keeps active tasks on a view-run action instead of offering another Run', () => {
    useAppStore.setState({ tasks: [task(2, 'active', 'Build graph')], flows: [publishedFlow(7, 'Delivery')] });
    render(<WorkBoard />);
    expect(screen.queryByRole('button', { name: 'Start run' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View run' })).toBeInTheDocument();
  });

  test('explains the intervention needed on attention rows', () => {
    useAppStore.setState({ tasks: [{ ...task(3, 'attention', 'Approve release'), description: 'Background that is less urgent', active_run_id: 9, active_run_status: 'waiting', active_block_name: 'Release approval' }] });
    render(<WorkBoard />);
    expect(screen.getByText('Decision required in Release approval')).toBeInTheDocument();
    expect(screen.queryByText('Background that is less urgent')).not.toBeInTheDocument();
  });

  test('offers task creation from an empty explorer', () => {
    useAppStore.setState({ tasks: [] });
    render(<WorkBoard />);
    expect(screen.getByText('Start with one task')).toBeInTheDocument();
    const newTaskButtons = screen.getAllByRole('button', { name: /new task/i });
    expect(newTaskButtons).toHaveLength(2);
    expect(newTaskButtons.every((button) => button.querySelector('.button-shortcut') === null)).toBe(true);
  });

  test('resets a search with no results', () => {
    render(<WorkBoard />);
    fireEvent.change(screen.getByPlaceholderText('Search tasks'), { target: { value: 'no-match' } });
    expect(screen.getByText('No tasks match this view')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(screen.getByText('Explore graph')).toBeInTheDocument();
  });
});
