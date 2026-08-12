import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createElement } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App, { canNavigateFromAgents, sidebarCollapsedForContext, shouldAutoCollapseSidebar, shouldCollapseSidebarOnResize, shouldExpandSidebarOnResize } from './App.js';
import { useAppStore } from './hooks/useTaskStore.js';
import { useEventSource } from './hooks/useEventSource.js';

vi.mock('./hooks/useEventSource.js', () => ({ useEventSource: vi.fn() }));
vi.mock('./components/WorkBoard.js', () => ({ default: () => null }));
vi.mock('./components/TaskPanel.js', () => ({ default: () => null }));
vi.mock('./components/TaskComposer.js', () => ({ default: () => null }));
vi.mock('./components/FlowLibrary.js', () => ({ default: () => null }));
vi.mock('./components/AgentsLibrary.js', () => ({ default: () => 'Agents library content' }));
vi.mock('./components/SettingsPanel.js', () => ({ default: () => null }));
vi.mock('./components/InitScreen.js', () => ({ default: () => null }));
vi.mock('./components/FlowEditor.js', () => ({ default: () => null }));

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  window.dispatchEvent(new Event('resize'));
}

beforeEach(() => {
  setViewportWidth(1280);
  useAppStore.setState({
    initialized: true,
    loading: false,
    bootError: null,
    repoName: 'tasks_manager',
    isGitRepo: true,
    runner: { activeCount: 0, queuedCount: 0, maxConcurrent: 3, executions: [] },
    tasks: [],
    flows: [],
    section: 'work',
    workView: 'open',
    editingFlowId: null,
    viewingFlowVersionId: null,
    selectedTaskId: null,
    createOpen: false,
    settingsOpen: false,
    bootstrap: vi.fn(),
  });
});

test('guards unsaved Agent preset edits when leaving the tab', () => {
  const confirmDiscard = vi.fn(() => false);
  expect(canNavigateFromAgents('agents', 'flows', true, confirmDiscard)).toBe(false);
  expect(confirmDiscard).toHaveBeenCalledOnce();
  expect(canNavigateFromAgents('agents', 'agents', true, confirmDiscard)).toBe(true);
  expect(canNavigateFromAgents('work', 'flows', true, confirmDiscard)).toBe(true);
});

test('uses one task destination instead of separate state destinations', () => {
  render(createElement(App));
  const tasks = screen.getByRole('button', { name: 'Tasks' });
  expect(tasks).toBeInTheDocument();
  expect(tasks.querySelector('[data-icon="tasks"]')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Open work/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Finished, Option/ })).not.toBeInTheDocument();
});

test('opens task creation from any section with Option N', () => {
  useAppStore.setState({ section: 'flows', createOpen: false });
  render(createElement(App));
  fireEvent.keyDown(window, { altKey: true, code: 'KeyN' });
  expect(useAppStore.getState().section).toBe('work');
  expect(useAppStore.getState().createOpen).toBe(true);
});

test('does not run the task shortcut while a combobox has focus', () => {
  useAppStore.setState({ section: 'flows', createOpen: false });
  render(createElement(App));
  const combobox = document.createElement('button');
  combobox.setAttribute('role', 'combobox');
  document.body.append(combobox);
  combobox.focus();
  fireEvent.keyDown(combobox, { altKey: true, code: 'KeyN' });
  expect(useAppStore.getState().section).toBe('flows');
  expect(useAppStore.getState().createOpen).toBe(false);
  combobox.remove();
});

test('opens the Agents tab from the primary navigation', () => {
  render(createElement(App));
  const agents = screen.getByRole('button', { name: 'Agents' });
  expect(agents.querySelector('[data-icon="agent"]')).toBeInTheDocument();
  expect(agents.querySelector('[data-icon="agent"] rect[x="4"][y="7"]')).toBeInTheDocument();
  fireEvent.click(agents);
  expect(screen.getByText('Agents library content')).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Agents' })).toBeVisible();
});

test('waits for bootstrap before opening the event stream', () => {
  useAppStore.setState({ loading: true });
  render(createElement(App));
  expect(vi.mocked(useEventSource)).toHaveBeenLastCalledWith(false);
});

test('shows a retryable startup failure', () => {
  const bootstrap = vi.fn();
  useAppStore.setState({ loading: false, bootError: 'The server did not respond.', bootstrap });
  render(createElement(App));
  expect(screen.getByRole('alert')).toHaveTextContent('Workspace unavailable');
  bootstrap.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(bootstrap).toHaveBeenCalledOnce();
});

describe('shouldAutoCollapseSidebar', () => {
  test('collapses the rail when the working area becomes narrow', () => {
    expect(shouldAutoCollapseSidebar(1159)).toBe(true);
    expect(shouldAutoCollapseSidebar(1160)).toBe(false);
  });
});

describe('shouldCollapseSidebarOnResize', () => {
  test('collapses only when the window crosses into the narrow layout', () => {
    expect(shouldCollapseSidebarOnResize(1200, 1159)).toBe(true);
    expect(shouldCollapseSidebarOnResize(1159, 900)).toBe(false);
    expect(shouldCollapseSidebarOnResize(1200, 1200)).toBe(false);
  });
});

describe('shouldExpandSidebarOnResize', () => {
  test('expands the rail when the window grows past the narrow breakpoint', () => {
    expect(shouldExpandSidebarOnResize(1159, 1160)).toBe(true);
    expect(shouldExpandSidebarOnResize(900, 1159)).toBe(false);
    expect(shouldExpandSidebarOnResize(1160, 1200)).toBe(false);
  });
});

describe('sidebarCollapsedForContext', () => {
  test('keeps the sidebar compact while a flow editor is open', () => {
    expect(sidebarCollapsedForContext(true, 1440)).toBe(true);
    expect(sidebarCollapsedForContext(false, 900)).toBe(true);
    expect(sidebarCollapsedForContext(false, 1440)).toBe(false);
  });
});

describe('App sidebar behavior', () => {
  test('toggles the left sidebar from its visible control', () => {
    render(createElement(App));
    const shell = document.querySelector('.app-shell');
    expect(shell).not.toHaveClass('sidebar-collapsed');

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(shell).toHaveClass('sidebar-collapsed');
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(shell).not.toHaveClass('sidebar-collapsed');
  });

  test('collapses and expands the sidebar as the viewport crosses the breakpoint', async () => {
    render(createElement(App));
    const shell = document.querySelector('.app-shell');

    act(() => setViewportWidth(1159));
    await waitFor(() => expect(shell).toHaveClass('sidebar-collapsed'));
    act(() => setViewportWidth(1160));
    await waitFor(() => expect(shell).not.toHaveClass('sidebar-collapsed'));
  });

  test('keeps the sidebar collapsed while the flow editor is open and restores it afterward', async () => {
    render(createElement(App));
    const shell = document.querySelector('.app-shell');

    act(() => useAppStore.setState({ section: 'flows', editingFlowId: 1 }));
    await waitFor(() => expect(shell).toHaveClass('sidebar-collapsed'));
    act(() => useAppStore.setState({ editingFlowId: null }));
    await waitFor(() => expect(shell).not.toHaveClass('sidebar-collapsed'));
  });
});
