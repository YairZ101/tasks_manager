import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { render } from '../test/render.js';
import TaskComposer from './TaskComposer.js';
import { useAppStore } from '../hooks/useTaskStore.js';
import { api } from '../api/client.js';

vi.mock('../api/client.js', () => ({ api: { createTask: vi.fn() } }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

const defaultFlow = {
  id: 5, name: 'Standard delivery', is_default: 1, active_version_id: 8, created_at: '', updated_at: '',
  activeVersion: {
    id: 8, flow_id: 5, version: 3, state: 'published', draft_revision: 0, compiled: null, published_at: '',
    definition: { schemaVersion: 1, nodes: [
      { id: 'begin', type: 'begin', typeVersion: 1, position: { x: 0, y: 0 }, config: { name: 'Begin' } },
      { id: 'agent', type: 'agent', typeVersion: 1, position: { x: 0, y: 0 }, config: { name: 'Implement', preset: 'development' } },
    ], connections: [] },
  },
} as any;

describe('TaskComposer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.createTask).mockResolvedValue({ task: { id: 7 } as any, links: [] });
    useAppStore.setState({ workView: 'open', createOpen: true, tasks: [], flows: [], refreshTasks: vi.fn(), selectTask: vi.fn(), setCreateOpen: vi.fn() });
  });
  test('creates a task in Backlog by default', async () => {
    render(<TaskComposer />);
    expect(screen.getByRole('dialog', { name: 'Frame the outcome' })).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('What should be different when this is done?'), { target: { value: 'Ship graph editor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(api.createTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Ship graph editor', run: false })));
    expect(screen.queryByRole('button', { name: 'More create actions' })).not.toBeInTheDocument();
  });

  test('prevents every dismissal path while task creation is running', async () => {
    const request = deferred<{ task: any; links: [] }>();
    vi.mocked(api.createTask).mockReturnValue(request.promise);
    render(<TaskComposer />);
    fireEvent.change(screen.getByPlaceholderText('What should be different when this is done?'), { target: { value: 'Ship graph editor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));

    expect(await screen.findByRole('button', { name: 'Creating…' })).toBeDisabled();
    expect(screen.getByRole('dialog', { name: 'Frame the outcome' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('textbox', { name: 'Task title' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close new task' })).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.mouseDown(document.querySelector('.dialog-layer')!);
    expect(useAppStore.getState().setCreateOpen).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Frame the outcome' })).toBeInTheDocument();

    request.resolve({ task: { id: 7 }, links: [] });
    await waitFor(() => expect(useAppStore.getState().setCreateOpen).toHaveBeenCalledWith(false));
  });

  test('selects a Run action and Flow before queuing the new task', async () => {
    useAppStore.setState({ flows: [defaultFlow] });
    render(<TaskComposer />);
    fireEvent.change(screen.getByPlaceholderText('What should be different when this is done?'), { target: { value: 'Ship graph editor' } });
    fireEvent.click(screen.getByRole('button', { name: 'More create actions' }));
    expect(screen.getByRole('menu', { name: 'Create task actions' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: /Create & start run/ }));
    expect(api.createTask).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Create & start run' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Flow to run' })).toHaveValue('5');
    fireEvent.click(screen.getByRole('button', { name: 'Create & start run' }));
    await waitFor(() => expect(api.createTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Ship graph editor', run: true, flow_id: 5 })));
  });

  test('uses the Flow selected for the new Run', async () => {
    const focusedFlow = { ...defaultFlow, id: 6, name: 'Focused delivery', is_default: 0, activeVersion: { ...defaultFlow.activeVersion, flow_id: 6, version: 4 } };
    useAppStore.setState({ flows: [defaultFlow, focusedFlow] });
    render(<TaskComposer />);
    fireEvent.change(screen.getByPlaceholderText('What should be different when this is done?'), { target: { value: 'Ship graph editor' } });
    fireEvent.click(screen.getByRole('button', { name: 'More create actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Create & start run/ }));
    fireEvent.click(screen.getByRole('combobox', { name: 'Flow to run' }));
    fireEvent.click(screen.getByRole('option', { name: 'Focused delivery · v4' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create & start run' }));
    await waitFor(() => expect(api.createTask).toHaveBeenCalledWith(expect.objectContaining({ run: true, flow_id: 6 })));
  });

  test('keeps the action controls in one shared footer when switching modes', () => {
    useAppStore.setState({ flows: [defaultFlow] });
    render(<TaskComposer />);
    fireEvent.change(screen.getByPlaceholderText('What should be different when this is done?'), { target: { value: 'Ship graph editor' } });
    const footer = document.querySelector('.composer footer')!;
    const actions = footer.querySelector('.composer-create-actions');
    const cancel = footer.querySelector('.button.ghost');
    expect(actions).not.toBeNull();
    expect(cancel).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'More create actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Create & start run/ }));

    expect(document.querySelector('.composer footer')).toBe(footer);
    expect(footer).toHaveClass('composer-run-footer');
    expect(footer.querySelector('.composer-flow-control')).not.toBeNull();
    expect(footer.querySelector('.composer-create-actions')).toBe(actions);
    expect(footer.querySelector('.button.ghost')).toBe(cancel);
  });

  test('closes nested task controls before dismissing the dialog', () => {
    useAppStore.setState({ flows: [defaultFlow] });
    render(<TaskComposer />);
    fireEvent.change(screen.getByPlaceholderText('What should be different when this is done?'), { target: { value: 'Ship graph editor' } });
    const moreActions = screen.getByRole('button', { name: 'More create actions' });
    fireEvent.click(moreActions);
    expect(screen.getByRole('menu', { name: 'Create task actions' })).toBeInTheDocument();

    fireEvent.keyDown(moreActions, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: 'Create task actions' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Frame the outcome' })).toBeInTheDocument();

    fireEvent.click(moreActions);
    fireEvent.click(screen.getByRole('menuitem', { name: /Create & start run/ }));
    const flowMenu = screen.getByRole('combobox', { name: 'Flow to run' });
    fireEvent.click(flowMenu);
    expect(screen.getByRole('listbox', { name: 'Flow to run options' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('listbox', { name: 'Flow to run options' }), { key: 'Escape' });
    expect(screen.queryByRole('listbox', { name: 'Flow to run options' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Frame the outcome' })).toBeInTheDocument();
  });

  test('warns before immediately starting work blocked by an open task', async () => {
    useAppStore.setState({
      flows: [defaultFlow],
      tasks: [{ id: 4, task_key: 'TST-4', title: 'Publish the API contract', resolution: 'open' } as any],
    });
    render(<TaskComposer />);
    fireEvent.change(screen.getByPlaceholderText('What should be different when this is done?'), { target: { value: 'Ship graph editor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Linked tasks' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Search tasks by title or key' }), { target: { value: 'API' } });
    fireEvent.click(screen.getByRole('option', { name: /TST-4 Publish the API contract/ }));
    fireEvent.click(screen.getByRole('button', { name: 'More create actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Create & start run/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create & start run' }));
    const confirmation = await screen.findByRole('dialog', { name: 'Start with incomplete dependencies?' });
    expect(confirmation).toHaveTextContent('TST-4 · Publish the API contract');
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }));
    expect(api.createTask).not.toHaveBeenCalled();
  });

  test('continues a blocked task after shared confirmation', async () => {
    useAppStore.setState({
      flows: [defaultFlow],
      tasks: [{ id: 4, task_key: 'TST-4', title: 'Publish the API contract', resolution: 'open' } as any],
    });
    render(<TaskComposer />);
    fireEvent.change(screen.getByPlaceholderText('What should be different when this is done?'), { target: { value: 'Ship graph editor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Linked tasks' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Search tasks by title or key' }), { target: { value: 'API' } });
    fireEvent.click(screen.getByRole('option', { name: /TST-4 Publish the API contract/ }));
    fireEvent.click(screen.getByRole('button', { name: 'More create actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Create & start run/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create & start run' }));
    const confirmation = await screen.findByRole('dialog', { name: 'Start with incomplete dependencies?' });
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Start run anyway' }));
    await waitFor(() => expect(api.createTask).toHaveBeenCalledWith(expect.objectContaining({ run: true })));
  });

  test('only sends detail sections selected for this task', async () => {
    render(<TaskComposer />);
    fireEvent.change(screen.getByPlaceholderText('What should be different when this is done?'), { target: { value: 'Link tasks' } });
    fireEvent.click(screen.getByRole('button', { name: 'Context' }));
    fireEvent.change(screen.getByPlaceholderText('Why this matters, constraints, useful links…'), { target: { value: 'Only shown when useful.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(api.createTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Link tasks', description: 'Only shown when useful.', acceptance: '', task_links: [] })));
  });

  test('finds tasks by title or key before adding a link', async () => {
    useAppStore.setState({ tasks: [{ id: 4, task_key: 'TST-4', title: 'Publish the API contract', resolution: 'open' } as any] });
    render(<TaskComposer />);
    fireEvent.change(screen.getByPlaceholderText('What should be different when this is done?'), { target: { value: 'Link work' } });
    fireEvent.click(screen.getByRole('button', { name: 'Linked tasks' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Search tasks by title or key' }), { target: { value: 'contract' } });
    fireEvent.click(screen.getByRole('option', { name: /TST-4 Publish the API contract/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(api.createTask).toHaveBeenCalledWith(expect.objectContaining({ task_links: [{ task_id: 4, relationship: 'is_blocked_by' }] })));
  });

  test('uses the relationship selected for a linked task', async () => {
    useAppStore.setState({ tasks: [{ id: 4, task_key: 'TST-4', title: 'Publish the API contract', resolution: 'open' } as any] });
    render(<TaskComposer />);
    fireEvent.change(screen.getByPlaceholderText('What should be different when this is done?'), { target: { value: 'Link work' } });
    fireEvent.click(screen.getByRole('button', { name: 'Linked tasks' }));
    fireEvent.click(screen.getByRole('combobox', { name: 'Relationship' }));
    fireEvent.click(screen.getByRole('option', { name: 'Blocks' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Search tasks by title or key' }), { target: { value: 'contract' } });
    fireEvent.click(screen.getByRole('option', { name: /TST-4 Publish the API contract/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(api.createTask).toHaveBeenCalledWith(expect.objectContaining({ task_links: [{ task_id: 4, relationship: 'blocks' }] })));
  });
});
