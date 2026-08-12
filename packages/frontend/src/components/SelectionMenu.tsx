import { useEffect, useId, useRef, useState } from 'react';
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
}

export default function SelectionMenu<Value extends string>({ label, ariaLabel = label, value, options, onChange, inlineLabel = false, hideLabel = false, disabled = false, className = '' }: SelectionMenuProps<Value>) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const selected = options[selectedIndex];
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);

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

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
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
      .filter((element) => element === triggerRef.current || !rootRef.current?.contains(element));
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

  return <div className={`selection-field${inlineLabel ? ' inline' : ''}${className ? ` ${className}` : ''}`}>
    {!inlineLabel && !hideLabel && <span className="selection-caption">{label}</span>}
    <div className="selection-menu" ref={rootRef}>
      <button ref={triggerRef} type="button" value={value} className="selection-trigger" role="combobox" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} aria-controls={listboxId} disabled={disabled} onClick={() => open ? closeMenu() : openMenu()} onKeyDown={onTriggerKeyDown}>
        {inlineLabel && <span className="selection-inline-label">{label}</span>}
        <span className="selection-current">{selected?.label}</span>
        <Icon name="arrow" size={14} />
      </button>
      {open && <div ref={listboxRef} id={listboxId} className="selection-options" role="listbox" aria-label={`${ariaLabel} options`} onKeyDown={onListKeyDown}>
        {options.map((option, index) => <div key={option.value} ref={(element) => { optionRefs.current[index] = element; }} className="selection-option" role="option" aria-selected={option.value === value} aria-disabled={option.disabled || undefined} tabIndex={index === activeIndex ? 0 : -1} onMouseEnter={() => { if (!option.disabled) setActiveIndex(index); }} onClick={() => choose(index)}>
          <span>{option.label}</span><Icon name="check" size={15} />
        </div>)}
      </div>}
    </div>
  </div>;
}
