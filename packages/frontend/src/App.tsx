import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Toaster } from 'sonner';
import { useAppStore } from './hooks/useTaskStore.js';
import { useEventSource } from './hooks/useEventSource.js';
import { AppMark, Icon } from './components/Icon.js';
import Button from './components/Button.js';
import WorkBoard from './components/WorkBoard.js';
import TaskPanel from './components/TaskPanel.js';
import TaskComposer from './components/TaskComposer.js';
import FlowLibrary from './components/FlowLibrary.js';
import AgentsLibrary from './components/AgentsLibrary.js';
import SettingsPanel from './components/SettingsPanel.js';
import InitScreen from './components/InitScreen.js';
import { ConfirmProvider, useConfirm } from './components/ConfirmProvider.js';
import { DialogInteractionProvider } from './components/DialogLayer.js';

const FlowEditor = lazy(() => import('./components/FlowEditor.js'));

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

export async function canNavigateFromAgents(current: 'work' | 'flows' | 'agents', target: 'work' | 'flows' | 'agents', dirty: boolean, confirmDiscard: () => Promise<boolean> | boolean) {
  return current !== 'agents' || target === 'agents' || !dirty || await confirmDiscard();
}

function AppContent() {
  const store = useAppStore();
  const editingFlow = store.section === 'flows' && store.editingFlowId !== null;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => sidebarCollapsedForContext(editingFlow, window.innerWidth));
  const [agentsDirty, setAgentsDirty] = useState(false);
  const previousViewportWidth = useRef(window.innerWidth);
  const taskReturnFocusRef = useRef<HTMLElement>(null);
  const confirm = useConfirm();
  useEventSource(!store.loading && !store.bootError);
  const confirmAgentDiscard = () => confirm({
    tone: 'warning',
    title: 'Discard Agent changes?',
    description: 'The unsaved changes to this Agent preset will be lost.',
    confirmLabel: 'Discard changes',
  });
  const navigateToSection = async (section: 'work' | 'flows' | 'agents') => {
    if (!await canNavigateFromAgents(store.section, section, agentsDirty, confirmAgentDiscard)) return;
    store.setSection(section);
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
      const target = event.target;
      if (!event.altKey || (target instanceof Element && target.matches('input, textarea, select, [role="combobox"], [contenteditable="true"]'))) return;
      if (event.code === 'KeyN') {
        event.preventDefault();
        void canNavigateFromAgents(useAppStore.getState().section, 'work', agentsDirty, confirmAgentDiscard).then((canNavigate) => {
          if (!canNavigate) return;
          useAppStore.getState().setSection('work');
          useAppStore.getState().setCreateOpen(true);
        });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [agentsDirty]);

  if (store.loading) return <div className="boot"><AppMark variant="loading" /><span>Loading workspace…</span></div>;
  if (store.bootError) return <div className="boot boot-error" role="alert"><AppMark /><div><strong>Workspace unavailable</strong><span>{store.bootError}</span><Button variant="ghost" onClick={() => { void store.bootstrap(); }}>Retry</Button></div></div>;
  if (!store.initialized) return <InitScreen />;

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
          <button aria-label="Tasks" className={`rail-primary ${store.section === 'work' ? 'active' : ''}`} onClick={() => void navigateToSection('work')}><Icon name="tasks" /><span>Tasks</span></button>
          <button aria-label="Flows" className={`rail-primary ${store.section === 'flows' ? 'active' : ''}`} onClick={() => void navigateToSection('flows')}><Icon name="nodes" /><span>Flows</span></button>
          <button aria-label="Agents" className={`rail-primary ${store.section === 'agents' ? 'active' : ''}`} onClick={() => void navigateToSection('agents')}><Icon name="agent" /><span>Agents</span></button>
        </nav>
        <div className="rail-bottom">
          <button onClick={() => store.setSettingsOpen(true)}><Icon name="settings" /><span>Settings</span></button>
          <div className="repo-chip"><span className={store.isGitRepo ? 'online' : ''} /><div><strong>{store.repoName}</strong><small>{store.runner.activeCount} running · {store.runner.queuedCount} queued</small></div></div>
        </div>
      </aside>
      <main className="workspace">
        <div className="workspace-body">
          {store.section === 'work' ? <WorkBoard returnFocusRef={taskReturnFocusRef} /> : store.section === 'agents' ? <AgentsLibrary onDirtyChange={setAgentsDirty} focusPresetKey={store.agentsFocusPresetKey} onFocusConsumed={store.clearAgentsFocus} /> : store.editingFlowId ? (
            <Suspense fallback={<div className="boot inline">Loading canvas…</div>}><FlowEditor flowId={store.editingFlowId} versionId={store.viewingFlowVersionId} /></Suspense>
          ) : <FlowLibrary />}
        </div>
      </main>
      {store.selectedTaskId && <TaskPanel key={store.selectedTaskId} taskId={store.selectedTaskId} returnFocusRef={taskReturnFocusRef} />}
      {store.createOpen && <TaskComposer />}
      {store.settingsOpen && <SettingsPanel />}
    </div>
  );
}

export default function App() {
  return <DialogInteractionProvider><ConfirmProvider><Toaster theme="dark" position="bottom-right" richColors /><AppContent /></ConfirmProvider></DialogInteractionProvider>;
}
