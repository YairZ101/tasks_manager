import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createRecommendedFlow } from '@flow/core';
import FlowLibrary from './FlowLibrary.js';
import { api } from '../api/client.js';
import { useAppStore } from '../hooks/useTaskStore.js';

vi.mock('../api/client.js', () => ({ api: { createFlow: vi.fn(), duplicateFlow: vi.fn(), deleteFlow: vi.fn(), updateFlow: vi.fn() } }));

describe('FlowLibrary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      flows: [],
      editingFlowId: null,
      viewingFlowVersionId: null,
      section: 'flows',
      refreshFlows: vi.fn().mockResolvedValue(undefined),
    });
  });

  test('creates a Flow and opens its draft editor without waiting for the library refresh', async () => {
    vi.mocked(api.createFlow).mockResolvedValue({ flow: { id: 42 } as any, draft: {} as any });
    render(<FlowLibrary />);

    expect(screen.getByRole('heading', { level: 1, name: 'Flow library' })).toBeVisible();

    const newFlow = screen.getByRole('button', { name: 'New flow' });
    expect(newFlow).toHaveClass('page-header-action');
    fireEvent.click(newFlow);
    expect(screen.getByRole('dialog', { name: 'Name the workflow' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Flow name'), { target: { value: 'Release delivery' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Flow' }));

    await waitFor(() => expect(api.createFlow).toHaveBeenCalledWith('Release delivery'));
    expect(useAppStore.getState()).toMatchObject({ editingFlowId: 42, section: 'flows' });
    expect(useAppStore.getState().refreshFlows).toHaveBeenCalledTimes(1);
  });

  test('keeps the dialog open and shows the create error', async () => {
    vi.mocked(api.createFlow).mockRejectedValue(new Error('Flow name is required.'));
    render(<FlowLibrary />);

    fireEvent.click(screen.getByRole('button', { name: 'New flow' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Flow' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Flow name is required.');
    expect(screen.getByRole('dialog', { name: 'Name the workflow' })).toBeInTheDocument();
  });

  test('opens a Flow editor when its card is selected', () => {
    useAppStore.setState({ flows: [{ id: 8, name: 'Release delivery', is_default: 0, active_version_id: null } as any] });
    render(<FlowLibrary />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit Release delivery' }));

    expect(useAppStore.getState()).toMatchObject({ editingFlowId: 8, section: 'flows' });
  });

  test('keeps version history out of the Flow library card', () => {
    useAppStore.setState({ flows: [{ id: 8, name: 'Release delivery', is_default: 0, active_version_id: 12, activeVersion: { id: 12, version: 3, definition: createRecommendedFlow() } } as any] });
    render(<FlowLibrary />);

    expect(screen.queryByRole('button', { name: 'Version history' })).not.toBeInTheDocument();
  });

  test('shows only the meaningful default and version signals on a Flow card', () => {
    useAppStore.setState({ flows: [
      { id: 8, name: 'Standard delivery', is_default: 1, active_version_id: 12, activeVersion: { id: 12, version: 3, definition: createRecommendedFlow() } },
      { id: 9, name: 'Delivery flow', is_default: 0, active_version_id: 13, activeVersion: { id: 13, version: 1, definition: createRecommendedFlow() } },
    ] as any });
    render(<FlowLibrary />);

    const deliveryCard = screen.getByRole('button', { name: 'Edit Delivery flow' }).closest('article')!;
    expect(within(deliveryCard).queryByText('FLOW')).not.toBeInTheDocument();
    expect(within(deliveryCard).queryByText(/blocks/i)).not.toBeInTheDocument();
    expect(within(deliveryCard).queryByText(/published/i)).not.toBeInTheDocument();
    expect(within(deliveryCard).queryByText('0')).not.toBeInTheDocument();
    expect(within(deliveryCard).getByText('v1')).toBeVisible();
    const makeDefault = within(deliveryCard).getByRole('button', { name: 'Make default' });
    expect(makeDefault).toBeVisible();
    expect(makeDefault.querySelector('[data-icon="check"]')).toBeInTheDocument();
    const defaultCard = screen.getByRole('button', { name: 'Edit Standard delivery' }).closest('article')!;
    expect(within(defaultCard).getByText('Default')).toHaveClass('default-flow-status');
    expect(within(defaultCard).getByText('v3')).toBeVisible();
    expect(defaultCard.querySelector('.flow-card-meta')).not.toBeInTheDocument();
  });

  test('renames a Flow directly from its library card', async () => {
    const flow = { id: 8, name: 'Release delivery', is_default: 0, active_version_id: null } as any;
    useAppStore.setState({ flows: [flow] });
    vi.mocked(api.updateFlow).mockResolvedValue({ flow: { ...flow, name: 'Release train' } });
    render(<FlowLibrary />);

    fireEvent.click(screen.getByRole('button', { name: 'Rename flow Release delivery' }));
    const input = screen.getByRole('textbox', { name: 'Flow name for Release delivery' });
    await waitFor(() => expect(input).toHaveFocus());
    fireEvent.change(input, { target: { value: 'Release train' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(api.updateFlow).toHaveBeenCalledWith(8, { name: 'Release train' }));
    expect(await screen.findByRole('button', { name: 'Rename flow Release train' })).toBeVisible();
  });

  test('cancels a library rename without sending a request', async () => {
    const flow = { id: 8, name: 'Release delivery', is_default: 0, active_version_id: null } as any;
    useAppStore.setState({ flows: [flow] });
    render(<FlowLibrary />);

    fireEvent.click(screen.getByRole('button', { name: 'Rename flow Release delivery' }));
    const input = screen.getByRole('textbox', { name: 'Flow name for Release delivery' });
    fireEvent.change(input, { target: { value: 'Discarded name' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(await screen.findByRole('button', { name: 'Rename flow Release delivery' })).toBeVisible();
    expect(api.updateFlow).not.toHaveBeenCalled();
  });

  test('keeps the library rename input open when saving fails', async () => {
    const flow = { id: 8, name: 'Release delivery', is_default: 0, active_version_id: null } as any;
    useAppStore.setState({ flows: [flow] });
    vi.mocked(api.updateFlow).mockRejectedValue(new Error('Rename failed.'));
    render(<FlowLibrary />);

    fireEvent.click(screen.getByRole('button', { name: 'Rename flow Release delivery' }));
    const input = screen.getByRole('textbox', { name: 'Flow name for Release delivery' });
    fireEvent.change(input, { target: { value: 'Retry name' } });
    fireEvent.blur(input);

    await waitFor(() => expect(api.updateFlow).toHaveBeenCalledWith(8, { name: 'Retry name' }));
    expect(screen.getByRole('textbox', { name: 'Flow name for Release delivery' })).toBeInTheDocument();
  });

  test('uses the shared block icon registry in Flow previews', () => {
    useAppStore.setState({ flows: [{ id: 1, name: 'Standard delivery', is_default: 1, active_version_id: 1, activeVersion: { version: 1, definition: createRecommendedFlow() } } as any] });
    render(<FlowLibrary />);

    const preview = document.querySelector('.flow-mini');
    expect(preview).not.toBeNull();
    expect(preview?.querySelector('[data-block-icon="decision"] svg')).toHaveAttribute('data-icon', 'question');
    expect(preview?.querySelectorAll('[data-block-icon] svg').length).toBe(createRecommendedFlow().nodes.length);
    expect(preview?.querySelectorAll('.flow-mini-links path').length).toBe(createRecommendedFlow().connections.length);
    expect(preview?.querySelector('.flow-mini-node-name')).not.toBeInTheDocument();
    expect(preview?.querySelectorAll('.flow-mini-links .is-forward')).toHaveLength(9);
    expect(preview?.querySelectorAll('.flow-mini-links .is-feedback')).toHaveLength(3);
    expect(preview?.querySelector('.flow-mini-links path')).toHaveAttribute('stroke-width', '3');
    expect(preview?.querySelectorAll('marker')).toHaveLength(1);
    expect(preview?.querySelector('marker')).toHaveAttribute('markerUnits', 'userSpaceOnUse');
    expect(preview?.querySelector('marker')).toHaveAttribute('markerWidth', '12');
    expect(preview?.querySelector('marker path')).toHaveAttribute('fill', '#577166');
  });

  test('keeps SVG arrow markers unique across Flow cards', () => {
    const definition = createRecommendedFlow();
    useAppStore.setState({ flows: [
      { id: 1, name: 'Standard delivery', is_default: 1, active_version_id: 1, activeVersion: { version: 1, definition } },
      { id: 2, name: 'Release delivery', is_default: 0, active_version_id: 2, activeVersion: { version: 1, definition } },
    ] as any });
    render(<FlowLibrary />);

    const cards = screen.getAllByRole('button', { name: /^Edit / }).map((button) => button.closest('article')!);
    const markerIds = cards.map((card) => card.querySelector('marker')?.id);
    expect(new Set(markerIds).size).toBe(cards.length);
    cards.forEach((card, index) => {
      expect(card.querySelector('.flow-mini-links path')).toHaveAttribute('marker-end', `url(#${markerIds[index]})`);
    });
  });

  test('keeps Note blocks out of the executable Flow preview', () => {
    const definition = createRecommendedFlow();
    definition.nodes.push({ id: 'delivery-note', type: 'note', typeVersion: 1, position: { x: 0, y: 0 }, config: { text: 'Release context', color: 'amber', width: 220, height: 120 } });
    useAppStore.setState({ flows: [{ id: 1, name: 'Standard delivery', is_default: 1, active_version_id: 1, activeVersion: { version: 1, definition } } as any] });
    render(<FlowLibrary />);

    const preview = document.querySelector('.flow-mini');
    expect(preview?.querySelector('[data-node-id="delivery-note"]')).not.toBeInTheDocument();
    expect(preview?.querySelectorAll('.flow-mini-node')).toHaveLength(createRecommendedFlow().nodes.length);
  });

  test('lays out the preview from connections instead of canvas positions', () => {
    const definition = createRecommendedFlow();
    definition.nodes = definition.nodes.map((node) => ({ ...node, position: { x: 0, y: 0 } }));
    useAppStore.setState({ flows: [{ id: 1, name: 'Standard delivery', is_default: 1, active_version_id: 1, activeVersion: { version: 1, definition } } as any] });
    render(<FlowLibrary />);

    const preview = document.querySelector('.flow-mini');
    const transforms = [...(preview?.querySelectorAll('.flow-mini-node') ?? [])].map((node) => node.getAttribute('transform'));
    expect(new Set(transforms).size).toBe(definition.nodes.length);
    expect(preview?.querySelector('[data-node-id="final-decision"]')).toHaveAttribute('transform', 'translate(504 34)');
    expect(preview?.querySelector('[data-node-id="test-decision"]')).toHaveAttribute('transform', 'translate(504 116)');
    expect(preview?.querySelector('.flow-mini-graph')).toHaveAttribute('viewBox', '0 0 780 224');
    expect(preview?.querySelector('[data-connection-id="c4"]')).toHaveAttribute('d', expect.stringContaining('V 108 H'));
    expect(preview?.querySelector('[data-connection-id="c8"]')).toHaveAttribute('d', expect.stringContaining('V 190 H'));
    expect(preview?.querySelector('[data-connection-id="c11"]')).toHaveAttribute('d', expect.stringContaining('V 108 H'));
  });

  test('shows the copied draft graph in the Flow library', () => {
    useAppStore.setState({ flows: [{ id: 8, name: 'Copy of Standard delivery', is_default: 0, active_version_id: null, activeVersion: null, draftVersion: { id: 12, version: 1, definition: createRecommendedFlow() } } as any] });
    render(<FlowLibrary />);

    const copyCard = screen.getByRole('button', { name: 'Edit Copy of Standard delivery' }).closest('article')!;
    expect(within(copyCard).getByText('Draft v1')).toBeVisible();
    expect(copyCard.querySelectorAll('[data-block-icon]').length).toBeGreaterThan(1);
  });

  test('duplicates a Flow and opens the new draft editor', async () => {
    const flow = { id: 8, name: 'Release delivery', is_default: 0, active_version_id: null } as any;
    useAppStore.setState({ flows: [flow] });
    vi.mocked(api.duplicateFlow).mockResolvedValue({ flow: { id: 42, name: 'Copy of Release delivery' } as any, draft: {} as any });
    render(<FlowLibrary />);

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate Flow' }));

    await waitFor(() => expect(api.duplicateFlow).toHaveBeenCalledWith(8));
    expect(useAppStore.getState()).toMatchObject({ editingFlowId: 42, section: 'flows' });
    expect(useAppStore.getState().refreshFlows).toHaveBeenCalledTimes(1);
  });

  test('confirms and deletes a non-default Flow', async () => {
    vi.mocked(api.deleteFlow).mockResolvedValue(undefined);
    useAppStore.setState({ flows: [{ id: 8, name: 'Release delivery', is_default: 0, active_version_id: null } as any] });
    render(<FlowLibrary />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete Flow' }));
    expect(screen.getByText('Delete Release delivery?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete flow' }));

    await waitFor(() => expect(api.deleteFlow).toHaveBeenCalledWith(8));
    expect(useAppStore.getState().refreshFlows).toHaveBeenCalledTimes(1);
  });

  test('does not offer deletion for the default Flow', () => {
    useAppStore.setState({ flows: [{ id: 1, name: 'Standard delivery', is_default: 1, active_version_id: 1 } as any] });
    render(<FlowLibrary />);

    expect(screen.getByRole('button', { name: 'Delete Flow' })).toBeDisabled();
  });
});
