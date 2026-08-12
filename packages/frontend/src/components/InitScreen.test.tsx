import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import InitScreen from './InitScreen.js';
import { api } from '../api/client.js';
import { useAppStore } from '../hooks/useTaskStore.js';

vi.mock('../api/client.js', () => ({ api: { getWorkspaceConfig: vi.fn(), testAgentConfigStream: vi.fn(), completeInitialization: vi.fn() } }));

describe('InitScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    useAppStore.setState({ repoName: 'flow', bootstrap: vi.fn() });
    vi.mocked(api.getWorkspaceConfig).mockResolvedValue({ config: { id: 1, setup_command: null, timeout_ms: 600000, updated_at: '' }, suggestedCommand: 'bun install --frozen-lockfile' });
    vi.mocked(api.testAgentConfigStream).mockImplementation(async (_candidate, onOutput) => { onOutput('OK'); return { success: true, durationMs: 42 }; });
    vi.mocked(api.completeInitialization).mockResolvedValue({ projectConfig: {}, flow: { id: 1, versionId: 1 } });
  });

  test('keeps agent testing separate from final initialization and publishes the selected template', async () => {
    render(<InitScreen />);
    expect(screen.getByRole('heading', { name: 'Connect an Agent' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    expect(screen.getByRole('heading', { name: 'Verify the Agent' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Test Agent' }));
    expect(await screen.findByText('Agent responded')).toBeInTheDocument();
    expect(screen.getByText('OK')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    expect(screen.getByRole('heading', { name: 'Name the project' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    expect(screen.getByRole('heading', { name: 'Prepare task workspaces' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Setup command/ })).toHaveValue('bun install --frozen-lockfile');
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    expect(screen.getByRole('heading', { name: 'Choose a starting Flow' })).toBeInTheDocument();
    expect(document.querySelector('[data-flow-template="recommended"] [data-block-icon="decision"] svg')).toHaveAttribute('data-icon', 'question');
    fireEvent.click(screen.getByRole('radio', { name: /Minimal delivery/ }));
    fireEvent.click(screen.getByRole('button', { name: /Finish setup/ }));
    await waitFor(() => expect(api.completeInitialization).toHaveBeenCalledWith(expect.objectContaining({
      prefix: 'FLOW', flowTemplate: 'minimal', agent: expect.objectContaining({ cli_cmd: 'codex exec --full-auto', cli_prompt_mode: 'stdin' }), workspaceSetup: { setup_command: 'bun install --frozen-lockfile', timeout_ms: 600000 },
    })));
    expect(api.testAgentConfigStream).toHaveBeenCalledWith(expect.objectContaining({ cli_cmd: 'codex exec --full-auto' }), expect.any(Function));
    expect(useAppStore.getState().bootstrap).toHaveBeenCalled();
    expect(window.localStorage.getItem('flow:onboarding:v2')).toBeNull();
  });

  test('applies the Claude Code preset before testing the Agent', async () => {
    render(<InitScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Claude Code/ }));
    expect(screen.getByLabelText(/Agent CLI command/)).toHaveValue('claude -p --dangerously-skip-permissions');
    expect(screen.getByLabelText(/Prompt delivery/)).toHaveValue('argument');
    expect(screen.getByText('Skips Claude permission prompts. Use only in a trusted workspace.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Test Agent' }));
    await screen.findByText('Agent responded');
    expect(api.testAgentConfigStream).toHaveBeenCalledWith(expect.objectContaining({ cli_cmd: 'claude -p --dangerously-skip-permissions', cli_prompt_mode: 'argument' }), expect.any(Function));
  });

  test('requires and tests a named prompt flag selected from the shared menu', async () => {
    render(<InitScreen />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Prompt delivery' }));
    fireEvent.click(screen.getByRole('option', { name: 'Named flag' }));
    expect(screen.getByText('Add the flag your CLI expects before continuing.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continue/ })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Prompt flag' }), { target: { value: '--message' } });
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Test Agent' }));
    await screen.findByText('Agent responded');
    expect(api.testAgentConfigStream).toHaveBeenCalledWith(expect.objectContaining({ cli_prompt_mode: 'flag', cli_prompt_flag: '--message' }), expect.any(Function));
  });

  test('keeps the next step locked until the Agent test succeeds', async () => {
    vi.mocked(api.testAgentConfigStream).mockImplementation(async (_candidate, onOutput) => { onOutput('missing binary'); return { success: false, durationMs: 12, error: 'Command was not found' }; });
    render(<InitScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Test Agent' }));
    expect(await screen.findByText('Test failed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Test to continue' })).toBeDisabled();
    expect(screen.getByText('missing binary')).toBeInTheDocument();
  });

  test('restores unfinished setup from local storage', async () => {
    window.localStorage.setItem('flow:onboarding:v2', JSON.stringify({
      version: 2, step: 3, prefix: 'FLOW', agent: { cli_cmd: 'agent run', cli_prompt_mode: 'argument', cli_prompt_flag: '' }, workspaceSetup: { setup_command: 'npm ci', timeout_ms: 300000 }, flowTemplate: 'blank',
    }));
    render(<InitScreen />);
    expect(screen.getByRole('heading', { name: 'Name the project' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Project key/ })).toHaveValue('FLOW');
    expect(window.localStorage.getItem('flow:onboarding:v2')).not.toBeNull();
    await waitFor(() => expect(api.getWorkspaceConfig).toHaveBeenCalled());
  });

  test('supports arrow-key selection for Flow templates', async () => {
    render(<InitScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Test Agent' }));
    await screen.findByText('Agent responded');
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    fireEvent.keyDown(screen.getByRole('radio', { name: /Recommended delivery/ }), { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: /Minimal delivery/ })).toHaveAttribute('aria-checked', 'true');
  });
});
