import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createElement } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Attempt, Flow, Run, RunDetail, Task } from '../domain.js';
import TaskPanel from './TaskPanel.js';
import { buildRunPreflight } from './runPreflight.js';
import { api } from '../api/client.js';
import { useAppStore } from '../hooks/useTaskStore.js';

vi.mock('../api/client.js', () => ({ api: { getTask: vi.fn(), getRun: vi.fn(), listRuns: vi.fn(), getAttempt: vi.fn(), updateTask: vi.fn(), reopenTask: vi.fn(), retryWorkspaceSetup: vi.fn() } }));

const flow = (): Flow => ({
  id: 1, name: 'Delivery', is_default: 1, active_version_id: 3, created_at: '', updated_at: '',
  activeVersion: {
    id: 3, flow_id: 1, version: 4, state: 'published', draft_revision: 0, compiled: null, published_at: '',
    definition: { schemaVersion: 1, nodes: [
      { id: 'begin', type: 'begin', typeVersion: 1, position: { x: 0, y: 0 }, config: { name: 'Begin' } },
      { id: 'agent', type: 'agent', typeVersion: 1, position: { x: 10, y: 0 }, config: { name: 'Implement', preset: 'development' } },
      { id: 'check', type: 'check', typeVersion: 1, position: { x: 20, y: 0 }, config: { name: 'Verify', command: 'bun test', workingDirectory: '.', timeoutMs: 1000 } },
      { id: 'result', type: 'result', typeVersion: 1, position: { x: 30, y: 0 }, config: { name: 'Done', category: 'completed', message: '' } },
    ], connections: [] },
  },
});

describe('buildRunPreflight', () => {
  test('summarizes the published Flow and its blocks', () => {
    const result = buildRunPreflight(flow());
    expect(result).toMatchObject({ name: 'Delivery', version: 4, blockNames: ['Begin', 'Implement', 'Verify', 'Done'] });
  });
  test('requires a published default Flow', () => {
    expect(buildRunPreflight(undefined)).toBeNull();
    expect(buildRunPreflight({ ...flow(), activeVersion: null })).toBeNull();
  });
});

describe('TaskPanel task links', () => {
  const task: Task = {
    id: 7, task_key: 'TST-7', title: 'Build the client', description: '', acceptance: '', preferred_flow_id: null, resolution: 'open', sort_order: 1,
    operational_state: 'backlog', active_run_id: null, active_run_status: null, active_block_id: null, active_block_name: null, workspace_state: null, created_at: '', updated_at: '',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getTask).mockResolvedValue({ task, links: [{ id: 1, link_type: 'blocks', relationship: 'is_blocked_by', linked_task_id: 3, created_at: '', task_key: 'TST-3', title: 'Create the API contract', resolution: 'open' }] });
    vi.mocked(api.listRuns).mockResolvedValue({ runs: [] });
    vi.mocked(api.updateTask).mockResolvedValue({ task, links: [] });
    vi.mocked(api.reopenTask).mockResolvedValue({ task, links: [] });
    useAppStore.setState({ tasks: [task], flows: [flow()], selectTask: vi.fn(), viewFlowVersion: vi.fn(), refreshTasks: vi.fn() });
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
    const identity = screen.getByRole('heading', { name: 'Build the client' }).closest('.panel-head-identity');
    expect(identity).toHaveTextContent('Build the client·TST-7backlog');
    expect(screen.getByRole('heading', { name: 'Build the client' })).toHaveAttribute('title', 'Build the client');
    expect(screen.getByRole('button', { name: 'Edit task' }).closest('.panel-head')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Delete task' }).closest('.panel-head')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Task actions' })).not.toBeInTheDocument();
  });

  test('shows a linked task operational state instead of its resolution', async () => {
    render(createElement(TaskPanel, { taskId: 7 }));

    const linkedTaskRow = (await screen.findByText('Is blocked by · TST-3')).closest('.task-dependencies > div');
    expect(linkedTaskRow).toHaveTextContent('backlog');
    expect(linkedTaskRow).not.toHaveTextContent('open');
    expect(linkedTaskRow?.querySelector('[data-icon="link"]')).not.toBeNull();
    expect(linkedTaskRow?.querySelector('[data-icon="branch"]')).toBeNull();
  });

  test('keeps a finished task read-only and reopens it with its Run history intact', async () => {
    const finishedTask: Task = { ...task, resolution: 'completed', operational_state: 'finished' };
    const reopenedTask: Task = { ...finishedTask, resolution: 'open', operational_state: 'backlog', sort_order: 3 };
    const dependentTask: Task = { ...task, id: 3, task_key: 'TST-3', title: 'Publish the client', sort_order: 2 };
    const links = [{ id: 2, link_type: 'blocks' as const, relationship: 'blocks' as const, linked_task_id: 3, created_at: '', task_key: 'TST-3', title: 'Publish the client', resolution: 'open' as const }];
    const historicalRun = { id: 9, task_id: 7, flow_version_id: 3, workspace_id: null, status: 'finished' as const, result_category: 'completed' as const, reason: null, created_at: '', started_at: '', finished_at: '' };
    vi.mocked(api.getTask).mockResolvedValue({ task: finishedTask, links });
    vi.mocked(api.listRuns).mockResolvedValue({ runs: [historicalRun] });
    vi.mocked(api.getRun).mockResolvedValue({ run: historicalRun, task: finishedTask, flowVersion: flow().activeVersion!, attempts: [], workspace: null });
    vi.mocked(api.reopenTask).mockResolvedValue({ task: reopenedTask, links });
    const refreshTasks = vi.fn(async () => { useAppStore.setState({ tasks: [reopenedTask, dependentTask] }); });
    useAppStore.setState({ tasks: [finishedTask, dependentTask], workView: 'finished', refreshTasks });
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    render(createElement(TaskPanel, { taskId: 7 }));

    expect(await screen.findByText('History stays intact.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit task' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete task' })).toBeInTheDocument();
    const reopen = screen.getByRole('button', { name: /Reopen task/ });
    await waitFor(() => expect(reopen).toBeEnabled());
    fireEvent.click(reopen);

    await waitFor(() => expect(api.reopenTask).toHaveBeenCalledWith(7));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('TST-3 · Publish the client'));
    expect(useAppStore.getState().workView).toBe('backlog');
    expect(await screen.findByRole('button', { name: /Start run/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delivery · v4/ })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Run history' })).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  test('switches the complete detail view between preserved Runs', async () => {
    const finishedTask: Task = { ...task, resolution: 'completed', operational_state: 'finished' };
    const latestRun: Run = { id: 10, task_id: 7, flow_version_id: 3, workspace_id: null, status: 'finished', result_category: 'completed', reason: null, created_at: '2026-08-11T11:00:00Z', started_at: '2026-08-11T11:00:00Z', finished_at: '2026-08-11T11:05:00Z' };
    const initialRun: Run = { ...latestRun, id: 9, flow_version_id: 2, created_at: '2026-08-11T10:00:00Z', started_at: '2026-08-11T10:00:00Z', finished_at: '2026-08-11T10:05:00Z' };
    const latestAttempt: Attempt = { id: 102, run_id: 10, block_id: 'result', sequence: 2, block_attempt: 1, status: 'succeeded', outcome_id: 'completed', decision_comment: null, result_json: null, started_at: '', finished_at: '' };
    const initialAttempt: Attempt = { id: 91, run_id: 9, block_id: 'agent', sequence: 1, block_attempt: 1, status: 'succeeded', outcome_id: 'success', decision_comment: null, result_json: null, started_at: '', finished_at: '' };
    const latestDetail: RunDetail = { run: latestRun, task: finishedTask, flowVersion: flow().activeVersion!, attempts: [latestAttempt], workspace: null };
    const initialDetail: RunDetail = { run: initialRun, task: finishedTask, flowVersion: { ...flow().activeVersion!, id: 2, version: 1 }, attempts: [initialAttempt], workspace: null };
    vi.mocked(api.getTask).mockResolvedValue({ task: finishedTask, links: [] });
    vi.mocked(api.listRuns).mockResolvedValue({ runs: [latestRun, initialRun] });
    vi.mocked(api.getRun).mockImplementation(async (runId) => runId === initialRun.id ? initialDetail : latestDetail);
    vi.mocked(api.getAttempt).mockImplementation(async (attemptId) => ({
      attempt: attemptId === initialAttempt.id ? initialAttempt : latestAttempt,
      logs: [{ id: attemptId, attempt_id: attemptId, level: 'info', message: attemptId === initialAttempt.id ? 'Initial run output' : 'Latest run output', timestamp: '' }],
      hasMore: false,
    }));
    useAppStore.setState({ tasks: [finishedTask] });
    render(createElement(TaskPanel, { taskId: 7 }));

    const history = await screen.findByRole('combobox', { name: 'Run history' });
    expect(screen.getByRole('option', { name: '#10 · Completed' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '#9 · Completed' })).toBeInTheDocument();
    expect(history).toHaveValue('10');
    expect(screen.queryByText('RUN #10')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Latest run output')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delivery · v4/ })).toBeInTheDocument();

    fireEvent.change(history, { target: { value: '9' } });

    await waitFor(() => expect(api.getRun).toHaveBeenCalledWith(9));
    await waitFor(() => expect(history).toHaveValue('9'));
    expect(screen.queryByText('RUN #9')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delivery · v1/ })).toBeInTheDocument();
    const initialStep = screen.getByRole('button', { name: 'Implement Success' });
    expect(initialStep).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Initial run output')).not.toBeInTheDocument();
    expect(screen.queryByText('Latest run output')).not.toBeInTheDocument();

    fireEvent.click(initialStep);
    expect(await screen.findByText('Initial run output')).toBeInTheDocument();
  });

  test('places output under the selected Attempt and lets the user close it', async () => {
    const finishedTask: Task = { ...task, resolution: 'completed', operational_state: 'finished' };
    const run: Run = { id: 10, task_id: 7, flow_version_id: 3, workspace_id: null, status: 'finished', result_category: 'completed', reason: null, created_at: '', started_at: '', finished_at: '' };
    const beginAttempt: Attempt = { id: 101, run_id: 10, block_id: 'begin', sequence: 1, block_attempt: 1, status: 'succeeded', outcome_id: 'started', decision_comment: null, result_json: null, started_at: '', finished_at: '' };
    const checkAttempt: Attempt = { id: 102, run_id: 10, block_id: 'check', sequence: 2, block_attempt: 1, status: 'failed', outcome_id: null, decision_comment: null, result_json: null, started_at: '', finished_at: '' };
    const retryAttempt: Attempt = { ...checkAttempt, id: 103, sequence: 3, block_attempt: 2, status: 'succeeded', outcome_id: 'passed' };
    const runDetail: RunDetail = { run, task: finishedTask, flowVersion: flow().activeVersion!, attempts: [beginAttempt, checkAttempt, retryAttempt], workspace: null };
    vi.mocked(api.getTask).mockResolvedValue({ task: finishedTask, links: [] });
    vi.mocked(api.listRuns).mockResolvedValue({ runs: [run] });
    vi.mocked(api.getRun).mockResolvedValue(runDetail);
    vi.mocked(api.getAttempt).mockImplementation(async (attemptId) => ({
      attempt: attemptId === beginAttempt.id ? beginAttempt : attemptId === checkAttempt.id ? checkAttempt : retryAttempt,
      logs: [{ id: attemptId, attempt_id: attemptId, level: 'info', message: attemptId === beginAttempt.id ? 'Begin output' : attemptId === checkAttempt.id ? 'Check output' : 'Retry output', timestamp: '' }],
      hasMore: false,
    }));
    useAppStore.setState({ tasks: [finishedTask] });
    render(createElement(TaskPanel, { taskId: 7 }));

    expect(await screen.findByRole('heading', { name: 'Run steps' })).toBeInTheDocument();
    const retryButton = await screen.findByRole('button', { name: /Verify Retry 1 · Passed/ });
    expect(retryButton).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Output for Verify')).not.toBeInTheDocument();

    fireEvent.click(retryButton);
    const retryOutput = await screen.findByLabelText('Output for Verify');
    expect(retryButton).toHaveAttribute('aria-expanded', 'true');
    expect(retryButton.closest('.timeline-attempt')).toContainElement(retryOutput);

    const checkButton = screen.getByRole('button', { name: 'Verify Failed' });
    expect(checkButton).not.toHaveTextContent('Attempt 1');
    fireEvent.click(checkButton);

    const checkOutput = await screen.findByLabelText('Output for Verify');
    expect(checkButton).toHaveAttribute('aria-expanded', 'true');
    expect(checkButton.closest('.timeline-attempt')).toContainElement(checkOutput);

    const beginButton = screen.getByRole('button', { name: 'Begin' });
    expect(beginButton).not.toHaveTextContent('Attempt 1');
    fireEvent.click(beginButton);

    const beginOutput = await screen.findByLabelText('Output for Begin');
    expect(beginButton).toHaveAttribute('aria-expanded', 'true');
    expect(beginButton.closest('.timeline-attempt')).toContainElement(beginOutput);
    expect(screen.queryByLabelText('Output for Verify')).not.toBeInTheDocument();

    fireEvent.click(beginButton);
    await waitFor(() => expect(screen.queryByLabelText('Output for Begin')).not.toBeInTheDocument());
    expect(beginButton).toHaveAttribute('aria-expanded', 'false');
  });

  test('shows failed workspace preparation before Run steps and retries that phase', async () => {
    const attentionTask: Task = { ...task, active_run_id: 12, active_run_status: 'attention', operational_state: 'attention' };
    const run: Run = { id: 12, task_id: 7, flow_version_id: 3, workspace_id: 4, status: 'attention', result_category: null, reason: 'Workspace setup exited with code 1.', created_at: '', started_at: '', finished_at: null };
    const detail: RunDetail = {
      run,
      task: attentionTask,
      flowVersion: flow().activeVersion!,
      attempts: [],
      workspace: { id: 4, state: 'retained', worktree_path: '/tmp/task-7', branch: 'agent/TST-7' },
      preparations: [{
        id: 8, workspace_id: 4, run_id: 12, sequence: 1, command: 'bun install --frozen-lockfile', status: 'failed', exit_code: 1, started_at: '', finished_at: '',
        logs: [{ id: 1, preparation_id: 8, level: 'error', message: 'lockfile changed', timestamp: '' }],
      }],
    };
    vi.mocked(api.getTask).mockResolvedValue({ task: attentionTask, links: [] });
    vi.mocked(api.listRuns).mockResolvedValue({ runs: [run] });
    vi.mocked(api.getRun).mockResolvedValue(detail);
    vi.mocked(api.retryWorkspaceSetup).mockResolvedValue({ run: { ...run, status: 'queued' } });
    useAppStore.setState({ tasks: [attentionTask] });
    render(createElement(TaskPanel, { taskId: 7 }));

    const setupHeading = await screen.findByText('Workspace setup failed');
    expect(setupHeading).toBeInTheDocument();
    expect(screen.getByText('bun install --frozen-lockfile')).toBeInTheDocument();
    expect(screen.getByLabelText('Workspace setup output')).toHaveTextContent('lockfile changed');
    const workspaceMeta = screen.getByText('agent/TST-7 · retained');
    expect(workspaceMeta.closest('.run-workspace-meta')).not.toBeNull();
    expect(workspaceMeta.compareDocumentPosition(setupHeading) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(screen.getByText('The Flow did not start.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry block' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop Run' }).closest('.panel-footer')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Retry setup' }).closest('.panel-footer')).not.toBeNull();
    const flowVersion = screen.getByRole('button', { name: /Delivery · v4/ });
    expect(setupHeading.closest('.workspace-preparation')!.compareDocumentPosition(flowVersion) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    const flowSection = flowVersion.closest('.run-flow-section');
    expect(flowSection).not.toBeNull();
    expect(flowSection).toContainElement(screen.getByRole('heading', { name: 'Run steps' }));
    expect(flowSection).not.toContainElement(setupHeading);

    fireEvent.click(screen.getByRole('button', { name: 'Retry setup' }));
    await waitFor(() => expect(api.retryWorkspaceSetup).toHaveBeenCalledWith(12));
  });

  test('keeps a route to the latest actionable Run while viewing history', async () => {
    const attentionTask: Task = { ...task, active_run_id: 12, active_run_status: 'attention', operational_state: 'attention' };
    const latestRun: Run = { id: 12, task_id: 7, flow_version_id: 3, workspace_id: 4, status: 'attention', result_category: null, reason: 'Workspace setup exited with code 1.', created_at: '2026-08-11T11:00:00Z', started_at: '', finished_at: null };
    const historicalRun: Run = { ...latestRun, id: 11, workspace_id: null, status: 'finished', result_category: 'completed', reason: null, created_at: '2026-08-11T10:00:00Z', finished_at: '2026-08-11T10:05:00Z' };
    const latestDetail: RunDetail = {
      run: latestRun,
      task: attentionTask,
      flowVersion: flow().activeVersion!,
      attempts: [],
      workspace: { id: 4, state: 'retained', worktree_path: '/tmp/task-7', branch: 'agent/TST-7' },
      preparations: [{ id: 8, workspace_id: 4, run_id: 12, sequence: 1, command: 'bun install', status: 'failed', exit_code: 1, started_at: '', finished_at: '', logs: [] }],
    };
    const historicalDetail: RunDetail = { run: historicalRun, task: attentionTask, flowVersion: flow().activeVersion!, attempts: [], workspace: null, preparations: [] };
    vi.mocked(api.getTask).mockResolvedValue({ task: attentionTask, links: [] });
    vi.mocked(api.listRuns).mockResolvedValue({ runs: [latestRun, historicalRun] });
    vi.mocked(api.getRun).mockImplementation(async (runId) => runId === historicalRun.id ? historicalDetail : latestDetail);
    useAppStore.setState({ tasks: [attentionTask] });
    render(createElement(TaskPanel, { taskId: 7 }));

    const history = await screen.findByRole('combobox', { name: 'Run history' });
    fireEvent.change(history, { target: { value: String(historicalRun.id) } });

    await waitFor(() => expect(history).toHaveValue(String(historicalRun.id)));
    expect(screen.queryByText('Latest run needs attention')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry setup' })).not.toBeInTheDocument();
    const viewLatest = screen.getByRole('button', { name: 'View latest run' });
    expect(viewLatest.closest('.panel-footer')).not.toBeNull();
    fireEvent.click(viewLatest);

    await waitFor(() => expect(history).toHaveValue(String(latestRun.id)));
    expect(screen.getByRole('button', { name: 'Retry setup' }).closest('.panel-footer')).not.toBeNull();
  });

  test('uses a compact panel when the task contains only a title', async () => {
    vi.mocked(api.getTask).mockResolvedValue({ task, links: [] });
    render(createElement(TaskPanel, { taskId: 7 }));

    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Task TST-7' })).toHaveClass('task-panel-compact'));
  });

  test('keeps the standard panel height when the task has supporting content', async () => {
    const describedTask = { ...task, description: 'Implementation context' };
    vi.mocked(api.getTask).mockResolvedValue({ task: describedTask, links: [] });
    useAppStore.setState({ tasks: [describedTask] });
    render(createElement(TaskPanel, { taskId: 7 }));

    expect(await screen.findByText('Implementation context')).toBeInTheDocument();
    expect(screen.getByText('Context')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Task TST-7' })).not.toHaveClass('task-panel-compact');
    expect(screen.getByRole('dialog', { name: 'Task TST-7' })).not.toHaveClass('task-panel-split');
  });

  test('separates the task brief from Run execution when both are present', async () => {
    const runningTask: Task = { ...task, description: 'Implementation context', active_run_id: 9, active_run_status: 'running', operational_state: 'active' };
    const run: Run = { id: 9, task_id: 7, flow_version_id: 3, workspace_id: null, status: 'running', result_category: null, reason: null, created_at: '', started_at: '', finished_at: null };
    vi.mocked(api.getTask).mockResolvedValue({ task: runningTask, links: [] });
    vi.mocked(api.listRuns).mockResolvedValue({ runs: [run] });
    vi.mocked(api.getRun).mockResolvedValue({ run, task: runningTask, flowVersion: flow().activeVersion!, attempts: [], workspace: null });
    useAppStore.setState({ tasks: [runningTask] });
    render(createElement(TaskPanel, { taskId: 7 }));

    const dialog = await screen.findByRole('dialog', { name: 'Task TST-7' });
    expect(dialog).toHaveClass('task-panel-split');
    expect(screen.getByRole('heading', { name: 'Build the client' }).closest('.panel-head')).not.toBeNull();
    expect(screen.getByText('Context').closest('.task-summary')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Run steps' }).closest('.run-card')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Edit task' }));
    expect(dialog).not.toHaveClass('task-panel-split');
    expect(screen.getByRole('textbox', { name: 'Task title' })).toHaveValue('Build the client');
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
    const selectedFlow = { ...flow(), id: 2, name: 'Focused delivery', is_default: 0 };
    useAppStore.setState({ flows: [flow(), selectedFlow] });
    render(createElement(TaskPanel, { taskId: 7 }));
    fireEvent.change(await screen.findByRole('combobox', { name: 'Flow to run' }), { target: { value: '2' } });
    await waitFor(() => expect(api.updateTask).toHaveBeenCalledWith(7, { preferred_flow_id: 2 }));
  });

  test('opens the exact Flow version pinned to a Run', async () => {
    const runningTask = { ...task, active_run_id: 9, active_run_status: 'running', operational_state: 'active' as const };
    const pinnedVersion = { ...flow().activeVersion!, id: 2, version: 3 };
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
