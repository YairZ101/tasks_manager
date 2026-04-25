import { useAppStore } from '../hooks/useTaskStore.js';

export default function Sidebar() {
  const {
    currentView,
    sidebarCollapsed,
    tasks,
    setCurrentView,
    toggleSidebar,
    setShowAgentConfig,
  } = useAppStore();

  const backlogCount = tasks.filter((t) => t.status === 'backlog').length;

  return (
    <>
      {/* Mobile overlay backdrop */}
      {!sidebarCollapsed && (
        <div
          className="fixed inset-0 bg-black/40 z-30 lg:hidden"
          onClick={toggleSidebar}
        />
      )}

      <aside
        className={`flex flex-col bg-bg-raised border-r border-border transition-all duration-200 z-40
          ${sidebarCollapsed ? 'w-16' : 'w-56'}
          max-lg:fixed max-lg:inset-y-0 max-lg:left-0
          ${sidebarCollapsed ? 'max-lg:w-0 max-lg:border-r-0 max-lg:overflow-hidden' : 'max-lg:w-56'}
        `}
      >
        {/* Header */}
        <div className="flex items-center h-14 px-4 border-b border-border">
          {!sidebarCollapsed && (
            <span className="font-bold text-sm tracking-wide text-text truncate">
              TASKS MANAGER
            </span>
          )}
          <button
            onClick={toggleSidebar}
            className="ml-auto p-1.5 rounded-md text-text-muted hover:text-text hover:bg-bg-hover transition-colors max-lg:hidden"
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              {sidebarCollapsed ? (
                <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              ) : (
                <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              )}
            </svg>
          </button>
          {/* Mobile close button */}
          <button
            onClick={toggleSidebar}
            className="ml-auto p-1.5 rounded-md text-text-muted hover:text-text hover:bg-bg-hover transition-colors hidden max-lg:block"
            title="Close menu"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-3 px-2 space-y-1">
          <NavItem
            icon={
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <rect x="1" y="1" width="4.5" height="16" rx="1" stroke="currentColor" strokeWidth="1.3" />
                <rect x="6.75" y="1" width="4.5" height="16" rx="1" stroke="currentColor" strokeWidth="1.3" />
                <rect x="12.5" y="1" width="4.5" height="16" rx="1" stroke="currentColor" strokeWidth="1.3" />
              </svg>
            }
            label="Board"
            active={currentView === 'board'}
            collapsed={sidebarCollapsed}
            onClick={() => { setCurrentView('board'); }}
          />
          <NavItem
            icon={
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M3 5h12M3 9h12M3 13h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            }
            label="Backlog"
            badge={backlogCount > 0 ? backlogCount : undefined}
            active={currentView === 'backlog'}
            collapsed={sidebarCollapsed}
            onClick={() => { setCurrentView('backlog'); }}
          />
        </nav>

        {/* Settings */}
        <div className="px-2 py-3 border-t border-border">
          <NavItem
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="currentColor" strokeWidth="1.5" />
                <path d="M13.765 2.152C13.398 2 12.932 2 12 2c-.932 0-1.398 0-1.765.152a2 2 0 0 0-1.083 1.083c-.092.222-.127.484-.141.853a1.617 1.617 0 0 1-.952 1.424 1.617 1.617 0 0 1-1.71-.142c-.3-.224-.528-.398-.753-.46a2 2 0 0 0-1.517.231c-.327.189-.56.556-1.024 1.29-.464.735-.696 1.102-.753 1.455a2 2 0 0 0 .434 1.548c.178.228.431.39.792.6.55.32.907.874.907 1.497s-.357 1.178-.907 1.497c-.36.21-.614.372-.792.6a2 2 0 0 0-.434 1.548c.057.353.289.72.753 1.455.464.734.697 1.101 1.024 1.29a2 2 0 0 0 1.517.23c.225-.06.454-.235.753-.459a1.617 1.617 0 0 1 1.71-.142c.58.27.93.836.952 1.424.014.369.049.631.141.853a2 2 0 0 0 1.083 1.083C10.602 22 11.068 22 12 22c.932 0 1.398 0 1.765-.152a2 2 0 0 0 1.083-1.083c.092-.222.127-.484.141-.853a1.617 1.617 0 0 1 .952-1.424 1.617 1.617 0 0 1 1.71.142c.3.224.528.399.753.46a2 2 0 0 0 1.517-.231c.327-.189.56-.556 1.024-1.29.464-.735.696-1.102.753-1.455a2 2 0 0 0-.434-1.548c-.178-.228-.431-.39-.792-.6a1.617 1.617 0 0 1-.907-1.497c0-.623.357-1.178.907-1.497.36-.21.614-.372.792-.6a2 2 0 0 0 .434-1.548c-.057-.353-.289-.72-.753-1.455-.464-.734-.697-1.101-1.024-1.29a2 2 0 0 0-1.517-.23c-.225.06-.454.235-.753.459a1.617 1.617 0 0 1-1.71.142 1.617 1.617 0 0 1-.952-1.424c-.014-.369-.049-.631-.141-.853a2 2 0 0 0-1.083-1.083Z" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            }
            label="Settings"
            collapsed={sidebarCollapsed}
            onClick={() => setShowAgentConfig(true)}
          />
        </div>
      </aside>
    </>
  );
}

function NavItem({
  icon,
  label,
  badge,
  active,
  collapsed,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  badge?: number;
  active?: boolean;
  collapsed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center w-full rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? 'bg-accent-dim text-accent'
          : 'text-text-muted hover:bg-bg-hover hover:text-text'
      } ${collapsed ? 'justify-center px-0' : ''}`}
      title={collapsed ? label : undefined}
    >
      <span className="flex-shrink-0">{icon}</span>
      {!collapsed && (
        <>
          <span className="ml-3 truncate">{label}</span>
          {badge !== undefined && (
            <span className="ml-auto bg-accent/20 text-accent text-xs font-semibold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
              {badge}
            </span>
          )}
        </>
      )}
    </button>
  );
}
