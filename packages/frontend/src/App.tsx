import { lazy, Suspense, useEffect } from 'react';
import { Toaster } from 'sonner';
import { useAppStore } from './hooks/useTaskStore.js';
import { useEventSource } from './hooks/useEventSource.js';
import { Icon } from './components/Icon.js';
import WorkBoard from './components/WorkBoard.js';
import TaskPanel from './components/TaskPanel.js';
import TaskComposer from './components/TaskComposer.js';
import FlowLibrary from './components/FlowLibrary.js';
import SettingsPanel from './components/SettingsPanel.js';
import InitScreen from './components/InitScreen.js';

const FlowEditor = lazy(() => import('./components/FlowEditor.js'));

const views = [
  ['backlog', 'Backlog', 'inbox'], ['ready', 'Ready', 'play'], ['active', 'Active', 'pulse'],
  ['attention', 'Needs attention', 'alert'], ['finished', 'Finished', 'check'],
] as const;

export function queueForShortcutCode(code: string): typeof views[number][0] | null {
  const index = Number(code.replace('Digit', '')) - 1;
  return index >= 0 && index < views.length ? views[index][0] : null;
}

function AppContent() {
  const store = useAppStore();
  useEventSource();
  useEffect(() => { void store.bootstrap(); }, [store.bootstrap]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (!event.altKey || target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (event.code === 'KeyN') { event.preventDefault(); useAppStore.getState().setWorkView('backlog'); useAppStore.getState().setCreateOpen(true); return; }
      const queue = queueForShortcutCode(event.code);
      if (queue) {
        event.preventDefault();
        useAppStore.getState().setWorkView(queue);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (store.loading) return <div className="boot"><span className="boot-mark">F</span><span>Loading workspace…</span></div>;
  if (!store.initialized) return <InitScreen />;

  const counts = new Map(views.map(([key]) => [key, store.tasks.filter((task) => task.operational_state === key).length]));
  return (
    <div className="app-shell">
      <aside className="rail">
        <div className="brand"><span className="brand-mark">F</span><span><strong>Flow</strong><small>local agent control</small></span></div>
        <nav aria-label="Primary navigation">
          <button className={`rail-primary ${store.section === 'work' ? 'active' : ''}`} onClick={() => store.setSection('work')}><Icon name="grid" />Work</button>
          <div className="rail-views">
            {views.map(([key, label, icon]) => (
              <button key={key} className={store.section === 'work' && store.workView === key ? 'active' : ''} onClick={() => store.setWorkView(key)} title={`Option ${views.findIndex(([view]) => view === key) + 1}`} aria-label={`${label}, Option ${views.findIndex(([view]) => view === key) + 1}`}>
                <Icon name={icon} /><span>{label}</span><em>{counts.get(key)}</em>
              </button>
            ))}
          </div>
          <button className={`rail-primary ${store.section === 'flows' ? 'active' : ''}`} onClick={() => store.setSection('flows')}><Icon name="nodes" />Flows</button>
        </nav>
        <div className="rail-bottom">
          <button onClick={() => store.setSettingsOpen(true)}><Icon name="settings" />Settings</button>
          <div className="repo-chip"><span className={store.isGitRepo ? 'online' : ''} /><div><strong>{store.repoName}</strong><small>{store.runner.activeCount} running · {store.runner.queuedCount} queued</small></div></div>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div><span className="eyebrow">{store.section === 'work' ? 'OPERATIONAL VIEW' : 'AUTOMATION DESIGN'}</span><h1>{store.section === 'work' ? 'Work control' : store.editingFlowId ? 'Flow editor' : 'Flow library'}</h1></div>
          <div className="topbar-actions">
            <span className="capacity"><i style={{ width: `${Math.min(100, store.runner.activeCount / Math.max(1, store.runner.maxConcurrent) * 100)}%` }} />Capacity {store.runner.activeCount}/{store.runner.maxConcurrent}</span>
            {store.section === 'work' && store.workView === 'backlog' && <button className="button primary" onClick={() => store.setCreateOpen(true)}><Icon name="plus" />New task <kbd>⌥N</kbd></button>}
          </div>
        </header>
        <div className="workspace-body">
          {store.section === 'work' ? <WorkBoard /> : store.editingFlowId ? (
            <Suspense fallback={<div className="boot inline">Loading canvas…</div>}><FlowEditor flowId={store.editingFlowId} /></Suspense>
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
