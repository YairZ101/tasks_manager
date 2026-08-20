import { useId, type FormEventHandler, type ReactNode } from 'react';
import IconButton from './IconButton.js';

type DialogFrameProps = {
  title: string;
  contextLabel?: string;
  closeLabel?: string;
  onClose?: () => void;
  closeDisabled?: boolean;
  busy?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  footerLayout?: 'default' | 'run';
  className?: string;
  onSubmit?: FormEventHandler<HTMLFormElement>;
};

export default function DialogFrame({
  title,
  contextLabel,
  closeLabel = 'Close dialog',
  onClose,
  closeDisabled = false,
  busy = false,
  children,
  footer,
  footerLayout = 'default',
  className,
  onSubmit,
}: DialogFrameProps) {
  const titleId = useId();
  const classes = `dialog-frame${className ? ` ${className}` : ''}`;
  const content = <>
    <header className="dialog-frame-header">
      <div>{contextLabel ? <span className="eyebrow">{contextLabel}</span> : null}<h2 id={titleId}>{title}</h2></div>
      {onClose ? <IconButton label={closeLabel} icon="close" disabled={closeDisabled} onClick={onClose} /> : null}
    </header>
    {children}
    {footer ? <footer className={footerLayout === 'run' ? 'composer-run-footer' : undefined}>{footer}</footer> : null}
  </>;

  if (onSubmit) return <form className={classes} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy || undefined} onSubmit={onSubmit}>{content}</form>;
  return <section className={classes} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy || undefined}>{content}</section>;
}
