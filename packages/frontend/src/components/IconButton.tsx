import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from './Icon.js';
import type { ButtonTone } from './Button.js';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
  label: string;
  icon: IconName;
  iconSize?: number;
  tone?: ButtonTone;
}

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({
  label,
  icon,
  iconSize = 18,
  tone = 'default',
  className,
  type = 'button',
  ...props
}, ref) {
  const classes = ['icon-button', tone === 'danger' ? 'danger' : null, className].filter(Boolean).join(' ');

  return <button {...props} ref={ref} type={type} className={classes} aria-label={label}>
    <Icon name={icon} size={iconSize} />
  </button>;
});

export default IconButton;
