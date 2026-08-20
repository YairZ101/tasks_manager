import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type RefObject } from 'react';
import { toast } from 'sonner';
import type { DecisionNode, FlowNode } from '@flow/core';
import { api } from '../api/client.js';
import type { Attempt, Flow, Run, RunDetail, Task, TaskLink, TaskLog } from '../domain.js';
import { useAppStore } from '../hooks/useTaskStore.js';
import Button from './Button.js';
import { Icon } from './Icon.js';
import IconButton from './IconButton.js';
import { KeyboardShortcut } from './KeyboardShortcut.js';
import SelectionMenu from './SelectionMenu.js';
import { type TaskDetailLink } from './TaskDetailsFields.js';
import { buildRunPreflight } from './runPreflight.js';
import { useConfirm } from './ConfirmProvider.js';
import DialogLayer from './DialogLayer.js';
import TaskDialog from './TaskDialog.js';

const statusLabel: Record<string, string> = { queued: 'Queued', running: 'Running', waiting: 'Waiting for you', attention: 'Needs attention', finished: 'Finished', stopped: 'Stopped' };
const resultLabel: Record<string, string> = { completed: 'Completed', paused: 'Paused', cancelled: 'Cancelled' };
const attemptOutcomeLabel: Record<string, string> = { queued: 'Queued', running: 'Running', waiting: 'Waiting for you', succeeded: 'Succeeded', failed: 'Failed', passed: 'Passed', completed: 'Completed', error: 'Error', timed_out: 'Timed out', interrupted: 'Interrupted', cancelled: 'Cancelled' };
const relationshipLabels = { is_blocked_by: 'Is blocked by', blocks: 'Blocks', relates_to: 'Relates to' } as const;
const runLabel = (run: Run) => run.result_category ? resultLabel[run.result_category] : statusLabel[run.status];
const readableOutcome = (value: string) => attemptOutcomeLabel[value] ?? value.replace(/[_-]+/g, ' ').replace(/^./, (letter) => letter.toUpperCase());

type TaskPanelData = {
  taskId: number;
  activeRunId: number | null;
  links: TaskLink[];
  runs: Run[];
  selectedRunId: number | null;
  detail: RunDetail | null;
};

export default function TaskPanel({ taskId, returnFocusRef }: { taskId: number; returnFocusRef?: RefObject<HTMLElement | null> }) {
  const confirm = useConfirm();
  const { tasks, flows, runRevision, selectTask, refreshTasks, setWorkView, viewFlowVersion } = useAppStore();
  const task = tasks.find((candidate) => candidate.id === taskId);
  const [panelData, setPanelData] = useState<TaskPanelData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadRevision, setLoadRevision] = useState(0);
  const [loadingRun, setLoadingRun] = useState(false);
  const [logs, setLogs] = useState<TaskLog[]>([]);
  const [selectedAttempt, setSelectedAttempt] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: '', description: '', acceptance: '' });

  const loadedPanelData = panelData?.taskId === taskId && panelData.activeRunId === task?.active_run_id ? panelData : null;
  const detail = loadedPanelData?.detail ?? null;
  const runs = loadedPanelData?.runs ?? [];
  const selectedRunId = loadedPanelData?.selectedRunId ?? null;
  const links = loadedPanelData?.links ?? [];
  const panelReady = loadedPanelData !== null;

  useEffect(() => {
    if (!task) return;
    let cancelled = false;
    setDraft({ title: task.title, description: task.description, acceptance: task.acceptance });
    setLoadError(null);

    const linksRequest = api.getTask(task.id).then((result) => result.links);
    const runsRequest = api.listRuns(task.id).then((result) => result.runs);
    const detailRequest = task.active_run_id
      ? api.getRun(task.active_run_id)
      : runsRequest.then((nextRuns) => nextRuns[0] ? api.getRun(nextRuns[0].id) : null);

    const load = async () => {
      try {
        const [nextLinks, nextRuns, nextDetail] = await Promise.all([linksRequest, runsRequest, detailRequest]);
        if (!cancelled) {
          setPanelData({
            taskId: task.id,
            activeRunId: task.active_run_id,
            links: nextLinks,
            runs: nextRuns,
            selectedRunId: nextDetail?.run.id ?? task.active_run_id ?? nextRuns[0]?.id ?? null,
            detail: nextDetail,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setPanelData(null);
          setLoadError(error instanceof Error ? error.message : 'The task details request failed.');
        }
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [task?.id, task?.active_run_id, task?.active_run_status, task?.resolution, task?.updated_at, runRevision, loadRevision]);

  useEffect(() => {
    if (task?.resolution !== 'open') setEditing(false);
  }, [task?.resolution]);

  useLayoutEffect(() => {
    setSelectedAttempt(null);
    setLogs([]);
  }, [detail?.run.id]);

  useEffect(() => {
    if (!selectedAttempt) { setLogs([]); return; }
    let cancelled = false;
    void api.getAttempt(selectedAttempt).then((result) => {
      if (!cancelled) setLogs(result.logs);
    }).catch(() => {
      if (!cancelled) setLogs([]);
    });
    return () => { cancelled = true; };
  }, [selectedAttempt]);

  const nodeMap = useMemo(() => new Map((detail?.flowVersion.definition.nodes ?? []).map((node) => [node.id, node])), [detail]);
  const attemptName = (attempt: Attempt) => {
    const node = nodeMap.get(attempt.block_id) as FlowNode | undefined;
    return node?.config && 'name' in node.config ? String(node.config.name) : attempt.block_id;
  };
  const attemptDetail = (attempt: Attempt) => {
    const node = nodeMap.get(attempt.block_id) as FlowNode | undefined;
    const retry = attempt.block_attempt > 1 ? `Retry ${attempt.block_attempt - 1}` : null;
    if (node?.type === 'begin' || node?.type === 'result') return retry;
    const outcome = readableOutcome(attempt.outcome_id ?? attempt.status);
    return retry ? `${retry} · ${outcome}` : outcome;
  };
  const defaultFlow = flows.find((flow) => flow.is_default);
  const selectedFlow = useMemo(() => task?.preferred_flow_id ? flows.find((flow) => flow.id === task.preferred_flow_id) : defaultFlow, [defaultFlow, flows, task?.preferred_flow_id]);
  const customFlows = useMemo(() => flows.filter((flow) => flow.activeVersion && flow.id !== defaultFlow?.id), [defaultFlow?.id, flows]);
  const runOptions = useMemo(() => runs.map((run) => ({ value: String(run.id), label: `#${run.id} · ${runLabel(run)}` })), [runs]);
  const runFlowOptions = useMemo(() => [
    defaultFlow
      ? { value: '', label: `Project default · ${defaultFlow.name} · v${defaultFlow.activeVersion?.version ?? '—'}` }
      : { value: '', label: 'Choose a published Flow', disabled: true },
    ...customFlows.map((flow) => ({ value: String(flow.id), label: `${flow.name} · v${flow.activeVersion!.version}` })),
  ], [customFlows, defaultFlow]);
  const preflight = useMemo(() => buildRunPreflight(selectedFlow), [selectedFlow]);
  const latest = detail?.attempts.at(-1);
  const latestPreparation = detail?.preparations?.at(-1);
  const preparationActive = latestPreparation ? ['queued', 'running'].includes(latestPreparation.status) : false;
  const preparationFailed = latestPreparation ? ['failed', 'timed_out', 'interrupted'].includes(latestPreparation.status) : false;
  const displayedRunLabel = detail && preparationActive ? 'Preparing workspace' : detail ? runLabel(detail.run) : '';
  const decision = latest?.status === 'waiting' ? nodeMap.get(latest.block_id) as DecisionNode | undefined : undefined;
  const currentLinks = useMemo(() => links.map((link) => {
    const current = tasks.find((candidate) => candidate.id === link.linked_task_id);
    const operationalState: Task['operational_state'] = current?.operational_state ?? (link.resolution === 'open' ? 'backlog' : 'finished');
    return current ? { ...link, task_key: current.task_key, title: current.title, resolution: current.resolution, operational_state: operationalState } : { ...link, operational_state: operationalState };
  }), [links, tasks]);
  const incompleteDependencies = useMemo(() => currentLinks.filter((link) => link.relationship === 'is_blocked_by' && link.resolution !== 'completed'), [currentLinks]);
  const openDependents = useMemo(() => currentLinks.filter((link) => link.relationship === 'blocks' && link.resolution === 'open'), [currentLinks]);
  const editableLinks = useMemo<TaskDetailLink[]>(() => links.map((link) => ({ task_id: link.linked_task_id, relationship: link.relationship, task_key: link.task_key, title: link.title })), [links]);
  const runFlow = detail ? flows.find((flow) => flow.id === detail.flowVersion.flow_id) : undefined;
  if (!task) return null;
  const isFinished = task.resolution !== 'open';
  const canStartRun = !editing && task.resolution === 'open' && task.active_run_id === null;
  const hasTaskBrief = Boolean(task.description || task.acceptance || currentLinks.length > 0);
  const splitPanel = Boolean(detail && !editing && hasTaskBrief);
  const isTitleOnly = !editing && !detail && !task.description && !task.acceptance && currentLinks.length === 0;
  const activeRun = task.active_run_id ? runs.find((run) => run.id === task.active_run_id) : undefined;
  const historicalActiveRun = activeRun && detail?.run.id !== activeRun.id ? activeRun : null;
  const activeRunDetail = detail && detail.run.id === task.active_run_id && ['queued', 'running', 'waiting', 'attention'].includes(detail.run.status) ? detail : null;

  const refresh = async (runId?: number) => {
    await refreshTasks();
    if (runId) {
      setSelectedAttempt(null);
      const nextDetail = await api.getRun(runId);
      setPanelData((current) => current?.taskId === task.id ? { ...current, selectedRunId: runId, detail: nextDetail } : current);
    }
  };
  const start = useCallback(async () => {
    if (!defaultFlow) { toast.error('Publish and set a default Flow before starting a Run.'); return; }
    if (incompleteDependencies.length) {
      const accepted = await confirm({
        tone: 'warning',
        title: 'Start with incomplete dependencies?',
        description: 'This task depends on work that is not completed.',
        details: incompleteDependencies.map((dependency) => `${dependency.task_key} · ${dependency.title}`),
        confirmLabel: 'Start run anyway',
      });
      if (!accepted) return;
    }
    setBusy(true); try { const { run } = await api.startRun(task.id); await refresh(run.id); toast.success('Run queued.'); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not start Run.'); } finally { setBusy(false); }
  }, [confirm, defaultFlow, incompleteDependencies, task.id]);
  const decide = async (outcome: string) => {
    if (!detail || !latest) return;
    setBusy(true); try { await api.decide(detail.run.id, latest.id, outcome, comment); setComment(''); await refresh(detail.run.id); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not save Decision.'); } finally { setBusy(false); }
  };
  const stop = async () => { if (!detail) return; setBusy(true); try { await api.stopRun(detail.run.id); await refresh(detail.run.id); } finally { setBusy(false); } };
  const retry = async () => { if (!detail) return; setBusy(true); try { await api.retryRun(detail.run.id); await refresh(detail.run.id); } finally { setBusy(false); } };
  const retrySetup = async () => { if (!detail) return; setBusy(true); try { await api.retryWorkspaceSetup(detail.run.id); await refresh(detail.run.id); } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not retry workspace setup.'); } finally { setBusy(false); } };
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
  const selectRun = async (runId: number) => {
    if (runId === selectedRunId || loadingRun) return;
    setLoadingRun(true);
    try {
      const nextDetail = await api.getRun(runId);
      setSelectedAttempt(null);
      setLogs([]);
      setPanelData((current) => current?.taskId === task.id ? { ...current, selectedRunId: runId, detail: nextDetail } : current);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not load the selected Run.'); }
    finally { setLoadingRun(false); }
  };
  const selectAttempt = (attemptId: number) => {
    setLogs([]);
    setSelectedAttempt((current) => current === attemptId ? null : attemptId);
  };
  const save = async () => {
    setBusy(true);
    try {
      const result = await api.updateTask(task.id, { ...draft, task_links: links.map((link) => ({ task_id: link.linked_task_id, relationship: link.relationship })) });
      setPanelData((current) => current?.taskId === task.id ? { ...current, links: result.links } : current);
      await refreshTasks();
      setEditing(false);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not update task.'); }
    finally { setBusy(false); }
  };
  const updateEditableLinks = (nextLinks: TaskDetailLink[]) => {
    const nextTaskLinks: TaskLink[] = nextLinks.flatMap((link) => {
      const existing = links.find((candidate) => candidate.linked_task_id === link.task_id);
      if (existing) return [{ ...existing, relationship: link.relationship, link_type: link.relationship === 'relates_to' ? 'relates_to' : 'blocks' }];
      const linkedTask = tasks.find((candidate) => candidate.id === link.task_id);
      return linkedTask ? [{ id: -link.task_id, link_type: link.relationship === 'relates_to' ? 'relates_to' : 'blocks', relationship: link.relationship, linked_task_id: link.task_id, created_at: '', task_key: linkedTask.task_key, title: linkedTask.title, resolution: linkedTask.resolution }] : [];
    });
    setPanelData((current) => current?.taskId === task.id ? { ...current, links: nextTaskLinks } : current);
  };
  const reopen = async () => {
    if (task.resolution === 'completed' && openDependents.length > 0) {
      const accepted = await confirm({
        tone: 'warning',
        title: `Reopen ${task.task_key}?`,
        description: 'These open tasks depend on it and will be blocked again. Previous Run history will be preserved.',
        details: openDependents.map((dependent) => `${dependent.task_key} · ${dependent.title}`),
        confirmLabel: 'Reopen task',
      });
      if (!accepted) return;
    }
    setBusy(true);
    try {
      const result = await api.reopenTask(task.id);
      setPanelData((current) => current?.taskId === task.id ? { ...current, links: result.links } : current);
      await refreshTasks();
      setWorkView('open');
      toast.success(`${task.task_key} reopened in Backlog.`);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not reopen the task.'); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!await confirm({
      tone: 'danger',
      title: `Delete ${task.task_key}?`,
      description: 'The task will be deleted. A dirty workspace is kept unless you explicitly force cleanup.',
      confirmLabel: 'Delete task',
    })) return;
    try { await api.deleteTask(task.id); selectTask(null); await refreshTasks(); }
    catch (error: any) {
      if (error.data?.reason === 'workspace_dirty') {
        const force = await confirm({
          tone: 'danger',
          title: 'Delete the dirty workspace?',
          description: error.message,
          confirmLabel: 'Force cleanup and delete',
        });
        if (force) { await api.deleteTask(task.id, true); selectTask(null); await refreshTasks(); }
      } else toast.error(error.message);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (!event.altKey || target?.matches('input, textarea, select, [role="combobox"], [contenteditable="true"]')) return;
      if (event.code === 'Enter' && canStartRun) { event.preventDefault(); void start(); }
      if (event.code === 'Period' && detail && ['queued', 'running', 'waiting', 'attention'].includes(detail.run.status)) { event.preventDefault(); void stop(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canStartRun, detail, start]);

  if (loadError) {
    return <DialogLayer variant="panel" returnFocusRef={returnFocusRef} onDismiss={() => selectTask(null)}>
      <aside className="task-panel task-panel-load-failed" role="dialog" aria-modal="true" aria-label={`Task ${task.task_key}`}>
        <header className="panel-head"><div className="panel-head-identity"><h2 title={task.title}>{task.title}</h2><span className="panel-head-separator" aria-hidden="true">·</span><div className="panel-head-meta"><span className="task-key">{task.task_key}</span><span className={`state-pill ${task.operational_state}`}>{task.operational_state.replace('_', ' ')}</span></div></div><div className="panel-head-actions">
          <IconButton label="Close task" icon="close" onClick={() => selectTask(null)} />
        </div></header>
        <div className="task-panel-load-error" role="alert">
          <span className="task-panel-load-error-icon" aria-hidden="true"><Icon name="alert" size={20} /></span>
          <div><strong>Task details unavailable</strong><p>{loadError}</p><span>Retry before editing the task or changing its Run.</span></div>
          <Button variant="ghost" onClick={() => setLoadRevision((revision) => revision + 1)}>Retry</Button>
        </div>
      </aside>
    </DialogLayer>;
  }

  if (!panelReady) {
    const likelySplitPanel = Boolean(task.active_run_id && (task.description || task.acceptance));
    return <DialogLayer variant="panel" returnFocusRef={returnFocusRef} onDismiss={() => selectTask(null)}>
      <aside className={`task-panel task-panel-loading${likelySplitPanel ? ' task-panel-split' : ''}`} role="dialog" aria-modal="true" aria-busy="true" aria-label={`Task ${task.task_key}`}>
        <header className="panel-head"><div className="panel-head-identity"><h2 title={task.title}>{task.title}</h2><span className="panel-head-separator" aria-hidden="true">·</span><div className="panel-head-meta"><span className="task-key">{task.task_key}</span><span className={`state-pill ${task.operational_state}`}>{task.operational_state.replace('_', ' ')}</span></div></div><div className="panel-head-actions">
          <IconButton label="Close task" icon="close" onClick={() => selectTask(null)} />
        </div></header>
        <div className="task-panel-loading-body" role="status"><span className="sr-only">Loading task details</span><i /><i /><i /></div>
      </aside>
    </DialogLayer>;
  }

  if (editing) return <TaskDialog
    key={task.id}
    mode="edit"
    value={draft}
    onChange={setDraft}
    links={editableLinks}
    onLinksChange={updateEditableLinks}
    tasks={tasks}
    excludeTaskId={task.id}
    busy={busy}
    footer={<><Button variant="ghost" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button><Button type="submit" variant="primary" loading={busy} loadingLabel="Saving…" disabled={!draft.title.trim()}>Save changes</Button></>}
    onSubmit={(event) => { event.preventDefault(); void save(); }}
    onClose={() => setEditing(false)}
  />;

  return <DialogLayer variant="panel" returnFocusRef={returnFocusRef} onDismiss={() => selectTask(null)}>
    <aside className={`task-panel${isTitleOnly ? ' task-panel-compact' : ''}${splitPanel ? ' task-panel-split' : ''}`} role="dialog" aria-modal="true" aria-label={`Task ${task.task_key}`}>
      <header className="panel-head"><div className="panel-head-identity"><h2 title={task.title}>{task.title}</h2><span className="panel-head-separator" aria-hidden="true">·</span><div className="panel-head-meta"><span className="task-key">{task.task_key}</span><span className={`state-pill ${task.operational_state}`}>{task.operational_state.replace('_', ' ')}</span></div></div><div className="panel-head-actions">
        {!isFinished && <IconButton label="Edit task" icon="edit" iconSize={16} onClick={() => setEditing(true)} />}<IconButton label="Delete task" icon="trash" iconSize={16} tone="danger" onClick={remove} />
        <IconButton label="Close task" icon="close" onClick={() => selectTask(null)} />
      </div></header>
      <div className={`panel-scroll${splitPanel ? ' task-panel-body-split' : ''}`}>
        {hasTaskBrief && <section className="task-summary task-brief">
          {task.description && <div className="task-copy"><span>Context</span><p>{task.description}</p></div>}
          {task.acceptance && <div className="acceptance"><span>Done when</span><p>{task.acceptance}</p></div>}
          {currentLinks.length > 0 && <div className="task-dependencies"><span>Linked tasks</span>{currentLinks.map((link) => <div key={link.id}><Icon name="link" size={14} /><strong>{relationshipLabels[link.relationship]} · {link.task_key}</strong><p>{link.title}</p><em className={link.operational_state}>{link.operational_state.replace('_', ' ')}</em></div>)}</div>}
        </section>}

        {canStartRun && incompleteDependencies.length > 0 && <div className="task-run-warning"><div className="dependency-warning"><Icon name="alert" size={16} /><div><strong>Dependency not completed</strong><span>{incompleteDependencies.map((dependency) => dependency.task_key).join(', ')}. You can still start this Flow.</span></div></div></div>}

        {detail && <section className="run-card">
          {runs.length > 1 ? <div className="run-history-picker"><span><Icon name="history" size={15} />Run history</span><SelectionMenu label="Run history" value={String(selectedRunId ?? detail.run.id)} options={runOptions} onChange={(value) => void selectRun(Number(value))} hideLabel disabled={loadingRun} className="run-history-selection" /></div> : <div className="run-head"><div><span className="eyebrow">RUN #{detail.run.id}</span><h3>{displayedRunLabel}</h3></div><span className={`run-light ${preparationActive ? 'running' : detail.run.status}`} /></div>}
          {detail.workspace && <div className="run-workspace-meta"><span><Icon name="branch" size={14} />Workspace</span><strong title={detail.workspace.worktree_path}>{detail.workspace.branch ?? 'project workspace'} · {detail.workspace.state}</strong></div>}
          {latestPreparation && (preparationActive || preparationFailed) && <div className={`workspace-preparation ${latestPreparation.status}`}>
            <div className="workspace-preparation-head"><span className={`attempt-dot ${latestPreparation.status}`} /><div><strong>{preparationFailed ? 'Workspace setup failed' : 'Preparing workspace'}</strong>{latestPreparation.sequence > 1 && <small>Retry {latestPreparation.sequence - 1}</small>}</div></div>
            <code className="workspace-preparation-command">{latestPreparation.command}</code>
            {latestPreparation.logs.length > 0 ? <div className="log-view" aria-label="Workspace setup output">{latestPreparation.logs.map((log) => <div key={log.id} className={log.level}><span>{log.level === 'error' ? 'err' : 'out'}</span><code>{log.message}</code></div>)}</div>
              : <p>{latestPreparation.status === 'queued' ? 'Waiting for execution capacity.' : latestPreparation.status === 'running' ? 'Starting the setup command…' : 'The setup command did not complete.'}</p>}
          </div>}
          <div className="run-flow-section">
          <button className="run-flow-version" type="button" onClick={() => { selectTask(null); viewFlowVersion(detail.flowVersion.flow_id, detail.flowVersion.id); }}><small>Flow version</small><strong>{runFlow?.name ?? 'Flow'} · v{detail.flowVersion.version}</strong><em>Open <Icon name="arrow" size={14} /></em></button>
          {detail.run.reason && !preparationFailed && <div className="run-reason"><Icon name="alert" size={16} />{detail.run.reason}</div>}
          {decision?.type === 'decision' && <div className="decision-box">
            <span className="eyebrow">DECISION REQUIRED</span><h3>{decision.config.name}</h3>{decision.config.instructions && <p>{decision.config.instructions}</p>}
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add context for the next block (optional unless required)" />
            <div className="decision-actions">{decision.config.choices.map((choice) => <Button key={choice.id} className={`choice ${choice.tone}`} disabled={busy || (choice.commentRequired && !comment.trim())} onClick={() => decide(choice.id)}>{choice.label}</Button>)}</div>
          </div>}
          <h4 className="run-section-title">Run steps</h4>
          {detail.attempts.length === 0 ? <p className="run-steps-empty">{preparationActive ? 'The Flow starts after the workspace is ready.' : 'The Flow did not start.'}</p> : <div className="timeline">
            {detail.attempts.map((attempt) => {
              const name = attemptName(attempt);
              const summary = attemptDetail(attempt);
              const expanded = selectedAttempt === attempt.id;
              const outputId = `attempt-output-${attempt.id}`;
              return <div className="timeline-attempt" key={attempt.id}>
                <button className={expanded ? 'selected' : ''} onClick={() => selectAttempt(attempt.id)} aria-expanded={expanded} aria-controls={expanded && logs.length > 0 ? outputId : undefined}>
                  <span className={`attempt-dot ${attempt.status}`} />
                  <div><strong>{name}</strong>{summary && <small>{summary}</small>}</div>
                </button>
                {expanded && logs.length > 0 && <div id={outputId} className="log-view" aria-label={`Output for ${name}`}>{logs.map((log) => <div key={log.id} className={log.level}><span>{log.level.slice(0, 3)}</span><code>{log.message}</code></div>)}</div>}
              </div>;
            })}
          </div>}
          </div>
        </section>}
      </div>
      {(canStartRun || isFinished || historicalActiveRun || activeRunDetail) && <footer className={`panel-footer${isFinished ? ' finished-task-controls' : historicalActiveRun ? ' latest-run-controls' : activeRunDetail ? ' active-run-controls' : ' run-controls'}`}>
        {isFinished ? <><div className="finished-task-note"><Icon name="lock" size={17} /><small>History stays intact.</small></div><Button variant="primary" icon="back" onClick={reopen} disabled={busy}>Reopen task</Button></>
          : historicalActiveRun ? <Button variant="primary" loading={loadingRun} loadingLabel="Loading…" onClick={() => void selectRun(historicalActiveRun.id)}>View latest run</Button>
          : activeRunDetail ? <><Button variant="ghost" tone="danger" icon="stop" onClick={stop} disabled={busy} title="Option + ." aria-keyshortcuts="Alt+.">Stop Run <KeyboardShortcut keys={['⌥', '.']} /></Button>{activeRunDetail.run.status === 'attention' && preparationFailed && <Button variant="primary" onClick={retrySetup} disabled={busy}>Retry setup</Button>}{activeRunDetail.run.status === 'attention' && !preparationFailed && <Button variant="primary" onClick={retry} disabled={busy}>Retry block</Button>}</>
          : preflight ? <><SelectionMenu label="Flow to run" value={task.preferred_flow_id && task.preferred_flow_id !== defaultFlow?.id ? String(task.preferred_flow_id) : ''} options={runFlowOptions} onChange={(value) => void selectRunFlow(value)} hideLabel disabled={busy || (!defaultFlow && !customFlows.length)} className="run-footer-flow" placement="top" /><Button variant="primary" className="start-run-action" onClick={start} disabled={busy} title="Option + Enter" aria-keyshortcuts="Alt+Enter">Start run <KeyboardShortcut keys={['⌥', '↩']} /></Button></>
            : <Button variant="primary" onClick={() => useAppStore.getState().setSection('flows')}>Open Flows</Button>}
      </footer>}
    </aside>
  </DialogLayer>;
}
