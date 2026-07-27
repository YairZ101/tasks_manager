import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '../api/client.js';
import { useAppStore } from '../hooks/useTaskStore.js';
import { Icon } from './Icon.js';

export default function TaskComposer() {
  const { flows, workView, setCreateOpen, refreshTasks, selectTask } = useAppStore();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [acceptance, setAcceptance] = useState('');
  const [placement, setPlacement] = useState<'backlog' | 'ready'>(workView === 'backlog' ? 'backlog' : 'ready');
  const [run, setRun] = useState(false);
  const [flowId, setFlowId] = useState(flows.find((flow) => flow.is_default)?.id ?? flows[0]?.id);
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await api.createTask({ title, description, acceptance, queue_state: placement, run, flow_id: flowId });
      await refreshTasks(); setCreateOpen(false); selectTask(result.task.id);
      toast.success(run ? 'Task created and Run queued.' : 'Task created.');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not create task.'); }
    finally { setSaving(false); }
  };
  return <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setCreateOpen(false)}>
    <form className="composer" onSubmit={submit}>
      <header><div><span className="eyebrow">NEW WORK</span><h2>Frame the outcome</h2></div><button type="button" className="icon-button" aria-label="Close" onClick={() => setCreateOpen(false)}><Icon name="close" /></button></header>
      <label>Task title<input autoFocus required maxLength={500} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What should be different when this is done?" /></label>
      <label>Context<textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Why this matters, constraints, useful links…" /></label>
      <label>Acceptance criteria<textarea value={acceptance} onChange={(e) => setAcceptance(e.target.value)} placeholder="Observable conditions for success" /></label>
      <div className="segmented" aria-label="Initial queue"><button type="button" className={placement === 'backlog' ? 'active' : ''} onClick={() => { setPlacement('backlog'); setRun(false); }}>Backlog</button><button type="button" className={placement === 'ready' ? 'active' : ''} onClick={() => setPlacement('ready')}>Ready</button></div>
      <label className="run-toggle"><input type="checkbox" checked={run} onChange={(e) => { setRun(e.target.checked); if (e.target.checked) setPlacement('ready'); }} /><span /><div><strong>Start a Run now</strong><small>The scheduler picks it up when capacity is available.</small></div></label>
      {run && <label>Flow<select value={flowId} onChange={(e) => setFlowId(Number(e.target.value))}>{flows.filter((flow) => flow.active_version_id).map((flow) => <option key={flow.id} value={flow.id}>{flow.name}{flow.is_default ? ' · default' : ''}</option>)}</select></label>}
      <footer><button type="button" className="button ghost" onClick={() => setCreateOpen(false)}>Cancel</button><button className="button primary" disabled={saving || !title.trim()}>{saving ? 'Creating…' : run ? 'Create & run' : 'Create task'}</button></footer>
    </form>
  </div>;
}
