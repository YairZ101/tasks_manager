import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEventSource } from './useEventSource';

const mockStore = {
  updateTaskInStore: vi.fn(),
  removeTaskFromStore: vi.fn(),
  fetchTasks: vi.fn(),
  fetchWorkflowSteps: vi.fn(),
  addActiveRun: vi.fn(),
  removeActiveRun: vi.fn(),
};

vi.mock('./useTaskStore', () => ({
  useAppStore: Object.assign(
    (selector: any) => selector(mockStore),
    { setState: vi.fn() }
  ),
}));

vi.mock('../api/client', () => ({
  api: {
    getStatus: vi.fn().mockResolvedValue({ activeRuns: [], maxConcurrentAgents: 3 }),
  },
}));

type Listener = (e: any) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];
  listeners: Map<string, Listener[]> = new Map();
  onerror: (() => void) | null = null;
  closed = false;

  constructor(public url: string) {
    MockEventSource.instances.push(this);
  }

  addEventListener(event: string, cb: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event)!.push(cb);
  }

  emit(event: string, data: any) {
    const listeners = this.listeners.get(event) ?? [];
    const messageEvent = { data: JSON.stringify(data) };
    listeners.forEach((cb) => cb(messageEvent));
  }

  close() {
    this.closed = true;
  }
}

beforeEach(() => {
  MockEventSource.instances = [];
  (globalThis as any).EventSource = MockEventSource;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as any).EventSource;
});

function getES(): MockEventSource {
  return MockEventSource.instances[MockEventSource.instances.length - 1];
}

describe('useEventSource', () => {
  describe('registerLogCallback', () => {
    test('returns a stable function', () => {
      const { result, rerender } = renderHook(() => useEventSource());
      const first = result.current.registerLogCallback;
      rerender();
      expect(result.current.registerLogCallback).toBe(first);
    });

    test('unregisters callback on returned cleanup', () => {
      const { result } = renderHook(() => useEventSource());
      const cb = vi.fn();
      const unregister = result.current.registerLogCallback(1, cb);

      unregister();

      act(() => {
        getES().emit('task:log', { taskId: 1, log: { level: 'agent', message: 'hi' } });
      });

      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe('task:log event', () => {
    test('calls registered callback with array containing the log', () => {
      const { result } = renderHook(() => useEventSource());
      const cb = vi.fn();
      result.current.registerLogCallback(42, cb);

      const log = { task_id: 42, run_number: 1, level: 'agent', message: 'output line' };
      act(() => {
        getES().emit('task:log', { taskId: 42, log });
      });

      expect(cb).toHaveBeenCalledOnce();
      expect(cb).toHaveBeenCalledWith([log]);
    });

    test('does not call callback for a different taskId', () => {
      const { result } = renderHook(() => useEventSource());
      const cb = vi.fn();
      result.current.registerLogCallback(1, cb);

      act(() => {
        getES().emit('task:log', { taskId: 99, log: { level: 'agent', message: 'nope' } });
      });

      expect(cb).not.toHaveBeenCalled();
    });

    test('does not throw on invalid JSON', () => {
      renderHook(() => useEventSource());
      const listeners = getES().listeners.get('task:log') ?? [];
      expect(() => listeners.forEach((cb) => cb({ data: 'not-json' }))).not.toThrow();
    });

    test('delivers multiple log events independently', () => {
      const { result } = renderHook(() => useEventSource());
      const cb = vi.fn();
      result.current.registerLogCallback(5, cb);

      const log1 = { level: 'agent', message: 'line 1' };
      const log2 = { level: 'agent', message: 'line 2' };

      act(() => {
        getES().emit('task:log', { taskId: 5, log: log1 });
        getES().emit('task:log', { taskId: 5, log: log2 });
      });

      expect(cb).toHaveBeenCalledTimes(2);
      expect(cb.mock.calls[0][0]).toEqual([log1]);
      expect(cb.mock.calls[1][0]).toEqual([log2]);
    });
  });

  describe('agent:status event', () => {
    test('calls callback with _runStarted sentinel when status is running', () => {
      const { result } = renderHook(() => useEventSource());
      const cb = vi.fn();
      result.current.registerLogCallback(7, cb);

      act(() => {
        getES().emit('agent:status', { taskId: 7, taskKey: 'TST-7', status: 'running', runNumber: 3 });
      });

      expect(cb).toHaveBeenCalledOnce();
      expect(cb).toHaveBeenCalledWith([{ _runStarted: true, run_number: 3 }]);
    });

    test('does not call callback for non-running status', () => {
      const { result } = renderHook(() => useEventSource());
      const cb = vi.fn();
      result.current.registerLogCallback(7, cb);

      act(() => {
        getES().emit('agent:status', { taskId: 7, status: 'completed' });
      });

      expect(cb).not.toHaveBeenCalled();
    });

    test('does not call callback when runNumber is missing', () => {
      const { result } = renderHook(() => useEventSource());
      const cb = vi.fn();
      result.current.registerLogCallback(7, cb);

      act(() => {
        getES().emit('agent:status', { taskId: 7, taskKey: 'TST-7', status: 'running' });
      });

      expect(cb).not.toHaveBeenCalled();
    });

    test('calls callback when runNumber is 0', () => {
      const { result } = renderHook(() => useEventSource());
      const cb = vi.fn();
      result.current.registerLogCallback(7, cb);

      act(() => {
        getES().emit('agent:status', { taskId: 7, taskKey: 'TST-7', status: 'running', runNumber: 0 });
      });

      expect(cb).toHaveBeenCalledOnce();
      expect(cb).toHaveBeenCalledWith([{ _runStarted: true, run_number: 0 }]);
    });

    test('does not call callback for different taskId', () => {
      const { result } = renderHook(() => useEventSource());
      const cb = vi.fn();
      result.current.registerLogCallback(1, cb);

      act(() => {
        getES().emit('agent:status', { taskId: 99, taskKey: 'TST-99', status: 'running', runNumber: 1 });
      });

      expect(cb).not.toHaveBeenCalled();
    });

    test('does not throw on invalid JSON', () => {
      renderHook(() => useEventSource());
      const listeners = getES().listeners.get('agent:status') ?? [];
      expect(() => listeners.forEach((cb) => cb({ data: '{bad' }))).not.toThrow();
    });

    test('calls addActiveRun on running status', () => {
      renderHook(() => useEventSource());

      act(() => {
        getES().emit('agent:status', { taskId: 5, taskKey: 'TST-5', status: 'running', runNumber: 1 });
      });

      expect(mockStore.addActiveRun).toHaveBeenCalledWith({ taskId: 5, taskKey: 'TST-5' });
    });

    test('calls removeActiveRun on completed status', () => {
      renderHook(() => useEventSource());

      act(() => {
        getES().emit('agent:status', { taskId: 5, status: 'completed' });
      });

      expect(mockStore.removeActiveRun).toHaveBeenCalledWith(5);
    });

    test('calls removeActiveRun on failed status', () => {
      renderHook(() => useEventSource());

      act(() => {
        getES().emit('agent:status', { taskId: 5, status: 'failed' });
      });

      expect(mockStore.removeActiveRun).toHaveBeenCalledWith(5);
    });
  });

  describe('toast event', () => {
    test('dispatches app:toast custom event', () => {
      renderHook(() => useEventSource());
      const handler = vi.fn();
      window.addEventListener('app:toast', handler);

      act(() => {
        getES().emit('toast', { type: 'success', message: 'Done!' });
      });

      expect(handler).toHaveBeenCalledOnce();
      const detail = (handler.mock.calls[0][0] as CustomEvent).detail;
      expect(detail).toEqual({ type: 'success', message: 'Done!' });

      window.removeEventListener('app:toast', handler);
    });

    test('does not throw on invalid JSON', () => {
      renderHook(() => useEventSource());
      const listeners = getES().listeners.get('toast') ?? [];
      expect(() => listeners.forEach((cb) => cb({ data: 'nope' }))).not.toThrow();
    });
  });

  describe('task:updated event', () => {
    test('calls updateTaskInStore for a normal task update', () => {
      renderHook(() => useEventSource());
      const task = { id: 1, task_key: 'TST-1', title: 'Test' };

      act(() => {
        getES().emit('task:updated', { task });
      });

      expect(mockStore.updateTaskInStore).toHaveBeenCalledWith(task);
    });

    test('calls removeTaskFromStore for a deleted task', () => {
      renderHook(() => useEventSource());
      const task = { id: 1, task_key: 'TST-1', _deleted: true };

      act(() => {
        getES().emit('task:updated', { task });
      });

      expect(mockStore.removeTaskFromStore).toHaveBeenCalledWith(1);
      expect(mockStore.updateTaskInStore).not.toHaveBeenCalled();
    });

    test('closes EventSource on unmount', () => {
      const { unmount } = renderHook(() => useEventSource());
      const es = getES();
      unmount();
      expect(es.closed).toBe(true);
    });
  });

  describe('stale event', () => {
    test('calls fetchTasks and fetchWorkflowSteps on stale event', () => {
      renderHook(() => useEventSource());

      act(() => {
        const listeners = getES().listeners.get('stale') ?? [];
        listeners.forEach((cb) => cb({}));
      });

      expect(mockStore.fetchTasks).toHaveBeenCalledOnce();
      expect(mockStore.fetchWorkflowSteps).toHaveBeenCalledOnce();
    });
  });

  describe('workflow:updated event', () => {
    test('calls fetchWorkflowSteps on workflow:updated', () => {
      renderHook(() => useEventSource());

      act(() => {
        const listeners = getES().listeners.get('workflow:updated') ?? [];
        listeners.forEach((cb) => cb({}));
      });

      expect(mockStore.fetchWorkflowSteps).toHaveBeenCalledOnce();
    });
  });
});
