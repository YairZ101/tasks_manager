import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createRecommendedFlow } from '@flow/core';
import FlowEditor, { appendVersionActions, COMPACT_ZOOM_THRESHOLD, DETAIL_ZOOM_THRESHOLD, FLOW_NODE_HEIGHTS, MIN_FLOW_ZOOM, formatActionTimestamp, getFlowZoomMode, getVersionChanges } from './FlowEditor.js';
import { api } from '../api/client.js';
import { useAppStore } from '../hooks/useTaskStore.js';

vi.mock('../api/client.js', () => ({ api: { getDraft: vi.fn(), getFlow: vi.fn(), saveDraft: vi.fn(), publishFlow: vi.fn(), activateFlowVersion: vi.fn(), updateFlow: vi.fn() } }));

describe('FlowEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
    const definition = createRecommendedFlow();
    vi.mocked(api.getDraft).mockResolvedValue({ draft: { id: 3, flow_id: 1, version: 2, state: 'draft', draft_revision: 4, definition, compiled: null, published_at: null }, validation: { valid: true, problems: [] } });
    vi.mocked(api.getFlow).mockResolvedValue({ flow: { id: 1, name: 'Standard delivery', active_version_id: 2 } as any, versions: [{ id: 2, flow_id: 1, version: 1, state: 'published', draft_revision: 0, definition, compiled: definition, published_at: '2026-07-01T12:00:00Z' }] });
    vi.mocked(api.saveDraft).mockResolvedValue({ draft: { id: 3, flow_id: 1, version: 2, state: 'draft', draft_revision: 5, definition, compiled: null, published_at: null }, validation: { valid: true, problems: [] } });
    vi.mocked(api.publishFlow).mockResolvedValue({ version: { id: 4, flow_id: 1, version: 2, state: 'published', draft_revision: 4, definition, compiled: definition, published_at: '2026-08-04T12:00:00Z' } as any, draft: { id: 5, flow_id: 1, version: 3, state: 'draft', draft_revision: 1, definition, compiled: null, published_at: null } as any });
    vi.mocked(api.activateFlowVersion).mockResolvedValue({ flow: { id: 1, name: 'Standard delivery', is_default: 1, active_version_id: 2 } as any, version: { id: 2, version: 1, definition } as any });
    vi.mocked(api.updateFlow).mockResolvedValue({ flow: { id: 1, name: 'Renamed delivery' } as any });
    useAppStore.setState({ flows: [{ id: 1, name: 'Standard delivery', is_default: 1, active_version_id: 2 } as any], editingFlowId: 1, viewingFlowVersionId: null, refreshFlows: vi.fn(), editFlow: vi.fn(), viewFlowVersion: vi.fn() });
  });

  test('describes the graph actions introduced by a version', () => {
    const previous = createRecommendedFlow();
    const editedNode = previous.nodes[1] as any;
    const current = {
      ...previous,
      nodes: [
        ...previous.nodes.slice(0, -1).map((node, index) => index === 1 ? { ...node, position: { x: node.position.x + 20, y: node.position.y }, config: { ...node.config, name: 'Implementation', instructions: 'Keep the change focused.' } } : node),
        { id: 'note-history', type: 'note', typeVersion: 1, position: { x: 50, y: 50 }, config: { text: 'Remember the edge case', color: 'amber', width: 220, height: 120 } },
      ],
      connections: [
        ...previous.connections.slice(0, -1),
        { id: 'connection-history', sourceNodeId: editedNode.id, sourceOutcomeId: 'completed', targetNodeId: previous.nodes[2].id },
      ],
    };
    const changes = getVersionChanges(current as any, previous);
    expect(changes.map((change) => change.title)).toEqual(expect.arrayContaining([
      'Added Note block',
      expect.stringMatching(/^Removed /),
      expect.stringMatching(/^Renamed /),
      'Moved Implementation',
      'Changed instructions',
      expect.stringMatching(/^Connected /),
      expect.stringMatching(/^Removed connection from /),
    ]));
    expect(changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Moved Implementation', blockType: 'agent' }),
    ]));
    expect(getVersionChanges(previous)).toEqual([{ kind: 'initial', title: 'Created the first version', detail: expect.stringMatching(/blocks/) }]);
    expect(formatActionTimestamp('2026-08-03T13:15:00Z')).toMatch(/Aug.*:\d{2}/);
    expect(formatActionTimestamp(undefined)).toBe('Just now');
  });

  test('keeps a separate timestamp for each action while coalescing a continuous move', () => {
    const firstMove = { kind: 'moved' as const, title: 'Moved Planning', blockType: 'agent' as const, timestamp: '2026-08-04T08:13:00.000Z' };
    const finalMove = { ...firstMove, timestamp: '2026-08-04T08:13:00.400Z' };
    const rename = { kind: 'changed' as const, title: 'Renamed Planning to Implementation', blockType: 'agent' as const, timestamp: '2026-08-04T08:14:32.000Z' };
    expect(appendVersionActions([firstMove], [finalMove, rename])).toEqual([finalMove, rename]);
  });

  test('opens an immutable published version in read-only mode', async () => {
    const first = { id: 2, flow_id: 1, version: 1, state: 'published', draft_revision: 0, definition: createRecommendedFlow(), compiled: createRecommendedFlow(), published_at: '2026-07-01T12:00:00Z' } as any;
    const current = { ...first, id: 3, version: 2, published_at: '2026-08-01T12:00:00Z' };
    vi.mocked(api.getFlow).mockResolvedValue({ flow: { id: 1, name: 'Standard delivery', active_version_id: 3 } as any, versions: [current, first] });
    vi.mocked(api.activateFlowVersion).mockResolvedValue({ flow: { id: 1, name: 'Standard delivery', is_default: 1, active_version_id: 2, activeVersion: first } as any, version: first });
    useAppStore.setState({ flows: [{ id: 1, name: 'Standard delivery', is_default: 1, active_version_id: 3, activeVersion: current } as any] });
    render(<div style={{ width: 1200, height: 800 }}><FlowEditor flowId={1} versionId={2} /></div>);

    await screen.findByText('Standard delivery');
    expect(screen.queryByText('Published version 1')).not.toBeInTheDocument();
    const picker = screen.getByRole('combobox', { name: 'Flow version' });
    const historyButton = screen.getByRole('button', { name: 'Version history' });
    const activateButton = screen.getByRole('button', { name: 'Activate' });
    expect(activateButton).toHaveAttribute('data-toolbar-action', 'activate');
    expect(activateButton.querySelector('[data-icon="check"]')).toBeInTheDocument();
    expect(picker).toHaveValue('2');
    expect(historyButton).toHaveAttribute('aria-expanded', 'false');
    const historicalActions = Array.from(historyButton.parentElement!.children);
    expect(historicalActions[0]).toBe(historyButton);
    expect(historicalActions[1]).toBe(picker.parentElement);
    expect(historicalActions[2]).toBe(activateButton);
    fireEvent.click(historyButton);
    expect(historyButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('complementary', { name: 'Version history' })).toHaveClass('panel-open');
    expect(screen.getByText('Changes in v1')).toBeVisible();
    expect(screen.getByText('Created the first version')).toBeVisible();
    expect(screen.getByRole('option', { name: /v2 · current/ })).toBeInTheDocument();
    fireEvent.click(activateButton);
    await waitFor(() => expect(api.activateFlowVersion).toHaveBeenCalledWith(1, 2));
    const editButton = await screen.findByRole('button', { name: /Edit latest draft/ });
    expect(editButton).toBeVisible();
    expect(editButton.querySelector('[data-icon="edit"]')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /v1 · current/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /^v2 ·/ })).toBeInTheDocument();
    expect(useAppStore.getState().refreshFlows).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Blocks' })).not.toBeInTheDocument();
    const readOnlyIndicator = screen.getByRole('status', { name: 'Read only' });
    expect(readOnlyIndicator).toHaveClass('editor-read-only-indicator');
    expect(readOnlyIndicator.querySelector('[data-icon="lock"]')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
    expect(api.getDraft).not.toHaveBeenCalled();
  });

  test('renders persisted history actions with their own timestamps and block icons', async () => {
    const definition = createRecommendedFlow();
    const version = {
      id: 2, flow_id: 1, version: 1, state: 'published', draft_revision: 0, definition, compiled: definition, published_at: '2026-08-04T12:00:00Z',
      action_history: [
        { kind: 'moved', title: 'Moved Planning', blockType: 'agent', timestamp: '2026-08-04T08:13:00.000Z' },
        { kind: 'changed', title: 'Changed instructions', blockType: 'agent', timestamp: '2026-08-04T08:14:32.000Z' },
      ],
    } as any;
    vi.mocked(api.getFlow).mockResolvedValue({ flow: { id: 1, name: 'Standard delivery', active_version_id: 2 } as any, versions: [version] });
    useAppStore.setState({ flows: [{ id: 1, name: 'Standard delivery', is_default: 1, active_version_id: 2, activeVersion: version } as any] });
    render(<div style={{ width: 1200, height: 800 }}><FlowEditor flowId={1} versionId={2} /></div>);

    fireEvent.click(await screen.findByRole('button', { name: 'Version history' }));
    const movedItem = (await screen.findByText('Moved Planning')).closest('li')!;
    expect(movedItem).toHaveAttribute('data-block-type', 'agent');
    expect(movedItem.querySelector('[data-icon="terminal"]')).toBeInTheDocument();
    expect(movedItem).toHaveTextContent(formatActionTimestamp('2026-08-04T08:13:00.000Z'));
    expect(screen.getByText('Changed instructions').closest('li')).toHaveTextContent(formatActionTimestamp('2026-08-04T08:14:32.000Z'));
  });

  test('keeps draft editing and published history in the same version picker', async () => {
    render(<div style={{ width: 1200, height: 800 }}><FlowEditor flowId={1} /></div>);

    const picker = await screen.findByRole('combobox', { name: 'Flow version' });
    expect(picker).toHaveValue('draft');
    expect(screen.getByRole('option', { name: 'Draft v2 · edit' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /v1 · current/ })).toBeInTheDocument();
    const historyButton = screen.getByRole('button', { name: 'Version history' });
    const publishButton = screen.getByRole('button', { name: 'Publish version' });
    expect(historyButton.querySelector('[data-icon="history"]')).toHaveAttribute('width', '18');
    expect(publishButton).toHaveAttribute('data-toolbar-action', 'publish');
    expect(publishButton.querySelector('[data-icon="publish"]')).toBeInTheDocument();
    const draftActions = Array.from(historyButton.parentElement!.children);
    expect(draftActions[0]).toBe(historyButton);
    expect(draftActions[1]).toBe(picker.parentElement);
    expect(draftActions[2]).toBe(publishButton);
    fireEvent.click(historyButton);
    expect(screen.getByText('Draft changes')).toBeVisible();
    expect(screen.getByText('No graph changes')).toBeVisible();

    fireEvent.change(picker, { target: { value: '2' } });
    await waitFor(() => expect(useAppStore.getState().viewFlowVersion).toHaveBeenCalledWith(1, 2));
  });

  test('uses stable semantic zoom levels', () => {
    expect(getFlowZoomMode(0.1)).toBe('overview');
    expect(getFlowZoomMode(0.349)).toBe('overview');
    expect(getFlowZoomMode(0.35)).toBe('compact');
    expect(getFlowZoomMode(0.549)).toBe('compact');
    expect(getFlowZoomMode(0.55)).toBe('detail');
    expect(getFlowZoomMode(1.6)).toBe('detail');
    expect(COMPACT_ZOOM_THRESHOLD).toBe(0.35);
    expect(DETAIL_ZOOM_THRESHOLD).toBe(0.55);
  });

  test('renames the Flow from its toolbar title', async () => {
    render(<div style={{ width: 1200, height: 800 }}><FlowEditor flowId={1} /></div>);
    fireEvent.click(await screen.findByRole('button', { name: 'Rename flow Standard delivery' }));
    const input = screen.getByRole('textbox', { name: 'Flow name' });
    await waitFor(() => expect(input).toHaveFocus());
    fireEvent.change(input, { target: { value: 'Renamed delivery' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(api.updateFlow).toHaveBeenCalledWith(1, { name: 'Renamed delivery' }));
    expect(await screen.findByText('Renamed delivery')).toBeVisible();
  });

  test('cancels a Flow rename without sending a request', async () => {
    render(<div style={{ width: 1200, height: 800 }}><FlowEditor flowId={1} /></div>);
    fireEvent.click(await screen.findByRole('button', { name: 'Rename flow Standard delivery' }));
    const input = screen.getByRole('textbox', { name: 'Flow name' });
    fireEvent.change(input, { target: { value: 'Discarded name' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(await screen.findByRole('button', { name: 'Rename flow Standard delivery' })).toBeVisible();
    expect(api.updateFlow).not.toHaveBeenCalled();
  });

  test('saves a Flow rename on blur and keeps editing after a failed request', async () => {
    vi.mocked(api.updateFlow).mockRejectedValueOnce(new Error('Rename failed.')).mockResolvedValueOnce({ flow: { id: 1, name: 'Saved on blur' } as any });
    render(<div style={{ width: 1200, height: 800 }}><FlowEditor flowId={1} /></div>);
    fireEvent.click(await screen.findByRole('button', { name: 'Rename flow Standard delivery' }));
    const retryInput = screen.getByRole('textbox', { name: 'Flow name' });
    fireEvent.change(retryInput, { target: { value: 'Retry name' } });
    fireEvent.blur(retryInput);
    await waitFor(() => expect(api.updateFlow).toHaveBeenCalledWith(1, { name: 'Retry name' }));
    expect(screen.getByRole('textbox', { name: 'Flow name' })).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: 'Flow name' }), { target: { value: 'Saved on blur' } });
    fireEvent.blur(screen.getByRole('textbox', { name: 'Flow name' }));
    await waitFor(() => expect(api.updateFlow).toHaveBeenLastCalledWith(1, { name: 'Saved on blur' }));
    expect(await screen.findByText('Saved on blur')).toBeVisible();
  });

  test('reserves stable block geometry before semantic details change', async () => {
    render(<div style={{ width: 1200, height: 800 }}><FlowEditor flowId={1} /></div>);
    const decision = (await screen.findByLabelText('Decision block: Plan review')).closest('.react-flow__node-flowBlock');
    const agent = screen.getByLabelText('Agent block: Development').closest('.react-flow__node-flowBlock');
    expect(decision).toHaveStyle({ height: `${FLOW_NODE_HEIGHTS.decision}px` });
    expect(agent).toHaveStyle({ height: `${FLOW_NODE_HEIGHTS.agent}px` });

    fireEvent.click(await screen.findByRole('button', { name: 'Zoom In' }));
    expect(decision).toHaveStyle({ height: `${FLOW_NODE_HEIGHTS.decision}px` });
    expect(agent).toHaveStyle({ height: `${FLOW_NODE_HEIGHTS.agent}px` });
  });

  test('provides a dedicated readable summary for reduced zoom levels', async () => {
    render(<div style={{ width: 1200, height: 800 }}><FlowEditor flowId={1} /></div>);
    const block = await screen.findByLabelText('Decision block: Plan review');
    const summary = block.querySelector('.node-zoom-summary');
    expect(summary).toHaveTextContent('Decision');
    expect(summary).toHaveTextContent('Plan review');
    expect(summary).toHaveAttribute('aria-hidden', 'true');
    expect(summary?.querySelector('.node-zoom-icon')).toHaveAttribute('data-block-icon', 'decision');
    expect(summary?.querySelector('.node-zoom-icon svg')).toHaveAttribute('data-icon', 'question');
    const compensation = Number((document.querySelector('.editor-shell') as HTMLElement).style.getPropertyValue('--zoom-compensation'));
    expect(compensation).toBeGreaterThanOrEqual(1);
    expect(compensation).toBeLessThanOrEqual(1 / MIN_FLOW_ZOOM);
    expect(MIN_FLOW_ZOOM).toBe(0.2);
  });

  test('does not open block settings when a block is dragged', async () => {
    render(<div style={{ width: 1200, height: 800 }}><FlowEditor flowId={1} /></div>);
    const block = await screen.findByLabelText('Decision block: Plan review');

    fireEvent.mouseDown(block, { button: 0, clientX: 240, clientY: 220, view: window });
    fireEvent.mouseMove(window, { buttons: 1, clientX: 300, clientY: 260, view: window });
    fireEvent.mouseUp(window, { button: 0, clientX: 300, clientY: 260, view: window });

    expect(block.closest('.react-flow__node')).toHaveClass('selected');
    expect(screen.queryByRole('complementary', { name: 'Block inspector' })).not.toBeInTheDocument();
  });

  test('loads the typed graph and exposes the accessible connection editor', async () => {
    render(<div style={{ width: 1200, height: 800 }}><FlowEditor flowId={1} /></div>);
    const planReview = await screen.findByLabelText('Decision block: Plan review');
    expect(screen.queryByRole('complementary', { name: 'Block inspector' })).not.toBeInTheDocument();
    fireEvent.click(planReview);
    expect(await screen.findByLabelText('Connect approved')).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Block inspector' })).toHaveClass('panel-open');
    expect(document.querySelector('.editor-main')).not.toHaveClass('has-inspector');
    expect(screen.getByText('Standard delivery')).toBeVisible();
    expect(screen.getByText('Saved')).toBeVisible();
    expect(screen.getByText('Ready to publish')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish version' })).toHaveTextContent('Publish version');
    expect(screen.getByRole('button', { name: 'Publish version' }).querySelector('[data-icon="publish"]')).toBeInTheDocument();
    expect(document.querySelector('.editor-shell')).toHaveAttribute('data-zoom-mode');
    expect(screen.getByLabelText('Decision block: Plan review')).toHaveAttribute('title', 'Decision: Plan review');
    const miniMap = screen.getByTestId('rf__minimap');
    expect(miniMap.style.getPropertyValue('--xy-minimap-mask-background-color-props')).toBe('rgba(5, 9, 8, 0.82)');
    expect(miniMap.querySelector('.react-flow__minimap-svg')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close block inspector' }));
    expect(screen.queryByRole('complementary', { name: 'Block inspector' })).not.toBeInTheDocument();

    fireEvent.click(planReview);
    expect(screen.getByRole('complementary', { name: 'Block inspector' })).toHaveClass('panel-open');
    expect(screen.queryByRole('button', { name: 'Dismiss block inspector overlay' })).not.toBeInTheDocument();

    const pane = document.querySelector('.react-flow__pane');
    expect(pane).not.toBeNull();
    fireEvent.click(pane!);
    expect(screen.queryByRole('complementary', { name: 'Block inspector' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Inspector' })).not.toBeInTheDocument();
  });

  test('opens the block library and adds a selected block without dragging', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 520 });
    vi.mocked(api.saveDraft).mockImplementation(async (_flowId, definition, _revision, actions) => ({
      draft: { id: 3, flow_id: 1, version: 2, state: 'draft', draft_revision: 5, definition, compiled: null, published_at: null, action_history: actions } as any,
      validation: { valid: true, problems: [] },
    }));
    render(<div style={{ width: 520, height: 800 }}><FlowEditor flowId={1} /></div>);
    await screen.findByLabelText('Decision block: Plan review');
    expect(screen.getByRole('application')).toBeInTheDocument();
    expect(screen.queryByText(/Flow editing needs/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Blocks' }));
    const library = screen.getByRole('complementary', { name: 'Block library' });
    expect(library).toHaveClass('panel-open');
    expect(screen.getByRole('button', { name: 'Blocks' }).parentElement).toHaveClass('editor-main');
    fireEvent.click(within(library).getByRole('button', { name: 'Add Agent block' }));

    expect(screen.queryByRole('complementary', { name: 'Block inspector' })).not.toBeInTheDocument();
    expect(screen.getByText('Unsaved changes')).toBeVisible();
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledTimes(1), { timeout: 2_000 });
    expect(vi.mocked(api.saveDraft).mock.calls[0]?.[3]).toEqual([expect.objectContaining({ kind: 'added', title: 'Added Agent block', blockType: 'agent', timestamp: expect.any(String) })]);
    expect(await screen.findByText('Saved')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Version history' }));
    expect(await screen.findByText('Added Agent block')).toBeVisible();
  });

  test('keeps the compact canvas clear until a block is selected', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 520 });
    render(<div style={{ width: 520, height: 800 }}><FlowEditor flowId={1} /></div>);
    const canvas = await screen.findByRole('application');
    expect(canvas.parentElement?.parentElement).toHaveClass('editor-main');
    expect(screen.queryByRole('complementary', { name: 'Block inspector' })).not.toBeInTheDocument();
  });
  test('flushes a pending autosave before publishing', async () => {
    render(<div style={{ width: 1200, height: 800 }}><FlowEditor flowId={1} /></div>);
    await screen.findByLabelText('Decision block: Plan review');
    fireEvent.click(await screen.findByRole('button', { name: 'Zoom In' }));
    expect(await screen.findByText('Unsaved changes')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Publish version' }));
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalled());
    expect(api.publishFlow).toHaveBeenCalledWith(1);
    await waitFor(() => expect(useAppStore.getState().viewFlowVersion).toHaveBeenCalledWith(1, 4));
  });

  test('keeps Publish available while an autosave is in flight', async () => {
    const definition = createRecommendedFlow();
    let resolveSave!: (value: any) => void;
    vi.mocked(api.saveDraft).mockImplementationOnce(() => new Promise((resolve) => { resolveSave = resolve; }));

    render(<div style={{ width: 1200, height: 800 }}><FlowEditor flowId={1} /></div>);
    await screen.findByLabelText('Decision block: Plan review');
    fireEvent.click(await screen.findByRole('button', { name: 'Zoom In' }));

    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledTimes(1), { timeout: 2_000 });
    const publishButton = screen.getByRole('button', { name: 'Publish version' });
    expect(publishButton).toBeEnabled();

    fireEvent.click(publishButton);
    expect(api.publishFlow).not.toHaveBeenCalled();

    resolveSave({ draft: { id: 3, flow_id: 1, version: 2, state: 'draft', draft_revision: 5, definition, compiled: null, published_at: null }, validation: { valid: true, problems: [] } });

    await waitFor(() => expect(api.publishFlow).toHaveBeenCalledWith(1));
  });

  test('treats a viewport change as a draft change', async () => {
    render(<div style={{ width: 1200, height: 800 }}><FlowEditor flowId={1} /></div>);
    await screen.findByLabelText('Decision block: Plan review');
    const zoomIndicator = await screen.findByLabelText('Current canvas zoom');
    const initialZoom = Number.parseInt(zoomIndicator.textContent ?? '', 10);
    expect(zoomIndicator).toHaveTextContent(/^\d+%$/);
    expect(zoomIndicator.parentElement).toHaveClass('react-flow__controls');
    fireEvent.click(await screen.findByRole('button', { name: 'Zoom In' }));
    await waitFor(() => expect(Number.parseInt(zoomIndicator.textContent ?? '', 10)).toBeGreaterThan(initialZoom));
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledTimes(1), { timeout: 2_000 });
    const savedDefinition = vi.mocked(api.saveDraft).mock.calls[0]?.[1];
    expect(savedDefinition?.viewport?.zoom).toBeGreaterThan(createRecommendedFlow().viewport?.zoom ?? 0);
  });

  test('saves a newer edit made while an autosave is in flight', async () => {
    const definition = createRecommendedFlow();
    let resolveFirstSave!: (value: any) => void;
    vi.mocked(api.saveDraft)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirstSave = resolve; }))
      .mockResolvedValueOnce({ draft: { id: 3, flow_id: 1, version: 2, state: 'draft', draft_revision: 6, definition, compiled: null, published_at: null }, validation: { valid: true, problems: [] } });
    render(<div style={{ width: 1200, height: 800 }}><FlowEditor flowId={1} /></div>);
    await screen.findByLabelText('Decision block: Plan review');

    fireEvent.click(await screen.findByRole('button', { name: 'Zoom In' }));
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledTimes(1), { timeout: 2_000 });
    fireEvent.click(screen.getByRole('button', { name: 'Zoom In' }));
    resolveFirstSave({ draft: { id: 3, flow_id: 1, version: 2, state: 'draft', draft_revision: 5, definition, compiled: null, published_at: null }, validation: { valid: true, problems: [] } });

    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledTimes(2), { timeout: 2_000 });
    expect(await screen.findByText('Saved')).toBeVisible();
  });

  test('shows an autosave failure and retries after the next edit', async () => {
    const definition = createRecommendedFlow();
    vi.mocked(api.saveDraft)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ draft: { id: 3, flow_id: 1, version: 2, state: 'draft', draft_revision: 5, definition, compiled: null, published_at: null }, validation: { valid: true, problems: [] } });
    render(<div style={{ width: 1200, height: 800 }}><FlowEditor flowId={1} /></div>);
    await screen.findByLabelText('Decision block: Plan review');

    fireEvent.click(await screen.findByRole('button', { name: 'Zoom In' }));
    expect(await screen.findByText('Autosave failed', {}, { timeout: 2_000 })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom In' }));

    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledTimes(2), { timeout: 2_000 });
    expect(await screen.findByText('Saved')).toBeVisible();
  });
});
