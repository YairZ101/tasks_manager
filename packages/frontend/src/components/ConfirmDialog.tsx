import Button from './Button.js';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  disabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
}

export default function ConfirmDialog({
  title,
  message,
  confirmLabel,
  destructive,
  disabled,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center animate-fade-in">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-sm bg-bg-raised border border-border rounded-xl shadow-2xl p-5 animate-slide-up">
        <h3 className="text-sm font-semibold text-text mb-2">{title}</h3>
        <p className="text-sm text-text-muted mb-5">{message}</p>
        {children}
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={onCancel}
            disabled={disabled}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            tone={destructive ? 'danger' : 'default'}
            onClick={onConfirm}
            disabled={disabled}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
