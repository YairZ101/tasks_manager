import { useState, useMemo } from 'react';
import { toast } from 'sonner';
import { useAppStore, type Task } from '../hooks/useTaskStore.js';
import { api } from '../api/client.js';
import Tooltip from './Tooltip.js';
import ConfirmDialog from './ConfirmDialog.js';

export default function Backlog() {
  const { tasks, setShowCreateTask, setSelectedTaskId, updateTaskInStore, removeTaskFromStore } = useAppStore();
  const [search, setSearch] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null);

  const backlogTasks = useMemo(() => {
    let filtered = tasks.filter((t) => t.status === 'backlog');
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q)
      );
    }
    return filtered.sort((a, b) => a.sort_order - b.sort_order);
  }, [tasks, search]);

  const handleMoveToTodo = async (task: Task) => {
    try {
      const data = await api.updateTask(task.id, { status: 'todo' });
      updateTaskInStore(data.task);
      toast.success(`${task.task_key} moved to Todo`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to move task');
    }
  };

  const handleRunNow = async (task: Task) => {
    try {
      const data = await api.updateTask(task.id, { status: 'in-progress' });
      updateTaskInStore(data.task);
    } catch (err: any) {
      toast.error(err.data?.error || err.message || 'Failed to start agent');
    }
  };

  const handleMarkDone = async (task: Task) => {
    try {
      const data = await api.updateTask(task.id, { status: 'done' });
      updateTaskInStore(data.task);
      toast.success(`${task.task_key} marked as done`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update task');
    }
  };

  const handleDelete = async (task: Task) => {
    try {
      await api.deleteTask(task.id);
      removeTaskFromStore(task.id);
      setDeleteTarget(null);
      toast.success(`${task.task_key} deleted`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete task');
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 h-14 border-b border-border flex-shrink-0">
        <h1 className="text-base font-semibold text-text">Backlog</h1>
        <button
          onClick={() => setShowCreateTask(true, 'backlog')}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-xs font-medium rounded-lg transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          New Task
        </button>
      </div>

      {/* Search */}
      <div className="px-6 py-3 border-b border-border">
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim"
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
          >
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M9.5 9.5L13 13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            placeholder="Search backlog..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm bg-bg-input border border-border rounded-lg text-text placeholder:text-text-dim focus:outline-none focus:border-border-focus transition-colors"
          />
        </div>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto">
        {backlogTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            {search ? (
              <p className="text-sm text-text-muted">No tasks match your search.</p>
            ) : (
              <>
                <div className="w-14 h-14 mb-4 rounded-xl bg-accent-dim flex items-center justify-center">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M4 6h16M4 12h16M4 18h10" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </div>
                <p className="text-sm text-text-muted mb-1">Your backlog is empty</p>
                <p className="text-xs text-text-dim">Create tasks to plan future work.</p>
              </>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {backlogTasks.map((task) => (
              <div
                key={task.id}
                className="group flex items-center gap-4 px-6 py-3 hover:bg-bg-hover transition-colors cursor-pointer"
                onClick={() => setSelectedTaskId(task.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[11px] font-mono font-semibold text-text-dim">
                      {task.task_key}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-text truncate">{task.title}</p>
                  {task.description && (
                    <p className="text-xs text-text-muted truncate mt-0.5">{task.description}</p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  <ActionButton
                    label="Move to Todo"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMoveToTodo(task);
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M7 10V3M4.5 5.5L7 3l2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M2 12h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                    </svg>
                  </ActionButton>
                  <ActionButton
                    label="Run Now"
                    className="hover:text-success hover:bg-success-dim"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRunNow(task);
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M3 2l9 5-9 5V2z" fill="currentColor" />
                    </svg>
                  </ActionButton>
                  <ActionButton
                    label="Mark as Done"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMarkDone(task);
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M3 7.5l3 3 5-6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </ActionButton>
                  <ActionButton
                    label="Delete"
                    className="hover:text-danger hover:bg-danger-dim"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTarget(task);
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M2.5 4h9M5 4V2.5a1 1 0 011-1h2a1 1 0 011 1V4M10 4v7.5a1 1 0 01-1 1H5a1 1 0 01-1-1V4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </ActionButton>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {deleteTarget && (
        <ConfirmDialog
          title="Delete task?"
          message={`This will permanently delete ${deleteTarget.task_key} and all its logs.`}
          confirmLabel="Delete"
          destructive
          onConfirm={() => handleDelete(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

function ActionButton({
  label,
  className,
  onClick,
  children,
}: {
  label: string;
  className?: string;
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip label={label}>
      <button
        onClick={onClick}
        className={`p-1.5 rounded-md text-text-muted hover:text-text hover:bg-border/50 transition-colors ${className || ''}`}
      >
        {children}
      </button>
    </Tooltip>
  );
}
