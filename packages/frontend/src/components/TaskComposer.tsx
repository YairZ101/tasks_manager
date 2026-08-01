import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '../api/client.js';
import type { TaskLinkRelationship } from '../domain.js';
import { useAppStore } from '../hooks/useTaskStore.js';
import { Icon } from './Icon.js';
import TaskDetailsFields from './TaskDetailsFields.js';

export default function TaskComposer() {
  const { tasks, setCreateOpen, refreshTasks, selectTask } = useAppStore();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [acceptance, setAcceptance] = useState('');
  const [links, setLinks] = useState<Array<{ task_id: number; relationship: TaskLinkRelationship }>>([]);
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await api.createTask({
        title,
        description,
        acceptance,
        task_links: links,
        queue_state: 'backlog',
        run: false,
      });
      await refreshTasks(); setCreateOpen(false); selectTask(result.task.id);
      toast.success('Task created in Backlog.');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not create task.'); }
    finally { setSaving(false); }
  };
  return <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setCreateOpen(false)}>
    <form className="composer" onSubmit={submit}>
      <header><div><span className="eyebrow">NEW WORK</span><h2>Frame the outcome</h2></div><button type="button" className="icon-button" aria-label="Close" onClick={() => setCreateOpen(false)}><Icon name="close" /></button></header>
      <TaskDetailsFields value={{ title, description, acceptance }} onChange={(next) => { setTitle(next.title); setDescription(next.description); setAcceptance(next.acceptance); }} links={links} onLinksChange={setLinks} tasks={tasks} candidateTasks={tasks.filter((task) => task.resolution === 'open')} autoFocus />
      <div className="composer-queue-note"><strong>Backlog</strong><span>Tasks can stay lean. Add detail before a Run when it reduces uncertainty.</span></div>
      <footer><button type="button" className="button ghost" onClick={() => setCreateOpen(false)}>Cancel</button><button className="button primary" disabled={saving || !title.trim()}>{saving ? 'Creating…' : 'Create task'}</button></footer>
    </form>
  </div>;
}
