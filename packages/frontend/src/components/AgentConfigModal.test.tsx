import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useAppStore } from '../hooks/useTaskStore';

vi.mock('../api/client', () => ({
  api: {
    getAgentConfig: vi.fn(),
    updateAgentConfig: vi.fn(),
    testAgentConfig: vi.fn(),
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
        type: 'cli',
        cli_cmd: 'echo test',
        cli_prompt_mode: 'stdin',
        cli_prompt_flag: null,
        api_url: null,
        api_headers: null,
        api_model: null,
        api_request_format: 'openai',
        api_stream_format: 'sse',
        timeout_ms: 1800000,
      },
    });
  });

  test('renders title', async () => {
    render(<AgentConfigModal />);
    expect(screen.getByText('Agent Configuration')).toBeInTheDocument();
  });

  test('loads and displays config', async () => {
    render(<AgentConfigModal />);
    await waitFor(() => {
      expect(screen.getByDisplayValue('echo test')).toBeInTheDocument();
    });
  });

  test('has CLI and API tabs', async () => {
    render(<AgentConfigModal />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'CLI' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'API' })).toBeInTheDocument();
    });
  });

  test('has Save, Cancel, and Test buttons', async () => {
    render(<AgentConfigModal />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
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

  test('Save calls updateAgentConfig', async () => {
    (api.updateAgentConfig as any).mockResolvedValue({ config: {} });
    render(<AgentConfigModal />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(api.updateAgentConfig).toHaveBeenCalled();
    });
  });

  test('shows preset buttons for CLI mode', async () => {
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
        sort_order: 1, description: '', acceptance: '', created_at: '', updated_at: '',
      }],
    });
    render(<AgentConfigModal />);
    await waitFor(() => {
      expect(screen.getByText(/Config changes apply to future runs/)).toBeInTheDocument();
    });
  });
});
