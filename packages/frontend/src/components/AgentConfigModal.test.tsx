import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useAppStore } from '../hooks/useTaskStore';

vi.mock('../api/client', () => ({
  api: {
    getAgentConfig: vi.fn(),
    updateAgentConfig: vi.fn(),
    testAgentConfig: vi.fn(),
    getStatus: vi.fn(),
    updateProjectConfig: vi.fn(),
  },
}));

import { api } from '../api/client';
import AgentConfigModal from './AgentConfigModal';

describe('AgentConfigModal', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAppStore.setState({
      showAgentConfig: true,
      tasks: [],
    });
    (api.getAgentConfig as any).mockResolvedValue({
      config: {
        cli_cmd: 'echo test',
        cli_prompt_mode: 'stdin',
        cli_prompt_flag: null,
        timeout_ms: 1800000,
        max_concurrent_agents: 3,
      },
    });
    (api.getStatus as any).mockResolvedValue({
      initialized: true,
      projectConfig: { delete_branch_on_done: 1 },
    });
  });

  test('renders title', async () => {
    render(<AgentConfigModal />);
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  test('renders sidebar navigation with Agent and Concurrency', async () => {
    render(<AgentConfigModal />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Agent/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Concurrency/ })).toBeInTheDocument();
    });
  });

  test('loads and displays config on Agent page', async () => {
    render(<AgentConfigModal />);
    await waitFor(() => {
      expect(screen.getByDisplayValue('echo test')).toBeInTheDocument();
    });
  });

  test('has Save and Cancel buttons', async () => {
    render(<AgentConfigModal />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });
  });

  test('has Test Connection button on Agent page', async () => {
    render(<AgentConfigModal />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Test Connection' })).toBeInTheDocument();
    });
  });

  test('Cancel closes modal', async () => {
    render(<AgentConfigModal />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(useAppStore.getState().showAgentConfig).toBe(false);
  });

  test('Save calls updateAgentConfig and updateProjectConfig', async () => {
    (api.updateAgentConfig as any).mockResolvedValue({ config: {} });
    (api.updateProjectConfig as any).mockResolvedValue({ projectConfig: {} });
    render(<AgentConfigModal />);
    await waitFor(() => {
      expect(screen.getByDisplayValue('echo test')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(api.updateAgentConfig).toHaveBeenCalled();
      expect(api.updateProjectConfig).toHaveBeenCalled();
    });
  });

  test('shows preset buttons on Agent page', async () => {
    render(<AgentConfigModal />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Crush' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Claude Code' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Aider' })).toBeInTheDocument();
    });
  });

  test('shows warning when agent is running', async () => {
    useAppStore.setState({
      showAgentConfig: true,
      tasks: [{
        id: 1, task_key: 'T-1', title: 'a', status: 'in-progress' as const,
        agent_status: 'running' as const, agent_pid: 123, agent_started_at: null,
        agent_worktree: null, agent_branch: null,
        sort_order: 1, description: '', acceptance: '', created_at: '', updated_at: '',
      }],
    });
    render(<AgentConfigModal />);
    await waitFor(() => {
      expect(screen.getByText(/Config changes apply to future runs/)).toBeInTheDocument();
    });
  });

  test('displays timeout in minutes with decimal precision', async () => {
    render(<AgentConfigModal />);
    await waitFor(() => {
      expect(screen.getByDisplayValue('30')).toBeInTheDocument();
    });
  });

  test('displays sub-minute timeout as decimal', async () => {
    (api.getAgentConfig as any).mockResolvedValue({
      config: {
        cli_cmd: 'echo test',
        cli_prompt_mode: 'stdin',
        cli_prompt_flag: null,
        timeout_ms: 30000,
        max_concurrent_agents: 3,
      },
    });
    render(<AgentConfigModal />);
    await waitFor(() => {
      expect(screen.getByDisplayValue('0.5')).toBeInTheDocument();
    });
  });

  test('switches to Concurrency page', async () => {
    render(<AgentConfigModal />);
    await waitFor(() => {
      expect(screen.getByDisplayValue('echo test')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Concurrency/ }));
    expect(screen.getByText('Max Concurrent Agents')).toBeInTheDocument();
    expect(screen.getByDisplayValue('3')).toBeInTheDocument();
  });

  test('Concurrency page shows explanation text', async () => {
    render(<AgentConfigModal />);
    await waitFor(() => {
      expect(screen.getByDisplayValue('echo test')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Concurrency/ }));
    expect(screen.getByText(/git worktree/)).toBeInTheDocument();
  });

  test('renders Git nav item', async () => {
    render(<AgentConfigModal />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Git/ })).toBeInTheDocument();
    });
  });

  test('switches to Git page and shows delete branch checkbox', async () => {
    render(<AgentConfigModal />);
    await waitFor(() => {
      expect(screen.getByDisplayValue('echo test')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Git/ }));
    expect(screen.getByText('Delete branch when task is done')).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  test('Git page checkbox reflects disabled state', async () => {
    (api.getStatus as any).mockResolvedValue({
      initialized: true,
      projectConfig: { delete_branch_on_done: 0 },
    });
    render(<AgentConfigModal />);
    await waitFor(() => {
      expect(screen.getByDisplayValue('echo test')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Git/ }));
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });
});
