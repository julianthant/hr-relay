import type { ReactNode } from 'react';
import type { StatusBucket, StatusCountWire } from '../shell/shell-model.js';

export function FocusQueueHeader({ children }: { children?: ReactNode; active: readonly StatusBucket[]; counts: readonly StatusCountWire[]; onFilter: (next: readonly StatusBucket[]) => void }) {
  return <div className="queue-filter-content">{children}</div>;
}
