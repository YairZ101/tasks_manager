import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../api/client.js';
import type { TaskLinkRelationship } from '../domain.js';
import { useAppStore } from '../hooks/useTaskStore.js';
import Button from './Button.js';
import { Icon } from './Icon.js';
import SelectionMenu from './SelectionMenu.js';
import { buildRunPreflight } from './runPreflight.js';
import TaskDialog from './TaskDialog.js';
import { useConfirm } from './ConfirmProvider.js';

export default function TaskComposer() {
  const { tasks, flows, setCreateOpen, refreshTasks, selectTask } = useAppStore();
  const confirm = useConfirm();
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
    document.addEventListener('mousedown', closeOnOutsidePress);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsidePress);
    };
  }, [actionsOpen]);

  const createTask = async (run: boolean) => {
    if (run && incompleteDependencies.length) {
      const accepted = await confirm({
        tone: 'warning',
        title: 'Start with incomplete dependencies?',
        description: 'This task depends on work that is not completed.',
        details: incompleteDependencies.map((dependency) => `${dependency.task_key} · ${dependency.title}`),
        confirmLabel: 'Start run anyway',
      });
      if (!accepted) return;
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
  return <TaskDialog
    mode="create"
    value={{ title, description, acceptance }}
    onChange={(next) => { setTitle(next.title); setDescription(next.description); setAcceptance(next.acceptance); }}
    links={links}
    onLinksChange={setLinks}
    tasks={tasks}
    candidateTasks={tasks.filter((task) => task.resolution === 'open')}
    busy={saving}
    footerLayout={action === 'run' ? 'run' : 'default'}
    footer={<>{action === 'run' && preflight ? <div className="composer-flow-control"><SelectionMenu label="Flow" ariaLabel="Flow to run" value={String(selectedFlow?.id ?? '')} options={flowOptions} onChange={(value) => setSelectedFlowId(Number(value))} inlineLabel disabled={saving} className="composer-flow-selection" placement="top" /></div> : null}<Button variant="ghost" disabled={saving} onClick={() => setCreateOpen(false)}>Cancel</Button><div className="composer-create-actions" ref={actionsRef} onKeyDown={(event) => { if (actionsOpen && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setActionsOpen(false); } }}><Button type="submit" variant="primary" loading={saving} loadingLabel="Creating…" disabled={!title.trim()}>{action === 'run' ? 'Create & start run' : 'Create task'}</Button>{preflight ? <><Button variant="primary" className="composer-more-actions" icon="arrow" aria-label="More create actions" aria-haspopup="menu" aria-expanded={actionsOpen} onClick={() => setActionsOpen((open) => !open)} disabled={saving || !title.trim()} />{actionsOpen ? <div className="composer-action-menu" role="menu" aria-label="Create task actions"><button type="button" role="menuitem" aria-current={action === 'create' ? 'true' : undefined} onClick={() => selectAction('create')}><Icon name="plus" size={16} /><span><strong>Create task</strong><small>Add it to Backlog.</small></span></button><button type="button" role="menuitem" aria-current={action === 'run' ? 'true' : undefined} onClick={() => selectAction('run')}><Icon name="play" size={16} /><span><strong>Create & start run</strong><small>Choose a Flow before starting.</small></span></button></div> : null}</> : null}</div></>}
    onSubmit={submit}
    onClose={() => setCreateOpen(false)}
  />;
}
