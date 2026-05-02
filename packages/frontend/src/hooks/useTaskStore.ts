import { create } from 'zustand';
import { api } from '../api/client.js';

export interface Task {
  id: number;
  task_key: string;
  title: string;
  description: string;
  acceptance: string;
  status: string;
  agent_status: 'running' | 'completed' | 'failed' | null;
  agent_pid: number | null;
  agent_started_at: string | null;
  agent_worktree: string | null;
  agent_branch: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface TaskLog {
  id: number;
  task_id: number;
  run_number: number;
  timestamp: string;
  level: string;
  message: string;
}

export interface WorkflowStep {
  id: number;
  slug: string;
  name: string;
  requires_review: number;
  config: string;
  sort_order: number;
  fixed: number;
  created_at: string;
}

interface ActiveRun {
  taskId: number;
  taskKey: string;
}

interface AppState {
  // Init state
  initialized: boolean;
  projectConfig: any | null;
  repoName: string;
  loading: boolean;

  // Tasks
  tasks: Task[];

  // Concurrency
  activeRuns: ActiveRun[];
  maxConcurrentAgents: number;

  // Workflow steps
  workflowSteps: WorkflowStep[];

  // Selected task
  selectedTaskId: number | null;

  // View
  currentView: 'board' | 'backlog';

  // Sidebar
  sidebarCollapsed: boolean;

  // Agent config modal
  showAgentConfig: boolean;
  showWorkflowSettings: boolean;

  // Create task modal
  showCreateTask: boolean;
  createTaskDefaultStatus: 'backlog' | 'todo';

  // Actions
  checkStatus: () => Promise<void>;
  fetchTasks: () => Promise<void>;
  updateTaskInStore: (task: Task) => void;
  removeTaskFromStore: (id: number) => void;
  setSelectedTaskId: (id: number | null) => void;
  setCurrentView: (view: 'board' | 'backlog') => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setShowAgentConfig: (show: boolean) => void;
  setShowWorkflowSettings: (show: boolean) => void;
  setShowCreateTask: (show: boolean, defaultStatus?: 'backlog' | 'todo') => void;
  fetchWorkflowSteps: () => Promise<void>;
  setWorkflowSteps: (steps: WorkflowStep[]) => void;
  addActiveRun: (run: ActiveRun) => void;
  removeActiveRun: (taskId: number) => void;
}

export const useAppStore = create<AppState>((set) => ({
  initialized: false,
  projectConfig: null,
  repoName: '',
  loading: true,
  tasks: [],
  activeRuns: [],
  maxConcurrentAgents: 3,
  workflowSteps: [],
  selectedTaskId: null,
  currentView: 'board',
  sidebarCollapsed: typeof window !== 'undefined' && window.innerWidth < 1024,
  showAgentConfig: false,
  showWorkflowSettings: false,
  showCreateTask: false,
  createTaskDefaultStatus: 'backlog',

  checkStatus: async () => {
    try {
      const data = await api.getStatus();
      set({
        initialized: data.initialized,
        projectConfig: data.projectConfig,
        repoName: data.repoName || '',
        activeRuns: data.activeRuns || [],
        maxConcurrentAgents: data.maxConcurrentAgents ?? 3,
        loading: false,
      });
    } catch {
      set({ loading: false });
    }
  },

  fetchTasks: async () => {
    try {
      const data = await api.getTasks();
      set({ tasks: data.tasks });
    } catch {
      // Error handled silently
    }
  },

  updateTaskInStore: (task: Task) => {
    set((state) => {
      const exists = state.tasks.find((t) => t.id === task.id);
      if (exists) {
        return { tasks: state.tasks.map((t) => (t.id === task.id ? task : t)) };
      }
      return { tasks: [...state.tasks, task] };
    });
  },

  removeTaskFromStore: (id: number) => {
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== id),
      activeRuns: state.activeRuns.filter((r) => r.taskId !== id),
      selectedTaskId: state.selectedTaskId === id ? null : state.selectedTaskId,
    }));
  },

  setSelectedTaskId: (id) => set({ selectedTaskId: id }),
  setCurrentView: (view) => set({ currentView: view }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  setShowAgentConfig: (show) => set({ showAgentConfig: show }),
  setShowWorkflowSettings: (show) => set({ showWorkflowSettings: show }),
  setShowCreateTask: (show, defaultStatus) =>
    set({
      showCreateTask: show,
      createTaskDefaultStatus: defaultStatus || 'backlog',
    }),

  fetchWorkflowSteps: async () => {
    try {
      const data = await api.getWorkflowSteps();
      set({ workflowSteps: data.steps });
    } catch {
      // Error handled silently
    }
  },

  setWorkflowSteps: (steps: WorkflowStep[]) => set({ workflowSteps: steps }),

  addActiveRun: (run: ActiveRun) => {
    set((state) => {
      if (state.activeRuns.some(r => r.taskId === run.taskId)) return state;
      return { activeRuns: [...state.activeRuns, run] };
    });
  },

  removeActiveRun: (taskId: number) => {
    set((state) => ({
      activeRuns: state.activeRuns.filter(r => r.taskId !== taskId),
    }));
  },
}));
