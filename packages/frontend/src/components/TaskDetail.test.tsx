import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useAppStore } from '../hooks/useTaskStore';
import type { Task, TaskLog } from '../hooks/useTaskStore';
import { buildLogRows } from './TaskDetail';

vi.mock('../api/client', () => ({
  api: {
    getTaskLogs: vi.fn().mockResolvedValue({ logs: [], hasMore: false }),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    startAgent: vi.fn(),
    cancelAgent: vi.fn(),
  },
}));

import TaskDetail from './TaskDetail';

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 1,
  task_key: 'TST-1',
  title: 'Test Task',
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

const makeLog = (overrides: Partial<TaskLog> = {}): TaskLog => ({
  id: 1,
  task_id: 1,
  run_number: 1,
  timestamp: '2024-01-01T00:00:00Z',
  level: 'agent',
  message: 'test log',
  ...overrides,
});

const noop = () => () => {};

describe('TaskDetail', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('renders task title and key', () => {
    useAppStore.setState({ tasks: [makeTask()], selectedTaskId: 1 });
    render(<TaskDetail taskId={1} registerLogCallback={noop} />);
    expect(screen.getByText('Test Task')).toBeInTheDocument();
    expect(screen.getByText('TST-1')).toBeInTheDocument();
  });

  test('shows empty log state when no logs', () => {
    useAppStore.setState({ tasks: [makeTask()], selectedTaskId: 1 });
    render(<TaskDetail taskId={1} registerLogCallback={noop} />);
    expect(screen.getByText('Agent Logs')).toBeInTheDocument();
  });

  test('returns null when task not found', () => {
    useAppStore.setState({ tasks: [], selectedTaskId: null });
    const { container } = render(<TaskDetail taskId={999} registerLogCallback={noop} />);
    expect(container.innerHTML).toBe('');
  });

  test('Run Agent button is enabled when under concurrency limit', () => {
    useAppStore.setState({
      tasks: [makeTask({ status: 'todo' })],
      selectedTaskId: 1,
      activeRuns: [],
      maxConcurrentAgents: 3,
    });
    render(<TaskDetail taskId={1} registerLogCallback={noop} />);
    const btn = screen.getByText('Run Agent').closest('button');
    expect(btn).not.toBeDisabled();
  });

  test('Run Agent button is disabled when concurrency limit reached', () => {
    useAppStore.setState({
      tasks: [makeTask({ status: 'todo' })],
      selectedTaskId: 1,
      activeRuns: [
        { taskId: 10, taskKey: 'TST-10' },
        { taskId: 11, taskKey: 'TST-11' },
        { taskId: 12, taskKey: 'TST-12' },
      ],
      maxConcurrentAgents: 3,
    });
    render(<TaskDetail taskId={1} registerLogCallback={noop} />);
    const btn = screen.getByText('Run Agent').closest('button');
    expect(btn).toBeDisabled();
  });

  test('Run Agent button is disabled when this task is already running', () => {
    useAppStore.setState({
      tasks: [makeTask({ status: 'in-progress', agent_status: 'running' })],
      selectedTaskId: 1,
      activeRuns: [{ taskId: 1, taskKey: 'TST-1' }],
      maxConcurrentAgents: 3,
    });
    render(<TaskDetail taskId={1} registerLogCallback={noop} />);
    // When running, Cancel Agent button is shown instead
    expect(screen.getByText('Cancel Agent')).toBeInTheDocument();
  });

  test('SSE logs received before loadLogs resolves are not lost', async () => {
    const { api } = await import('../api/client');
    let resolveLoad!: (v: any) => void;
    (api.getTaskLogs as any).mockReturnValue(new Promise((r) => { resolveLoad = r; }));

    let capturedCallback: ((logs: TaskLog[]) => void) | null = null;
    const registerLogCallback = (_taskId: number, cb: (logs: TaskLog[]) => void) => {
      capturedCallback = cb;
      return () => {};
    };

    useAppStore.setState({ tasks: [makeTask()], selectedTaskId: 1 });
    render(<TaskDetail taskId={1} registerLogCallback={registerLogCallback} />);

    // SSE log arrives before loadLogs resolves
    const sseLog = makeLog({ id: undefined as any, run_number: 1, message: 'Agent cancelled by user.' });
    act(() => { capturedCallback!([sseLog]); });

    // loadLogs resolves with empty DB (cancel committed after fetch started — SSE beat it)
    await act(async () => {
      resolveLoad({ logs: [], hasMore: false });
    });

    // SSE log preserved → logs.length > 0 → placeholder is absent
    expect(screen.queryByText(/No agent runs yet/)).not.toBeInTheDocument();
  });

  test('SSE logs already in DB are not duplicated after loadLogs resolves', async () => {
    const { api } = await import('../api/client');
    let resolveLoad!: (v: any) => void;
    (api.getTaskLogs as any).mockReturnValue(new Promise((r) => { resolveLoad = r; }));

    let capturedCallback: ((logs: TaskLog[]) => void) | null = null;
    const registerLogCallback = (_taskId: number, cb: (logs: TaskLog[]) => void) => {
      capturedCallback = cb;
      return () => {};
    };

    useAppStore.setState({ tasks: [makeTask()], selectedTaskId: 1 });
    render(<TaskDetail taskId={1} registerLogCallback={registerLogCallback} />);

    // SSE log arrives before loadLogs (no id — as broadcast by backend)
    const sseLog = makeLog({ id: undefined as any, run_number: 1, message: 'Agent cancelled by user.' });
    act(() => { capturedCallback!([sseLog]); });

    // loadLogs resolves with the same log in DB (with id — persisted)
    const dbLog = makeLog({ id: 42, run_number: 1, message: 'Agent cancelled by user.' });
    await act(async () => {
      resolveLoad({ logs: [dbLog], hasMore: false });
    });

    // DB log present → placeholder absent; dedup means exactly one log line rendered.
    // The virtualizer doesn't render text in JSDOM (no layout), but we can verify
    // the virtualizer container has a non-zero height (logs exist) and the empty
    // state is hidden.
    expect(screen.queryByText(/No agent runs yet/)).not.toBeInTheDocument();
    // Virtualizer total height = 1 separator (28px) + 1 log (22px) = 50px
    // If dedup failed we'd get 28 + 22 + 22 = 72px
    const virtualContainer = document.querySelector('[style*="height:"]');
    expect(virtualContainer).not.toBeNull();
    expect(virtualContainer!.getAttribute('style')).toContain('height: 50px');
  });
});

describe('buildLogRows', () => {
  test('returns empty array for no logs', () => {
    expect(buildLogRows([], new Set())).toEqual([]);
  });

  test('creates separator before each run', () => {
    const logs = [
      makeLog({ id: 1, run_number: 1, message: 'a' }),
      makeLog({ id: 2, run_number: 2, message: 'b' }),
    ];
    const rows = buildLogRows(logs, new Set());

    expect(rows).toEqual([
      { type: 'separator', runNumber: 1, key: 'sep-1' },
      { type: 'log', log: logs[0], key: 'log-1' },
      { type: 'separator', runNumber: 2, key: 'sep-2' },
      { type: 'log', log: logs[1], key: 'log-2' },
    ]);
  });

  test('groups multiple logs under same run separator', () => {
    const logs = [
      makeLog({ id: 1, run_number: 1, message: 'a' }),
      makeLog({ id: 2, run_number: 1, message: 'b' }),
      makeLog({ id: 3, run_number: 1, message: 'c' }),
    ];
    const rows = buildLogRows(logs, new Set());

    const separators = rows.filter((r) => r.type === 'separator');
    const logRows = rows.filter((r) => r.type === 'log');
    expect(separators).toHaveLength(1);
    expect(logRows).toHaveLength(3);
  });

  test('collapsing a run hides its log rows but keeps separator', () => {
    const logs = [
      makeLog({ id: 1, run_number: 1, message: 'visible' }),
      makeLog({ id: 2, run_number: 2, message: 'hidden' }),
      makeLog({ id: 3, run_number: 3, message: 'also visible' }),
    ];
    const rows = buildLogRows(logs, new Set([2]));

    expect(rows).toEqual([
      { type: 'separator', runNumber: 1, key: 'sep-1' },
      { type: 'log', log: logs[0], key: 'log-1' },
      { type: 'separator', runNumber: 2, key: 'sep-2' },
      { type: 'separator', runNumber: 3, key: 'sep-3' },
      { type: 'log', log: logs[2], key: 'log-3' },
    ]);
  });

  test('collapsing multiple runs independently', () => {
    const logs = [
      makeLog({ id: 1, run_number: 1, message: 'r1' }),
      makeLog({ id: 2, run_number: 2, message: 'r2' }),
      makeLog({ id: 3, run_number: 3, message: 'r3' }),
    ];
    const rows = buildLogRows(logs, new Set([1, 2]));

    expect(rows).toEqual([
      { type: 'separator', runNumber: 1, key: 'sep-1' },
      { type: 'separator', runNumber: 2, key: 'sep-2' },
      { type: 'separator', runNumber: 3, key: 'sep-3' },
      { type: 'log', log: logs[2], key: 'log-3' },
    ]);
  });

  test('collapsing all runs shows only separators', () => {
    const logs = [
      makeLog({ id: 1, run_number: 1, message: 'a' }),
      makeLog({ id: 2, run_number: 2, message: 'b' }),
    ];
    const rows = buildLogRows(logs, new Set([1, 2]));

    expect(rows).toEqual([
      { type: 'separator', runNumber: 1, key: 'sep-1' },
      { type: 'separator', runNumber: 2, key: 'sep-2' },
    ]);
  });

  test('expanding (empty collapsed set) shows all logs', () => {
    const logs = [
      makeLog({ id: 1, run_number: 1, message: 'a' }),
      makeLog({ id: 2, run_number: 1, message: 'b' }),
    ];
    const rows = buildLogRows(logs, new Set());

    const logRows = rows.filter((r) => r.type === 'log');
    expect(logRows).toHaveLength(2);
  });

  test('keys are stable using log ids', () => {
    const logs = [
      makeLog({ id: 42, run_number: 1, message: 'a' }),
      makeLog({ id: 99, run_number: 2, message: 'b' }),
    ];
    const rows = buildLogRows(logs, new Set());

    const logKeys = rows.filter((r) => r.type === 'log').map((r) => r.key);
    expect(logKeys).toEqual(['log-42', 'log-99']);
  });

  test('keys use index fallback when log id is missing', () => {
    const logs = [
      makeLog({ id: undefined as any, run_number: 1, message: 'a' }),
      makeLog({ id: undefined as any, run_number: 1, message: 'b' }),
    ];
    const rows = buildLogRows(logs, new Set());

    const logKeys = rows.filter((r) => r.type === 'log').map((r) => r.key);
    expect(logKeys).toEqual(['log-idx-0', 'log-idx-1']);
  });

  test('handles logs with empty messages', () => {
    const logs = [
      makeLog({ id: 1, run_number: 1, message: '' }),
      makeLog({ id: 2, run_number: 1, message: 'after empty' }),
    ];
    const rows = buildLogRows(logs, new Set());

    const logRows = rows.filter((r) => r.type === 'log');
    expect(logRows).toHaveLength(2);
    expect((logRows[0] as any).log.message).toBe('');
    expect((logRows[1] as any).log.message).toBe('after empty');
  });

  test('three runs with mixed collapse state', () => {
    const logs = [
      makeLog({ id: 1, run_number: 1, message: 'r1-a' }),
      makeLog({ id: 2, run_number: 1, message: 'r1-b' }),
      makeLog({ id: 3, run_number: 2, message: 'r2-a' }),
      makeLog({ id: 4, run_number: 3, message: 'r3-a' }),
      makeLog({ id: 5, run_number: 3, message: 'r3-b' }),
    ];

    // Collapse run 1 only
    const rows = buildLogRows(logs, new Set([1]));

    const separators = rows.filter((r) => r.type === 'separator');
    const logRows = rows.filter((r) => r.type === 'log');
    expect(separators).toHaveLength(3);
    expect(logRows).toHaveLength(3); // r2-a, r3-a, r3-b
    expect(logRows.map((r: any) => r.log.id)).toEqual([3, 4, 5]);
  });

  test('_runStarted sentinel alone produces no separator', () => {
    const sentinel = { _runStarted: true, run_number: 2, task_id: 1, timestamp: '', level: 'info', message: '' } as any;
    const logs = [
      makeLog({ id: 1, run_number: 1, message: 'prev' }),
      sentinel,
    ];
    const rows = buildLogRows(logs, new Set());

    const separators = rows.filter((r) => r.type === 'separator');
    expect(separators).toHaveLength(1);
    expect((separators[0] as any).runNumber).toBe(1);
  });

  test('_runStarted sentinel followed by real log produces separator then log', () => {
    const sentinel = { _runStarted: true, run_number: 2, task_id: 1, timestamp: '', level: 'info', message: '' } as any;
    const logs = [
      makeLog({ id: 1, run_number: 1, message: 'prev' }),
      sentinel,
      makeLog({ id: 2, run_number: 2, message: 'Agent cancelled by user.' }),
    ];
    const rows = buildLogRows(logs, new Set());

    expect(rows).toEqual([
      { type: 'separator', runNumber: 1, key: 'sep-1' },
      { type: 'log', log: logs[0], key: 'log-1' },
      { type: 'separator', runNumber: 2, key: 'sep-2' },
      { type: 'log', log: logs[2], key: 'log-2' },
    ]);
  });

  test('multiple _runStarted sentinels with no real logs produce no separators', () => {
    const s1 = { _runStarted: true, run_number: 1, task_id: 1, timestamp: '', level: 'info', message: '' } as any;
    const s2 = { _runStarted: true, run_number: 2, task_id: 1, timestamp: '', level: 'info', message: '' } as any;
    const rows = buildLogRows([s1, s2], new Set());
    expect(rows).toHaveLength(0);
  });
});
