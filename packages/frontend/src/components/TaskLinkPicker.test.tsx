import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TaskLinkPicker from './TaskLinkPicker.js';

const tasks = [
  { id: 1, task_key: 'TST-1', title: 'Draft the API contract' },
  { id: 2, task_key: 'TST-2', title: 'Deploy the client' },
];

describe('TaskLinkPicker', () => {
  test('filters by task key or title and selects the first match with Enter', async () => {
    const onSelect = vi.fn();
    render(<TaskLinkPicker tasks={tasks} onSelect={onSelect} />);

    const input = screen.getByRole('combobox', { name: 'Search tasks by title or key' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'deploy' } });
    expect(await screen.findByRole('option', { name: /TST-2 Deploy the client/ })).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(tasks[1]));
    expect(screen.queryByRole('listbox', { name: 'Matching tasks' })).not.toBeInTheDocument();
  });
});
