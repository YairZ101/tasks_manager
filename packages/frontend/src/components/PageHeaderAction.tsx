import type { MouseEventHandler } from 'react';
import Button from './Button.js';

interface PageHeaderActionProps {
  label: string;
  onClick: MouseEventHandler<HTMLButtonElement>;
  ariaKeyShortcuts?: string;
}

export default function PageHeaderAction({ label, onClick, ariaKeyShortcuts }: PageHeaderActionProps) {
  return <Button
    variant="primary"
    className="page-header-action"
    icon="plus"
    iconSize={16}
    onClick={onClick}
    aria-keyshortcuts={ariaKeyShortcuts}
  >
    <span>{label}</span>
  </Button>;
}
