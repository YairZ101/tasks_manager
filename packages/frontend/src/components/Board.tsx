import { useState } from 'react';
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  useSensor,
  useSensors,
  PointerSensor,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { toast } from 'sonner';
import { useAppStore, type Task } from '../hooks/useTaskStore.js';
import { api } from '../api/client.js';
import Column from './Column.js';
import TaskCard from './TaskCard.js';
import ConfirmDialog from './ConfirmDialog.js';

const COLUMNS = [
  { id: 'todo', title: 'Todo', emptyText: 'Drag tasks here' },
  { id: 'in-progress', title: 'In Progress', emptyText: 'Tasks your agent is working on appear here' },
  { id: 'done', title: 'Done', emptyText: 'Drag tasks here' },
] as const;

export default function Board() {
  const { tasks, setShowCreateTask, setSelectedTaskId, updateTaskInStore } = useAppStore();
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [pendingMove, setPendingMove] = useState<{
    task: Task;
    newStatus: string;
    sortOrder?: number;
  } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const boardTasks = tasks.filter((t) => t.status !== 'backlog');
  const hasBoardTasks = boardTasks.length > 0;

  const getColumnTasks = (status: string) =>
    tasks
      .filter((t) => t.status === status)
      .sort((a, b) => a.sort_order - b.sort_order);

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks.find((t) => t.id === Number(event.active.id));
    if (task) setActiveTask(task);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;

    const task = tasks.find((t) => t.id === Number(active.id));
    if (!task) return;

    // Determine target column
    let targetStatus: string;
    const overTask = tasks.find((t) => t.id === Number(over.id));

    if (overTask) {
      targetStatus = overTask.status;
    } else {
      targetStatus = String(over.id);
    }

    if (!['todo', 'in-progress', 'done'].includes(targetStatus)) return;

    // If dragging a running task away, show confirmation
    if (task.status === 'in-progress' && task.agent_status === 'running' && targetStatus !== 'in-progress') {
      setPendingMove({ task, newStatus: targetStatus });
      return;
    }

    // Calculate sort order
    let sortOrder: number | undefined;
    if (overTask && overTask.status === targetStatus && overTask.id !== task.id) {
      const columnTasks = getColumnTasks(targetStatus);
      const overIndex = columnTasks.findIndex((t) => t.id === overTask.id);
      if (overIndex >= 0) {
        const above = columnTasks[overIndex - 1];
        const below = columnTasks[overIndex];
        if (!above) {
          sortOrder = below.sort_order - 1.0;
        } else {
          sortOrder = (above.sort_order + below.sort_order) / 2;
        }
      }
    }

    // Same column reorder
    if (task.status === targetStatus) {
      if (sortOrder !== undefined) {
        try {
          const data = await api.updateTask(task.id, { sort_order: sortOrder });
          updateTaskInStore(data.task);
        } catch (err: any) {
          toast.error(err.message || 'Failed to reorder task');
        }
      }
      return;
    }

    // Cross-column move
    try {
      const payload: any = { status: targetStatus };
      if (sortOrder !== undefined) payload.sort_order = sortOrder;
      const data = await api.updateTask(task.id, payload);
      updateTaskInStore(data.task);
    } catch (err: any) {
      toast.error(err.data?.error || err.message || 'Failed to move task');
    }
  };

  const handleConfirmMove = async () => {
    if (!pendingMove) return;
    const { task, newStatus } = pendingMove;
    setPendingMove(null);

    try {
      await api.cancelAgent(task.id);
      const data = await api.updateTask(task.id, { status: newStatus });
      updateTaskInStore(data.task);
    } catch (err: any) {
      toast.error(err.data?.error || err.message || 'Failed to move task');
    }
  };

  if (!hasBoardTasks) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-4">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-accent-dim flex items-center justify-center">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <rect x="2" y="2" width="7" height="24" rx="2" stroke="var(--color-accent)" strokeWidth="1.5" />
              <rect x="10.5" y="2" width="7" height="24" rx="2" stroke="var(--color-accent)" strokeWidth="1.5" />
              <rect x="19" y="2" width="7" height="24" rx="2" stroke="var(--color-accent)" strokeWidth="1.5" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-text mb-2">No tasks on the board yet</h2>
          <p className="text-sm text-text-muted mb-6">
            Create a task or move one from the backlog to get started.
          </p>
          <button
            onClick={() => setShowCreateTask(true, 'todo')}
            className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors"
          >
            Create Task
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Board header */}
      <div className="flex items-center justify-between px-6 h-14 border-b border-border flex-shrink-0">
        <h1 className="text-base font-semibold text-text">Board</h1>
        <button
          onClick={() => setShowCreateTask(true, 'todo')}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-xs font-medium rounded-lg transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          New Task
        </button>
      </div>

      {/* Board columns */}
      <div className="flex-1 flex gap-4 p-4 overflow-x-auto max-sm:flex-col max-sm:overflow-y-auto max-sm:overflow-x-hidden">
        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          {COLUMNS.map((col) => (
            <Column
              key={col.id}
              id={col.id}
              title={col.title}
              emptyText={col.emptyText}
              tasks={getColumnTasks(col.id)}
              onTaskClick={setSelectedTaskId}
            />
          ))}
          <DragOverlay>
            {activeTask ? (
              <TaskCard task={activeTask} isDragging />
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      {/* Confirmation dialog for moving running tasks */}
      {pendingMove && (
        <ConfirmDialog
          title="Cancel running agent?"
          message={`Agent is running on ${pendingMove.task.task_key}. Cancel it and move?`}
          confirmLabel="Cancel & Move"
          onConfirm={handleConfirmMove}
          onCancel={() => setPendingMove(null)}
        />
      )}
    </div>
  );
}
