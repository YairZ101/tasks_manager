const paths = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  inbox: <><path d="M4 4h16v16H4z"/><path d="M4 14h5l2 3h2l2-3h5"/></>,
  play: <path d="m9 7 8 5-8 5z"/>, pulse: <path d="M3 12h4l2-6 4 12 2-6h6"/>,
  alert: <><path d="M12 3 2.8 20h18.4z"/><path d="M12 9v4M12 17h.01"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  nodes: <><rect x="3" y="4" width="7" height="6" rx="1"/><rect x="14" y="14" width="7" height="6" rx="1"/><path d="M10 7h3a4 4 0 0 1 4 4v3"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a2 2 0 0 0 .4 2.2l.1.1-2.6 2.6-.1-.1a2 2 0 0 0-2.2-.4 2 2 0 0 0-1.2 1.8V21h-3.6v-.2A2 2 0 0 0 9 19a2 2 0 0 0-2.2.4l-.1.1-2.6-2.6.1-.1A2 2 0 0 0 4.6 15a2 2 0 0 0-1.8-1.2H2v-3.6h.8A2 2 0 0 0 4.6 9a2 2 0 0 0-.4-2.2l-.1-.1 2.6-2.6.1.1A2 2 0 0 0 9 4.6a2 2 0 0 0 1.2-1.8V2h3.6v.8A2 2 0 0 0 15 4.6a2 2 0 0 0 2.2-.4l.1-.1 2.6 2.6-.1.1a2 2 0 0 0-.4 2.2 2 2 0 0 0 1.8 1.2h.8v3.6h-.8A2 2 0 0 0 19.4 15Z"/></>,
  plus: <path d="M12 5v14M5 12h14"/>, close: <path d="m6 6 12 12M18 6 6 18"/>,
  save: <><path d="M5 3h12l3 3v15H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/></>, publish: <><path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 15v5h14v-5"/></>,
  arrow: <path d="m9 18 6-6-6-6"/>, back: <path d="m15 18-6-6 6-6"/>, edit: <><path d="m4 20 4.5-1 10-10-3.5-3.5-10 10z"/><path d="m13.5 7 3.5 3.5"/></>,
  lock: <><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
  stop: <rect x="6" y="6" width="12" height="12" rx="1"/>, branch: <><circle cx="6" cy="5" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10M8 12h4a6 6 0 0 0 6-3"/></>,
  history: <><path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6"/><path d="M4 4v4.6h4.6M12 8v4l3 2"/></>,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/></>,
  trash: <><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6"/></>,
  terminal: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/></>,
  question: <><path d="M9.7 9a2.5 2.5 0 1 1 3.7 2.2c-.9.5-1.4 1.2-1.4 2.3"/><path d="M12 17h.01"/></>,
  flag: <><path d="M5 21V4"/><path d="M5 5h11l-2 4 2 4H5"/></>,
  note: <><path d="M5 3h10l4 4v14H5z"/><path d="M15 3v5h4M8 12h8M8 16h6"/></>,
} satisfies Record<string, React.ReactNode>;

export type IconName = keyof typeof paths;
export type BlockIconType = 'begin' | 'agent' | 'check' | 'decision' | 'result' | 'note';

export const BLOCK_ICON_NAMES = {
  begin: 'play',
  agent: 'terminal',
  check: 'check',
  decision: 'question',
  result: 'flag',
  note: 'note',
} as const satisfies Record<BlockIconType, IconName>;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <svg aria-hidden="true" data-icon={name} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export function BlockIcon({ type, size = 18 }: { type: BlockIconType; size?: number }) {
  return <Icon name={BLOCK_ICON_NAMES[type]} size={size} />;
}

export function AppMark({ variant = 'default' }: { variant?: 'default' | 'large' | 'loading' }) {
  const className = variant === 'loading' ? 'boot-mark' : `brand-mark${variant === 'large' ? ' large' : ''}`;
  return <span className={className} aria-hidden="true">F</span>;
}
