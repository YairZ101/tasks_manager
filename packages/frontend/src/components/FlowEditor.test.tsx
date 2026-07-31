import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createRecommendedFlow } from '@flow/core';
import FlowEditor, { COMPACT_ZOOM_THRESHOLD, DETAIL_ZOOM_THRESHOLD, FLOW_NODE_HEIGHTS, MIN_FLOW_ZOOM, getFlowZoomMode } from './FlowEditor.js';
import { api } from '../api/client.js';
import { useAppStore } from '../hooks/useTaskStore.js';

vi.mock('../api/client.js', () => ({ api: { getDraft: vi.fn(), saveDraft: vi.fn(), publishFlow: vi.fn(), updateFlow: vi.fn() } }));

describe('FlowEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
    const definition = createRecommendedFlow();
    vi.mocked(api.getDraft).mockResolvedValue({ draft: { id: 3, flow_id: 1, version: 2, state: 'draft', draft_revision: 4, definition, compiled: null, published_at: null }, validation: { valid: true, problems: [] } });
    vi.mocked(api.saveDraft).mockResolvedValue({ draft: { id: 3, flow_id: 1, version: 2, state: 'draft', draft_revision: 5, definition, compiled: null, published_at: null }, validation: { valid: true, problems: [] } });
    vi.mocked(api.publishFlow).mockResolvedValue({ version: {} as any });
    vi.mocked(api.updateFlow).mockResolvedValue({ flow: { id: 1, name: 'Renamed delivery' } as any });
    useAppStore.setState({ flows: [{ id: 1, name: 'Standard delivery', is_default: 1 } as any], editingFlowId: 1, refreshFlows: vi.fn(), editFlow: vi.fn() });
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
    expect(screen.getByText('Ready to publish')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save draft' })).toHaveTextContent('Save draft');
    expect(screen.getByRole('button', { name: 'Publish version' })).toHaveTextContent('Publish version');
    expect(screen.getByRole('button', { name: 'Save draft' }).querySelector('[data-icon="save"]')).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled();
  });

  test('keeps the compact canvas clear until a block is selected', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 520 });
    render(<div style={{ width: 520, height: 800 }}><FlowEditor flowId={1} /></div>);
    const canvas = await screen.findByRole('application');
    expect(canvas.parentElement?.parentElement).toHaveClass('editor-main');
    expect(screen.queryByRole('complementary', { name: 'Block inspector' })).not.toBeInTheDocument();
  });
  test('publishes only after saving the current draft', async () => {
    render(<div style={{ width: 1200, height: 800 }}><FlowEditor flowId={1} /></div>);
    await screen.findByLabelText('Decision block: Plan review');
    fireEvent.click(screen.getByRole('button', { name: 'Publish version' }));
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalled());
    expect(api.publishFlow).toHaveBeenCalledWith(1);
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledTimes(1));
    const savedDefinition = vi.mocked(api.saveDraft).mock.calls[0]?.[1];
    expect(savedDefinition?.viewport?.zoom).toBeGreaterThan(createRecommendedFlow().viewport?.zoom ?? 0);
  });
});
