import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import Button from './Button.js';
import IconButton from './IconButton.js';

test('renders a safe default button and forwards native props and refs', () => {
  const ref = createRef<HTMLButtonElement>();
  const onClick = vi.fn();

  render(<Button ref={ref} onClick={onClick} data-testid="action">Continue</Button>);

  const button = screen.getByRole('button', { name: 'Continue' });
  expect(button).toHaveAttribute('type', 'button');
  expect(button).toHaveClass('button');
  expect(button).toHaveAttribute('data-testid', 'action');
  expect(ref.current).toBe(button);

  fireEvent.click(button);
  expect(onClick).toHaveBeenCalledOnce();
});

test('combines visual variants, semantic tone, and icon placement', () => {
  render(<>
    <Button variant="primary" icon="plus" iconSize={16}>Create task</Button>
    <Button variant="ghost" tone="danger" icon="stop">Stop run</Button>
    <Button variant="text" tone="danger" icon="trash" iconPosition="end">Delete</Button>
  </>);

  const create = screen.getByRole('button', { name: 'Create task' });
  const stop = screen.getByRole('button', { name: 'Stop run' });
  const remove = screen.getByRole('button', { name: 'Delete' });

  expect(create).toHaveClass('button', 'primary');
  expect(create.querySelector('[data-icon="plus"]')).toHaveAttribute('width', '16');
  expect(stop).toHaveClass('button', 'ghost', 'danger');
  expect(remove).toHaveClass('text-danger');
  expect(remove.lastElementChild).toHaveAttribute('data-icon', 'trash');
});

test('exposes and disables a loading action', () => {
  const onClick = vi.fn();
  render(<Button icon="save" loading loadingLabel="Saving…" onClick={onClick}>Save changes</Button>);

  const button = screen.getByRole('button', { name: 'Saving…' });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute('aria-busy', 'true');
  expect(button.querySelector('[data-icon="save"]')).toBeInTheDocument();

  fireEvent.click(button);
  expect(onClick).not.toHaveBeenCalled();
});

test('renders a labelled icon-only action and forwards native props and refs', () => {
  const ref = createRef<HTMLButtonElement>();
  const onClick = vi.fn();
  render(<IconButton ref={ref} label="Close panel" icon="close" tone="danger" disabled onClick={onClick} data-testid="close-panel" />);

  const button = screen.getByRole('button', { name: 'Close panel' });
  const icon = button.querySelector('[data-icon="close"]');

  expect(button).toHaveAttribute('type', 'button');
  expect(button).toHaveClass('icon-button', 'danger');
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute('data-testid', 'close-panel');
  expect(ref.current).toBe(button);
  expect(icon).toHaveAttribute('width', '18');
  expect(icon).toHaveAttribute('height', '18');

  fireEvent.click(button);
  expect(onClick).not.toHaveBeenCalled();
});
