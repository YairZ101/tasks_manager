import type { ReactNode } from 'react';
import { useAppStore } from '../hooks/useTaskStore.js';

interface PageHeaderProps {
  title: string;
  description: string;
  titleId?: string;
  children?: ReactNode;
}

export default function PageHeader({ title, description, titleId, children }: PageHeaderProps) {
  const runner = useAppStore((state) => state.runner);
  const capacity = Math.min(1, runner.activeCount / Math.max(1, runner.maxConcurrent));

  return <header className="page-header">
    <div className="page-header-copy">
      <h1 id={titleId}>{title}</h1>
      <p>{description}</p>
    </div>
    <div className="page-header-actions">
      <span className="capacity"><i style={{ transform: `scaleX(${capacity})` }} />Capacity {runner.activeCount}/{runner.maxConcurrent}</span>
      {children}
    </div>
  </header>;
}
