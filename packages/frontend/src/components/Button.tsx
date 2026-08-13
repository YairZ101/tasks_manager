import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon.js';

export type ButtonVariant = 'default' | 'primary' | 'ghost' | 'text';
export type ButtonTone = 'default' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  tone?: ButtonTone;
  icon?: IconName;
  iconPosition?: 'start' | 'end';
  iconSize?: number;
  loading?: boolean;
  loadingLabel?: ReactNode;
}

function buttonClassName(variant: ButtonVariant, tone: ButtonTone, className?: string) {
  const classes = variant === 'text'
    ? [tone === 'danger' ? 'text-danger' : 'text-button']
    : ['button', variant === 'default' ? null : variant, tone === 'danger' ? 'danger' : null];

  if (className) classes.push(className);
  return classes.filter(Boolean).join(' ');
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  variant = 'default',
  tone = 'default',
  icon,
  iconPosition = 'start',
  iconSize = 15,
  loading = false,
  loadingLabel,
  className,
  children,
  disabled,
  type = 'button',
  'aria-busy': ariaBusy,
  ...props
}, ref) {
  const content = loading ? loadingLabel ?? children : children;
  const iconElement = icon ? <Icon name={icon} size={iconSize} /> : null;

  return <button
    {...props}
    ref={ref}
    type={type}
    className={buttonClassName(variant, tone, className)}
    disabled={disabled || loading}
    aria-busy={loading || ariaBusy ? true : undefined}
  >
    {iconPosition === 'start' && iconElement}
    {content}
    {iconPosition === 'end' && iconElement}
  </button>;
});

export default Button;
