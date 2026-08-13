import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import PageHeaderAction from './PageHeaderAction.js';

test('renders the standard page action and forwards interaction details', () => {
  const onClick = vi.fn();

  render(<PageHeaderAction label="New task" onClick={onClick} ariaKeyShortcuts="Alt+N" />);

  const button = screen.getByRole('button', { name: 'New task' });
  const icon = button.querySelector('[data-icon="plus"]');

  expect(button).toHaveAttribute('type', 'button');
  expect(button).toHaveClass('page-header-action');
  expect(button).toHaveAttribute('aria-keyshortcuts', 'Alt+N');
  expect(icon).toHaveAttribute('width', '16');
  expect(icon).toHaveAttribute('height', '16');

  fireEvent.click(button);
  expect(onClick).toHaveBeenCalledOnce();
});
