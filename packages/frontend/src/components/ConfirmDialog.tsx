import { useRef, type ReactNode } from 'react';
import Button from './Button.js';
import DialogFrame from './DialogFrame.js';
import DialogLayer from './DialogLayer.js';

export type ConfirmTone = 'default' | 'warning' | 'danger';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  details?: readonly string[];
  disabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}

export default function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'default',
  details,
  disabled,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return <DialogLayer variant="confirm" onDismiss={onCancel} dismissDisabled={disabled} initialFocusRef={cancelRef}>
    <DialogFrame
      className={`confirm-dialog ${tone}`}
      title={title}
      busy={disabled}
      footer={<>
        <Button ref={cancelRef} variant="ghost" onClick={onCancel} disabled={disabled}>{cancelLabel}</Button>
        <Button variant="primary" tone={tone === 'danger' ? 'danger' : 'default'} onClick={onConfirm} disabled={disabled}>{confirmLabel}</Button>
      </>}
    >
      <p className="confirm-message">{message}</p>
      {details?.length ? <ul className="confirm-details">{details.map((detail) => <li key={detail}>{detail}</li>)}</ul> : null}
      {children}
    </DialogFrame>
  </DialogLayer>;
}
