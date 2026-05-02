import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import WorkflowEditor, { type EditorStep } from './WorkflowEditor';

vi.mock('../api/client', () => ({
  api: {},
}));

const makeStep = (overrides: Partial<EditorStep> = {}): EditorStep => ({
  id: 'development',
  slug: 'development',
  name: 'Development',
  requires_review: false,
  ...overrides,
});

const fixedSteps: EditorStep[] = [
  { id: 'todo', slug: 'todo', name: 'Todo', requires_review: false, fixed: true },
  { id: 'done', slug: 'done', name: 'Done', requires_review: false, fixed: true, config: '{"deleteBranch":true}' },
];

describe('WorkflowEditor', () => {
  const defaultProps = {
    steps: fixedSteps as EditorStep[],
    onAdd: vi.fn(),
    onRemove: vi.fn(),
    onReorder: vi.fn(),
    onToggleReview: vi.fn(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('renders fixed Todo and Done rows', () => {
    render(<WorkflowEditor {...defaultProps} />);
    expect(screen.getByText('Todo')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
  });

  test('renders empty state when no steps', () => {
    render(<WorkflowEditor {...defaultProps} />);
    expect(screen.getByText('Add steps from the catalog below')).toBeInTheDocument();
  });

  test('renders workflow steps between Todo and Done', () => {
    const steps = [
      ...fixedSteps.filter(s => s.slug === 'todo'),
      makeStep({ id: 'planning', slug: 'planning', name: 'Planning', requires_review: true }),
      makeStep({ id: 'development', slug: 'development', name: 'Development' }),
      ...fixedSteps.filter(s => s.slug === 'done'),
    ];
    render(<WorkflowEditor {...defaultProps} steps={steps} />);
    expect(screen.getByText('Planning')).toBeInTheDocument();
    expect(screen.getByText('Development')).toBeInTheDocument();
  });

  test('shows available steps from catalog', () => {
    render(<WorkflowEditor {...defaultProps} />);
    expect(screen.getByText('Planning')).toBeInTheDocument();
    expect(screen.getByText('Development')).toBeInTheDocument();
    expect(screen.getByText('Visual QA')).toBeInTheDocument();
    expect(screen.getByText('Open PRs')).toBeInTheDocument();
  });

  test('hides step from available list when already active', () => {
    const steps = [...fixedSteps, makeStep()];
    render(<WorkflowEditor {...defaultProps} steps={steps} />);
    // Development should appear in the workflow section but not in available steps
    const addButtons = screen.getAllByText('Add');
    // 4 catalog steps minus 1 active = 3 Add buttons
    expect(addButtons).toHaveLength(3);
  });

  test('calls onAdd when Add button is clicked', () => {
    const onAdd = vi.fn();
    render(<WorkflowEditor {...defaultProps} onAdd={onAdd} />);
    const addButtons = screen.getAllByText('Add');
    fireEvent.click(addButtons[0]);
    expect(onAdd).toHaveBeenCalledOnce();
  });

  test('calls onRemove when X button is clicked', () => {
    const onRemove = vi.fn();
    const steps = [
      ...fixedSteps,
      makeStep({ id: 'a', slug: 'planning', name: 'Planning' }),
      makeStep({ id: 'b', slug: 'development', name: 'Development' }),
    ];
    render(<WorkflowEditor {...defaultProps} steps={steps} onRemove={onRemove} />);
    // Find X buttons (there should be 2, one per step)
    const removeButtons = screen.getAllByRole('button').filter(
      btn => btn.querySelector('svg path[d*="4 4l8 8"]')
    );
    fireEvent.click(removeButtons[0]);
    expect(onRemove).toHaveBeenCalledOnce();
  });

  test('calls onToggleReview when toggle is clicked', () => {
    const onToggleReview = vi.fn();
    const steps = [...fixedSteps, makeStep()];
    render(<WorkflowEditor {...defaultProps} steps={steps} onToggleReview={onToggleReview} />);
    const toggleBtn = screen.getByText('Pause for review').closest('button')!;
    fireEvent.click(toggleBtn);
    expect(onToggleReview).toHaveBeenCalledOnce();
  });

  test('shows "all steps added" when catalog is exhausted', () => {
    const steps = [
      ...fixedSteps,
      makeStep({ id: 'planning', slug: 'planning', name: 'Planning' }),
      makeStep({ id: 'development', slug: 'development', name: 'Development' }),
      makeStep({ id: 'visual-qa', slug: 'visual-qa', name: 'Visual QA' }),
      makeStep({ id: 'open-prs', slug: 'open-prs', name: 'Open PRs' }),
    ];
    render(<WorkflowEditor {...defaultProps} steps={steps} />);
    expect(screen.getByText('All steps added to your workflow.')).toBeInTheDocument();
  });

  test('does not show gear icon when showConfig is false', () => {
    const steps = [...fixedSteps, makeStep({ id: 'planning', slug: 'planning', name: 'Planning', config: '{"planLocation":"doc/"}' })];
    render(<WorkflowEditor {...defaultProps} steps={steps} showConfig={false} />);
    // Planning has config but showConfig is off — no gear icon
    const gearButtons = screen.getAllByRole('button').filter(
      btn => btn.querySelector('svg path[d*="M12 15a3"]')
    );
    expect(gearButtons).toHaveLength(0);
  });

  test('shows gear icon when showConfig is true for steps with config', () => {
    const steps = [makeStep({ id: 'planning', slug: 'planning', name: 'Planning', config: '{"planLocation":"doc/"}' })];
    render(<WorkflowEditor {...defaultProps} steps={steps} showConfig />);
    const gearButtons = screen.getAllByRole('button').filter(
      btn => btn.querySelector('svg path[d*="M12 15a3"]')
    );
    expect(gearButtons).toHaveLength(1);
  });
});
