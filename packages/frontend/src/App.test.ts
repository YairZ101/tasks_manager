import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createElement } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App, { queueForShortcutCode, sidebarCollapsedForContext, shouldAutoCollapseSidebar, shouldCollapseSidebarOnResize, shouldExpandSidebarOnResize } from './App.js';
import { useAppStore } from './hooks/useTaskStore.js';
import { useEventSource } from './hooks/useEventSource.js';

vi.mock('./hooks/useEventSource.js', () => ({ useEventSource: vi.fn() }));
vi.mock('./components/WorkBoard.js', () => ({ default: () => null }));
vi.mock('./components/TaskPanel.js', () => ({ default: () => null }));
vi.mock('./components/TaskComposer.js', () => ({ default: () => null }));
vi.mock('./components/FlowLibrary.js', () => ({ default: () => null }));
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
    workView: 'backlog',
    editingFlowId: null,
    viewingFlowVersionId: null,
    selectedTaskId: null,
    createOpen: false,
    settingsOpen: false,
    bootstrap: vi.fn(),
  });
});

describe('queueForShortcutCode', () => {
  test('uses physical digit keys so Option shortcuts work with macOS keyboard layouts', () => {
    expect(queueForShortcutCode('Digit1')).toBe('backlog');
    expect(queueForShortcutCode('Digit3')).toBe('attention');
    expect(queueForShortcutCode('Digit4')).toBe('finished');
  });
  test('ignores unrelated keys', () => {
    expect(queueForShortcutCode('KeyN')).toBeNull();
    expect(queueForShortcutCode('Digit5')).toBeNull();
  });
});

test('does not expose a Ready operational view', () => {
  render(createElement(App));
  expect(screen.queryByRole('button', { name: 'Ready, Option 2' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Active, Option 2' })).toBeInTheDocument();
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

    setViewportWidth(1159);
    await waitFor(() => expect(shell).toHaveClass('sidebar-collapsed'));
    setViewportWidth(1160);
    await waitFor(() => expect(shell).not.toHaveClass('sidebar-collapsed'));
  });

  test('keeps the sidebar collapsed while the flow editor is open and restores it afterward', async () => {
    render(createElement(App));
    const shell = document.querySelector('.app-shell');

    useAppStore.setState({ section: 'flows', editingFlowId: 1 });
    await waitFor(() => expect(shell).toHaveClass('sidebar-collapsed'));
    useAppStore.setState({ editingFlowId: null });
    await waitFor(() => expect(shell).not.toHaveClass('sidebar-collapsed'));
  });
});
