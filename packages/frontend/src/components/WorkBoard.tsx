import { useMemo } from 'react';
import { useAppStore } from '../hooks/useTaskStore.js';
import type { OperationalState, Task } from '../domain.js';
import { Icon } from './Icon.js';

const columns: Array<{ key: OperationalState; label: string; hint: string }> = [
  { key: 'backlog', label: 'Backlog', hint: 'Ideas, not yet committed' },
  { key: 'ready', label: 'Ready', hint: 'Prepared to run' },
  { key: 'active', label: 'Active', hint: 'Agents and checks in motion' },
  { key: 'attention', label: 'Needs attention', hint: 'A decision or recovery needed' },
  { key: 'finished', label: 'Finished', hint: 'Completed or cancelled' },
];

function TaskCard({ task }: { task: Task }) {
  const select = useAppStore((state) => state.selectTask);
  return <button className={`task-card state-${task.operational_state}`} onClick={() => select(task.id)}>
    <div className="task-card-top"><span>{task.task_key}</span>{task.workspace_state === 'cleanup_required' && <i title="Workspace needs cleanup">DIRTY</i>}</div>
    <h3>{task.title}</h3>
    {task.description && <p>{task.description}</p>}
    <div className="task-card-foot">
      {task.active_block_name ? <span className="block-chip"><span className="signal" />{task.active_block_name}</span> : <span>{task.resolution === 'open' ? 'No active run' : task.resolution}</span>}
      <Icon name="arrow" size={15} />
    </div>
  </button>;
}

export default function WorkBoard() {
  const tasks = useAppStore((state) => state.tasks);
  const focused = useAppStore((state) => state.workView);
  const setCreate = useAppStore((state) => state.setCreateOpen);
  const grouped = useMemo(() => new Map(columns.map((column) => [column.key, tasks.filter((task) => task.operational_state === column.key)])), [tasks]);
  return <div className="board">
    {columns.map((column) => <section key={column.key} className={`work-column ${focused === column.key ? 'focused' : ''}`}>
      <header><div><span>{column.label}</span><em>{grouped.get(column.key)?.length}</em></div><p>{column.hint}</p></header>
      <div className="card-stack">
        {grouped.get(column.key)?.map((task) => <TaskCard key={task.id} task={task} />)}
        {!grouped.get(column.key)?.length && <div className="empty-column"><span>{column.key === 'attention' ? '✓' : '·'}</span><p>{column.key === 'attention' ? 'Nothing needs you' : 'No work here'}</p></div>}
      </div>
      {(column.key === 'backlog' || column.key === 'ready') && <button className="column-add" onClick={() => setCreate(true)}><Icon name="plus" size={15} />Add task</button>}
    </section>)}
  </div>;
}
