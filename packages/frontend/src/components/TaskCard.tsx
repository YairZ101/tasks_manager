import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { toast } from 'sonner';
import { api } from '../api/client.js';
import { useAppStore, type Task } from '../hooks/useTaskStore.js';
import Tooltip from './Tooltip.js';

interface TaskCardProps {
  task: Task;
  isDragging?: boolean;
  onClick?: () => void;
  showActions?: boolean;
}

export default function TaskCard({ task, isDragging, onClick, showActions }: TaskCardProps) {
  const { updateTaskInStore, addActiveRun, activeRuns, maxConcurrentAgents } = useAppStore();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isSortDragging ? 0.4 : 1,
  };

  const handleRunAgent = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const data = await api.startAgent(task.id);
      updateTaskInStore(data.task);
      addActiveRun({ taskId: task.id, taskKey: task.task_key });
    } catch (err: any) {
      toast.error(err.data?.error || err.message || 'Failed to start agent');
    }
  };

  const canStartAgent = activeRuns.length < maxConcurrentAgents && task.agent_status !== 'running';

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={`group relative p-3 rounded-lg border transition-all cursor-pointer select-none ${
        isDragging
          ? 'bg-bg-card border-accent/40 shadow-lg shadow-accent/10 scale-[1.02]'
          : 'bg-bg-card border-border hover:border-accent/30 hover:shadow-md hover:shadow-black/20'
      }`}
    >
      {/* Task key + status badge */}
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-mono font-semibold text-text-muted">{task.task_key}</span>
        <AgentBadge status={task.agent_status} />
      </div>

      {/* Title */}
      <p className="text-sm font-medium text-text leading-snug line-clamp-2">{task.title}</p>

      {/* Quick run button for todo tasks */}
      {(task.status === 'todo' || showActions) && canStartAgent && (
        <Tooltip label="Start Workflow" className="absolute top-2.5 right-2.5 opacity-0 group-hover:opacity-100">
          <button
            onClick={handleRunAgent}
            className="p-1 rounded-md text-text-muted hover:text-success hover:bg-success-dim transition-all"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 2l9 5-9 5V2z" fill="currentColor" />
            </svg>
          </button>
        </Tooltip>
      )}
    </div>
  );
}

function AgentBadge({ status }: { status: Task['agent_status'] }) {
  if (!status) return null;

  const config = {
    running: {
      bg: 'bg-running-dim',
      text: 'text-running',
      label: 'Running',
      icon: (
        <svg width="10" height="10" viewBox="0 0 10 10" className="animate-spin-slow">
          <circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeDasharray="12 8" />
        </svg>
      ),
    },
    completed: {
      bg: 'bg-success-dim',
      text: 'text-success',
      label: 'Done',
      icon: (
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M2 5.5l2 2 4-4.5" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    failed: {
      bg: 'bg-danger-dim',
      text: 'text-danger',
      label: 'Failed',
      icon: (
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M3 3l4 4M7 3l-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      ),
    },
  };

  const c = config[status];
  return (
    <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold ${c.bg} ${c.text}`}>
      {c.icon}
      {c.label}
    </span>
  );
}
