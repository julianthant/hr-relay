import { RotateCw } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils.js";
import { Button } from "./primitives-core.js";
import { Banner } from "./primitives-layout.js";

/** The one failure notice: a plain sentence, what still works, then a single action beneath. */
export function FailureNotice({ sentence, stillWorks, action, className }: {
  sentence: string;
  stillWorks: string;
  action?: { label: string; onClick: () => void; icon?: ReactNode };
  className?: string;
}) {
  return <Banner tone="danger" className={className} title={<span>{sentence}</span>}>
    <span>{stillWorks}</span>
    {action && <div className={cn("mt-[var(--ds-space-base)] flex items-center")}>
      <Button variant="primary" icon={action.icon ?? <RotateCw aria-hidden width={14} height={14} />} onClick={action.onClick}>{action.label}</Button>
    </div>}
  </Banner>;
}
