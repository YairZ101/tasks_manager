import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Toaster } from 'sonner';
import { useAppStore } from './hooks/useTaskStore.js';
import { useEventSource } from './hooks/useEventSource.js';
import { AppMark, Icon } from './components/Icon.js';
import { KeyboardShortcut } from './components/KeyboardShortcut.js';
import WorkBoard from './components/WorkBoard.js';
import TaskPanel from './components/TaskPanel.js';
import TaskComposer from './components/TaskComposer.js';
import FlowLibrary from './components/FlowLibrary.js';
import AgentsLibrary from './components/AgentsLibrary.js';
import SettingsPanel from './components/SettingsPanel.js';
import InitScreen from './components/InitScreen.js';

const FlowEditor = lazy(() => import('./components/FlowEditor.js'));

const views = [
  ['backlog', 'Backlog', 'inbox'], ['active', 'Active', 'pulse'],
  ['attention', 'Needs attention', 'alert'], ['finished', 'Finished', 'check'],
] as const;

export const SIDEBAR_AUTO_COLLAPSE_WIDTH = 1160;

export function shouldAutoCollapseSidebar(width: number) {
  return width < SIDEBAR_AUTO_COLLAPSE_WIDTH;
}

export function shouldCollapseSidebarOnResize(previousWidth: number, nextWidth: number) {
  return previousWidth >= SIDEBAR_AUTO_COLLAPSE_WIDTH && shouldAutoCollapseSidebar(nextWidth);
}

export function shouldExpandSidebarOnResize(previousWidth: number, nextWidth: number) {
  return shouldAutoCollapseSidebar(previousWidth) && nextWidth >= SIDEBAR_AUTO_COLLAPSE_WIDTH;
}

export function sidebarCollapsedForContext(editingFlow: boolean, width: number) {
  return editingFlow || shouldAutoCollapseSidebar(width);
}

export function canNavigateFromAgents(current: 'work' | 'flows' | 'agents', target: 'work' | 'flows' | 'agents', dirty: boolean, confirmDiscard: () => boolean) {
  return current !== 'agents' || target === 'agents' || !dirty || confirmDiscard();
}

export function queueForShortcutCode(code: string): typeof views[number][0] | null {
  const index = Number(code.replace('Digit', '')) - 1;
  return index >= 0 && index < views.length ? views[index][0] : null;
}

function AppContent() {
  const store = useAppStore();
  const editingFlow = store.section === 'flows' && store.editingFlowId !== null;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => sidebarCollapsedForContext(editingFlow, window.innerWidth));
  const [agentsDirty, setAgentsDirty] = useState(false);
  const previousViewportWidth = useRef(window.innerWidth);
  useEventSource(!store.loading && !store.bootError);
  const navigateToSection = (section: 'work' | 'flows' | 'agents') => {
    if (canNavigateFromAgents(store.section, section, agentsDirty, () => window.confirm('Discard unsaved changes to this Agent preset?'))) store.setSection(section);
  };
  const navigateToWorkView = (view: typeof views[number][0]) => {
    if (canNavigateFromAgents(store.section, 'work', agentsDirty, () => window.confirm('Discard unsaved changes to this Agent preset?'))) store.setWorkView(view);
  };
  useEffect(() => { void store.bootstrap(); }, [store.bootstrap]);
  useLayoutEffect(() => {
    setSidebarCollapsed(sidebarCollapsedForContext(editingFlow, window.innerWidth));
  }, [editingFlow]);
  useEffect(() => {
    const collapseForViewport = () => {
      const nextWidth = window.innerWidth;
      if (editingFlow || shouldCollapseSidebarOnResize(previousViewportWidth.current, nextWidth)) setSidebarCollapsed(true);
      if (!editingFlow && shouldExpandSidebarOnResize(previousViewportWidth.current, nextWidth)) setSidebarCollapsed(false);
      previousViewportWidth.current = nextWidth;
    };
    window.addEventListener('resize', collapseForViewport);
    return () => window.removeEventListener('resize', collapseForViewport);
  }, [editingFlow]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (!event.altKey || target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (event.code === 'KeyN') { event.preventDefault(); if (!canNavigateFromAgents(useAppStore.getState().section, 'work', agentsDirty, () => window.confirm('Discard unsaved changes to this Agent preset?'))) return; useAppStore.getState().setWorkView('backlog'); useAppStore.getState().setCreateOpen(true); return; }
      const queue = queueForShortcutCode(event.code);
      if (queue) {
        event.preventDefault();
        if (canNavigateFromAgents(useAppStore.getState().section, 'work', agentsDirty, () => window.confirm('Discard unsaved changes to this Agent preset?'))) useAppStore.getState().setWorkView(queue);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [agentsDirty]);

  if (store.loading) return <div className="boot"><AppMark variant="loading" /><span>Loading workspace…</span></div>;
  if (store.bootError) return <div className="boot boot-error" role="alert"><AppMark /><div><strong>Workspace unavailable</strong><span>{store.bootError}</span><button className="button ghost" onClick={() => { void store.bootstrap(); }}>Retry</button></div></div>;
  if (!store.initialized) return <InitScreen />;

  const counts = new Map(views.map(([key]) => [key, store.tasks.filter((task) => task.operational_state === key).length]));
  return (
    <div className={`app-shell ${editingFlow ? 'editor-focused' : ''} ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className="rail">
        <button
          className="rail-collapse"
          type="button"
          onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!sidebarCollapsed}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <Icon name="arrow" />
        </button>
        <div className="brand"><AppMark /><span><strong>Flow</strong><small>local agent control</small></span></div>
        <nav aria-label="Primary navigation">
          <button aria-label="Work" className={`rail-primary ${store.section === 'work' ? 'active' : ''}`} onClick={() => navigateToSection('work')}><Icon name="grid" /><span>Work</span></button>
          <div className="rail-views">
            {views.map(([key, label, icon]) => (
              <button key={key} className={store.section === 'work' && store.workView === key ? 'active' : ''} onClick={() => navigateToWorkView(key)} title={`Option ${views.findIndex(([view]) => view === key) + 1}`} aria-label={`${label}, Option ${views.findIndex(([view]) => view === key) + 1}`}>
                <Icon name={icon} /><span>{label}</span><em>{counts.get(key)}</em>
              </button>
            ))}
          </div>
          <button aria-label="Flows" className={`rail-primary ${store.section === 'flows' ? 'active' : ''}`} onClick={() => navigateToSection('flows')}><Icon name="nodes" /><span>Flows</span></button>
          <button aria-label="Agents" className={`rail-primary ${store.section === 'agents' ? 'active' : ''}`} onClick={() => navigateToSection('agents')}><Icon name="agent" /><span>Agents</span></button>
        </nav>
        <div className="rail-bottom">
          <button onClick={() => store.setSettingsOpen(true)}><Icon name="settings" /><span>Settings</span></button>
          <div className="repo-chip"><span className={store.isGitRepo ? 'online' : ''} /><div><strong>{store.repoName}</strong><small>{store.runner.activeCount} running · {store.runner.queuedCount} queued</small></div></div>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div><span className="eyebrow">{store.section === 'work' ? 'OPERATIONAL VIEW' : store.section === 'flows' ? 'AUTOMATION DESIGN' : 'AGENT CONFIGURATION'}</span><h1>{store.section === 'work' ? 'Work control' : store.section === 'agents' ? 'Agents' : store.editingFlowId ? 'Flow editor' : 'Flow library'}</h1></div>
          <div className="topbar-actions">
            <span className="capacity"><i style={{ width: `${Math.min(100, store.runner.activeCount / Math.max(1, store.runner.maxConcurrent) * 100)}%` }} />Capacity {store.runner.activeCount}/{store.runner.maxConcurrent}</span>
            {store.section === 'work' && store.workView === 'backlog' && <button className="button primary" onClick={() => store.setCreateOpen(true)} title="Option + N" aria-keyshortcuts="Alt+N"><Icon name="plus" />New task <KeyboardShortcut keys={['⌥', 'N']} /></button>}
          </div>
        </header>
        <div className="workspace-body">
          {store.section === 'work' ? <WorkBoard /> : store.section === 'agents' ? <AgentsLibrary onDirtyChange={setAgentsDirty} focusPresetKey={store.agentsFocusPresetKey} onFocusConsumed={store.clearAgentsFocus} /> : store.editingFlowId ? (
            <Suspense fallback={<div className="boot inline">Loading canvas…</div>}><FlowEditor flowId={store.editingFlowId} versionId={store.viewingFlowVersionId} /></Suspense>
          ) : <FlowLibrary />}
        </div>
      </main>
      {store.selectedTaskId && <TaskPanel taskId={store.selectedTaskId} />}
      {store.createOpen && <TaskComposer />}
      {store.settingsOpen && <SettingsPanel />}
    </div>
  );
}

export default function App() {
  return <><Toaster theme="dark" position="bottom-right" richColors /><AppContent /></>;
}
