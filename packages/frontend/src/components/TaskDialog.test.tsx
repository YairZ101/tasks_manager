import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TaskDialog from './TaskDialog.js';

const props = {
  value: { title: 'Ship the client', description: '', acceptance: '' },
  onChange: vi.fn(),
  links: [],
  onLinksChange: vi.fn(),
  tasks: [],
  footer: <button type="submit">Save</button>,
  onSubmit: vi.fn((event) => event.preventDefault()),
  onClose: vi.fn(),
};

describe('TaskDialog', () => {
  test.each([
    ['create' as const, 'Frame the outcome', 'NEW TASK', 'Close new task'],
    ['edit' as const, 'Refine the outcome', 'EDIT TASK', 'Close task editor'],
  ])('uses the shared task shell in %s mode', async (mode, title, context, closeLabel) => {
    render(<TaskDialog {...props} mode={mode} />);
    const dialog = screen.getByRole('dialog', { name: title });
    expect(dialog).toHaveClass('composer', 'task-dialog');
    expect(dialog).toHaveTextContent(context);
    const titleInput = screen.getByRole('textbox', { name: 'Task title' });
    expect(titleInput).toHaveValue('Ship the client');
    await waitFor(() => expect(titleInput).toHaveFocus());
    expect(screen.getByRole('button', { name: closeLabel })).toBeInTheDocument();
    expect(dialog.querySelector(':scope > footer')).not.toBeNull();
  });

  test('submits and dismisses through the shared shell', () => {
    const onSubmit = vi.fn((event) => event.preventDefault());
    const onClose = vi.fn();
    render(<TaskDialog {...props} mode="create" onSubmit={onSubmit} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledOnce();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
