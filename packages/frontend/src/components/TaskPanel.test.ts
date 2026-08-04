import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createElement } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Flow, Task } from '../domain.js';
import TaskPanel from './TaskPanel.js';
import { buildRunPreflight } from './runPreflight.js';
import { api } from '../api/client.js';
import { useAppStore } from '../hooks/useTaskStore.js';

vi.mock('../api/client.js', () => ({ api: { getTask: vi.fn(), getRun: vi.fn(), listRuns: vi.fn(), getAttempt: vi.fn(), updateTask: vi.fn() } }));

const flow = (effectLevel: 'read_only' | 'workspace_write' | 'external_write'): Flow => ({
  id: 1, name: 'Delivery', is_default: 1, active_version_id: 3, created_at: '', updated_at: '',
  activeVersion: {
    id: 3, flow_id: 1, version: 4, state: 'published', draft_revision: 0, compiled: null, published_at: '',
    definition: { schemaVersion: 1, nodes: [
      { id: 'begin', type: 'begin', typeVersion: 1, position: { x: 0, y: 0 }, config: { name: 'Begin' } },
      { id: 'agent', type: 'agent', typeVersion: 1, position: { x: 10, y: 0 }, config: { name: 'Implement', preset: 'development', instructions: '', effectLevel } },
      { id: 'check', type: 'check', typeVersion: 1, position: { x: 20, y: 0 }, config: { name: 'Verify', command: 'bun test', workingDirectory: '.', timeoutMs: 1000, effectLevel: 'read_only' } },
      { id: 'result', type: 'result', typeVersion: 1, position: { x: 30, y: 0 }, config: { name: 'Done', category: 'completed', message: '' } },
    ], connections: [] },
  },
});

describe('buildRunPreflight', () => {
  test('summarizes the published Flow and its strongest effect level', () => {
    const result = buildRunPreflight(flow('workspace_write'));
    expect(result).toMatchObject({ name: 'Delivery', version: 4, effectCopy: 'May change this task’s workspace', blockNames: ['Begin', 'Implement', 'Verify', 'Done'] });
  });
  test('requires a published default Flow', () => {
    expect(buildRunPreflight(undefined)).toBeNull();
    expect(buildRunPreflight({ ...flow('read_only'), activeVersion: null })).toBeNull();
  });

  test('describes read-only and external-write Flows accurately', () => {
    expect(buildRunPreflight(flow('read_only'))?.effectCopy).toBe('Read-only analysis and checks');
    expect(buildRunPreflight(flow('external_write'))?.effectCopy).toBe('May change the workspace and external services');
  });
});

describe('TaskPanel task links', () => {
  const task: Task = {
    id: 7, task_key: 'TST-7', title: 'Build the client', description: '', acceptance: '', preferred_flow_id: null, resolution: 'open', sort_order: 1,
    operational_state: 'backlog', active_run_id: null, active_run_status: null, active_block_id: null, active_block_name: null, workspace_state: null, created_at: '', updated_at: '',
  };

  beforeEach(() => {
    vi.mocked(api.getTask).mockResolvedValue({ task, links: [{ id: 1, link_type: 'blocks', relationship: 'is_blocked_by', linked_task_id: 3, created_at: '', task_key: 'TST-3', title: 'Create the API contract', resolution: 'open' }] });
    vi.mocked(api.listRuns).mockResolvedValue({ runs: [] });
    vi.mocked(api.updateTask).mockResolvedValue({ task, links: [] });
    useAppStore.setState({ tasks: [task], flows: [flow('read_only')], selectTask: vi.fn(), viewFlowVersion: vi.fn(), refreshTasks: vi.fn() });
  });

  test('warns before a Run when a dependency has not completed', async () => {
    render(createElement(TaskPanel, { taskId: 7 }));
    expect(await screen.findByText('Dependency not completed')).toBeInTheDocument();
    expect(screen.getByText(/TST-3\. You can still start this Flow/)).toBeInTheDocument();
    expect(screen.queryByText('RUN SETUP')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Flow to run' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Project default · Delivery · v4' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start run/ })).toBeInTheDocument();
    expect(screen.getByTitle('Option + Enter')).toHaveAttribute('aria-keyshortcuts', 'Alt+Enter');
  });

  test('keeps edit and delete actions in the header', async () => {
    render(createElement(TaskPanel, { taskId: 7 }));
    expect(await screen.findByRole('dialog', { name: 'Task TST-7' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit task' }).closest('.panel-head')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Delete task' }).closest('.panel-head')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Task actions' })).not.toBeInTheDocument();
  });

  test('uses the shared details fields while editing', async () => {
    render(createElement(TaskPanel, { taskId: 7 }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit task' }));
    expect(screen.getByRole('textbox', { name: 'Task title' })).toHaveValue('Build the client');
    expect(screen.getByRole('combobox', { name: 'Search tasks by title or key' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Start run/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete task/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  test('renders an unbroken task title in the detail heading', async () => {
    const longTitle = 'task'.repeat(80);
    const longTask = { ...task, title: longTitle };
    useAppStore.setState({ tasks: [longTask] });
    render(createElement(TaskPanel, { taskId: longTask.id }));
    expect(await screen.findByRole('heading', { name: longTitle })).toBeInTheDocument();
  });

  test('saves a selected published Flow for the task', async () => {
    const selectedFlow = { ...flow('read_only'), id: 2, name: 'Focused delivery', is_default: 0 };
    useAppStore.setState({ flows: [flow('read_only'), selectedFlow] });
    render(createElement(TaskPanel, { taskId: 7 }));
    fireEvent.change(await screen.findByRole('combobox', { name: 'Flow to run' }), { target: { value: '2' } });
    await waitFor(() => expect(api.updateTask).toHaveBeenCalledWith(7, { preferred_flow_id: 2 }));
  });

  test('opens the exact Flow version pinned to a Run', async () => {
    const runningTask = { ...task, active_run_id: 9, active_run_status: 'running', operational_state: 'active' as const };
    const pinnedVersion = { ...flow('read_only').activeVersion!, id: 2, version: 3 };
    vi.mocked(api.getTask).mockResolvedValue({ task: runningTask, links: [] });
    vi.mocked(api.getRun).mockResolvedValue({
      run: { id: 9, task_id: 7, flow_version_id: 2, workspace_id: null, status: 'running', result_category: null, reason: null, created_at: '', started_at: '', finished_at: null },
      task: runningTask,
      flowVersion: pinnedVersion,
      attempts: [],
      workspace: null,
    });
    useAppStore.setState({ tasks: [runningTask] });
    render(createElement(TaskPanel, { taskId: 7 }));

    fireEvent.click(await screen.findByRole('button', { name: /Delivery · v3/ }));

    expect(useAppStore.getState().selectTask).toHaveBeenCalledWith(null);
    expect(useAppStore.getState().viewFlowVersion).toHaveBeenCalledWith(1, 2);
  });
});
