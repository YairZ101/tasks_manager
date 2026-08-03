import { useEffect } from 'react';
import { toast } from 'sonner';
import { useAppStore } from './useTaskStore.js';

export function useEventSource(enabled: boolean): void {
  const refreshTasks = useAppStore((state) => state.refreshTasks);
  const refreshFlows = useAppStore((state) => state.refreshFlows);
  const bootstrap = useAppStore((state) => state.bootstrap);
  useEffect(() => {
    if (!enabled) return;
    const source = new EventSource('/events');
    const tasks = () => { void refreshTasks(); };
    const flows = () => { void refreshFlows(); };
    source.addEventListener('task:changed', tasks);
    source.addEventListener('task:deleted', tasks);
    source.addEventListener('run:changed', tasks);
    source.addEventListener('flow:changed', flows);
    source.addEventListener('flow:published', flows);
    source.addEventListener('stale', () => { void bootstrap(); });
    source.addEventListener('toast', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        if (data.type === 'success') toast.success(data.message); else toast.info(data.message);
      } catch {}
    });
    return () => source.close();
  }, [bootstrap, enabled, refreshFlows, refreshTasks]);
}
