import type { ReactNode } from 'react';

export function FocusQueueHeader({ children }: { children?: ReactNode }) {
  return <div className="queue-filter-content">{children}</div>;
}
