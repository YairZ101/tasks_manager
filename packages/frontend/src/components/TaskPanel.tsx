import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { DecisionNode, FlowNode } from '@flow/core';
import { api } from '../api/client.js';
import type { Attempt, Flow, RunDetail, TaskLink, TaskLog } from '../domain.js';
import { useAppStore } from '../hooks/useTaskStore.js';
import { Icon } from './Icon.js';
import { KeyboardShortcut } from './KeyboardShortcut.js';
import TaskDetailsFields, { type TaskDetailLink } from './TaskDetailsFields.js';

const statusLabel: Record<string, string> = { queued: 'Queued', running: 'Running', waiting: 'Waiting for you', attention: 'Needs attention', finished: 'Finished', stopped: 'Stopped' };
const relationshipLabels = { is_blocked_by: 'Is blocked by', blocks: 'Blocks', relates_to: 'Relates to' } as const;

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
  const [links, setLinks] = useState<TaskLink[]>([]);

  useEffect(() => {
    if (!task) return;
    setDraft({ title: task.title, description: task.description, acceptance: task.acceptance });
    void api.getTask(task.id).then(({ links }) => {
      setLinks(links);
    }).catch(() => setLinks([]));
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
  const selectedFlow = useMemo(() => task?.preferred_flow_id ? flows.find((flow) => flow.id === task.preferred_flow_id) : defaultFlow, [defaultFlow, flows, task?.preferred_flow_id]);
  const customFlows = useMemo(() => flows.filter((flow) => flow.activeVersion && flow.id !== defaultFlow?.id), [defaultFlow?.id, flows]);
  const preflight = useMemo(() => buildRunPreflight(selectedFlow), [selectedFlow]);
  const latest = detail?.attempts.at(-1);
  const decision = latest?.status === 'waiting' ? nodeMap.get(latest.block_id) as DecisionNode | undefined : undefined;
  const currentLinks = useMemo(() => links.map((link) => {
    const current = tasks.find((candidate) => candidate.id === link.linked_task_id);
    return current ? { ...link, task_key: current.task_key, title: current.title, resolution: current.resolution } : link;
  }), [links, tasks]);
  const incompleteDependencies = useMemo(() => currentLinks.filter((link) => link.relationship === 'is_blocked_by' && link.resolution !== 'completed'), [currentLinks]);
  const editableLinks = useMemo<TaskDetailLink[]>(() => links.map((link) => ({ task_id: link.linked_task_id, relationship: link.relationship, task_key: link.task_key, title: link.title })), [links]);
  if (!task) return null;

  const refresh = async (runId?: number) => { await refreshTasks(); if (runId) setDetail(await api.getRun(runId)); };
  const start = useCallback(async () => {
    if (!defaultFlow) { toast.error('Publish and set a default Flow before starting a Run.'); return; }
    if (incompleteDependencies.length) {
      const names = incompleteDependencies.map((dependency) => `${dependency.task_key} · ${dependency.title}`).join('\n');
      if (!window.confirm(`This task depends on work that is not completed:\n\n${names}\n\nStart this run anyway?`)) return;
    }
    setBusy(true); try { const { run } = await api.startRun(task.id); await refresh(run.id); toast.success('Run queued.'); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not start Run.'); } finally { setBusy(false); }
  }, [defaultFlow, flows, incompleteDependencies, task.id]);
  const decide = async (outcome: string) => {
    if (!detail || !latest) return;
    setBusy(true); try { await api.decide(detail.run.id, latest.id, outcome, comment); setComment(''); await refresh(detail.run.id); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not save Decision.'); } finally { setBusy(false); }
  };
  const stop = async () => { if (!detail) return; setBusy(true); try { await api.stopRun(detail.run.id); await refresh(detail.run.id); } finally { setBusy(false); } };
  const retry = async () => { if (!detail) return; setBusy(true); try { await api.retryRun(detail.run.id); await refresh(detail.run.id); } finally { setBusy(false); } };
  const selectRunFlow = async (value: string) => {
    const preferredFlowId = value ? Number(value) : null;
    setBusy(true);
    try {
      await api.updateTask(task.id, { preferred_flow_id: preferredFlowId });
      await refreshTasks();
      toast.success(preferredFlowId ? 'Flow saved for this task.' : 'Task will use the project default Flow.');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not save the Flow.'); }
    finally { setBusy(false); }
  };
  const save = async () => { setBusy(true); try { const result = await api.updateTask(task.id, { ...draft, task_links: links.map((link) => ({ task_id: link.linked_task_id, relationship: link.relationship })) }); setLinks(result.links); await refreshTasks(); setEditing(false); } finally { setBusy(false); } };
  const updateEditableLinks = (nextLinks: TaskDetailLink[]) => setLinks(nextLinks.flatMap((link) => {
    const existing = links.find((candidate) => candidate.linked_task_id === link.task_id);
    if (existing) return [{ ...existing, relationship: link.relationship, link_type: link.relationship === 'relates_to' ? 'relates_to' : 'blocks' }];
    const linkedTask = tasks.find((candidate) => candidate.id === link.task_id);
    return linkedTask ? [{ id: -link.task_id, link_type: link.relationship === 'relates_to' ? 'relates_to' : 'blocks', relationship: link.relationship, linked_task_id: link.task_id, created_at: '', task_key: linkedTask.task_key, title: linkedTask.title, resolution: linkedTask.resolution }] : [];
  }));
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
      if (event.code === 'Enter' && !editing && !detail && task.resolution === 'open') { event.preventDefault(); void start(); }
      if (event.code === 'Period' && detail && ['queued', 'running', 'waiting', 'attention'].includes(detail.run.status)) { event.preventDefault(); void stop(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [detail, editing, start, task.resolution]);

  return <div className="panel-layer" onMouseDown={(e) => e.target === e.currentTarget && selectTask(null)}>
    <aside className="task-panel" aria-label={`Task ${task.task_key}`}>
      <header className="panel-head"><div><span className="task-key">{task.task_key}</span><span className={`state-pill ${task.operational_state}`}>{task.operational_state.replace('_', ' ')}</span></div><div className="panel-head-actions">
        {!editing && <><button className="icon-button" aria-label="Edit task" onClick={() => setEditing(true)}><Icon name="edit" size={16} /></button><button className="icon-button danger" aria-label="Delete task" onClick={remove}><Icon name="trash" size={16} /></button></>}
        <button className="icon-button" aria-label="Close task" onClick={() => selectTask(null)}><Icon name="close" /></button>
      </div></header>
      <div className="panel-scroll">
        <section className="task-summary">
          {editing ? <>
            <TaskDetailsFields key={task.id} value={draft} onChange={setDraft} links={editableLinks} onLinksChange={updateEditableLinks} tasks={tasks} excludeTaskId={task.id} />
          </> : <>
            <div className="title-row"><h2>{task.title}</h2></div>
            {task.description && <div className="task-copy"><span>Context</span><p>{task.description}</p></div>}
            {task.acceptance && <div className="acceptance"><span>Done when</span><p>{task.acceptance}</p></div>}
            {currentLinks.length > 0 && <div className="task-dependencies"><span>Linked tasks</span>{currentLinks.map((link) => <div key={link.id}><Icon name="branch" size={14} /><strong>{relationshipLabels[link.relationship]} · {link.task_key}</strong><p>{link.title}</p><em className={link.resolution}>{link.resolution}</em></div>)}</div>}
          </>}
        </section>

        {!editing && !detail && task.resolution === 'open' && incompleteDependencies.length > 0 && <div className="task-run-warning"><div className="dependency-warning"><Icon name="alert" size={16} /><div><strong>Dependency not completed</strong><span>{incompleteDependencies.map((dependency) => dependency.task_key).join(', ')}. You can still start this Flow.</span></div></div></div>}

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
            {['queued', 'running', 'waiting', 'attention'].includes(detail.run.status) && <button className="button danger ghost" onClick={stop} disabled={busy} title="Option + ." aria-keyshortcuts="Alt+."><Icon name="stop" size={15} />Stop Run <KeyboardShortcut keys={['⌥', '.']} /></button>}
            {detail.run.status === 'attention' && <button className="button primary" onClick={retry} disabled={busy}>Retry block</button>}
            {detail.workspace && <span title={detail.workspace.worktree_path}><Icon name="branch" size={14} />{detail.workspace.branch ?? 'project workspace'} · {detail.workspace.state}</span>}
          </div>
        </section>}
      </div>
      {(editing || (!detail && task.resolution === 'open')) && <footer className={`panel-footer${editing ? '' : ' run-controls'}`}>
        {editing ? <><button className="button ghost" onClick={() => setEditing(false)}>Cancel</button><button className="button primary" onClick={save} disabled={busy}>Save</button></>
          : preflight ? <><label className="run-footer-flow"><span className="sr-only">Flow to run</span><select aria-label="Flow to run" value={task.preferred_flow_id && task.preferred_flow_id !== defaultFlow?.id ? String(task.preferred_flow_id) : ''} onChange={(event) => void selectRunFlow(event.target.value)} disabled={busy || (!defaultFlow && !customFlows.length)}>
            {defaultFlow ? <option value="">Project default · {defaultFlow.name} · v{defaultFlow.activeVersion?.version ?? '—'}</option> : <option value="" disabled>Choose a published Flow</option>}
            {customFlows.map((flow) => <option key={flow.id} value={flow.id}>{flow.name} · v{flow.activeVersion!.version}</option>)}
          </select></label><button className="button primary start-run-action" onClick={start} disabled={busy} title="Option + Enter" aria-keyshortcuts="Alt+Enter">Start run <KeyboardShortcut keys={['⌥', '↩']} /></button></>
            : <button className="button primary" onClick={() => useAppStore.getState().setSection('flows')}>Open Flows</button>}
      </footer>}
    </aside>
  </div>;
}
