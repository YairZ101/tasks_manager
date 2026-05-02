import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import TaskCard from './TaskCard.js';
import type { Task } from '../hooks/useTaskStore.js';

interface ColumnProps {
  id: string;
  title: string;
  emptyText: string;
  tasks: Task[];
  onTaskClick: (id: number) => void;
}

export default function Column({ id, title, emptyText, tasks, onTaskClick }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  const count = tasks.length;

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col flex-1 min-w-[200px] rounded-xl bg-bg-raised border transition-colors max-sm:min-w-full max-sm:snap-start max-sm:flex-shrink-0 ${
        isOver ? 'border-accent/40 bg-accent-dim/30' : 'border-border'
      }`}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <span className="text-sm font-semibold text-text">{title}</span>
        <span className="text-xs font-medium text-text-dim bg-bg px-1.5 py-0.5 rounded-md">
          {count}
        </span>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} onClick={() => onTaskClick(task.id)} />
          ))}
        </SortableContext>

        {tasks.length === 0 && (
          <div className="flex items-center justify-center h-24 text-xs text-text-dim">
            {emptyText}
          </div>
        )}
      </div>
    </div>
  );
}
