import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SettingsPanel from './SettingsPanel.js';
import { api } from '../api/client.js';
import { useAppStore } from '../hooks/useTaskStore.js';

vi.mock('../api/client.js', () => ({ api: {
  getAgentConfig: vi.fn(), getWorkspaceConfig: vi.fn(), updateAgentConfig: vi.fn(), updateWorkspaceConfig: vi.fn(),
  testAgentConfig: vi.fn(), testWorkspaceConfig: vi.fn(),
} }));

describe('SettingsPanel workspace preparation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ setSettingsOpen: vi.fn(), bootstrap: vi.fn() });
    vi.mocked(api.getAgentConfig).mockResolvedValue({ config: { cli_cmd: 'codex exec', cli_prompt_mode: 'stdin', cli_prompt_flag: '', timeout_ms: 1800000, max_concurrent_executions: 3 } });
    vi.mocked(api.getWorkspaceConfig).mockResolvedValue({ config: { id: 1, setup_command: null, timeout_ms: 600000, updated_at: '' }, suggestedCommand: 'bun install --frozen-lockfile' });
    vi.mocked(api.testWorkspaceConfig).mockResolvedValue({ success: true, durationMs: 25, output: 'OUT  dependencies ready' });
    vi.mocked(api.updateAgentConfig).mockResolvedValue({ config: {} });
    vi.mocked(api.updateWorkspaceConfig).mockResolvedValue({ config: { id: 1, setup_command: 'bun install --frozen-lockfile', timeout_ms: 600000, updated_at: '' } });
  });

  test('applies the detected command and tests it in a temporary worktree', async () => {
    render(<SettingsPanel />);
    const suggestion = await screen.findByRole('button', { name: /Use detected command/ });
    fireEvent.click(suggestion);
    expect(screen.getByRole('textbox', { name: 'Setup command' })).toHaveValue('bun install --frozen-lockfile');

    fireEvent.click(screen.getByRole('button', { name: 'Test setup' }));
    expect(await screen.findByText('Temporary worktree passed')).toBeInTheDocument();
    expect(screen.getByText('OUT dependencies ready')).toBeInTheDocument();
    expect(api.testWorkspaceConfig).toHaveBeenCalledWith({ setup_command: 'bun install --frozen-lockfile', timeout_ms: 600000 });

    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(api.updateWorkspaceConfig).toHaveBeenCalledWith({ setup_command: 'bun install --frozen-lockfile', timeout_ms: 600000 }));
  });

  test('shows command output when the temporary worktree test fails', async () => {
    vi.mocked(api.testWorkspaceConfig).mockResolvedValue({
      success: false,
      durationMs: 25,
      output: 'ERR  install failed',
      error: 'Workspace setup exited with code 1.',
    });
    render(<SettingsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /Use detected command/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Test setup' }));

    expect(await screen.findByText('Setup test failed')).toBeInTheDocument();
    expect(screen.getByText('ERR install failed')).toBeInTheDocument();
  });

  test('shows request errors when the Workspace setup test cannot start', async () => {
    vi.mocked(api.testWorkspaceConfig).mockRejectedValue(new Error('Testing workspace setup requires a Git repository.'));
    render(<SettingsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /Use detected command/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Test setup' }));

    expect(await screen.findByText('Setup test failed')).toBeInTheDocument();
    expect(screen.getByText('Testing workspace setup requires a Git repository.')).toBeInTheDocument();
  });

  test('keeps setup testing disabled until a command is configured', async () => {
    render(<SettingsPanel />);
    expect(await screen.findByRole('button', { name: 'Test setup' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(api.updateWorkspaceConfig).toHaveBeenCalledWith({ setup_command: '', timeout_ms: 600000 }));
  });
});
