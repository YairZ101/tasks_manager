import type { MouseEventHandler } from 'react';
import { Icon } from './Icon.js';

interface PageHeaderActionProps {
  label: string;
  onClick: MouseEventHandler<HTMLButtonElement>;
  ariaKeyShortcuts?: string;
}

export default function PageHeaderAction({ label, onClick, ariaKeyShortcuts }: PageHeaderActionProps) {
  return <button
    type="button"
    className="button primary page-header-action"
    onClick={onClick}
    aria-keyshortcuts={ariaKeyShortcuts}
  >
    <Icon name="plus" size={16} />
    <span>{label}</span>
  </button>;
}
