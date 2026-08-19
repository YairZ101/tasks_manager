import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../api/client.js';
import type { TaskLinkRelationship } from '../domain.js';
import { useAppStore } from '../hooks/useTaskStore.js';
import Button from './Button.js';
import { Icon } from './Icon.js';
import IconButton from './IconButton.js';
import SelectionMenu from './SelectionMenu.js';
import TaskDetailsFields from './TaskDetailsFields.js';
import { buildRunPreflight } from './runPreflight.js';

export default function TaskComposer() {
  const { tasks, flows, setCreateOpen, refreshTasks, selectTask } = useAppStore();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [acceptance, setAcceptance] = useState('');
  const [links, setLinks] = useState<Array<{ task_id: number; relationship: TaskLinkRelationship }>>([]);
  const publishedFlows = useMemo(() => flows.filter((flow) => flow.activeVersion), [flows]);
  const defaultFlow = publishedFlows.find((flow) => flow.is_default);
  const [action, setAction] = useState<'create' | 'run'>('create');
  const [selectedFlowId, setSelectedFlowId] = useState<number | null>(() => defaultFlow?.id ?? publishedFlows[0]?.id ?? null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  const selectedFlow = publishedFlows.find((flow) => flow.id === selectedFlowId) ?? defaultFlow ?? publishedFlows[0];
  const flowOptions = useMemo(() => publishedFlows.map((flow) => ({ value: String(flow.id), label: `${flow.is_default ? 'Project default · ' : ''}${flow.name} · v${flow.activeVersion!.version}` })), [publishedFlows]);
  const preflight = buildRunPreflight(selectedFlow);
  const incompleteDependencies = links.flatMap((link) => {
    if (link.relationship !== 'is_blocked_by') return [];
    const task = tasks.find((candidate) => candidate.id === link.task_id);
    return task && task.resolution !== 'completed' ? [task] : [];
  });
  useEffect(() => {
    if (!actionsOpen) return;
    const closeOnOutsidePress = (event: MouseEvent) => {
      if (!actionsRef.current?.contains(event.target as Node)) setActionsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActionsOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsidePress);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsidePress);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [actionsOpen]);

  const createTask = async (run: boolean) => {
    if (run && incompleteDependencies.length) {
      const names = incompleteDependencies.map((dependency) => `${dependency.task_key} · ${dependency.title}`).join('\n');
      if (!window.confirm(`This task depends on work that is not completed:\n\n${names}\n\nStart this run anyway?`)) return;
    }
    setActionsOpen(false);
    setSaving(true);
    try {
      const result = await api.createTask({
        title,
        description,
        acceptance,
        task_links: links,
        run,
        flow_id: run ? selectedFlow?.id : undefined,
      });
      await refreshTasks(); setCreateOpen(false); selectTask(result.task.id);
      toast.success(run ? 'Task created and Run queued.' : 'Task created in Backlog.');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not create task.'); }
    finally { setSaving(false); }
  };
  const selectAction = (nextAction: 'create' | 'run') => { setAction(nextAction); setActionsOpen(false); };
  const submit = (event: React.FormEvent) => { event.preventDefault(); void createTask(action === 'run'); };
  return <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setCreateOpen(false)}>
    <form className="composer" role="dialog" aria-modal="true" aria-labelledby="new-task-title" onSubmit={submit}>
      <header><div><span className="eyebrow">NEW WORK</span><h2 id="new-task-title">Frame the outcome</h2></div><IconButton label="Close new task" icon="close" onClick={() => setCreateOpen(false)} /></header>
      <TaskDetailsFields value={{ title, description, acceptance }} onChange={(next) => { setTitle(next.title); setDescription(next.description); setAcceptance(next.acceptance); }} links={links} onLinksChange={setLinks} tasks={tasks} candidateTasks={tasks.filter((task) => task.resolution === 'open')} autoFocus />
      <footer className={action === 'run' ? 'composer-run-footer' : ''}>{action === 'run' && preflight ? <div className="composer-flow-control"><SelectionMenu label="Flow" ariaLabel="Flow to run" value={String(selectedFlow?.id ?? '')} options={flowOptions} onChange={(value) => setSelectedFlowId(Number(value))} inlineLabel className="composer-flow-selection menu-top" /></div> : null}<Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button><div className="composer-create-actions" ref={actionsRef}><Button type="submit" variant="primary" loading={saving} loadingLabel="Creating…" disabled={!title.trim()}>{action === 'run' ? 'Create & start run' : 'Create task'}</Button>{preflight ? <><Button variant="primary" className="composer-more-actions" icon="arrow" aria-label="More create actions" aria-haspopup="menu" aria-expanded={actionsOpen} onClick={() => setActionsOpen((open) => !open)} disabled={saving || !title.trim()} />{actionsOpen ? <div className="composer-action-menu" role="menu" aria-label="Create task actions"><button type="button" role="menuitem" aria-current={action === 'create' ? 'true' : undefined} onClick={() => selectAction('create')}><Icon name="plus" size={16} /><span><strong>Create task</strong><small>Add it to Backlog.</small></span></button><button type="button" role="menuitem" aria-current={action === 'run' ? 'true' : undefined} onClick={() => selectAction('run')}><Icon name="play" size={16} /><span><strong>Create & start run</strong><small>Choose a Flow before starting.</small></span></button></div> : null}</> : null}</div></footer>
    </form>
  </div>;
}
