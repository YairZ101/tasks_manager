import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRecommendedFlow } from '@tasks-manager/flow-core';
import FlowEditor from './FlowEditor.js';
import { api } from '../api/client.js';
import { useAppStore } from '../hooks/useTaskStore.js';

vi.mock('../api/client.js', () => ({ api: { getDraft: vi.fn(), saveDraft: vi.fn(), publishFlow: vi.fn() } }));

describe('FlowEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const definition = createRecommendedFlow();
    vi.mocked(api.getDraft).mockResolvedValue({ draft: { id: 3, flow_id: 1, version: 2, state: 'draft', draft_revision: 4, definition, compiled: null, published_at: null }, validation: { valid: true, problems: [] } });
    vi.mocked(api.saveDraft).mockResolvedValue({ draft: { id: 3, flow_id: 1, version: 2, state: 'draft', draft_revision: 5, definition, compiled: null, published_at: null }, validation: { valid: true, problems: [] } });
    vi.mocked(api.publishFlow).mockResolvedValue({ version: {} as any });
    useAppStore.setState({ flows: [{ id: 1, name: 'Standard delivery', is_default: 1 } as any], editingFlowId: 1, refreshFlows: vi.fn(), editFlow: vi.fn() });
  });
  test('loads the typed graph and exposes the accessible connection editor', async () => {
    render(<div style={{ width: 1200, height: 800 }}><FlowEditor flowId={1} /></div>);
    expect(await screen.findByText('Plan review')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Plan review'));
    expect(await screen.findByLabelText('Connect approved')).toBeInTheDocument();
    expect(screen.getByText('Ready to publish')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
    expect(screen.getByTestId('rf__minimap').style.getPropertyValue('--xy-minimap-mask-background-color-props')).toBe('rgba(5, 9, 8, 0.82)');
  });
  test('publishes only after saving the current draft', async () => {
    render(<div style={{ width: 1200, height: 800 }}><FlowEditor flowId={1} /></div>);
    await screen.findByText('Plan review');
    fireEvent.click(screen.getByRole('button', { name: 'Publish version' }));
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalled());
    expect(api.publishFlow).toHaveBeenCalledWith(1);
  });

  test('treats a viewport change as a draft change', async () => {
    render(<div style={{ width: 1200, height: 800 }}><FlowEditor flowId={1} /></div>);
    await screen.findByText('Plan review');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom In' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledTimes(1));
    const savedDefinition = vi.mocked(api.saveDraft).mock.calls[0]?.[1];
    expect(savedDefinition?.viewport?.zoom).toBeGreaterThan(createRecommendedFlow().viewport?.zoom ?? 0);
  });
});
