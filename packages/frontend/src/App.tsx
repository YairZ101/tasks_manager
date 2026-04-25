import { useEffect, useState, useRef } from 'react';
import { Toaster, toast } from 'sonner';
import { useAppStore } from './hooks/useTaskStore.js';
import { useEventSource } from './hooks/useEventSource.js';
import Sidebar from './components/Sidebar.js';
import Board from './components/Board.js';
import Backlog from './components/Backlog.js';
import TaskDetail from './components/TaskDetail.js';
import CreateTaskModal from './components/CreateTaskModal.js';
import AgentConfigModal from './components/AgentConfigModal.js';
import InitWizard from './components/InitWizard.js';

function AppContent() {
  const {
    initialized,
    loading,
    currentView,
    selectedTaskId,
    showAgentConfig,
    showCreateTask,
    checkStatus,
    fetchTasks,
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
    }
  }, [initialized, fetchTasks]);

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

  // Multi-tab detection
  useEffect(() => {
    const channel = new BroadcastChannel('tasks-manager');

    // Announce this tab opened
    channel.postMessage('ping');

    channel.onmessage = (e) => {
      if (e.data === 'ping') {
        // Another tab just opened — warn them back
        channel.postMessage('pong');
        toast.warning('Another tab is already open. Real-time updates may be unreliable.');
      } else if (e.data === 'pong') {
        toast.warning('Another tab is already open. Real-time updates may be unreliable.');
      }
    };

    return () => {
      channel.close();
    };
  }, []);

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
