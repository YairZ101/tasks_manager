import { useEffect, useState } from 'react';
import type { Task, TaskLinkRelationship } from '../domain.js';
import { Icon } from './Icon.js';
import TaskLinkPicker from './TaskLinkPicker.js';

type DetailSection = 'context' | 'acceptance' | 'links';

export type TaskDetailValues = { title: string; description: string; acceptance: string };
export type TaskDetailLink = { task_id: number; relationship: TaskLinkRelationship; task_key?: string; title?: string };

const detailLabels: Record<DetailSection, string> = { context: 'Context', acceptance: 'Done when', links: 'Linked tasks' };
const relationshipLabels: Record<TaskLinkRelationship, string> = { is_blocked_by: 'Is blocked by', blocks: 'Blocks', relates_to: 'Relates to' };

export default function TaskDetailsFields({ value, onChange, links, onLinksChange, tasks, candidateTasks = tasks, excludeTaskId, autoFocus = false }: {
  value: TaskDetailValues;
  onChange: (value: TaskDetailValues) => void;
  links: TaskDetailLink[];
  onLinksChange: (links: TaskDetailLink[]) => void;
  tasks: Task[];
  candidateTasks?: Task[];
  excludeTaskId?: number;
  autoFocus?: boolean;
}) {
  const [sections, setSections] = useState<DetailSection[]>(() => [
    ...(value.description ? ['context' as const] : []),
    ...(value.acceptance ? ['acceptance' as const] : []),
    ...(links.length ? ['links' as const] : []),
  ]);
  const [relationship, setRelationship] = useState<TaskLinkRelationship>('is_blocked_by');
  const addSection = (section: DetailSection) => setSections((current) => current.includes(section) ? current : [...current, section]);
  const removeSection = (section: DetailSection) => {
    setSections((current) => current.filter((candidate) => candidate !== section));
    if (section === 'context') onChange({ ...value, description: '' });
    if (section === 'acceptance') onChange({ ...value, acceptance: '' });
    if (section === 'links') onLinksChange([]);
  };
  const availableTasks = candidateTasks.filter((task) => task.id !== excludeTaskId && !links.some((link) => link.task_id === task.id));

  useEffect(() => {
    const populatedSections: DetailSection[] = [
      ...(value.description ? ['context' as const] : []),
      ...(value.acceptance ? ['acceptance' as const] : []),
      ...(links.length ? ['links' as const] : []),
    ];
    setSections((current) => [...current, ...populatedSections.filter((section) => !current.includes(section))]);
  }, [links.length, value.acceptance, value.description]);

  return <div className="task-details-fields">
    <label className="task-detail-title-field">Task title<input autoFocus={autoFocus} required maxLength={500} value={value.title} onChange={(event) => onChange({ ...value, title: event.target.value })} placeholder="What should be different when this is done?" /></label>
    {sections.includes('context') ? <section className="task-detail-field"><header><strong>Context</strong><button type="button" onClick={() => removeSection('context')}>Remove</button></header><textarea value={value.description} onChange={(event) => onChange({ ...value, description: event.target.value })} placeholder="Why this matters, constraints, useful links…" /></section> : null}
    {sections.includes('acceptance') ? <section className="task-detail-field"><header><strong>Done when</strong><button type="button" onClick={() => removeSection('acceptance')}>Remove</button></header><textarea value={value.acceptance} onChange={(event) => onChange({ ...value, acceptance: event.target.value })} placeholder="Observable conditions for success and how to verify them" /></section> : null}
    {sections.includes('links') ? <section className="task-detail-field"><header><strong>Linked tasks</strong><button type="button" onClick={() => removeSection('links')}>Remove</button></header>
      <div className="link-picker"><label>Relationship<select value={relationship} onChange={(event) => setRelationship(event.target.value as TaskLinkRelationship)}>{(Object.keys(relationshipLabels) as TaskLinkRelationship[]).map((candidate) => <option key={candidate} value={candidate}>{relationshipLabels[candidate]}</option>)}</select></label>
        <TaskLinkPicker tasks={availableTasks} onSelect={(task) => onLinksChange([...links, { task_id: task.id, relationship }])} />
      </div>
      {links.length > 0 ? <div className="dependency-list">{links.map((link) => {
        const linkedTask = tasks.find((task) => task.id === link.task_id);
        const taskKey = link.task_key ?? linkedTask?.task_key ?? `Task ${link.task_id}`;
        const title = link.title ?? linkedTask?.title ?? 'Task unavailable';
        return <span key={`${link.task_id}-${link.relationship}`}><small>{relationshipLabels[link.relationship]}</small>{taskKey} · {title}<button type="button" aria-label={`Remove link ${taskKey}`} onClick={() => onLinksChange(links.filter((candidate) => candidate !== link))}><Icon name="close" size={13} /></button></span>;
      })}</div> : null}
    </section> : null}
    {sections.length < 3 ? <div className="detail-picker"><span>Add details only when they help</span><div>{(Object.keys(detailLabels) as DetailSection[]).filter((section) => !sections.includes(section)).map((section) => <button key={section} type="button" onClick={() => addSection(section)}><Icon name="plus" size={13} />{detailLabels[section]}</button>)}</div></div> : null}
  </div>;
}
