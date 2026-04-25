import { useState, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  label: string;
  children: ReactNode;
  className?: string;
}

export default function Tooltip({ label, children, className }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const triggerRef = useRef<HTMLSpanElement>(null);

  const show = () => {
    timeoutRef.current = setTimeout(() => {
      if (triggerRef.current) {
        const child = triggerRef.current.firstElementChild as HTMLElement | null;
        const el = child || triggerRef.current;
        const rect = el.getBoundingClientRect();
        setCoords({
          x: rect.left + rect.width / 2,
          y: rect.top,
        });
      }
      setVisible(true);
    }, 400);
  };

  const hide = () => {
    clearTimeout(timeoutRef.current);
    setVisible(false);
  };

  return (
    <span
      ref={triggerRef}
      className={`inline-flex ${className || ''}`}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {children}
      {visible &&
        createPortal(
          <span
            className="fixed px-2 py-1 text-[10px] font-medium text-text bg-bg-card border border-border rounded-md shadow-lg whitespace-nowrap z-[9999] animate-fade-in pointer-events-none"
            style={{
              left: coords.x,
              top: coords.y - 4,
              transform: 'translate(-50%, -100%)',
            }}
          >
            {label}
          </span>,
          document.body
        )}
    </span>
  );
}
