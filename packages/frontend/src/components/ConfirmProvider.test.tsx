import { useState } from 'react';
import { describe, expect, test } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfirmProvider, useConfirm } from './ConfirmProvider.js';

function Harness() {
  const confirm = useConfirm();
  const [result, setResult] = useState('waiting');
  return <><button onClick={() => void confirm({ title: 'Continue?', description: 'Check the shared confirmation.', confirmLabel: 'Continue' }).then((accepted) => setResult(String(accepted)))}>Ask</button><output>{result}</output></>;
}

function ReplacementHarness() {
  const confirm = useConfirm();
  const [firstResult, setFirstResult] = useState('waiting');
  return <>
    <button onClick={() => void confirm({ title: 'First?', description: 'First request.', confirmLabel: 'First' }).then((accepted) => setFirstResult(String(accepted)))}>Ask twice</button>
    <button onClick={() => void confirm({ title: 'Second?', description: 'Second request.', confirmLabel: 'Second' })}>Replace</button>
    <output>{firstResult}</output>
  </>;
}

describe('ConfirmProvider', () => {
  test('resolves true after confirmation', async () => {
    render(<ConfirmProvider><Harness /></ConfirmProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(screen.getByText('true')).toBeInTheDocument());
  });

  test('resolves false after cancellation', async () => {
    render(<ConfirmProvider><Harness /></ConfirmProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByText('false')).toBeInTheDocument());
  });

  test('cancels a pending request before presenting its replacement', async () => {
    render(<ConfirmProvider><ReplacementHarness /></ConfirmProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Ask twice' }));
    expect(await screen.findByRole('dialog', { name: 'First?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));

    await waitFor(() => expect(screen.getByText('false')).toBeInTheDocument());
    expect(screen.queryByRole('dialog', { name: 'First?' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Second?' })).toBeInTheDocument();
  });

  test('settles a pending request as cancelled when the provider unmounts', async () => {
    let result: boolean | undefined;
    function PendingHarness() {
      const confirm = useConfirm();
      return <button onClick={() => void confirm({ title: 'Pending?', description: 'Pending request.', confirmLabel: 'Continue' }).then((accepted) => { result = accepted; })}>Ask</button>;
    }
    const view = render(<ConfirmProvider><PendingHarness /></ConfirmProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByRole('dialog', { name: 'Pending?' })).toBeInTheDocument();
    view.unmount();
    await waitFor(() => expect(result).toBe(false));
  });
});
