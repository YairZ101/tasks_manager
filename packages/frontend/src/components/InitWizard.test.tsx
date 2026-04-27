import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAppStore } from '../hooks/useTaskStore';

vi.mock('../api/client', () => ({
  api: {
    getAgentConfig: vi.fn(),
    updateAgentConfig: vi.fn(),
    testAgentConfig: vi.fn(),
    generatePrefix: vi.fn(),
    savePrefix: vi.fn(),
  },
}));

import { api } from '../api/client';
import InitWizard from './InitWizard';

describe('InitWizard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAppStore.setState({
      initialized: false,
      repoName: 'test-repo',
    });
    (api.getAgentConfig as any).mockResolvedValue({ config: {} });
  });

  test('renders welcome screen', async () => {
    render(<InitWizard />);
    expect(screen.getByText('Tasks Manager')).toBeInTheDocument();
    expect(screen.getByText(/Set up your AI agent/)).toBeInTheDocument();
  });

  test('shows step indicators', () => {
    render(<InitWizard />);
    expect(screen.getByText('Agent Setup')).toBeInTheDocument();
    expect(screen.getByText('Test')).toBeInTheDocument();
    expect(screen.getByText('Project Key')).toBeInTheDocument();
  });

  test('starts on agent-config step', () => {
    render(<InitWizard />);
    expect(screen.getByText('Configure your agent')).toBeInTheDocument();
  });

  test('shows CLI and API type tabs', () => {
    render(<InitWizard />);
    expect(screen.getByRole('button', { name: 'CLI Tool' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'API Endpoint' })).toBeInTheDocument();
  });

  test('shows preset buttons', () => {
    render(<InitWizard />);
    expect(screen.getByRole('button', { name: 'Crush' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Claude Code' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aider' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Codex' })).toBeInTheDocument();
  });

  test('Continue button disabled when no command entered', async () => {
    render(<InitWizard />);
    const cmdInput = screen.getByPlaceholderText('e.g. claude');
    await userEvent.clear(cmdInput);

    const continueBtn = screen.getByRole('button', { name: 'Continue' });
    expect(continueBtn).toBeDisabled();
  });

  test('clicking preset fills command field', async () => {
    render(<InitWizard />);
    fireEvent.click(screen.getByRole('button', { name: 'Claude Code' }));
    expect(screen.getByDisplayValue('claude')).toBeInTheDocument();
  });

  test('Continue navigates to test step', async () => {
    render(<InitWizard />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Test your agent connection')).toBeInTheDocument();
  });

  test('test step has Back button', async () => {
    render(<InitWizard />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  });

  test('test step Back returns to agent config', async () => {
    render(<InitWizard />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Configure your agent')).toBeInTheDocument();
  });

  test('switches to API mode', () => {
    render(<InitWizard />);
    fireEvent.click(screen.getByRole('button', { name: 'API Endpoint' }));
    expect(screen.getByPlaceholderText(/localhost:11434/)).toBeInTheDocument();
  });

  test('skips to prefix step if agent already configured', async () => {
    (api.getAgentConfig as any).mockResolvedValue({
      config: { cli_cmd: 'echo test', type: 'cli' },
    });
    (api.generatePrefix as any).mockResolvedValue({ prefix: 'TST' });

    render(<InitWizard />);

    await waitFor(() => {
      expect(screen.getByText('Project Key')).toBeInTheDocument();
    });
  });
});
