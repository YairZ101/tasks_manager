import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from './useTaskStore.js';

export function useEventSource() {
  const updateTaskInStore = useAppStore((s) => s.updateTaskInStore);
  const removeTaskFromStore = useAppStore((s) => s.removeTaskFromStore);
  const fetchTasks = useAppStore((s) => s.fetchTasks);
  const esRef = useRef<EventSource | null>(null);
  const logBufferRef = useRef<any[]>([]);
  const logCallbacksRef = useRef<Map<number, (log: any) => void>>(new Map());

  const registerLogCallback = useCallback((taskId: number, cb: (log: any) => void) => {
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
        if (data.taskId && data.status) {
          // Status is already reflected via task:updated
        }
      } catch {
        // Invalid event data
      }
    });

    es.addEventListener('toast', (e) => {
      try {
        const data = JSON.parse(e.data);
        // Toasts are handled by the toast system
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

    // Flush log buffer via requestAnimationFrame with 100ms throttle
    let lastFlush = 0;
    let rafId: number | null = null;

    const flushLogs = () => {
      rafId = null;
      if (logBufferRef.current.length > 0) {
        const batch = logBufferRef.current;
        logBufferRef.current = [];
        lastFlush = performance.now();

        for (const entry of batch) {
          const cb = logCallbacksRef.current.get(entry.taskId);
          if (cb) {
            cb(entry.log);
          }
        }
      }
    };

    const scheduleFlush = () => {
      if (rafId !== null) return;
      const elapsed = performance.now() - lastFlush;
      if (elapsed >= 100) {
        rafId = requestAnimationFrame(flushLogs);
      } else {
        setTimeout(() => {
          rafId = requestAnimationFrame(flushLogs);
        }, 100 - elapsed);
      }
    };

    // Patch the log listener to schedule flushes
    es.addEventListener('task:log', (e: any) => {
      try {
        const data = JSON.parse(e.data);
        logBufferRef.current.push(data);
        scheduleFlush();
      } catch {
        // Invalid event data
      }
    });

    return () => {
      es.close();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [updateTaskInStore, removeTaskFromStore, fetchTasks]);

  return { registerLogCallback };
}
