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
  runRevision: number;
  tasks: Task[];
  flows: Flow[];
  section: 'work' | 'flows' | 'agents';
  workView: OperationalState;
  selectedTaskId: number | null;
  editingFlowId: number | null;
  viewingFlowVersionId: number | null;
  agentsFocusPresetKey: string | null;
  createOpen: boolean;
  settingsOpen: boolean;
  bootstrap(): Promise<void>;
  refreshTasks(): Promise<void>;
  refreshFlows(): Promise<void>;
  setSection(section: 'work' | 'flows' | 'agents'): void;
  setWorkView(view: OperationalState): void;
  selectTask(id: number | null): void;
  editFlow(id: number | null): void;
  viewFlowVersion(flowId: number, versionId: number): void;
  openAgent(presetKey: string | null): void;
  clearAgentsFocus(): void;
  setCreateOpen(open: boolean): void;
  setSettingsOpen(open: boolean): void;
  markRunChanged(): void;
}

const emptyRunner: Runner = { activeCount: 0, queuedCount: 0, maxConcurrent: 1, executions: [] };

export const useAppStore = create<AppState>((set, get) => ({
  initialized: false,
  loading: true,
  bootError: null,
  repoName: '',
  isGitRepo: false,
  runner: emptyRunner,
  runRevision: 0,
  tasks: [],
  flows: [],
  section: 'work',
  workView: 'backlog',
  selectedTaskId: null,
  editingFlowId: null,
  viewingFlowVersionId: null,
  agentsFocusPresetKey: null,
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
  setSection: (section) => set({
    section,
    editingFlowId: section === 'flows' ? get().editingFlowId : null,
    viewingFlowVersionId: section === 'flows' ? get().viewingFlowVersionId : null,
    agentsFocusPresetKey: section === 'agents' ? get().agentsFocusPresetKey : null,
  }),
  setWorkView: (workView) => set({ workView, section: 'work', agentsFocusPresetKey: null }),
  selectTask: (selectedTaskId) => set({ selectedTaskId }),
  editFlow: (editingFlowId) => set({ editingFlowId, viewingFlowVersionId: null, section: 'flows' }),
  viewFlowVersion: (editingFlowId, viewingFlowVersionId) => set({ editingFlowId, viewingFlowVersionId, section: 'flows' }),
  openAgent: (agentsFocusPresetKey) => set({ section: 'agents', agentsFocusPresetKey, editingFlowId: null, viewingFlowVersionId: null }),
  clearAgentsFocus: () => set({ agentsFocusPresetKey: null }),
  setCreateOpen: (createOpen) => set({ createOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  markRunChanged: () => set((state) => ({ runRevision: state.runRevision + 1 })),
}));
