import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { toast } from 'sonner';
import { useAppStore, type Task, type TaskLog } from '../hooks/useTaskStore.js';
import { api } from '../api/client.js';
import ConfirmDialog from './ConfirmDialog.js';

interface TaskDetailProps {
  taskId: number;
  registerLogCallback: (taskId: number, cb: (logs: any[]) => void) => () => void;
}

export type LogRow =
  | { type: 'separator'; runNumber: number; key: string }
  | { type: 'log'; log: TaskLog; key: string };

export function buildLogRows(logs: TaskLog[], collapsedRuns: Set<number>): LogRow[] {
  if (logs.length === 0) return [];
  const result: LogRow[] = [];
  let currentRun: number | null = null;
  let pendingSeparator: LogRow | null = null;

  for (let i = 0; i < logs.length; i++) {
    const log = logs[i];
    if (log.run_number !== currentRun) {
      currentRun = log.run_number;
      pendingSeparator = { type: 'separator', runNumber: currentRun, key: `sep-${currentRun}` };
    }
    if ((log as any)._runStarted) continue;
    if (pendingSeparator) {
      result.push(pendingSeparator);
      pendingSeparator = null;
    }
    if (!collapsedRuns.has(log.run_number)) {
      result.push({ type: 'log', log, key: `log-${log.id ?? `idx-${i}`}` });
    }
  }
  return result;
}

export default function TaskDetail({ taskId, registerLogCallback }: TaskDetailProps) {
  const { tasks, workflowSteps, updateTaskInStore, removeTaskFromStore, setSelectedTaskId, activeRuns, maxConcurrentAgents, addActiveRun } = useAppStore();
  const task = tasks.find((t) => t.id === taskId);

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [acceptance, setAcceptance] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [pendingMoveStatus, setPendingMoveStatus] = useState<string | null>(null);
  const [showSendBack, setShowSendBack] = useState(false);
  const [closing, setClosing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const closePanel = useCallback(() => {
    setClosing(true);
  }, []);

  const handleAnimationEnd = () => {
    if (closing) {
      setSelectedTaskId(null);
    }
  };

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        closePanel();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [closePanel]);

  // Log state is stored as a mutable ref + version counter instead of useState.
  // This avoids copying the full log array on every SSE event (which would re-allocate
  // on each of potentially thousands of lines). Any mutation to logsRef.current must
  // be followed by setLogVersion(v => v + 1) to trigger a re-render.
  const logsRef = useRef<TaskLog[]>([]);
  const [logVersion, setLogVersion] = useState(0);
  const logs = logsRef.current;
  const [hasMoreLogs, setHasMoreLogs] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const autoScrollRef = useRef(true);
  const [collapsedRuns, setCollapsedRuns] = useState<Set<number>>(new Set());
  const initialLoadDoneRef = useRef(false);
  const sseBufferRef = useRef<TaskLog[]>([]);

  // Load task fields into edit state
  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description);
      setAcceptance(task.acceptance);
      setShowSendBack(false);
      setClosing(false);
      setEditing(false);
    }
  }, [task?.id]);

  // Load initial logs
  useEffect(() => {
    let cancelled = false;
    initialLoadDoneRef.current = false;
    sseBufferRef.current = [];
    logsRef.current = [];
    async function loadLogs() {
      setLoadingLogs(true);
      try {
        const data = await api.getTaskLogs(taskId, { limit: 500 });
        if (!cancelled) {
          const dbKey = (l: TaskLog) => `${l.run_number}:${l.message}`;
          const dbSet = new Set(data.logs.map(dbKey));
          const pending = sseBufferRef.current.filter(
            (l) => (l as any)._runStarted || !dbSet.has(dbKey(l))
          );
          logsRef.current = [...data.logs, ...pending];
          initialLoadDoneRef.current = true;
          sseBufferRef.current = [];
          setLogVersion((v) => v + 1);
          setHasMoreLogs(data.hasMore);
        }
      } catch {
        // Silently fail
      } finally {
        if (!cancelled) setLoadingLogs(false);
      }
    }
    loadLogs();
    return () => { cancelled = true; };
  }, [taskId]);

  // Register log callback for live streaming
  useEffect(() => {
    const unsubscribe = registerLogCallback(taskId, (newLogs: TaskLog[]) => {
      if (!initialLoadDoneRef.current) {
        sseBufferRef.current = [...sseBufferRef.current, ...newLogs];
        return;
      }
      logsRef.current = [...logsRef.current, ...newLogs];
      setLogVersion((v) => v + 1);
    });
    return unsubscribe;
  }, [taskId, registerLogCallback]);

  // Build rows with run_number separators
  // eslint-disable-next-line react-hooks/exhaustive-deps -- logs is a ref, logVersion is the render trigger
  const rows: LogRow[] = useMemo(() => buildLogRows(logs, collapsedRuns), [logVersion, collapsedRuns]);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- same ref pattern as above
  const maxRun = useMemo(() => {
    if (logs.length === 0) return 1;
    return Math.max(...logs.map((l) => l.run_number));
  }, [logVersion]);

  // Track log count separately so auto-scroll only fires on new logs, not collapse/expand
  const logCountRef = useRef(logs.length);

  // Virtualizer
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => logContainerRef.current,
    estimateSize: (index) => (rows[index]?.type === 'separator' ? 28 : 22),
    getItemKey: (index) => rows[index]?.key ?? index,
    overscan: 20,
  });

  // Auto-scroll only when new logs arrive (not on collapse/expand)
  useEffect(() => {
    const prevCount = logCountRef.current;
    logCountRef.current = logs.length;
    if (logs.length > prevCount && autoScrollRef.current && rows.length > 0) {
      virtualizer.scrollToIndex(rows.length - 1, { align: 'end' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scroll on new logs only, not collapse/expand
  }, [logVersion, rows.length]);

  const handleScroll = () => {
    const el = logContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    autoScrollRef.current = atBottom;
    setIsAtBottom(atBottom);
  };

  const handleJumpToBottom = () => {
    if (rows.length > 0) {
      virtualizer.scrollToIndex(rows.length - 1, { align: 'end' });
      autoScrollRef.current = true;
      setIsAtBottom(true);
    }
  };

  const handleLoadMore = async () => {
    if (!logs.length || loadingLogs) return;
    setLoadingLogs(true);
    try {
      const data = await api.getTaskLogs(taskId, { before_id: logs[0].id, limit: 500 });
      logsRef.current = [...data.logs, ...logsRef.current];
      setLogVersion((v) => v + 1);
      setHasMoreLogs(data.hasMore);
    } catch {
      toast.error('Failed to load earlier logs');
    } finally {
      setLoadingLogs(false);
    }
  };

  const toggleRunCollapse = (runNumber: number) => {
    setCollapsedRuns((prev) => {
      const next = new Set(prev);
      if (next.has(runNumber)) {
        next.delete(runNumber);
      } else {
        next.add(runNumber);
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (!task) return;
    try {
      const data = await api.updateTask(task.id, { title, description, acceptance });
      updateTaskInStore(data.task);
      setEditing(false);
      toast.success('Task updated');
    } catch (err: any) {
      toast.error(err.message || 'Failed to save');
    }
  };

  const handleDelete = async () => {
    if (!task) return;
    try {
      await api.deleteTask(task.id);
      removeTaskFromStore(task.id);
      setSelectedTaskId(null);
      toast.success(`${task.task_key} deleted`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete');
    }
  };

  const handleRunAgent = async () => {
    if (!task) return;
    try {
      const data = await api.startAgent(task.id);
      updateTaskInStore(data.task);
      addActiveRun({ taskId: task.id, taskKey: task.task_key });
    } catch (err: any) {
      toast.error(err.data?.error || err.message || 'Failed to start agent');
    }
  };

  const handleMoveToBacklog = async () => {
    if (!task) return;
    try {
      const data = await api.updateTask(task.id, { status: 'backlog' });
      updateTaskInStore(data.task);
      toast.success(`${task.task_key} moved to backlog`);
    } catch (err: any) {
      toast.error(err.data?.error || err.message || 'Failed to move task');
    }
  };

  const handleMoveToTodo = async () => {
    if (!task) return;
    if (isRunning) {
      setPendingMoveStatus('todo');
      return;
    }
    try {
      const data = await api.updateTask(task.id, { status: 'todo' });
      updateTaskInStore(data.task);
      toast.success(`${task.task_key} moved to todo`);
    } catch (err: any) {
      toast.error(err.data?.error || err.message || 'Failed to move task');
    }
  };

  const handleMarkDone = async () => {
    if (!task) return;
    if (isRunning) {
      setPendingMoveStatus('done');
      return;
    }
    try {
      const data = await api.updateTask(task.id, { status: 'done' });
      updateTaskInStore(data.task);
      toast.success(`${task.task_key} marked as done`);
    } catch (err: any) {
      toast.error(err.data?.error || err.message || 'Failed to update task');
    }
  };

  const handleConfirmMove = async () => {
    if (!task || !pendingMoveStatus) return;
    try {
      await api.cancelAgent(task.id);
      const data = await api.updateTask(task.id, { status: pendingMoveStatus });
      updateTaskInStore(data.task);
      toast.success(`${task.task_key} moved to ${pendingMoveStatus}`);
    } catch (err: any) {
      toast.error(err.data?.error || err.message || 'Failed to move task');
    } finally {
      setPendingMoveStatus(null);
    }
  };

  const handleCancelAgent = async () => {
    if (!task) return;
    try {
      const data = await api.cancelAgent(task.id);
      updateTaskInStore(data.task);
    } catch (err: any) {
      toast.error(err.message || 'Failed to cancel agent');
    }
  };

  if (!task) {
    return null;
  }

  const isRunning = task.agent_status === 'running';
  const isReadOnly = isRunning;
  const canStartAgent = activeRuns.length < maxConcurrentAgents && !isRunning;
  const currentStepInfo = workflowSteps.find(s => s.slug === task.status);
  const isInWorkflowStep = !!currentStepInfo;
  const showApprove = isInWorkflowStep && currentStepInfo?.requires_review && task.agent_status === 'completed';
  const showRetry = isInWorkflowStep && task.agent_status === 'failed';

  const handleApproveAndContinue = async () => {
    if (!task) return;
    const currentIndex = workflowSteps.findIndex(s => s.slug === task.status);
    const nextStep = workflowSteps[currentIndex + 1];
    const nextStatus = nextStep?.slug ?? 'done';
    try {
      const data = await api.updateTask(task.id, { status: nextStatus });
      updateTaskInStore(data.task);
    } catch (err: any) {
      toast.error(err.data?.error || err.message || 'Failed to advance task');
    }
  };

  const handleRetry = async () => {
    if (!task) return;
    try {
      const data = await api.startAgent(task.id);
      updateTaskInStore(data.task);
      addActiveRun({ taskId: task.id, taskKey: task.task_key });
    } catch (err: any) {
      toast.error(err.data?.error || err.message || 'Failed to retry');
    }
  };

  const handleSendBack = async (targetSlug: string) => {
    if (!task) return;
    setShowSendBack(false);
    try {
      const data = await api.updateTask(task.id, { status: targetSlug });
      updateTaskInStore(data.task);
    } catch (err: any) {
      toast.error(err.data?.error || err.message || 'Failed to send back');
    }
  };

  return (
    <div ref={panelRef} onAnimationEnd={handleAnimationEnd} className={`absolute top-0 right-0 w-[440px] h-full border-l border-border bg-bg-raised flex flex-col z-30 shadow-2xl shadow-black/30 max-lg:fixed max-lg:inset-0 max-lg:w-full max-lg:z-40 max-lg:border-l-0 max-lg:shadow-none ${closing ? 'animate-slide-out-right' : 'animate-slide-in-right'}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-12 border-b border-border flex-shrink-0">
        <span className="text-xs font-mono font-semibold text-text-muted">{task.task_key}</span>
        <button
          onClick={closePanel}
          title="Close"
          className="p-1 rounded-md text-text-muted hover:text-text hover:bg-bg-hover transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-4">
          {/* Title */}
          {editing && !isReadOnly ? (
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full text-base font-semibold text-text bg-bg-input border border-border rounded-lg px-3 py-2 focus:outline-none focus:border-border-focus"
            />
          ) : (
            <h2
              className="text-base font-semibold text-text cursor-pointer hover:text-accent transition-colors"
              onClick={() => !isReadOnly && setEditing(true)}
            >
              {task.title}
            </h2>
          )}

          {/* Status & agent status */}
          <div className="flex items-center gap-2">
            <StatusBadge status={task.status} />
            {task.agent_status && <AgentStatusBadge status={task.agent_status} />}
          </div>

          {/* Description */}
          <div>
            <label className="text-xs font-semibold text-text-muted uppercase tracking-wide">Description</label>
            {editing && !isReadOnly ? (
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                className="w-full mt-1 text-sm bg-bg-input border border-border rounded-lg px-3 py-2 text-text resize-none focus:outline-none focus:border-border-focus"
              />
            ) : (
              <p
                className="text-sm text-text-muted mt-1 whitespace-pre-wrap cursor-pointer hover:text-text transition-colors min-h-[2em]"
                onClick={() => !isReadOnly && setEditing(true)}
              >
                {task.description || 'No description'}
              </p>
            )}
          </div>

          {/* Acceptance criteria */}
          <div>
            <label className="text-xs font-semibold text-text-muted uppercase tracking-wide">
              Acceptance Criteria
            </label>
            {editing && !isReadOnly ? (
              <textarea
                value={acceptance}
                onChange={(e) => setAcceptance(e.target.value)}
                rows={4}
                className="w-full mt-1 text-sm bg-bg-input border border-border rounded-lg px-3 py-2 text-text resize-none focus:outline-none focus:border-border-focus"
              />
            ) : (
              <p
                className="text-sm text-text-muted mt-1 whitespace-pre-wrap cursor-pointer hover:text-text transition-colors min-h-[2em]"
                onClick={() => !isReadOnly && setEditing(true)}
              >
                {task.acceptance || 'No acceptance criteria'}
              </p>
            )}
          </div>

          {/* Edit actions */}
          {editing && !isReadOnly && (
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-xs font-medium rounded-lg transition-colors"
              >
                Save
              </button>
              <button
                onClick={() => {
                  setEditing(false);
                  setTitle(task.title);
                  setDescription(task.description);
                  setAcceptance(task.acceptance);
                }}
                className="px-3 py-1.5 text-text-muted hover:text-text text-xs font-medium rounded-lg hover:bg-bg-hover transition-colors"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2 pt-2 border-t border-border">
            {isRunning ? (
              <button
                onClick={handleCancelAgent}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-danger-dim text-danger hover:bg-danger/20 text-xs font-medium rounded-lg transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <rect x="2" y="2" width="8" height="8" rx="1" fill="currentColor" />
                </svg>
                Cancel Agent
              </button>
            ) : showApprove ? (
              <>
                <button
                  onClick={handleApproveAndContinue}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-success-dim text-success hover:bg-success/20 text-xs font-medium rounded-lg transition-colors"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6.5l3 3 5-6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Approve &amp; Continue
                </button>
                {currentStepInfo && workflowSteps.indexOf(currentStepInfo) > 0 && (
                  <div className="relative">
                    <button
                      onClick={() => setShowSendBack(!showSendBack)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-text-muted hover:text-warning hover:bg-warning-dim text-xs font-medium rounded-lg transition-colors"
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M8 3L4 6l4 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      Send Back
                    </button>
                    {showSendBack && (
                      <div className="absolute top-full left-0 mt-1 py-1 bg-bg-raised border border-border rounded-lg shadow-lg z-10 min-w-[140px]">
                        {workflowSteps
                          .slice(0, workflowSteps.indexOf(currentStepInfo))
                          .map(s => (
                            <button
                              key={s.slug}
                              onClick={() => handleSendBack(s.slug)}
                              className="w-full text-left px-3 py-1.5 text-xs text-text hover:bg-bg-hover transition-colors"
                            >
                              {s.name}
                            </button>
                          ))}
                        <button
                          onClick={() => handleSendBack('todo')}
                          className="w-full text-left px-3 py-1.5 text-xs text-text hover:bg-bg-hover transition-colors"
                        >
                          Todo
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : showRetry ? (
              <button
                onClick={handleRetry}
                disabled={!canStartAgent}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-warning-dim text-warning hover:bg-warning/20 text-xs font-medium rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6a4 4 0 017.2-2.4M10 2v2.4H7.6M10 6a4 4 0 01-7.2 2.4M2 10V7.6h2.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Retry
              </button>
            ) : task.status === 'todo' ? (
              <button
                onClick={handleRunAgent}
                disabled={!canStartAgent}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-success-dim text-success hover:bg-success/20 text-xs font-medium rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 1l8 5-8 5V1z" fill="currentColor" />
                </svg>
                Start Workflow
              </button>
            ) : null}

            {/* More actions dropdown */}
            <MoreActionsMenu
              task={task}
              onMoveToTodo={handleMoveToTodo}
              onMoveToBacklog={handleMoveToBacklog}
              onMarkDone={handleMarkDone}
              onDelete={() => setShowDeleteConfirm(true)}
              isRunning={isRunning}
            />
          </div>
        </div>

        {/* Log viewer */}
        <div className="border-t border-border">
          <div className="flex items-center justify-between px-4 py-2 border-b border-border">
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wide">
              Agent Logs
            </span>
            {isRunning && (
              <span className="flex items-center gap-1 text-[10px] font-medium text-running">
                <span className="w-1.5 h-1.5 rounded-full bg-running animate-pulse-glow" />
                Live
              </span>
            )}
          </div>

          <div className="relative">
            <div
              ref={logContainerRef}
              onScroll={handleScroll}
              className="h-64 overflow-y-auto font-mono text-xs bg-bg p-3"
            >
              {hasMoreLogs && (
                <button
                  onClick={handleLoadMore}
                  disabled={loadingLogs}
                  className="w-full py-1.5 text-center text-[10px] text-accent hover:text-accent-hover transition-colors mb-2"
                >
                  {loadingLogs ? 'Loading...' : 'Load earlier logs'}
                </button>
              )}

              {logs.length === 0 && !loadingLogs ? (
                <div className="flex items-center justify-center h-full text-text-dim text-[11px]">
                  No agent runs yet. Click &apos;Start Workflow&apos; to start.
                </div>
              ) : (
                <div
                  style={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}
                >
                  {virtualizer.getVirtualItems().map((virtualRow) => {
                    const row = rows[virtualRow.index];
                    if (!row) return null;

                    if (row.type === 'separator') {
                      const isCollapsed = collapsedRuns.has(row.runNumber);
                      const isCurrent = row.runNumber === maxRun;
                      return (
                        <div
                          key={row.key}
                          data-index={virtualRow.index}
                          ref={virtualizer.measureElement}
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            transform: `translateY(${virtualRow.start}px)`,
                          }}
                        >
                          <button
                            onClick={() => toggleRunCollapse(row.runNumber)}
                            className="flex items-center gap-2 w-full py-1 text-[10px] font-semibold text-text-dim hover:text-text-muted transition-colors group"
                          >
                            <span className="flex-1 h-px bg-border" />
                            <span className="flex items-center gap-1 shrink-0">
                              <svg
                                width="8"
                                height="8"
                                viewBox="0 0 8 8"
                                fill="none"
                                className={`transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                              >
                                <path d="M2 1l4 3-4 3V1z" fill="currentColor" />
                              </svg>
                              Run #{row.runNumber}
                              {isCurrent && isRunning && (
                                <span className="w-1 h-1 rounded-full bg-running animate-pulse-glow" />
                              )}
                            </span>
                            <span className="flex-1 h-px bg-border" />
                          </button>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={row.key}
                        data-index={virtualRow.index}
                        ref={virtualizer.measureElement}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                        className="py-0.5 leading-relaxed"
                      >
                        <span className={getLogColor(row.log.level)}>{row.log.message || '\u00A0'}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {!isAtBottom && logs.length > 0 && (
              <button
                onClick={handleJumpToBottom}
                className="absolute bottom-2 right-4 px-2 py-1 text-[10px] bg-bg-card border border-border rounded-md text-text-muted hover:text-text transition-colors z-10"
              >
                ↓ Jump to bottom
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <ConfirmDialog
          title="Delete task?"
          message={`This will permanently delete ${task.task_key} and all its logs.`}
          confirmLabel="Delete"
          destructive
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}

      {/* Move running task confirmation */}
      {pendingMoveStatus && (
        <ConfirmDialog
          title="Move running task?"
          message={`The agent is currently running on ${task.task_key}. Moving it will cancel the agent.`}
          confirmLabel="Cancel agent & move"
          destructive
          onConfirm={handleConfirmMove}
          onCancel={() => setPendingMoveStatus(null)}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    backlog: 'bg-bg text-text-dim border-border',
    todo: 'bg-warning-dim text-warning border-warning/20',
    done: 'bg-success-dim text-success border-success/20',
  };

  const fallback = 'bg-running-dim text-running border-running/20';

  return (
    <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-md border ${colors[status] || fallback}`}>
      {status}
    </span>
  );
}

function AgentStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running: 'text-running',
    completed: 'text-success',
    failed: 'text-danger',
  };

  return (
    <span className={`text-[10px] font-semibold ${colors[status] || ''}`}>
      agent: {status}
    </span>
  );
}

function getLogColor(level: string): string {
  switch (level) {
    case 'error':
      return 'text-danger';
    case 'warn':
      return 'text-warning';
    case 'info':
      return 'text-text-muted';
    case 'agent':
      return 'text-text';
    default:
      return 'text-text';
  }
}

function MoreActionsMenu({
  task,
  onMoveToTodo,
  onMoveToBacklog,
  onMarkDone,
  onDelete,
  isRunning,
}: {
  task: Task;
  onMoveToTodo: () => void;
  onMoveToBacklog: () => void;
  onMarkDone: () => void;
  onDelete: () => void;
  isRunning: boolean;
}) {
  const [open, setOpen] = useState(false);

  const items: { label: string; onClick: () => void; danger?: boolean; disabled?: boolean }[] = [];

  if (task.status !== 'todo' && task.status !== 'backlog') {
    items.push({ label: 'Move to Todo', onClick: onMoveToTodo });
  }
  if (task.status === 'todo') {
    items.push({ label: 'Move to Backlog', onClick: onMoveToBacklog });
  }
  if (task.status !== 'done') {
    items.push({ label: 'Move to Done', onClick: onMarkDone });
  }
  items.push({ label: 'Delete', onClick: onDelete, danger: true, disabled: isRunning });

  return (
    <div className="relative ml-auto">
      <button
        onClick={() => setOpen(!open)}
        className="p-1.5 text-text-muted hover:text-text hover:bg-bg-hover rounded-lg transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="3" r="1.2" fill="currentColor" />
          <circle cx="7" cy="7" r="1.2" fill="currentColor" />
          <circle cx="7" cy="11" r="1.2" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div className="absolute bottom-full right-0 mb-1 py-1 bg-bg-raised border border-border rounded-lg shadow-lg z-10 min-w-[150px]">
          {items.map(item => (
            <button
              key={item.label}
              onClick={() => { setOpen(false); item.onClick(); }}
              disabled={item.disabled}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors disabled:opacity-30 ${
                item.danger
                  ? 'text-danger hover:bg-danger-dim'
                  : 'text-text hover:bg-bg-hover'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
