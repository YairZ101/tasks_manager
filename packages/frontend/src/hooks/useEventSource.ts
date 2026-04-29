import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from './useTaskStore.js';

export function useEventSource() {
  const updateTaskInStore = useAppStore((s) => s.updateTaskInStore);
  const removeTaskFromStore = useAppStore((s) => s.removeTaskFromStore);
  const fetchTasks = useAppStore((s) => s.fetchTasks);
  const esRef = useRef<EventSource | null>(null);
  const logCallbacksRef = useRef<Map<number, (logs: any[]) => void>>(new Map());

  const registerLogCallback = useCallback((taskId: number, cb: (logs: any[]) => void) => {
    logCallbacksRef.current.set(taskId, cb);
    return () => {
      logCallbacksRef.current.delete(taskId);
    };
  }, []);

  useEffect(() => {
    const es = new EventSource('/events');
    esRef.current = es;

    es.addEventListener('task:updated', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.task) {
          if (data.task._deleted) {
            removeTaskFromStore(data.task.id);
          } else {
            updateTaskInStore(data.task);
          }
        }
      } catch {
        // Invalid event data
      }
    });

    es.addEventListener('agent:status', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.taskId && data.status === 'running' && data.runNumber != null) {
          const cb = logCallbacksRef.current.get(data.taskId);
          if (cb) {
            cb([{ _runStarted: true, run_number: data.runNumber }]);
          }
        }
      } catch {
        // Invalid event data
      }
    });

    es.addEventListener('toast', (e) => {
      try {
        const data = JSON.parse(e.data);
        window.dispatchEvent(new CustomEvent('app:toast', { detail: data }));
      } catch {
        // Invalid event data
      }
    });

    es.addEventListener('stale', () => {
      fetchTasks();
    });

    es.onerror = () => {
      // EventSource auto-reconnects
    };

    es.addEventListener('task:log', (e: any) => {
      try {
        const data = JSON.parse(e.data);
        const cb = logCallbacksRef.current.get(data.taskId);
        if (cb) cb([data.log]);
      } catch {
        // Invalid event data
      }
    });

    return () => {
      es.close();
    };
  }, [updateTaskInStore, removeTaskFromStore, fetchTasks]);

  return { registerLogCallback };
}
