import { TriangleAlert, X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils.js";
import { Button, IconButton } from "./primitives-core.js";

/** The one failure notice: a dark strip with a triangle, the first sentence on one line (full text on hover) and at most one secondary button. */
export function FailureNotice({ sentence, action, onDismiss, className }: {
  sentence: string;
  action?: { label: string; onClick: () => void; icon?: ReactNode; disabled?: boolean };
  /** Closes the notice in place. */
  onDismiss?: () => void;
  className?: string;
}) {
  const line = sentence.split(/(?<=[.!?])\s/u)[0] ?? sentence;
  return <div role="alert" className={cn("flex items-center gap-2.5 rounded-[10px] border border-ui-stroke bg-ui-panel px-3 py-2 text-[12px] leading-[18px] text-ui-secondary", className)}>
    <TriangleAlert aria-hidden width={14} height={14} className="shrink-0 text-ui-muted" />
    <span className="min-w-0 flex-1 truncate" title={sentence}>{line}</span>
    {action && <Button size="sm" variant="secondary" icon={action.icon} disabled={action.disabled} onClick={action.onClick} className="shrink-0">{action.label}</Button>}
    {onDismiss && <IconButton variant="ghost" size="sm" label="Dismiss" icon={<X aria-hidden width={14} height={14} />} onClick={onDismiss} className="shrink-0" />}
  </div>;
}
