import { beforeEach, describe, expect, test, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import AgentsLibrary from './AgentsLibrary.js';
import { api } from '../api/client.js';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../api/client.js', () => ({ api: {
  listAgentPresets: vi.fn(),
  createAgentPreset: vi.fn(),
  updateAgentPreset: vi.fn(),
  deleteAgentPreset: vi.fn(),
} }));

const development = {
  id: 1,
  preset_key: 'development',
  name: 'Development',
  description: 'Implement the task and run checks.',
  system_prompt: 'Implement the task.',
  created_at: '2026-08-07 10:00:00',
  updated_at: '2026-08-07 10:00:00',
};

describe('AgentsLibrary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listAgentPresets).mockResolvedValue({ presets: [development] });
  });

  test('loads and edits the full Agent preset configuration', async () => {
    vi.mocked(api.updateAgentPreset).mockResolvedValue({ preset: { ...development, system_prompt: 'Implement the task and verify every change.' } });
    render(<AgentsLibrary />);
    expect(await screen.findByRole('button', { name: /Development/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByLabelText('Permission level')).not.toBeInTheDocument();
    const prompt = screen.getByLabelText('System prompt');
    expect(prompt).toHaveValue('Implement the task.');
    fireEvent.change(prompt, { target: { value: 'Implement the task and verify every change.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.updateAgentPreset).toHaveBeenCalledWith(1, expect.objectContaining({ system_prompt: 'Implement the task and verify every change.' })));
  });

  test('adds a new Agent preset', async () => {
    const created = { ...development, id: 2, preset_key: 'release-engineer', name: 'Release engineer', system_prompt: 'Prepare the release.' };
    vi.mocked(api.createAgentPreset).mockResolvedValue({ preset: created });
    render(<AgentsLibrary />);
    await screen.findByRole('button', { name: /Development/ });
    fireEvent.click(screen.getByRole('button', { name: 'New Agent' }));
    fireEvent.change(screen.getByLabelText('Agent name'), { target: { value: 'Release engineer' } });
    fireEvent.change(screen.getByLabelText('System prompt'), { target: { value: 'Prepare the release.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Agent' }));
    await waitFor(() => expect(api.createAgentPreset).toHaveBeenCalledWith(expect.objectContaining({ name: 'Release engineer', system_prompt: 'Prepare the release.' })));
  });

  test('reports dirty state and protects an unsaved preset from browser unload', async () => {
    const onDirtyChange = vi.fn();
    render(<AgentsLibrary onDirtyChange={onDirtyChange} />);
    await screen.findByRole('button', { name: /Development/ });
    fireEvent.change(screen.getByLabelText('Agent name'), { target: { value: 'Development lead' } });
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  test('surfaces the “in use by Flows” error when an agent cannot be deleted', async () => {
    window.confirm = vi.fn().mockReturnValue(true);
    vi.mocked(api.deleteAgentPreset).mockRejectedValue(new Error('This agent is used by 1 Flow (“Delivery”). Replace or remove the Agent block there first.'));
    render(<AgentsLibrary />);
    await screen.findByRole('button', { name: /Development/ });
    fireEvent.click(screen.getByRole('button', { name: /Delete preset/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('used by 1 Flow')));
  });

  test('preselects the focused preset when opened from a Flow Agent block, even after the key is consumed', async () => {
    const reviewer = { ...development, id: 2, preset_key: 'reviewer', name: 'Reviewer', system_prompt: 'Review the work.' };
    vi.mocked(api.listAgentPresets).mockResolvedValue({ presets: [development, reviewer] });
    // Mirror the real store: consuming the focus clears the key, which must not reset the selection to the first preset.
    let consumed = false;
    function Harness() {
      const [key, setKey] = useState<string | null>('reviewer');
      return <AgentsLibrary focusPresetKey={key} onFocusConsumed={() => { consumed = true; setKey(null); }} />;
    }
    render(<Harness />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Reviewer/ })).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByLabelText('System prompt')).toHaveValue('Review the work.');
    expect(screen.getByRole('button', { name: /Development/ })).toHaveAttribute('aria-pressed', 'false');
    expect(consumed).toBe(true);
  });
});
