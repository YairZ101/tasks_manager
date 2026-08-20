import { useState } from 'react';
import { describe, test, expect, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { render } from '../test/render.js';
import ConfirmDialog from './ConfirmDialog.js';

const requiredProps = {
  title: 'Delete task?',
  message: 'This will permanently delete the task.',
  confirmLabel: 'Delete task',
  onConfirm: () => {},
  onCancel: () => {},
};

describe('ConfirmDialog', () => {
  test('renders an accessible dialog with details and actions', () => {
    render(<ConfirmDialog {...requiredProps} tone="danger" details={['TST-4 · Publish the API contract']} />);

    const dialog = screen.getByRole('dialog', { name: 'Delete task?' });
    expect(dialog).toHaveTextContent('This will permanently delete the task.');
    expect(dialog).toHaveTextContent('TST-4 · Publish the API contract');
    expect(screen.getByRole('button', { name: 'Delete task' })).toHaveClass('button', 'primary', 'danger');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  test('calls the selected action', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(<ConfirmDialog {...requiredProps} onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete task' }));
    expect(onConfirm).toHaveBeenCalledOnce();

    rerender(<ConfirmDialog {...requiredProps} onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  test('dismisses from Escape and the backdrop', () => {
    const onCancel = vi.fn();
    const { rerender } = render(<ConfirmDialog {...requiredProps} onCancel={onCancel} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();

    rerender(<ConfirmDialog {...requiredProps} onCancel={onCancel} />);
    fireEvent.mouseDown(document.querySelector('.confirm-layer')!);
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  test('blocks dismissal and actions while disabled', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog {...requiredProps} disabled onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.mouseDown(document.querySelector('.confirm-layer')!);
    fireEvent.click(screen.getByRole('button', { name: 'Delete task' }));
    expect(screen.getByRole('dialog', { name: 'Delete task?' })).toHaveAttribute('aria-busy', 'true');
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test('starts on Cancel, traps Tab, and restores focus when closed', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return <><button onClick={() => setOpen(true)}>Open confirmation</button>{open ? <ConfirmDialog {...requiredProps} onCancel={() => setOpen(false)} /> : null}</>;
    }
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open confirmation' });
    trigger.focus();
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());

    const confirm = screen.getByRole('button', { name: 'Delete task' });
    confirm.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  test('keeps pointer focus-ring behavior after a modifier-only key press', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return <><button onClick={() => setOpen(true)}>Open confirmation</button>{open ? <ConfirmDialog {...requiredProps} onCancel={() => setOpen(false)} /> : null}</>;
    }
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open confirmation' });
    trigger.focus();
    fireEvent.pointerDown(trigger);
    fireEvent.keyDown(trigger, { key: 'Meta', metaKey: true });
    fireEvent.click(trigger);

    const cancel = await screen.findByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(cancel).toHaveFocus());
    expect(cancel).toHaveAttribute('data-dialog-focus-ring', 'suppressed');

    fireEvent.click(cancel);
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(trigger).toHaveAttribute('data-dialog-focus-ring', 'suppressed');
  });

  test('keeps focus rings for keyboard-opened dialogs', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return <><button onClick={() => setOpen(true)}>Open confirmation</button>{open ? <ConfirmDialog {...requiredProps} onCancel={() => setOpen(false)} /> : null}</>;
    }
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open confirmation' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(trigger);

    const cancel = await screen.findByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(cancel).toHaveFocus());
    expect(cancel).not.toHaveAttribute('data-dialog-focus-ring');

    fireEvent.click(cancel);
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(trigger).toHaveAttribute('data-dialog-focus-ring', 'suppressed');

    fireEvent.keyDown(trigger, { key: 'Meta', metaKey: true });
    expect(trigger).toHaveAttribute('data-dialog-focus-ring', 'suppressed');

    fireEvent.blur(trigger);
    expect(trigger).not.toHaveAttribute('data-dialog-focus-ring');
  });
});
