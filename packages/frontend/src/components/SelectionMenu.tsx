import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.js';

export interface SelectionOption<Value extends string> {
  value: Value;
  label: string;
  disabled?: boolean;
}

interface SelectionMenuProps<Value extends string> {
  label: string;
  ariaLabel?: string;
  value: Value;
  options: Array<SelectionOption<Value>>;
  onChange(value: Value): void;
  inlineLabel?: boolean;
  hideLabel?: boolean;
  disabled?: boolean;
  className?: string;
  placement?: 'top' | 'bottom' | 'auto';
}

export default function SelectionMenu<Value extends string>({ label, ariaLabel = label, value, options, onChange, inlineLabel = false, hideLabel = false, disabled = false, className = '', placement }: SelectionMenuProps<Value>) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const selected = options[selectedIndex];
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const [floatingStyle, setFloatingStyle] = useState<CSSProperties | null>(null);
  const [resolvedPlacement, setResolvedPlacement] = useState<'top' | 'bottom'>('bottom');

  const nextEnabledIndex = (start: number, offset: number) => {
    if (options.every((option) => option.disabled)) return start;
    let index = start;
    do index = (index + offset + options.length) % options.length;
    while (options[index]?.disabled);
    return index;
  };

  useEffect(() => {
    if (!open) return;
    const option = optionRefs.current[activeIndex];
    const listbox = listboxRef.current;
    option?.focus({ preventScroll: true });
    if (!option || !listbox) return;
    const optionTop = option.offsetTop;
    const optionBottom = optionTop + option.offsetHeight;
    if (optionTop < listbox.scrollTop) listbox.scrollTop = optionTop;
    else if (optionBottom > listbox.scrollTop + listbox.clientHeight) listbox.scrollTop = optionBottom - listbox.clientHeight;
  }, [activeIndex, open]);

  useLayoutEffect(() => {
    if (!open || !placement) return;
    const positionMenu = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const viewportPadding = 16;
      const gap = 6;
      const availableAbove = Math.max(0, rect.top - viewportPadding - gap);
      const availableBelow = Math.max(0, window.innerHeight - rect.bottom - viewportPadding - gap);
      const minimumUsefulHeight = 68;
      let nextPlacement = placement === 'auto' ? (availableBelow >= availableAbove ? 'bottom' : 'top') : placement;
      if (nextPlacement === 'top' && availableAbove < minimumUsefulHeight && availableBelow > availableAbove) nextPlacement = 'bottom';
      if (nextPlacement === 'bottom' && availableBelow < minimumUsefulHeight && availableAbove > availableBelow) nextPlacement = 'top';
      const availableHeight = nextPlacement === 'top' ? availableAbove : availableBelow;
      const width = Math.min(rect.width, window.innerWidth - viewportPadding * 2);
      const left = Math.min(Math.max(viewportPadding, rect.left), window.innerWidth - viewportPadding - width);
      setResolvedPlacement(nextPlacement);
      setFloatingStyle({
        position: 'fixed',
        top: nextPlacement === 'bottom' ? rect.bottom + gap : 'auto',
        bottom: nextPlacement === 'top' ? window.innerHeight - rect.top + gap : 'auto',
        left,
        width,
        minWidth: width,
        maxWidth: window.innerWidth - viewportPadding * 2,
        maxHeight: Math.min(320, availableHeight),
      });
    };
    positionMenu();
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', positionMenu, true);
    return () => {
      window.removeEventListener('resize', positionMenu);
      window.removeEventListener('scroll', positionMenu, true);
    };
  }, [open, placement]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target) && !listboxRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  const openMenu = () => {
    if (disabled || options.length === 0 || options.every((option) => option.disabled)) return;
    setActiveIndex(options[selectedIndex]?.disabled ? nextEnabledIndex(selectedIndex, 1) : selectedIndex);
    setOpen(true);
  };
  const closeMenu = (restoreFocus = false) => {
    setOpen(false);
    setFloatingStyle(null);
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  };
  const choose = (index: number) => {
    if (options[index]?.disabled) return;
    onChange(options[index].value);
    closeMenu(true);
  };
  const move = (offset: number) => setActiveIndex((current) => nextEnabledIndex(current, offset));
  const focusAdjacentControl = (reverse: boolean) => {
    const controls = Array.from(document.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      .filter((element) => element === triggerRef.current || (!rootRef.current?.contains(element) && !listboxRef.current?.contains(element)));
    const triggerIndex = controls.indexOf(triggerRef.current as HTMLElement);
    const adjacent = controls[triggerIndex + (reverse ? -1 : 1)];
    adjacent?.focus({ preventScroll: true });
  };

  const onTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openMenu();
    }
  };
  const onListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); move(1); return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); return; }
    if (event.key === 'Home') { event.preventDefault(); setActiveIndex(options.findIndex((option) => !option.disabled)); return; }
    if (event.key === 'End') { event.preventDefault(); setActiveIndex(options.reduce((last, option, index) => option.disabled ? last : index, 0)); return; }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(activeIndex); return; }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(true); return; }
    if (event.key === 'Tab') { event.preventDefault(); setOpen(false); focusAdjacentControl(event.shiftKey); return; }
    if (event.key.length === 1) {
      const match = options.findIndex((option) => !option.disabled && option.label.toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase()));
      if (match >= 0) { event.preventDefault(); setActiveIndex(match); }
    }
  };

  const listbox = <div ref={listboxRef} id={listboxId} className={`selection-options${placement ? ' selection-options-floating' : ''}`} role="listbox" aria-label={`${ariaLabel} options`} data-placement={placement ? resolvedPlacement : undefined} style={placement ? floatingStyle ?? { position: 'fixed', visibility: 'hidden' } : undefined} onKeyDown={onListKeyDown}>
    {options.map((option, index) => <div key={option.value} ref={(element) => { optionRefs.current[index] = element; }} className="selection-option" role="option" aria-selected={option.value === value} aria-disabled={option.disabled || undefined} tabIndex={index === activeIndex ? 0 : -1} onMouseEnter={() => { if (!option.disabled) setActiveIndex(index); }} onClick={() => choose(index)}>
      <span>{option.label}</span><Icon name="check" size={15} />
    </div>)}
  </div>;
  const portalTarget = rootRef.current?.closest('.dialog-layer') ?? (typeof document === 'undefined' ? null : document.body);

  return <div className={`selection-field${inlineLabel ? ' inline' : ''}${className ? ` ${className}` : ''}`}>
    {!inlineLabel && !hideLabel && <span className="selection-caption">{label}</span>}
    <div className="selection-menu" ref={rootRef}>
      <button ref={triggerRef} type="button" value={value} className="selection-trigger" role="combobox" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} aria-controls={listboxId} disabled={disabled} onClick={() => open ? closeMenu() : openMenu()} onKeyDown={onTriggerKeyDown}>
        {inlineLabel && <span className="selection-inline-label">{label}</span>}
        <span className="selection-current">{selected?.label}</span>
        <Icon name="arrow" size={14} />
      </button>
      {open && (!placement || !portalTarget) ? listbox : null}
    </div>
    {open && placement && portalTarget ? createPortal(listbox, portalTarget) : null}
  </div>;
}
