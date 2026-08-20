import { useDeferredValue, useEffect, useId, useMemo, useState } from 'react';
import type { Task } from '../domain.js';

type LinkableTask = Pick<Task, 'id' | 'task_key' | 'title'>;

const resultLimit = 6;

export default function TaskLinkPicker({ tasks, onSelect, disabled = false }: { tasks: LinkableTask[]; onSelect: (task: LinkableTask) => void; disabled?: boolean }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const deferredQuery = useDeferredValue(query);
  const listId = useId();
  const normalizedQuery = deferredQuery.trim().toLocaleLowerCase();
  const matches = useMemo(() => tasks
    .filter((task) => !normalizedQuery || `${task.task_key} ${task.title}`.toLocaleLowerCase().includes(normalizedQuery))
    .slice(0, resultLimit), [normalizedQuery, tasks]);
  const listLabel = normalizedQuery ? 'Matching tasks' : 'Available tasks';
  const chooseTask = (task: LinkableTask) => {
    onSelect(task);
    setQuery('');
    setOpen(false);
  };

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return <div className="task-search-picker" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    <label>Task
      <input
        type="search"
        role="combobox"
        aria-label="Search tasks by title or key"
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={open}
        autoComplete="off"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { setOpen(false); event.currentTarget.blur(); }
          if (event.key === 'Enter' && open && matches.length > 0) { event.preventDefault(); chooseTask(matches[0]); }
        }}
        placeholder="Search by title or key…"
        disabled={disabled}
      />
    </label>
    {open ? <div id={listId} className="task-search-results" role="listbox" aria-label={listLabel}>
      {matches.length > 0 ? <ul>{matches.map((task) => <li key={task.id}><button type="button" role="option" aria-selected={false} onClick={() => chooseTask(task)}><strong>{task.task_key}</strong><span>{task.title}</span></button></li>)}</ul>
        : <p>No tasks match “{query.trim()}”.</p>}
    </div> : null}
  </div>;
}
