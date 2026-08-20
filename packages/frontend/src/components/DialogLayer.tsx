import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';

type DialogStackEntry = { id: string; element: HTMLDivElement };

const dialogStack: DialogStackEntry[] = [];
let previousBodyOverflow = '';
let lastInteractionWasKeyboard = true;

const modifierKeys = new Set(['Alt', 'Control', 'Meta', 'Shift']);

export function DialogInteractionProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const handlePointerDown = () => { lastInteractionWasKeyboard = false; };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!modifierKeys.has(event.key)) lastInteractionWasKeyboard = true;
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, []);

  return children;
}

const focusableSelector = [
  'button:not(:disabled)',
  '[href]',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableElements(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => {
    return !element.closest('[aria-hidden="true"], [inert]') && !element.hidden;
  });
}

function focusElement(element: HTMLElement, showFocusRing: boolean) {
  if (!showFocusRing) {
    element.dataset.dialogFocusRing = 'suppressed';
    const clearFocusRingSuppression = () => {
      delete element.dataset.dialogFocusRing;
      element.removeEventListener('blur', clearFocusRingSuppression);
    };
    element.addEventListener('blur', clearFocusRingSuppression, { once: true });
  }
  element.focus({ preventScroll: true });
}

export default function DialogLayer({
  children,
  onDismiss,
  dismissDisabled = false,
  variant = 'modal',
  initialFocusRef,
  restoreFocus = true,
  returnFocusRef,
}: {
  children: ReactNode;
  onDismiss?: () => void;
  dismissDisabled?: boolean;
  variant?: 'modal' | 'panel' | 'confirm';
  initialFocusRef?: RefObject<HTMLElement | null>;
  restoreFocus?: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const layerId = useId();
  const layerRef = useRef<HTMLDivElement>(null);
  const dismissRef = useRef(onDismiss);
  const dismissDisabledRef = useRef(dismissDisabled);
  const initialFocusRefRef = useRef(initialFocusRef);
  const restoreFocusRef = useRef(restoreFocus);
  const returnFocusRefRef = useRef(returnFocusRef);
  dismissRef.current = onDismiss;
  dismissDisabledRef.current = dismissDisabled;
  initialFocusRefRef.current = initialFocusRef;
  restoreFocusRef.current = restoreFocus;
  returnFocusRefRef.current = returnFocusRef;

  useEffect(() => {
    const restoreFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const showInitialFocusRing = lastInteractionWasKeyboard;
    const layer = layerRef.current;
    if (!layer) return;
    const firstDialog = dialogStack.length === 0;
    const parentDialog = dialogStack.at(-1)?.element;
    parentDialog?.setAttribute('aria-hidden', 'true');
    parentDialog?.setAttribute('inert', '');
    dialogStack.push({ id: layerId, element: layer });
    if (firstDialog) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }

    let active = true;
    queueMicrotask(() => {
      if (!active || dialogStack.at(-1)?.id !== layerId) return;
      const preferred = initialFocusRefRef.current?.current ?? layer?.querySelector<HTMLElement>('[autofocus]');
      if (preferred) focusElement(preferred, showInitialFocusRing);
      if (layer && !layer.contains(document.activeElement)) focusElement(focusableElements(layer)[0] ?? layer, showInitialFocusRing);
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (dialogStack.at(-1)?.id !== layerId) return;
      if (event.key === 'Escape') {
        if (!dismissRef.current || dismissDisabledRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        dismissRef.current();
        return;
      }
      if (event.key !== 'Tab' || !layerRef.current) return;
      const focusable = focusableElements(layerRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        focusElement(layerRef.current, true);
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const containFocus = (event: FocusEvent) => {
      if (dialogStack.at(-1)?.id !== layerId || !layerRef.current || layerRef.current.contains(event.target as Node)) return;
      focusElement(initialFocusRefRef.current?.current ?? focusableElements(layerRef.current)[0] ?? layerRef.current, lastInteractionWasKeyboard);
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('focusin', containFocus);
    return () => {
      active = false;
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('focusin', containFocus);
      let stackIndex = -1;
      for (let index = dialogStack.length - 1; index >= 0; index -= 1) {
        if (dialogStack[index]?.id === layerId) { stackIndex = index; break; }
      }
      if (stackIndex >= 0) dialogStack.splice(stackIndex, 1);
      const revealedDialog = dialogStack.at(-1)?.element;
      revealedDialog?.removeAttribute('aria-hidden');
      revealedDialog?.removeAttribute('inert');
      if (dialogStack.length === 0) document.body.style.overflow = previousBodyOverflow;
      const explicitReturnTarget = returnFocusRefRef.current?.current;
      const returnFocusTo = explicitReturnTarget?.isConnected ? explicitReturnTarget : restoreFocusTo;
      if (restoreFocusRef.current && returnFocusTo?.isConnected) focusElement(returnFocusTo, false);
    };
  }, [layerId]);

  const layerClass = variant === 'panel' ? 'panel-layer' : 'modal-layer';
  return <div
    ref={layerRef}
    className={`dialog-layer ${layerClass}${variant === 'confirm' ? ' confirm-layer' : ''}`}
    role="presentation"
    tabIndex={-1}
    onMouseDown={(event) => {
      if (event.target === event.currentTarget && onDismiss && !dismissDisabled) onDismiss();
    }}
  >{children}</div>;
}
