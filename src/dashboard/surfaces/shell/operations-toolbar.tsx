import type { ReactNode } from 'react';
import { ActionBar, ActionBarRow } from '../../ds/ui.js';
import { cn } from '../../lib/utils.js';

export function OperationsToolbar({ label, title, icon, children, className }: { label: string; title?: string; icon?: ReactNode; children: ReactNode; className?: string }) {
 return <ActionBar className={cn("operations-toolbar ui-theme-scope mx-3 mt-3 border-ui-stroke bg-ui-panel font-ui text-ui-primary [--ds-control-bg:var(--ui-table)] [--ds-control-bg-hover:var(--ui-hover)] [--ds-control-fg:var(--ui-primary)] [--ds-border-strong:var(--ui-stroke-control)] [--ds-focus-ring:var(--ui-info)]", className)}>
  <OperationsToolbarRow label={label}>{title && <div className="flex shrink-0 items-center gap-2">{icon}<h2 className="m-0 text-control font-semibold">{title}</h2></div>}{children}</OperationsToolbarRow>
 </ActionBar>;
}

export function OperationsToolbarRow({ label, children }: { label: string; children: ReactNode }) {
 return <ActionBarRow label={label} className="h-[50px] min-h-[50px] gap-3 px-3 py-2">{children}</ActionBarRow>;
}
