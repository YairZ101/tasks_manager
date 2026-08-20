import { useRef, useState } from 'react';
import { describe, expect, test } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { render } from '../test/render.js';
import DialogLayer from './DialogLayer.js';

describe('DialogLayer', () => {
  test.each(['button', 'Escape'] as const)('returns focus to an explicit neutral target after closing with %s', async (dismissMethod) => {
    function Harness() {
      const [open, setOpen] = useState(false);
      const returnFocusRef = useRef<HTMLElement>(null);
      return <>
        <section ref={returnFocusRef} tabIndex={-1} aria-label="Tasks region" />
        <button onClick={() => setOpen(true)}>Open task</button>
        {open ? <DialogLayer returnFocusRef={returnFocusRef} onDismiss={() => setOpen(false)}>
          <div role="dialog" aria-label="Task details"><button onClick={() => setOpen(false)}>Close task</button></div>
        </DialogLayer> : null}
      </>;
    }

    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open task' });
    trigger.focus();
    fireEvent.click(trigger);
    const close = await screen.findByRole('button', { name: 'Close task' });
    await waitFor(() => expect(close).toHaveFocus());

    if (dismissMethod === 'Escape') fireEvent.keyDown(document, { key: 'Escape' });
    else fireEvent.click(close);

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Task details' })).not.toBeInTheDocument());
    expect(trigger).not.toHaveFocus();
    expect(screen.getByRole('region', { name: 'Tasks region' })).toHaveFocus();
  });

  test('keeps the page locked and exposes only the top dialog while dialogs are nested', async () => {
    function Harness() {
      const [parentOpen, setParentOpen] = useState(false);
      const [childOpen, setChildOpen] = useState(false);
      return <>
        <button onClick={() => setParentOpen(true)}>Open parent</button>
        {parentOpen ? <>
          <DialogLayer onDismiss={() => setParentOpen(false)}>
            <div role="dialog" aria-label="Parent dialog"><button onClick={() => setChildOpen(true)}>Open child</button></div>
          </DialogLayer>
          {childOpen ? <DialogLayer onDismiss={() => setChildOpen(false)}>
            <div role="dialog" aria-label="Child dialog"><button>Child action</button></div>
          </DialogLayer> : null}
        </> : null}
      </>;
    }

    document.body.style.overflow = 'clip';
    render(<Harness />);
    const pageTrigger = screen.getByRole('button', { name: 'Open parent' });
    pageTrigger.focus();
    fireEvent.click(pageTrigger);
    const childTrigger = await screen.findByRole('button', { name: 'Open child' });
    const parentLayer = screen.getByRole('dialog', { name: 'Parent dialog' }).closest('.dialog-layer');
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.click(childTrigger);
    expect(await screen.findByRole('dialog', { name: 'Child dialog' })).toBeInTheDocument();
    expect(parentLayer).toHaveAttribute('aria-hidden', 'true');
    expect(parentLayer).toHaveAttribute('inert');

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Child dialog' })).not.toBeInTheDocument());
    expect(screen.getByRole('dialog', { name: 'Parent dialog' })).toBeInTheDocument();
    expect(parentLayer).not.toHaveAttribute('aria-hidden');
    expect(parentLayer).not.toHaveAttribute('inert');
    expect(document.body.style.overflow).toBe('hidden');
    expect(childTrigger).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Parent dialog' })).not.toBeInTheDocument());
    expect(document.body.style.overflow).toBe('clip');
    expect(pageTrigger).toHaveFocus();
    document.body.style.overflow = '';
  });

  test('falls back to the opening control when an explicit return target was removed', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      const returnFocusRef = useRef<HTMLElement>(null);
      return <>
        <button onClick={() => setOpen(true)}>Open dialog</button>
        {open ? <>
          <section ref={returnFocusRef} aria-label="Temporary return target" />
          <DialogLayer returnFocusRef={returnFocusRef} onDismiss={() => setOpen(false)}>
            <div role="dialog" aria-label="Fallback dialog"><button onClick={() => setOpen(false)}>Close dialog</button></div>
          </DialogLayer>
        </> : null}
      </>;
    }

    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open dialog' });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('button', { name: 'Close dialog' }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
