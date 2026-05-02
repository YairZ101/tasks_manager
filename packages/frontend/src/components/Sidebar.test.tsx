import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useAppStore } from '../hooks/useTaskStore';
import Sidebar from './Sidebar';

describe('Sidebar', () => {
  beforeEach(() => {
    useAppStore.setState({
      currentView: 'board',
      sidebarCollapsed: false,
      tasks: [],
      showAgentConfig: false,
    });
  });

  test('renders navigation items', () => {
    render(<Sidebar />);
    expect(screen.getByText('Board')).toBeInTheDocument();
    expect(screen.getByText('Backlog')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  test('renders app title when expanded', () => {
    render(<Sidebar />);
    expect(screen.getByText('TASKS MANAGER')).toBeInTheDocument();
  });

  test('hides title when collapsed', () => {
    useAppStore.setState({ sidebarCollapsed: true });
    render(<Sidebar />);
    expect(screen.queryByText('TASKS MANAGER')).not.toBeInTheDocument();
  });

  test('clicking Board sets view', () => {
    useAppStore.setState({ currentView: 'backlog' });
    render(<Sidebar />);
    fireEvent.click(screen.getByText('Board'));
    expect(useAppStore.getState().currentView).toBe('board');
  });

  test('clicking Backlog sets view', () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByText('Backlog'));
    expect(useAppStore.getState().currentView).toBe('backlog');
  });

  test('clicking Settings opens agent config', () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByText('Settings'));
    expect(useAppStore.getState().showAgentConfig).toBe(true);
  });

  test('renders Workflow nav item', () => {
    render(<Sidebar />);
    expect(screen.getByText('Workflow')).toBeInTheDocument();
  });

  test('clicking Workflow opens workflow settings', () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByText('Workflow'));
    expect(useAppStore.getState().showWorkflowSettings).toBe(true);
  });

  test('shows backlog badge count', () => {
    useAppStore.setState({
      tasks: [
        { id: 1, task_key: 'T-1', title: 'a', status: 'backlog', sort_order: 1, description: '', acceptance: '', agent_status: null, agent_pid: null, agent_started_at: null, created_at: '', updated_at: '' },
        { id: 2, task_key: 'T-2', title: 'b', status: 'backlog', sort_order: 2, description: '', acceptance: '', agent_status: null, agent_pid: null, agent_started_at: null, created_at: '', updated_at: '' },
        { id: 3, task_key: 'T-3', title: 'c', status: 'todo', sort_order: 3, description: '', acceptance: '', agent_status: null, agent_pid: null, agent_started_at: null, created_at: '', updated_at: '' },
      ] as any,
    });
    render(<Sidebar />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});
