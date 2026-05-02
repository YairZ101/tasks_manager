import { useEffect, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { useAppStore } from './hooks/useTaskStore.js';
import { useEventSource } from './hooks/useEventSource.js';
import Sidebar from './components/Sidebar.js';
import Board from './components/Board.js';
import Backlog from './components/Backlog.js';
import TaskDetail from './components/TaskDetail.js';
import CreateTaskModal from './components/CreateTaskModal.js';
import AgentConfigModal from './components/AgentConfigModal.js';
import WorkflowSettingsModal from './components/WorkflowSettingsModal.js';
import InitWizard from './components/InitWizard.js';

// Acquire the lock once at module load — outside React lifecycle so
// StrictMode double-mount cannot interfere.
let lockHeld = false;
if (typeof navigator !== 'undefined' && navigator.locks) {
  navigator.locks.request('tasks-manager-ui', { ifAvailable: true }, (lock) => {
    if (lock) {
      lockHeld = true;
      return new Promise<void>(() => {});
    }
    return Promise.resolve();
  });
}

function useMultiTabWarning(): [boolean, () => void] {
  const [show, setShow] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!navigator.locks) return;

    const channel = new BroadcastChannel('tasks-manager-tabs');
    let abortController: AbortController | null = null;

    const timer = setTimeout(() => {
      if (!lockHeld) {
        setShow(true);
        channel.postMessage('new-tab');

        // Queue on the lock so the holder can see us in `pending`.
        // AbortController lets us cancel the request on cleanup.
        abortController = new AbortController();
        navigator.locks.request(
          'tasks-manager-ui',
          { signal: abortController.signal },
          () => new Promise<void>(() => {})
        ).catch(() => {});
      }
    }, 100);

    channel.onmessage = (e) => {
      if (e.data === 'new-tab' && lockHeld && !dismissed) {
        setShow(true);
      }
    };

    // Poll to detect when all other tabs have closed.
    const pollTimer = setInterval(() => {
      if (!lockHeld) return;
      navigator.locks.query().then((state) => {
        const pending = state.pending?.filter((l) => l.name === 'tasks-manager-ui') ?? [];
        if (pending.length === 0) {
          setShow(false);
          setDismissed(false);
        }
      });
    }, 1000);

    return () => {
      clearTimeout(timer);
      clearInterval(pollTimer);
      abortController?.abort();
      channel.close();
    };
  }, [dismissed]);

  const dismiss = () => {
    setDismissed(true);
    setShow(false);
  };

  return [show && !dismissed, dismiss];
}

function AppContent() {
  const {
    initialized,
    loading,
    currentView,
    selectedTaskId,
    showAgentConfig,
    showCreateTask,
    showWorkflowSettings,
    setShowWorkflowSettings,
    checkStatus,
    fetchTasks,
    fetchWorkflowSteps,
    toggleSidebar,
    setSidebarCollapsed,
  } = useAppStore();

  const { registerLogCallback } = useEventSource();

  // Sync sidebar with screen size
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = (e: MediaQueryListEvent) => {
      setSidebarCollapsed(!e.matches);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [setSidebarCollapsed]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  useEffect(() => {
    if (initialized) {
      fetchTasks();
      fetchWorkflowSteps();
    }
  }, [initialized, fetchTasks, fetchWorkflowSteps]);

  // Listen for toast events from SSE
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const { type, message } = e.detail;
      if (type === 'success') toast.success(message);
      else if (type === 'error') toast.error(message);
      else toast.info(message);
    };
    window.addEventListener('app:toast', handler as EventListener);
    return () => window.removeEventListener('app:toast', handler as EventListener);
  }, []);

  const [multiTabWarning, dismissMultiTab] = useMultiTabWarning();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-bg">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin-slow" />
      </div>
    );
  }

  if (!initialized) {
    return <InitWizard />;
  }

  return (
    <div className="flex h-screen bg-bg overflow-hidden">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        {multiTabWarning && (
          <div className="flex items-center justify-between px-4 py-2 bg-warning-dim border-b border-warning/20 flex-shrink-0">
            <span className="text-xs text-warning font-medium">
              Another tab is open. Edits made here may conflict with the other tab.
            </span>
            <button
              onClick={dismissMultiTab}
              className="p-0.5 text-warning/60 hover:text-warning transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )}
        {/* Mobile header */}
        <div className="hidden max-lg:flex items-center h-12 px-4 border-b border-border bg-bg-raised flex-shrink-0">
          <button
            onClick={toggleSidebar}
            className="p-1.5 rounded-md text-text-muted hover:text-text hover:bg-bg-hover transition-colors"
            title="Open menu"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M2 4h14M2 9h14M2 14h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <span className="ml-3 font-bold text-sm tracking-wide text-text">TASKS MANAGER</span>
        </div>
        <div className="flex-1 relative overflow-hidden">
          <div className="h-full overflow-hidden">
            {currentView === 'board' ? <Board /> : <Backlog />}
          </div>
          {selectedTaskId && (
            <TaskDetail taskId={selectedTaskId} registerLogCallback={registerLogCallback} />
          )}
        </div>
      </main>
      {showCreateTask && <CreateTaskModal />}
      {showAgentConfig && <AgentConfigModal />}
      {showWorkflowSettings && <WorkflowSettingsModal onClose={() => setShowWorkflowSettings(false)} />}
    </div>
  );
}

export default function App() {
  return (
    <>
      <Toaster
        position="bottom-right"
        theme="dark"
        toastOptions={{
          style: {
            background: 'var(--color-bg-card)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text)',
            fontFamily: 'var(--font-sans)',
          },
        }}
      />
      <AppContent />
    </>
  );
}
