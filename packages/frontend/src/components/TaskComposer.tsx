import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '../api/client.js';
import { useAppStore } from '../hooks/useTaskStore.js';
import { Icon } from './Icon.js';

export default function TaskComposer() {
  const { setCreateOpen, refreshTasks, selectTask } = useAppStore();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [acceptance, setAcceptance] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await api.createTask({ title, description, acceptance, queue_state: 'backlog', run: false });
      await refreshTasks(); setCreateOpen(false); selectTask(result.task.id);
      toast.success('Task created in Backlog.');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not create task.'); }
    finally { setSaving(false); }
  };
  return <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setCreateOpen(false)}>
    <form className="composer" onSubmit={submit}>
      <header><div><span className="eyebrow">NEW WORK</span><h2>Frame the outcome</h2></div><button type="button" className="icon-button" aria-label="Close" onClick={() => setCreateOpen(false)}><Icon name="close" /></button></header>
      <label>Task title<input autoFocus required maxLength={500} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What should be different when this is done?" /></label>
      <label>Context<textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Why this matters, constraints, useful links…" /></label>
      <label>Acceptance criteria<textarea value={acceptance} onChange={(e) => setAcceptance(e.target.value)} placeholder="Observable conditions for success" /></label>
      <div className="composer-queue-note"><strong>Backlog</strong><span>New tasks start here. Move a task to Ready when its outcome and acceptance criteria are clear.</span></div>
      <footer><button type="button" className="button ghost" onClick={() => setCreateOpen(false)}>Cancel</button><button className="button primary" disabled={saving || !title.trim()}>{saving ? 'Creating…' : 'Create task'}</button></footer>
    </form>
  </div>;
}
