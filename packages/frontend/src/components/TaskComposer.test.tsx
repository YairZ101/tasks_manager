import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TaskComposer from './TaskComposer.js';
import { useAppStore } from '../hooks/useTaskStore.js';
import { api } from '../api/client.js';

vi.mock('../api/client.js', () => ({ api: { createTask: vi.fn() } }));

const defaultFlow = {
  id: 5, name: 'Standard delivery', is_default: 1, active_version_id: 8, created_at: '', updated_at: '',
  activeVersion: {
    id: 8, flow_id: 5, version: 3, state: 'published', draft_revision: 0, compiled: null, published_at: '',
    definition: { schemaVersion: 1, nodes: [
      { id: 'begin', type: 'begin', typeVersion: 1, position: { x: 0, y: 0 }, config: { name: 'Begin' } },
      { id: 'agent', type: 'agent', typeVersion: 1, position: { x: 0, y: 0 }, config: { name: 'Implement', preset: 'development', instructions: '', effectLevel: 'workspace_write' } },
    ], connections: [] },
  },
} as any;

describe('TaskComposer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.createTask).mockResolvedValue({ task: { id: 7 } as any, links: [] });
    useAppStore.setState({ workView: 'backlog', createOpen: true, tasks: [], flows: [], refreshTasks: vi.fn(), selectTask: vi.fn(), setCreateOpen: vi.fn() });
  });
  test('creates a task in Backlog by default', async () => {
    render(<TaskComposer />);
    expect(screen.getByRole('dialog', { name: 'Frame the outcome' })).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('What should be different when this is done?'), { target: { value: 'Ship graph editor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(api.createTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Ship graph editor', run: false })));
    expect(screen.queryByRole('button', { name: 'More create actions' })).not.toBeInTheDocument();
  });

  test('selects a Run action and Flow before queuing the new task', async () => {
    useAppStore.setState({ flows: [defaultFlow] });
    render(<TaskComposer />);
    fireEvent.change(screen.getByPlaceholderText('What should be different when this is done?'), { target: { value: 'Ship graph editor' } });
    fireEvent.click(screen.getByRole('button', { name: 'More create actions' }));
    expect(screen.getByRole('menu', { name: 'Create task actions' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: /Create & start run/ }));
    expect(api.createTask).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Create & start run' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Flow to run' })).toHaveValue('5');
    fireEvent.click(screen.getByRole('button', { name: 'Create & start run' }));
    await waitFor(() => expect(api.createTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Ship graph editor', run: true, flow_id: 5 })));
  });

  test('uses the Flow selected for the new Run', async () => {
    const focusedFlow = { ...defaultFlow, id: 6, name: 'Focused delivery', is_default: 0, activeVersion: { ...defaultFlow.activeVersion, flow_id: 6, version: 4 } };
    useAppStore.setState({ flows: [defaultFlow, focusedFlow] });
    render(<TaskComposer />);
    fireEvent.change(screen.getByPlaceholderText('What should be different when this is done?'), { target: { value: 'Ship graph editor' } });
    fireEvent.click(screen.getByRole('button', { name: 'More create actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Create & start run/ }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Flow to run' }), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create & start run' }));
    await waitFor(() => expect(api.createTask).toHaveBeenCalledWith(expect.objectContaining({ run: true, flow_id: 6 })));
  });

  test('warns before immediately starting work blocked by an open task', async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    useAppStore.setState({
      flows: [defaultFlow],
      tasks: [{ id: 4, task_key: 'TST-4', title: 'Publish the API contract', resolution: 'open' } as any],
    });
    render(<TaskComposer />);
    fireEvent.change(screen.getByPlaceholderText('What should be different when this is done?'), { target: { value: 'Ship graph editor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Linked tasks' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Search tasks by title or key' }), { target: { value: 'API' } });
    fireEvent.click(screen.getByRole('option', { name: /TST-4 Publish the API contract/ }));
    fireEvent.click(screen.getByRole('button', { name: 'More create actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Create & start run/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create & start run' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('This task depends on work that is not completed:'));
    expect(api.createTask).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
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
