import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../api/client.js';
import { useAppStore, type WorkView } from '../hooks/useTaskStore.js';
import type { Flow, OperationalState, Task } from '../domain.js';
import { Icon } from './Icon.js';
import PageHeader from './PageHeader.js';
import PageHeaderAction from './PageHeaderAction.js';
import SelectionMenu, { type SelectionOption } from './SelectionMenu.js';

type GroupBy = 'state' | 'flow' | 'resolution' | 'none';
type SortBy = 'updated' | 'created' | 'key' | 'title';
type StateFilter = 'any' | OperationalState;
type WorkspaceFilter = 'any' | 'none' | 'active' | 'retained' | 'cleanup_required' | 'orphaned';

interface ExplorerPreferences {
  version: 1;
  groupBy: GroupBy;
  sortBy: SortBy;
  stateFilter: StateFilter;
  flowFilter: string;
  workspaceFilter: WorkspaceFilter;
  collapsedGroups: string[];
}

interface TaskGroup {
  key: string;
  label: string;
  hint: string;
  state?: OperationalState;
  tasks: Task[];
}

const preferenceKey = 'flow.task-explorer.v1';
const defaultPreferences: ExplorerPreferences = {
  version: 1,
  groupBy: 'state',
  sortBy: 'updated',
  stateFilter: 'any',
  flowFilter: 'any',
  workspaceFilter: 'any',
  collapsedGroups: [],
};

const stateMetadata: Array<{ key: OperationalState; label: string; hint: string }> = [
  { key: 'attention', label: 'Needs attention', hint: 'Decisions and recovery requests' },
  { key: 'active', label: 'Active', hint: 'Agents and checks in motion' },
  { key: 'backlog', label: 'Backlog', hint: 'Available to start' },
  { key: 'finished', label: 'Finished', hint: 'Completed and cancelled work' },
];

const resolutionMetadata: Array<{ key: Task['resolution']; label: string; hint: string }> = [
  { key: 'open', label: 'Open', hint: 'Work that can still move forward' },
  { key: 'completed', label: 'Completed', hint: 'Work that reached its intended result' },
  { key: 'cancelled', label: 'Cancelled', hint: 'Work closed without completion' },
];

const groupOptions: Array<SelectionOption<GroupBy>> = [
  { value: 'none', label: 'No grouping' },
  { value: 'state', label: 'State' },
  { value: 'flow', label: 'Flow' },
  { value: 'resolution', label: 'Resolution' },
];
const sortOptions: Array<SelectionOption<SortBy>> = [
  { value: 'updated', label: 'Recently updated' },
  { value: 'created', label: 'Recently created' },
  { value: 'key', label: 'Task key' },
  { value: 'title', label: 'Title' },
];
const stateFilterOptions: Array<SelectionOption<StateFilter>> = [
  { value: 'any', label: 'Any state' },
  ...stateMetadata.map((state) => ({ value: state.key, label: state.label })),
];
const workspaceFilterOptions: Array<SelectionOption<WorkspaceFilter>> = [
  { value: 'any', label: 'Any workspace' },
  { value: 'none', label: 'No workspace' },
  { value: 'active', label: 'Active' },
  { value: 'retained', label: 'Retained' },
  { value: 'cleanup_required', label: 'Needs cleanup' },
  { value: 'orphaned', label: 'Orphaned' },
];
const resolutionFilterOptions: Array<SelectionOption<WorkView>> = [
  { value: 'open', label: 'Open' },
  { value: 'all', label: 'All tasks' },
  { value: 'finished', label: 'Finished' },
];

function readPreferences(): ExplorerPreferences {
  try {
    const saved = JSON.parse(window.localStorage.getItem(preferenceKey) ?? 'null') as Partial<ExplorerPreferences> | null;
    if (!saved || saved.version !== 1) return defaultPreferences;
    return {
      version: 1,
      groupBy: saved.groupBy === 'state' || saved.groupBy === 'flow' || saved.groupBy === 'resolution' || saved.groupBy === 'none' ? saved.groupBy : defaultPreferences.groupBy,
      sortBy: saved.sortBy === 'updated' || saved.sortBy === 'created' || saved.sortBy === 'key' || saved.sortBy === 'title' ? saved.sortBy : defaultPreferences.sortBy,
      stateFilter: saved.stateFilter === 'any' || saved.stateFilter === 'attention' || saved.stateFilter === 'active' || saved.stateFilter === 'backlog' || saved.stateFilter === 'finished' ? saved.stateFilter : defaultPreferences.stateFilter,
      flowFilter: typeof saved.flowFilter === 'string' ? saved.flowFilter : defaultPreferences.flowFilter,
      workspaceFilter: saved.workspaceFilter === 'any' || saved.workspaceFilter === 'none' || saved.workspaceFilter === 'active' || saved.workspaceFilter === 'retained' || saved.workspaceFilter === 'cleanup_required' || saved.workspaceFilter === 'orphaned' ? saved.workspaceFilter : defaultPreferences.workspaceFilter,
      collapsedGroups: Array.isArray(saved.collapsedGroups) ? saved.collapsedGroups.filter((key): key is string => typeof key === 'string') : [],
    };
  } catch {
    return defaultPreferences;
  }
}

function attentionSummary(task: Task): string | null {
  if (task.workspace_state === 'cleanup_required') return 'Workspace cleanup required';
  if (task.active_run_status === 'waiting') return task.active_block_name ? `Decision required in ${task.active_block_name}` : 'Decision required';
  if (task.active_run_status === 'attention') return task.active_run_reason || 'Run needs recovery';
  return null;
}

function cardContext(task: Task, attention: string | null): string | null {
  if (task.active_block_name && (!attention || !attention.toLocaleLowerCase().includes(task.active_block_name.toLocaleLowerCase()))) return task.active_block_name;
  if (task.operational_state === 'finished') return task.resolution === 'completed' ? 'Completed' : 'Cancelled';
  return null;
}

function runnableFlow(task: Task, flows: Flow[]) {
  const preferred = task.preferred_flow_id === null ? undefined : flows.find((flow) => flow.id === task.preferred_flow_id && flow.activeVersion);
  return preferred ?? flows.find((flow) => flow.is_default && flow.activeVersion);
}

function TaskRow({ task, flows, starting, onStart }: { task: Task; flows: Flow[]; starting: boolean; onStart(task: Task): void }) {
  const select = useAppStore((state) => state.selectTask);
  const attention = attentionSummary(task);
  const context = cardContext(task, attention);
  const summary = attention ?? task.description;
  const runFlow = runnableFlow(task, flows);
  const canStart = task.resolution === 'open' && task.active_run_id === null;
  const viewLabel = task.resolution === 'open' ? 'View run' : 'View task';
  return <li className={`task-row-item state-${task.operational_state}`}>
    <div className="task-row">
      <span className="task-row-state" aria-hidden="true" />
      <button type="button" className="task-row-main" onClick={() => select(task.id)} aria-label={`${task.task_key}: ${task.title}${attention ? `. ${attention}` : ''}`}>
        <span className="task-row-key">{task.task_key}</span>
        <span className="task-row-copy">
          <strong>{task.title}</strong>
          {summary && <span className={`task-row-summary${attention ? ' attention' : ''}`}>{attention && <Icon name="alert" size={14} />}<span>{summary}</span></span>}
        </span>
      </button>
      <span className="task-row-meta">
        {task.workspace_state === 'cleanup_required' && <em title="Workspace needs cleanup">DIRTY</em>}
        {context && <span className="task-row-context">{task.operational_state === 'active' && <span className="task-row-running" />}{context}</span>}
        {canStart
          ? <button type="button" className="task-row-run" onClick={() => onStart(task)} disabled={starting || !runFlow} title={runFlow ? `Start with ${runFlow.name}` : 'Publish and set a default Flow before starting a Run'}><Icon name="play" size={14} />{starting ? 'Starting…' : 'Start run'}</button>
          : <button type="button" className="task-row-open" onClick={() => select(task.id)}>{viewLabel}<Icon name="arrow" size={15} /></button>}
      </span>
    </div>
  </li>;
}

function TaskList({ label, tasks, flows, startingTaskId, onStart }: { label: string; tasks: Task[]; flows: Flow[]; startingTaskId: number | null; onStart(task: Task): void }) {
  return <ul className="task-list" aria-label={`${label} tasks`}>{tasks.map((task) => <TaskRow key={task.id} task={task} flows={flows} starting={startingTaskId === task.id} onStart={onStart} />)}</ul>;
}

function flowName(flowId: number | null, flows: Flow[]) {
  if (flowId === null) return 'Default flow';
  return flows.find((flow) => flow.id === flowId)?.name ?? `Flow ${flowId}`;
}

function compareTasks(left: Task, right: Task, sortBy: SortBy) {
  if (sortBy === 'key') return left.task_key.localeCompare(right.task_key, undefined, { numeric: true });
  if (sortBy === 'title') return left.title.localeCompare(right.title);
  const field = sortBy === 'created' ? 'created_at' : 'updated_at';
  return (Date.parse(right[field]) || 0) - (Date.parse(left[field]) || 0) || right.id - left.id;
}

function groupTasks(tasks: Task[], groupBy: GroupBy, flows: Flow[]): TaskGroup[] {
  if (groupBy === 'none') return tasks.length ? [{ key: 'all', label: 'Tasks', hint: 'One uninterrupted list', tasks }] : [];
  if (groupBy === 'state') return stateMetadata.flatMap((metadata) => {
    const stateTasks = tasks.filter((task) => task.operational_state === metadata.key);
    return stateTasks.length ? [{ ...metadata, tasks: stateTasks, state: metadata.key }] : [];
  });
  if (groupBy === 'resolution') return resolutionMetadata.flatMap((metadata) => {
    const resolutionTasks = tasks.filter((task) => task.resolution === metadata.key);
    return resolutionTasks.length ? [{ ...metadata, tasks: resolutionTasks }] : [];
  });
  const groups = new Map<string, Task[]>();
  for (const task of tasks) {
    const key = task.preferred_flow_id === null ? 'default' : String(task.preferred_flow_id);
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }
  return [...groups.entries()]
    .map(([key, flowTasks]) => ({ key: `flow-${key}`, label: flowName(key === 'default' ? null : Number(key), flows), hint: key === 'default' ? 'Uses the current default flow' : 'Preferred task flow', tasks: flowTasks }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

export default function WorkBoard() {
  const tasks = useAppStore((state) => state.tasks);
  const flows = useAppStore((state) => state.flows);
  const workView = useAppStore((state) => state.workView);
  const setWorkView = useAppStore((state) => state.setWorkView);
  const setCreate = useAppStore((state) => state.setCreateOpen);
  const refreshTasks = useAppStore((state) => state.refreshTasks);
  const markRunChanged = useAppStore((state) => state.markRunChanged);
  const [preferences, setPreferences] = useState(readPreferences);
  const [query, setQuery] = useState('');
  const [startingTaskId, setStartingTaskId] = useState<number | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const searchRef = useRef<HTMLInputElement>(null);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  const filterButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    try { window.localStorage.setItem(preferenceKey, JSON.stringify(preferences)); } catch { /* Storage is optional. */ }
  }, [preferences]);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.key !== '/' || (target instanceof Element && target.matches('input, textarea, select, [role="combobox"], [contenteditable="true"]'))) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);

  useEffect(() => {
    if (!filtersOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !filterMenuRef.current?.contains(event.target)) setFiltersOpen(false);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setFiltersOpen(false);
      filterButtonRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeWithEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeWithEscape);
    };
  }, [filtersOpen]);

  const filteredTasks = useMemo(() => {
    const visible = tasks.filter((task) => {
      if (workView === 'open' && task.resolution !== 'open') return false;
      if (workView === 'finished' && task.resolution === 'open') return false;
      if (preferences.stateFilter !== 'any' && task.operational_state !== preferences.stateFilter) return false;
      if (preferences.flowFilter === 'default' && task.preferred_flow_id !== null) return false;
      if (preferences.flowFilter !== 'any' && preferences.flowFilter !== 'default' && task.preferred_flow_id !== Number(preferences.flowFilter)) return false;
      if (preferences.workspaceFilter === 'none' && task.workspace_state !== null) return false;
      if (preferences.workspaceFilter !== 'any' && preferences.workspaceFilter !== 'none' && task.workspace_state !== preferences.workspaceFilter) return false;
      if (!deferredQuery) return true;
      return [task.task_key, task.title, task.description, task.acceptance, task.active_block_name ?? '']
        .some((value) => value.toLocaleLowerCase().includes(deferredQuery));
    });
    return [...visible].sort((left, right) => compareTasks(left, right, preferences.sortBy));
  }, [deferredQuery, preferences.flowFilter, preferences.sortBy, preferences.stateFilter, preferences.workspaceFilter, tasks, workView]);

  const groups = useMemo(() => groupTasks(filteredTasks, preferences.groupBy, flows), [filteredTasks, flows, preferences.groupBy]);
  const flowOptions = useMemo(() => flows.filter((flow) => tasks.some((task) => task.preferred_flow_id === flow.id)), [flows, tasks]);
  const flowFilterOptions = useMemo<Array<SelectionOption<string>>>(() => [
    { value: 'any', label: 'Any flow' },
    { value: 'default', label: 'Default flow' },
    ...flowOptions.map((flow) => ({ value: String(flow.id), label: flow.name })),
  ], [flowOptions]);
  const activeFilterCount = Number(workView !== 'open') + Number(preferences.stateFilter !== 'any') + Number(preferences.flowFilter !== 'any') + Number(preferences.workspaceFilter !== 'any');
  const hasNarrowing = Boolean(query) || activeFilterCount > 0 || workView !== 'open';

  const updatePreferences = <Key extends keyof ExplorerPreferences>(key: Key, value: ExplorerPreferences[Key]) => {
    setPreferences((current) => ({ ...current, [key]: value }));
  };
  const resetView = () => {
    setQuery('');
    setWorkView('open');
    setPreferences(defaultPreferences);
  };
  const toggleGroup = (key: string) => {
    setPreferences((current) => ({
      ...current,
      collapsedGroups: current.collapsedGroups.includes(key) ? current.collapsedGroups.filter((group) => group !== key) : [...current.collapsedGroups, key],
    }));
  };
  const startTask = async (task: Task) => {
    const flow = runnableFlow(task, flows);
    if (!flow) { toast.error('Publish and set a default Flow before starting a Run.'); return; }
    setStartingTaskId(task.id);
    try {
      await api.startRun(task.id, flow.id);
      await refreshTasks();
      markRunChanged();
      toast.success(`${task.task_key} queued with ${flow.name}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not start Run.');
    } finally {
      setStartingTaskId(null);
    }
  };

  return <section className="board queue-board" aria-labelledby="tasks-heading">
    <PageHeader title="Tasks" titleId="tasks-heading" description="Search, filter, and start work.">
      <PageHeaderAction label="New task" onClick={() => setCreate(true)} ariaKeyShortcuts="Alt+N" />
    </PageHeader>
    <div className="queue-content">
      <div className="task-explorer-controls">
        <div className="task-explorer-toolbar">
          <label className="task-search">
            <span className="sr-only">Search tasks</span><Icon name="search" size={16} />
            <input ref={searchRef} type="search" aria-label="Search tasks" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { setQuery(''); searchRef.current?.blur(); } }} placeholder="Search tasks" />
            {!query && <kbd>/</kbd>}
          </label>
          <div className="task-filter-menu" ref={filterMenuRef}>
            <button ref={filterButtonRef} type="button" className="task-filter-trigger" aria-expanded={filtersOpen} aria-controls="task-filter-popover" onClick={() => setFiltersOpen((open) => !open)}><Icon name="filter" size={15} />Filters{activeFilterCount > 0 && <em>{activeFilterCount}</em>}</button>
            {filtersOpen && <div className="task-filter-popover" id="task-filter-popover" aria-label="Task filters">
              <SelectionMenu label="Resolution" value={workView} options={resolutionFilterOptions} onChange={setWorkView} />
              <SelectionMenu label="Operational state" value={preferences.stateFilter} options={stateFilterOptions} onChange={(value) => updatePreferences('stateFilter', value)} />
              <SelectionMenu label="Preferred flow" value={preferences.flowFilter} options={flowFilterOptions} onChange={(value) => updatePreferences('flowFilter', value)} />
              <SelectionMenu label="Workspace state" value={preferences.workspaceFilter} options={workspaceFilterOptions} onChange={(value) => updatePreferences('workspaceFilter', value)} />
              {activeFilterCount > 0 && <button type="button" onClick={() => { setWorkView('open'); setPreferences((current) => ({ ...current, stateFilter: 'any', flowFilter: 'any', workspaceFilter: 'any' })); }}>Clear filters</button>}
            </div>}
          </div>
          <SelectionMenu label="Group" ariaLabel="Group tasks by" value={preferences.groupBy} options={groupOptions} onChange={(value) => updatePreferences('groupBy', value)} inlineLabel className="group-selection" />
          <SelectionMenu label="Sort" ariaLabel="Sort tasks by" value={preferences.sortBy} options={sortOptions} onChange={(value) => updatePreferences('sortBy', value)} inlineLabel className="sort-selection" />
        </div>
        {activeFilterCount > 0 && <div className="task-filter-chips" aria-label="Active filters">
          {workView !== 'open' && <button type="button" onClick={() => setWorkView('open')}>Resolution: {workView === 'all' ? 'All tasks' : 'Finished'}<Icon name="close" size={12} /></button>}
          {preferences.stateFilter !== 'any' && <button type="button" onClick={() => updatePreferences('stateFilter', 'any')}>State: {stateMetadata.find((state) => state.key === preferences.stateFilter)?.label}<Icon name="close" size={12} /></button>}
          {preferences.flowFilter !== 'any' && <button type="button" onClick={() => updatePreferences('flowFilter', 'any')}>Flow: {preferences.flowFilter === 'default' ? 'Default' : flowName(Number(preferences.flowFilter), flows)}<Icon name="close" size={12} /></button>}
          {preferences.workspaceFilter !== 'any' && <button type="button" onClick={() => updatePreferences('workspaceFilter', 'any')}>Workspace: {preferences.workspaceFilter === 'none' ? 'None' : preferences.workspaceFilter.replace('_', ' ')}<Icon name="close" size={12} /></button>}
        </div>}
      </div>
      {groups.length ? <div className={`work-groups grouped-by-${preferences.groupBy}`}>{groups.map((group) => {
        const collapsed = preferences.collapsedGroups.includes(group.key);
        return <section className={`work-group${group.state ? ` state-${group.state}` : ''}`} key={group.key} aria-labelledby={`work-group-${group.key}`}>
          <button type="button" className="work-group-head" onClick={() => toggleGroup(group.key)} aria-expanded={!collapsed}>
            <span><span className="work-group-title"><span className="work-group-state" aria-hidden="true" /><h3 id={`work-group-${group.key}`}>{group.label}</h3></span><span className="work-group-hint">{group.hint}</span></span>
            <span className="work-group-tail"><em>{group.tasks.length}</em><Icon name="arrow" size={15} /></span>
          </button>
          {!collapsed && <TaskList label={group.label} tasks={group.tasks} flows={flows} startingTaskId={startingTaskId} onStart={(task) => void startTask(task)} />}
        </section>;
      })}</div>
        : <div className={`empty-queue ${tasks.length === 0 ? 'first-use' : ''}`}><span className="empty-queue-mark"><Icon name={tasks.length === 0 ? 'plus' : 'search'} size={25} /></span><h3>{tasks.length === 0 ? 'Start with one task' : 'No tasks match this view'}</h3><p>{tasks.length === 0 ? 'Add the outcome and context. Flow will place it in the open queue.' : 'Try a broader search or reset the current filters.'}</p>{tasks.length === 0 ? <button type="button" className="button primary" onClick={() => setCreate(true)} aria-keyshortcuts="Alt+N"><Icon name="plus" size={16} />New task</button> : hasNarrowing && <button type="button" className="button ghost" onClick={resetView}>Reset view</button>}</div>}
    </div>
  </section>;
}
