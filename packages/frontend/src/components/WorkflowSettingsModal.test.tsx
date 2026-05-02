import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useAppStore } from '../hooks/useTaskStore';
import type { WorkflowStep } from '../hooks/useTaskStore';

vi.mock('../api/client', () => ({
  api: {
    getWorkflowCatalog: vi.fn().mockResolvedValue({ catalog: [] }),
    addWorkflowStep: vi.fn().mockResolvedValue({ step: {} }),
    removeWorkflowStep: vi.fn().mockResolvedValue(undefined),
    updateWorkflowStep: vi.fn().mockResolvedValue({ step: {} }),
    getWorkflowSteps: vi.fn().mockResolvedValue({ steps: [] }),
  },
}));

import WorkflowSettingsModal from './WorkflowSettingsModal';
import { api } from '../api/client';

const makeWorkflowStep = (overrides: Partial<WorkflowStep> = {}): WorkflowStep => ({
  id: 1,
  slug: 'development',
  name: 'Development',
  requires_review: 0,
  config: '{}',
  sort_order: 1,
  fixed: 0,
  created_at: '',
  ...overrides,
});

const fixedSteps: WorkflowStep[] = [
  makeWorkflowStep({ id: 100, slug: 'todo', name: 'Todo', sort_order: 0, fixed: 1 }),
  makeWorkflowStep({ id: 101, slug: 'done', name: 'Done', sort_order: 100, fixed: 1, config: '{"deleteBranch":true}' }),
];

describe('WorkflowSettingsModal', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    (api.getWorkflowCatalog as any).mockResolvedValue({
      catalog: [
        { slug: 'planning', name: 'Planning', requiresReview: true, description: 'Plan desc', configSchema: [] },
        { slug: 'development', name: 'Development', requiresReview: false, description: 'Dev desc', configSchema: [] },
        { slug: 'visual-qa', name: 'Visual QA', requiresReview: true, description: 'QA desc', configSchema: [] },
        { slug: 'open-prs', name: 'Open PRs', requiresReview: false, description: 'PR desc', configSchema: [] },
      ],
    });
  });

  test('renders modal with title and close button', () => {
    useAppStore.setState({
      workflowSteps: [...fixedSteps, makeWorkflowStep()],
    });
    render(<WorkflowSettingsModal onClose={onClose} />);
    expect(screen.getByText('Workflow Steps')).toBeInTheDocument();
  });

  test('calls onClose when close button is clicked', () => {
    useAppStore.setState({
      workflowSteps: [...fixedSteps, makeWorkflowStep()],
    });
    render(<WorkflowSettingsModal onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  test('renders active workflow steps', () => {
    useAppStore.setState({
      workflowSteps: [
        ...fixedSteps,
        makeWorkflowStep({ id: 1, slug: 'planning', name: 'Planning', requires_review: 1 }),
        makeWorkflowStep({ id: 2, slug: 'development', name: 'Development' }),
      ],
    });
    render(<WorkflowSettingsModal onClose={onClose} />);
    expect(screen.getByText('Planning')).toBeInTheDocument();
    expect(screen.getByText('Development')).toBeInTheDocument();
  });

  test('renders fixed Todo and Done rows', () => {
    useAppStore.setState({
      workflowSteps: [...fixedSteps, makeWorkflowStep()],
    });
    render(<WorkflowSettingsModal onClose={onClose} />);
    expect(screen.getByText('Todo')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
  });

  test('shows available steps from catalog after loading', async () => {
    useAppStore.setState({
      workflowSteps: [...fixedSteps, makeWorkflowStep()],
    });
    render(<WorkflowSettingsModal onClose={onClose} />);
    // Catalog is fetched async — wait for it
    await waitFor(() => {
      // Planning is not active, so its description should appear in available steps
      expect(screen.getByText('Planning')).toBeInTheDocument();
    });
  });

  test('calls addWorkflowStep when Add is clicked', async () => {
    useAppStore.setState({
      workflowSteps: [...fixedSteps, makeWorkflowStep()],
      fetchWorkflowSteps: vi.fn(),
    });
    render(<WorkflowSettingsModal onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getAllByText('Add').length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByText('Add')[0]);
    expect(api.addWorkflowStep).toHaveBeenCalledOnce();
  });

  test('calls updateWorkflowStep when review toggle is clicked', async () => {
    useAppStore.setState({
      workflowSteps: [...fixedSteps, makeWorkflowStep()],
      fetchWorkflowSteps: vi.fn(),
    });
    render(<WorkflowSettingsModal onClose={onClose} />);
    const toggleBtn = screen.getByText('Pause for review').closest('button')!;
    fireEvent.click(toggleBtn);
    expect(api.updateWorkflowStep).toHaveBeenCalledWith(1, { requires_review: true });
  });

  test('shows delete confirmation when remove is triggered', async () => {
    useAppStore.setState({
      workflowSteps: [
        ...fixedSteps,
        makeWorkflowStep({ id: 1, slug: 'planning', name: 'Planning' }),
        makeWorkflowStep({ id: 2, slug: 'development', name: 'Development' }),
      ],
    });
    render(<WorkflowSettingsModal onClose={onClose} />);

    // The X/remove buttons have a specific SVG with path "M4 4l8 8M12 4l-8 8"
    // But the modal close button uses the same pattern. Filter by size (16x16 vs 16x16)
    // Instead, find buttons that are NOT the modal close or the Close text button
    const allButtons = screen.getAllByRole('button');
    // Find buttons with the X icon that are inside the workflow step rows (not the modal header)
    const removeButtons = allButtons.filter(btn => {
      const svg = btn.querySelector('svg');
      if (!svg) return false;
      const path = svg.querySelector('path');
      if (!path) return false;
      const d = path.getAttribute('d') || '';
      return d.includes('4 4l8 8') && svg.getAttribute('width') === '16' && btn.closest('.flex.items-center.gap-2.px-3.py-2');
    });

    expect(removeButtons.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(removeButtons[0]);

    await waitFor(() => {
      expect(screen.getByText('Remove Step')).toBeInTheDocument();
    });
  });
});
