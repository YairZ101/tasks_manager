import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { DecisionNode, FlowNode } from '@flow/core';
import { api } from '../api/client.js';
import type { Attempt, Flow, RunDetail, TaskLog } from '../domain.js';
import { useAppStore } from '../hooks/useTaskStore.js';
import { Icon } from './Icon.js';

const statusLabel: Record<string, string> = { queued: 'Queued', running: 'Running', waiting: 'Waiting for you', attention: 'Needs attention', finished: 'Finished', stopped: 'Stopped' };

export function buildRunPreflight(flow: Flow | undefined) {
  if (!flow?.activeVersion) return null;
  const blocks = flow.activeVersion.definition.nodes.filter((node) => node.type !== 'note');
  const agentBlocks = blocks.filter((node) => node.type === 'agent');
  const effectLevel = agentBlocks.some((node) => node.config.effectLevel === 'external_write') ? 'external_write'
    : agentBlocks.some((node) => node.config.effectLevel === 'workspace_write') ? 'workspace_write'
      : 'read_only';
  const effectCopy = {
    read_only: 'Read-only analysis and checks',
    workspace_write: 'May change this task’s workspace',
    external_write: 'May change the workspace and external services',
  }[effectLevel];
  return {
    name: flow.name,
    version: flow.activeVersion.version,
    blockNames: blocks.slice(0, 4).map((node) => 'name' in node.config ? node.config.name : node.type),
    remainingBlocks: Math.max(0, blocks.length - 4),
    workspace: 'Task-scoped workspace · reused by future Runs',
    effectCopy,
  };
}

export default function TaskPanel({ taskId }: { taskId: number }) {
  const { tasks, flows, selectTask, refreshTasks } = useAppStore();
  const task = tasks.find((candidate) => candidate.id === taskId);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [logs, setLogs] = useState<TaskLog[]>([]);
  const [selectedAttempt, setSelectedAttempt] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: '', description: '', acceptance: '' });

  useEffect(() => {
    if (!task) return;
    setDraft({ title: task.title, description: task.description, acceptance: task.acceptance });
    const load = async () => {
      const runId = task.active_run_id ?? (await api.listRuns(task.id)).runs[0]?.id;
      setDetail(runId ? await api.getRun(runId) : null);
    };
    void load();
  }, [task?.id, task?.active_run_id, task?.active_run_status, task?.updated_at]);

  useEffect(() => {
    const attemptId = selectedAttempt ?? detail?.attempts.at(-1)?.id;
    if (!attemptId) { setLogs([]); return; }
    setSelectedAttempt(attemptId);
    void api.getAttempt(attemptId).then((result) => setLogs(result.logs));
  }, [detail, selectedAttempt]);

  const nodeMap = useMemo(() => new Map((detail?.flowVersion.definition.nodes ?? []).map((node) => [node.id, node])), [detail]);
  const defaultFlow = flows.find((flow) => flow.is_default);
  const preflight = useMemo(() => buildRunPreflight(defaultFlow), [defaultFlow]);
  const latest = detail?.attempts.at(-1);
  const decision = latest?.status === 'waiting' ? nodeMap.get(latest.block_id) as DecisionNode | undefined : undefined;
  if (!task) return null;

  const refresh = async (runId?: number) => { await refreshTasks(); if (runId) setDetail(await api.getRun(runId)); };
  const start = useCallback(async () => {
    if (!defaultFlow) { toast.error('Publish and set a default Flow before starting a Run.'); return; }
    setBusy(true); try { const { run } = await api.startRun(task.id, flows.find((flow) => flow.is_default)?.id); await refresh(run.id); toast.success('Run queued.'); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not start Run.'); } finally { setBusy(false); }
  }, [defaultFlow, flows, task.id]);
  const decide = async (outcome: string) => {
    if (!detail || !latest) return;
    setBusy(true); try { await api.decide(detail.run.id, latest.id, outcome, comment); setComment(''); await refresh(detail.run.id); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not save Decision.'); } finally { setBusy(false); }
  };
  const stop = async () => { if (!detail) return; setBusy(true); try { await api.stopRun(detail.run.id); await refresh(detail.run.id); } finally { setBusy(false); } };
  const retry = async () => { if (!detail) return; setBusy(true); try { await api.retryRun(detail.run.id); await refresh(detail.run.id); } finally { setBusy(false); } };
  const save = async () => { setBusy(true); try { await api.updateTask(task.id, draft); await refreshTasks(); setEditing(false); } finally { setBusy(false); } };
  const remove = async () => {
    if (!window.confirm(`Delete ${task.task_key}? This keeps dirty workspaces unless you explicitly force cleanup.`)) return;
    try { await api.deleteTask(task.id); selectTask(null); await refreshTasks(); }
    catch (error: any) {
      if (error.data?.reason === 'workspace_dirty' && window.confirm(`${error.message}\n\nForce cleanup and delete the task?`)) { await api.deleteTask(task.id, true); selectTask(null); await refreshTasks(); }
      else toast.error(error.message);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (!event.altKey || target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (event.code === 'Enter' && !detail && task.resolution === 'open') { event.preventDefault(); void start(); }
      if (event.code === 'Period' && detail && ['queued', 'running', 'waiting', 'attention'].includes(detail.run.status)) { event.preventDefault(); void stop(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [detail, start, task.resolution]);

  return <div className="panel-layer" onMouseDown={(e) => e.target === e.currentTarget && selectTask(null)}>
    <aside className="task-panel" aria-label={`Task ${task.task_key}`}>
      <header className="panel-head"><div><span className="task-key">{task.task_key}</span><span className={`state-pill ${task.operational_state}`}>{task.operational_state.replace('_', ' ')}</span></div><button className="icon-button" aria-label="Close task" onClick={() => selectTask(null)}><Icon name="close" /></button></header>
      <div className="panel-scroll">
        <section className="task-summary">
          {editing ? <>
            <input className="title-input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            <label>Context<textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
            <label>Acceptance criteria<textarea value={draft.acceptance} onChange={(e) => setDraft({ ...draft, acceptance: e.target.value })} /></label>
            <div className="inline-actions"><button className="button ghost" onClick={() => setEditing(false)}>Cancel</button><button className="button primary" onClick={save} disabled={busy}>Save</button></div>
          </> : <>
            <div className="title-row"><h2>{task.title}</h2><button className="icon-button" aria-label="Edit task" onClick={() => setEditing(true)}><Icon name="edit" size={16} /></button></div>
            {task.description ? <p>{task.description}</p> : <p className="muted">No context provided.</p>}
            {task.acceptance && <div className="acceptance"><span>DONE WHEN</span><p>{task.acceptance}</p></div>}
          </>}
        </section>

        {!detail && task.resolution === 'open' && <section className="start-run">
          <div className="start-glyph"><Icon name="play" size={23} /></div>
          {preflight ? <>
            <span className="eyebrow">RUN PREFLIGHT</span><h3>{preflight.name} <small>v{preflight.version}</small></h3>
            <p>One execution of this published Flow will begin for this task.</p>
            <dl className="preflight-list"><div><dt>Key blocks</dt><dd>{preflight.blockNames.join(' → ')}{preflight.remainingBlocks ? ` +${preflight.remainingBlocks}` : ''}</dd></div><div><dt>Workspace</dt><dd>{preflight.workspace}</dd></div><div><dt>Effects</dt><dd>{preflight.effectCopy}</dd></div></dl>
            <button className="button primary wide" onClick={start} disabled={busy}>Start this Flow <kbd>⌥↵</kbd></button>
          </> : <>
            <h3>No default Flow yet</h3><p>Publish a Flow and make it the default before this task can run.</p>
            <button className="button primary wide" onClick={() => useAppStore.getState().setSection('flows')}>Open Flows</button>
          </>}
        </section>}

        {detail && <section className="run-card">
          <div className="run-head"><div><span className="eyebrow">RUN #{detail.run.id}</span><h3>{statusLabel[detail.run.status]}</h3></div><span className={`run-light ${detail.run.status}`} /></div>
          {detail.run.reason && <div className="run-reason"><Icon name="alert" size={16} />{detail.run.reason}</div>}
          {decision?.type === 'decision' && <div className="decision-box">
            <span className="eyebrow">DECISION REQUIRED</span><h3>{decision.config.name}</h3>{decision.config.instructions && <p>{decision.config.instructions}</p>}
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add context for the next block (optional unless required)" />
            <div className="decision-actions">{decision.config.choices.map((choice) => <button key={choice.id} className={`button choice ${choice.tone}`} disabled={busy || (choice.commentRequired && !comment.trim())} onClick={() => decide(choice.id)}>{choice.label}</button>)}</div>
          </div>}
          <div className="timeline">
            {detail.attempts.map((attempt) => <button key={attempt.id} className={`${selectedAttempt === attempt.id ? 'selected' : ''}`} onClick={() => setSelectedAttempt(attempt.id)}>
              <span className={`attempt-dot ${attempt.status}`} />
              <div><strong>{(nodeMap.get(attempt.block_id) as FlowNode | undefined)?.config && 'name' in (nodeMap.get(attempt.block_id) as FlowNode).config ? ((nodeMap.get(attempt.block_id) as any).config.name) : attempt.block_id}</strong><small>Attempt {attempt.block_attempt} · {attempt.outcome_id ?? attempt.status}</small></div>
              <em>{attempt.sequence}</em>
            </button>)}
          </div>
          {logs.length > 0 && <div className="log-view" aria-label="Attempt output">{logs.map((log) => <div key={log.id} className={log.level}><span>{log.level.slice(0, 3)}</span><code>{log.message}</code></div>)}</div>}
          <div className="run-actions">
            {['queued', 'running', 'waiting', 'attention'].includes(detail.run.status) && <button className="button danger ghost" onClick={stop} disabled={busy}><Icon name="stop" size={15} />Stop Run <kbd>⌥.</kbd></button>}
            {detail.run.status === 'attention' && <button className="button primary" onClick={retry} disabled={busy}>Retry block</button>}
            {detail.workspace && <span title={detail.workspace.worktree_path}><Icon name="branch" size={14} />{detail.workspace.branch ?? 'project workspace'} · {detail.workspace.state}</span>}
          </div>
        </section>}
      </div>
      <footer className="panel-footer">
        {task.resolution !== 'open' ? <button className="button ghost" onClick={async () => { await api.updateTask(task.id, { resolution: 'open', queue_state: 'ready' }); await refreshTasks(); }}>Reopen task</button>
          : !task.active_run_id ? <button className="button ghost" onClick={async () => { await api.updateTask(task.id, { queue_state: task.queue_state === 'ready' ? 'backlog' : 'ready' }); await refreshTasks(); }}>{task.queue_state === 'ready' ? 'Move to backlog' : 'Move to ready'}</button> : <span />}
        <button className="text-danger" onClick={remove}><Icon name="trash" size={15} />Delete task</button>
      </footer>
    </aside>
  </div>;
}
