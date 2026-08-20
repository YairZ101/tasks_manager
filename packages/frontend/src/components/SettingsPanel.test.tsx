import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SettingsPanel from './SettingsPanel.js';
import { api } from '../api/client.js';
import { useAppStore } from '../hooks/useTaskStore.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((next, fail) => { resolve = next; reject = fail; });
  return { promise, resolve, reject };
}

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

  test('uses the shared dialog shell and closes with Escape', async () => {
    const setSettingsOpen = vi.fn();
    useAppStore.setState({ setSettingsOpen });
    render(<SettingsPanel />);
    expect(await screen.findByRole('dialog', { name: 'Execution settings' })).toHaveClass('dialog-frame', 'settings-panel');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(setSettingsOpen).toHaveBeenCalledWith(false);
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

  test('recovers when the agent test request cannot start', async () => {
    vi.mocked(api.testAgentConfig).mockRejectedValue(new Error('Agent executable was not found.'));
    render(<SettingsPanel />);
    const testAgent = await screen.findByRole('button', { name: 'Test agent' });
    await waitFor(() => expect(testAgent).toBeEnabled());
    fireEvent.click(testAgent);

    await waitFor(() => expect(testAgent).toBeEnabled());
    expect(screen.getByRole('dialog', { name: 'Execution settings' })).toBeInTheDocument();
  });

  test('keeps setup testing disabled until a command is configured', async () => {
    render(<SettingsPanel />);
    expect(await screen.findByRole('button', { name: 'Test setup' })).toBeDisabled();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Save settings' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(api.updateWorkspaceConfig).toHaveBeenCalledWith({ setup_command: '', timeout_ms: 600000 }));
  });

  test('saves a manually selected prompt delivery mode and flag', async () => {
    render(<SettingsPanel />);
    const delivery = await screen.findByRole('combobox', { name: 'Prompt delivery' });
    const flag = screen.getByRole('textbox', { name: 'Prompt flag' });
    expect(flag).toBeDisabled();
    fireEvent.click(delivery);
    fireEvent.click(screen.getByRole('option', { name: 'Named flag' }));
    expect(flag).toBeEnabled();
    fireEvent.change(flag, { target: { value: '--prompt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(api.updateAgentConfig).toHaveBeenCalledWith(expect.objectContaining({ cli_prompt_mode: 'flag', cli_prompt_flag: '--prompt' })));
  });

  test('keeps settings open and blocks dismissal while saving', async () => {
    const request = deferred<{ config: any }>();
    vi.mocked(api.updateAgentConfig).mockReturnValue(request.promise);
    const setSettingsOpen = vi.fn();
    useAppStore.setState({ setSettingsOpen });
    render(<SettingsPanel />);
    const save = await screen.findByRole('button', { name: 'Save settings' });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);

    expect(await screen.findByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('dialog', { name: 'Execution settings' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('textbox', { name: 'CLI command' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close settings' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Test agent' })).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.mouseDown(document.querySelector('.dialog-layer')!);
    expect(setSettingsOpen).not.toHaveBeenCalled();

    request.resolve({ config: {} });
    await waitFor(() => expect(setSettingsOpen).toHaveBeenCalledWith(false));
  });

  test('reports save failures without closing the settings dialog', async () => {
    vi.mocked(api.updateAgentConfig).mockRejectedValue(new Error('Agent configuration could not be saved.'));
    const setSettingsOpen = vi.fn();
    useAppStore.setState({ setSettingsOpen });
    render(<SettingsPanel />);
    const save = await screen.findByRole('button', { name: 'Save settings' });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Save settings' })).toBeEnabled());
    expect(setSettingsOpen).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Execution settings' })).toBeInTheDocument();
  });

  test('does not expose editable defaults before settings finish loading', async () => {
    const agentRequest = deferred<any>();
    vi.mocked(api.getAgentConfig).mockReturnValue(agentRequest.promise);
    render(<SettingsPanel />);

    expect(screen.getByRole('dialog', { name: 'Execution settings' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('textbox', { name: 'CLI command' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled();
    agentRequest.resolve({ config: { cli_cmd: 'codex exec', cli_prompt_mode: 'stdin', cli_prompt_flag: '', timeout_ms: 1800000, max_concurrent_executions: 3 } });

    await waitFor(() => expect(screen.getByRole('textbox', { name: 'CLI command' })).toBeEnabled());
    expect(screen.getByRole('dialog', { name: 'Execution settings' })).not.toHaveAttribute('aria-busy');
  });
});
