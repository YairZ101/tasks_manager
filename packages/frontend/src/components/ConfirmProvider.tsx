import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import ConfirmDialog, { type ConfirmTone } from './ConfirmDialog.js';

export type ConfirmOptions = {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  details?: readonly string[];
};

type PendingConfirmation = ConfirmOptions & { resolve: (accepted: boolean) => void };
type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirm | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const pendingRef = useRef<PendingConfirmation | null>(null);
  const [request, setRequest] = useState<ConfirmOptions | null>(null);

  const settle = useCallback((accepted: boolean) => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    setRequest(null);
    pending?.resolve(accepted);
  }, []);

  const confirm = useCallback<Confirm>((options) => new Promise((resolve) => {
    pendingRef.current?.resolve(false);
    pendingRef.current = { ...options, resolve };
    setRequest(options);
  }), []);

  useEffect(() => () => pendingRef.current?.resolve(false), []);

  return <ConfirmContext.Provider value={confirm}>
    {children}
    {request ? <ConfirmDialog
      title={request.title}
      message={request.description}
      confirmLabel={request.confirmLabel}
      cancelLabel={request.cancelLabel}
      tone={request.tone}
      details={request.details}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    /> : null}
  </ConfirmContext.Provider>;
}

export function useConfirm() {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm must be used within ConfirmProvider.');
  return confirm;
}
