import { describe, test, expect, beforeEach } from 'vitest';
import { useAppStore } from './useTaskStore';
import type { Task } from './useTaskStore';

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 1,
  task_key: 'TST-1',
  title: 'Test Task',
  description: '',
  acceptance: '',
  status: 'backlog',
  agent_status: null,
  agent_pid: null,
  agent_started_at: null,
  agent_worktree: null,
  agent_branch: null,
  sort_order: 1,
  created_at: '2024-01-01',
  updated_at: '2024-01-01',
  ...overrides,
});

describe('useAppStore', () => {
  beforeEach(() => {
    useAppStore.setState({
      initialized: false,
      projectConfig: null,
      repoName: '',
      loading: true,
      tasks: [],
      activeRuns: [],
      maxConcurrentAgents: 3,
      selectedTaskId: null,
      currentView: 'board',
      sidebarCollapsed: false,
      showAgentConfig: false,
      showCreateTask: false,
      createTaskDefaultStatus: 'backlog',
    });
  });

  describe('updateTaskInStore', () => {
    test('adds a new task', () => {
      const task = makeTask();
      useAppStore.getState().updateTaskInStore(task);
      expect(useAppStore.getState().tasks).toHaveLength(1);
      expect(useAppStore.getState().tasks[0].title).toBe('Test Task');
    });

    test('updates an existing task', () => {
      const task = makeTask();
      useAppStore.getState().updateTaskInStore(task);

      const updated = makeTask({ title: 'Updated Title' });
      useAppStore.getState().updateTaskInStore(updated);

      expect(useAppStore.getState().tasks).toHaveLength(1);
      expect(useAppStore.getState().tasks[0].title).toBe('Updated Title');
    });

    test('adds multiple tasks', () => {
      useAppStore.getState().updateTaskInStore(makeTask({ id: 1, task_key: 'TST-1' }));
      useAppStore.getState().updateTaskInStore(makeTask({ id: 2, task_key: 'TST-2' }));
      useAppStore.getState().updateTaskInStore(makeTask({ id: 3, task_key: 'TST-3' }));

      expect(useAppStore.getState().tasks).toHaveLength(3);
    });
  });

  describe('removeTaskFromStore', () => {
    test('removes an existing task', () => {
      useAppStore.getState().updateTaskInStore(makeTask({ id: 1 }));
      useAppStore.getState().updateTaskInStore(makeTask({ id: 2, task_key: 'TST-2' }));

      useAppStore.getState().removeTaskFromStore(1);
      expect(useAppStore.getState().tasks).toHaveLength(1);
      expect(useAppStore.getState().tasks[0].id).toBe(2);
    });

    test('clears selectedTaskId when removing selected task', () => {
      useAppStore.getState().updateTaskInStore(makeTask({ id: 1 }));
      useAppStore.setState({ selectedTaskId: 1 });

      useAppStore.getState().removeTaskFromStore(1);
      expect(useAppStore.getState().selectedTaskId).toBeNull();
    });

    test('preserves selectedTaskId when removing different task', () => {
      useAppStore.getState().updateTaskInStore(makeTask({ id: 1 }));
      useAppStore.getState().updateTaskInStore(makeTask({ id: 2, task_key: 'TST-2' }));
      useAppStore.setState({ selectedTaskId: 2 });

      useAppStore.getState().removeTaskFromStore(1);
      expect(useAppStore.getState().selectedTaskId).toBe(2);
    });

    test('no-op when removing non-existent task', () => {
      useAppStore.getState().updateTaskInStore(makeTask({ id: 1 }));
      useAppStore.getState().removeTaskFromStore(99);
      expect(useAppStore.getState().tasks).toHaveLength(1);
    });
  });

  describe('view state', () => {
    test('setSelectedTaskId', () => {
      useAppStore.getState().setSelectedTaskId(5);
      expect(useAppStore.getState().selectedTaskId).toBe(5);

      useAppStore.getState().setSelectedTaskId(null);
      expect(useAppStore.getState().selectedTaskId).toBeNull();
    });

    test('setCurrentView', () => {
      expect(useAppStore.getState().currentView).toBe('board');

      useAppStore.getState().setCurrentView('backlog');
      expect(useAppStore.getState().currentView).toBe('backlog');

      useAppStore.getState().setCurrentView('board');
      expect(useAppStore.getState().currentView).toBe('board');
    });

    test('toggleSidebar', () => {
      const initial = useAppStore.getState().sidebarCollapsed;
      useAppStore.getState().toggleSidebar();
      expect(useAppStore.getState().sidebarCollapsed).toBe(!initial);

      useAppStore.getState().toggleSidebar();
      expect(useAppStore.getState().sidebarCollapsed).toBe(initial);
    });

    test('setSidebarCollapsed', () => {
      useAppStore.getState().setSidebarCollapsed(true);
      expect(useAppStore.getState().sidebarCollapsed).toBe(true);

      useAppStore.getState().setSidebarCollapsed(false);
      expect(useAppStore.getState().sidebarCollapsed).toBe(false);
    });

    test('setShowAgentConfig', () => {
      useAppStore.getState().setShowAgentConfig(true);
      expect(useAppStore.getState().showAgentConfig).toBe(true);

      useAppStore.getState().setShowAgentConfig(false);
      expect(useAppStore.getState().showAgentConfig).toBe(false);
    });

    test('setShowCreateTask', () => {
      useAppStore.getState().setShowCreateTask(true, 'todo');
      expect(useAppStore.getState().showCreateTask).toBe(true);
      expect(useAppStore.getState().createTaskDefaultStatus).toBe('todo');

      useAppStore.getState().setShowCreateTask(false);
      expect(useAppStore.getState().showCreateTask).toBe(false);
      expect(useAppStore.getState().createTaskDefaultStatus).toBe('backlog');
    });
  });

  describe('activeRuns', () => {
    test('addActiveRun adds an entry', () => {
      useAppStore.getState().addActiveRun({ taskId: 1, taskKey: 'TST-1' });
      expect(useAppStore.getState().activeRuns).toHaveLength(1);
      expect(useAppStore.getState().activeRuns[0]).toEqual({ taskId: 1, taskKey: 'TST-1' });
    });

    test('addActiveRun deduplicates by taskId', () => {
      useAppStore.getState().addActiveRun({ taskId: 1, taskKey: 'TST-1' });
      useAppStore.getState().addActiveRun({ taskId: 1, taskKey: 'TST-1' });
      expect(useAppStore.getState().activeRuns).toHaveLength(1);
    });

    test('addActiveRun allows multiple different tasks', () => {
      useAppStore.getState().addActiveRun({ taskId: 1, taskKey: 'TST-1' });
      useAppStore.getState().addActiveRun({ taskId: 2, taskKey: 'TST-2' });
      expect(useAppStore.getState().activeRuns).toHaveLength(2);
    });

    test('removeActiveRun removes by taskId', () => {
      useAppStore.getState().addActiveRun({ taskId: 1, taskKey: 'TST-1' });
      useAppStore.getState().addActiveRun({ taskId: 2, taskKey: 'TST-2' });

      useAppStore.getState().removeActiveRun(1);
      expect(useAppStore.getState().activeRuns).toHaveLength(1);
      expect(useAppStore.getState().activeRuns[0].taskId).toBe(2);
    });

    test('removeActiveRun is a no-op for non-existent taskId', () => {
      useAppStore.getState().addActiveRun({ taskId: 1, taskKey: 'TST-1' });
      useAppStore.getState().removeActiveRun(99);
      expect(useAppStore.getState().activeRuns).toHaveLength(1);
    });

    test('removeTaskFromStore also removes from activeRuns', () => {
      useAppStore.getState().updateTaskInStore(makeTask({ id: 1 }));
      useAppStore.getState().addActiveRun({ taskId: 1, taskKey: 'TST-1' });

      useAppStore.getState().removeTaskFromStore(1);
      expect(useAppStore.getState().activeRuns).toHaveLength(0);
      expect(useAppStore.getState().tasks).toHaveLength(0);
    });

    test('maxConcurrentAgents defaults to 3', () => {
      expect(useAppStore.getState().maxConcurrentAgents).toBe(3);
    });
  });
});
