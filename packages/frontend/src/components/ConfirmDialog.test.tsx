import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConfirmDialog from './ConfirmDialog';

describe('ConfirmDialog', () => {
  test('renders title and message', () => {
    render(
      <ConfirmDialog
        title="Delete task?"
        message="This will permanently delete the task."
        confirmLabel="Delete"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );

    expect(screen.getByText('Delete task?')).toBeInTheDocument();
    expect(screen.getByText('This will permanently delete the task.')).toBeInTheDocument();
  });

  test('renders confirm and cancel buttons', () => {
    render(
      <ConfirmDialog
        title="Confirm"
        message="Are you sure?"
        confirmLabel="Yes, do it"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );

    expect(screen.getByRole('button', { name: 'Yes, do it' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  test('calls onConfirm when confirm button clicked', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        title="Confirm"
        message="Sure?"
        confirmLabel="OK"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  test('calls onCancel when cancel button clicked', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        title="Confirm"
        message="Sure?"
        confirmLabel="OK"
        onConfirm={() => {}}
        onCancel={onCancel}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test('calls onCancel when backdrop clicked', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        title="Confirm"
        message="Sure?"
        confirmLabel="OK"
        onConfirm={() => {}}
        onCancel={onCancel}
      />
    );

    // Backdrop is the first div inside the fixed overlay
    const backdrop = document.querySelector('[class*="bg-black"]');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test('applies destructive styling when destructive prop is true', () => {
    render(
      <ConfirmDialog
        title="Delete?"
        message="Permanent action"
        confirmLabel="Delete"
        destructive
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );

    const btn = screen.getByRole('button', { name: 'Delete' });
    expect(btn.className).toContain('bg-danger');
  });

  test('applies accent styling when destructive is false', () => {
    render(
      <ConfirmDialog
        title="Confirm"
        message="Sure?"
        confirmLabel="OK"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );

    const btn = screen.getByRole('button', { name: 'OK' });
    expect(btn.className).toContain('bg-accent');
  });
});
