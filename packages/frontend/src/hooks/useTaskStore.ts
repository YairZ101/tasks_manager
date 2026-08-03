import { create } from 'zustand';
import { api } from '../api/client.js';
import type { Flow, OperationalState, Runner, Task } from '../domain.js';

interface AppState {
  initialized: boolean;
  loading: boolean;
  bootError: string | null;
  repoName: string;
  isGitRepo: boolean;
  runner: Runner;
  tasks: Task[];
  flows: Flow[];
  section: 'work' | 'flows';
  workView: OperationalState;
  selectedTaskId: number | null;
  editingFlowId: number | null;
  createOpen: boolean;
  settingsOpen: boolean;
  bootstrap(): Promise<void>;
  refreshTasks(): Promise<void>;
  refreshFlows(): Promise<void>;
  setSection(section: 'work' | 'flows'): void;
  setWorkView(view: OperationalState): void;
  selectTask(id: number | null): void;
  editFlow(id: number | null): void;
  setCreateOpen(open: boolean): void;
  setSettingsOpen(open: boolean): void;
}

const emptyRunner: Runner = { activeCount: 0, queuedCount: 0, maxConcurrent: 1, executions: [] };

export const useAppStore = create<AppState>((set, get) => ({
  initialized: false,
  loading: true,
  bootError: null,
  repoName: '',
  isGitRepo: false,
  runner: emptyRunner,
  tasks: [],
  flows: [],
  section: 'work',
  workView: 'backlog',
  selectedTaskId: null,
  editingFlowId: null,
  createOpen: false,
  settingsOpen: false,
  async bootstrap() {
    set({ loading: true, bootError: null });
    try {
      const status = await api.status();
      set({ initialized: status.initialized, repoName: status.repoName, runner: status.runner, isGitRepo: status.isGitRepo });
      if (status.initialized) {
        const [{ tasks }, { flows }] = await Promise.all([api.listTasks(), api.listFlows()]);
        set({
          tasks,
          flows,
          workView: tasks.some((task) => task.operational_state === 'attention') ? 'attention' : 'backlog',
        });
      }
    } catch (error) {
      set({ bootError: error instanceof Error ? error.message : 'Unable to load the workspace.' });
    } finally { set({ loading: false }); }
  },
  async refreshTasks() { const { tasks } = await api.listTasks(); set({ tasks }); },
  async refreshFlows() { const { flows } = await api.listFlows(); set({ flows }); },
  setSection: (section) => set({ section, editingFlowId: section === 'work' ? null : get().editingFlowId }),
  setWorkView: (workView) => set({ workView, section: 'work' }),
  selectTask: (selectedTaskId) => set({ selectedTaskId }),
  editFlow: (editingFlowId) => set({ editingFlowId, section: 'flows' }),
  setCreateOpen: (createOpen) => set({ createOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
}));
