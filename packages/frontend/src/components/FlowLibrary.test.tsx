import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRecommendedFlow } from '@flow/core';
import FlowLibrary from './FlowLibrary.js';
import { api } from '../api/client.js';
import { useAppStore } from '../hooks/useTaskStore.js';

vi.mock('../api/client.js', () => ({ api: { createFlow: vi.fn(), deleteFlow: vi.fn() } }));

describe('FlowLibrary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      flows: [],
      editingFlowId: null,
      section: 'flows',
      refreshFlows: vi.fn().mockResolvedValue(undefined),
    });
  });

  test('creates a Flow and opens its draft editor without waiting for the library refresh', async () => {
    vi.mocked(api.createFlow).mockResolvedValue({ flow: { id: 42 } as any, draft: {} as any });
    render(<FlowLibrary />);

    fireEvent.click(screen.getByRole('button', { name: 'New Flow' }));
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

    fireEvent.click(screen.getByRole('button', { name: 'New Flow' }));
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

  test('uses the shared block icon registry in Flow previews', () => {
    useAppStore.setState({ flows: [{ id: 1, name: 'Standard delivery', is_default: 1, active_version_id: 1, activeVersion: { version: 1, definition: createRecommendedFlow() } } as any] });
    render(<FlowLibrary />);

    const preview = document.querySelector('.flow-mini');
    expect(preview).not.toBeNull();
    expect(preview?.querySelector('[data-block-icon="decision"] svg')).toHaveAttribute('data-icon', 'question');
    expect(preview?.querySelectorAll('[data-block-icon] svg').length).toBeGreaterThan(1);
    expect(preview).toHaveTextContent('');
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
