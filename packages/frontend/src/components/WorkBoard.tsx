import { useMemo } from 'react';
import { useAppStore } from '../hooks/useTaskStore.js';
import type { OperationalState, Task } from '../domain.js';
import { Icon } from './Icon.js';
import { KeyboardShortcut } from './KeyboardShortcut.js';

const columns: Array<{ key: OperationalState; label: string; hint: string }> = [
  { key: 'backlog', label: 'Backlog', hint: 'Open tasks, available to run' },
  { key: 'active', label: 'Active', hint: 'Agents and checks in motion' },
  { key: 'attention', label: 'Needs attention', hint: 'A decision or recovery needed' },
  { key: 'finished', label: 'Finished', hint: 'Completed or cancelled' },
];

function attentionSummary(task: Task): string | null {
  if (task.workspace_state === 'cleanup_required') return 'Workspace cleanup required';
  if (task.active_run_status === 'waiting') return task.active_block_name ? `Decision required in ${task.active_block_name}` : 'Decision required';
  if (task.active_run_status === 'attention') return task.active_run_reason || 'Run needs recovery';
  return null;
}

function TaskCard({ task }: { task: Task }) {
  const select = useAppStore((state) => state.selectTask);
  const attention = attentionSummary(task);
  return <button className={`task-card state-${task.operational_state}`} onClick={() => select(task.id)} aria-label={`${task.task_key}: ${task.title}${attention ? `. ${attention}` : ''}`}>
    <div className="task-card-top"><span>{task.task_key}</span>{task.workspace_state === 'cleanup_required' && <i title="Workspace needs cleanup">DIRTY</i>}</div>
    <h3>{task.title}</h3>
    {task.description && <p>{task.description}</p>}
    {attention && <span className="attention-callout"><Icon name="alert" size={14} />{attention}<b>Review</b></span>}
    <div className="task-card-foot">
      {task.active_block_name ? <span className="block-chip"><span className="signal" />{task.active_block_name}</span> : <span>{task.resolution === 'open' ? 'No active run' : task.resolution}</span>}
      <Icon name="arrow" size={15} />
    </div>
  </button>;
}

export default function WorkBoard() {
  const tasks = useAppStore((state) => state.tasks);
  const workView = useAppStore((state) => state.workView);
  const setCreate = useAppStore((state) => state.setCreateOpen);
  const current = columns.find((column) => column.key === workView)!;
  const queue = useMemo(() => tasks.filter((task) => task.operational_state === workView), [tasks, workView]);
  const firstUse = tasks.length === 0;
  const emptyCopy = workView === 'attention'
    ? { title: 'Nothing needs you', detail: 'Decisions, interrupted Runs, and cleanup requests will appear here.' }
    : firstUse && workView === 'backlog'
      ? { title: 'Start with one task', detail: 'Every new task starts in Backlog. Add context when it will help the Run.' }
      : { title: `No ${current.label.toLowerCase()} tasks`, detail: current.hint };

  return <section className="board queue-board" aria-labelledby={`queue-${workView}`}>
    <header className="queue-header">
      <div><span className="eyebrow">WORK QUEUE</span><div className="queue-title"><h2 id={`queue-${workView}`}>{current.label}</h2><em>{queue.length}</em></div><p>{current.hint}</p></div>
      <div className="queue-guide"><strong>How Flow works</strong><span>A Flow is the versioned plan. A Run is one execution of that plan.</span></div>
    </header>
    <div className="queue-content">
      {queue.length ? <div className="card-stack queue-stack">{queue.map((task) => <TaskCard key={task.id} task={task} />)}</div>
        : <div className={`empty-queue ${firstUse ? 'first-use' : ''}`}><span className="empty-queue-mark"><Icon name={workView === 'attention' ? 'check' : 'plus'} size={25} /></span><h3>{emptyCopy.title}</h3><p>{emptyCopy.detail}</p>{workView === 'backlog' && <button className="button primary" onClick={() => setCreate(true)} title="Option + N" aria-keyshortcuts="Alt+N"><Icon name="plus" size={16} />New task <KeyboardShortcut keys={['⌥', 'N']} /></button>}</div>}
    </div>
  </section>;
}
