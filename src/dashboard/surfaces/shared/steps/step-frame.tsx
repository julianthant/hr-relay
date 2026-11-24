import type { ReactNode, Ref } from "react";
import { Monitor } from "lucide-react";
import { cn } from "../../../lib/utils.js";

/** The step's left column, title and system. `leading` is the time in Logs or a step number elsewhere. */
export function StepFrame({ leading, title, system, titleId, titleRef, headerHidden = false, numbered = false, className, children, after }: {
  leading: ReactNode;
  title: string;
  system?: string;
  titleId: string;
  titleRef?: Ref<HTMLHeadingElement>;
  headerHidden?: boolean;
  /** Draws `leading` as a numbered circle instead of a timestamp. */
  numbered?: boolean;
  className?: string;
  children: ReactNode;
  after?: ReactNode;
}) {
  return <section aria-labelledby={titleId} className={cn("grid min-w-0 grid-cols-[var(--spacing-log-time)_minmax(0,1fr)] gap-x-3 border-ui-stroke py-5 first:pt-0", className)}>
    <time className={numbered
      ? "flex size-7 items-center justify-center rounded-full border border-ui-stroke bg-ui-panel text-caption tabular-nums text-ui-secondary"
      : cn("whitespace-nowrap text-caption tabular-nums text-ui-muted", headerHidden ? "pt-4" : "pt-0.5")}>{leading}</time>
    <div className="min-w-0">
      <header className={headerHidden ? "sr-only" : "mb-4 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1"}><h3 id={titleId} ref={titleRef} tabIndex={-1} className="m-0 rounded-sm text-heading focus:outline-2 focus:outline-offset-4 focus:outline-ui-info">{title}</h3>{system && <span className={cn("border-l border-ui-stroke pl-3 text-body text-ui-muted", numbered && "flex items-center gap-1.5")}>{numbered && <Monitor aria-hidden className="size-3.5" />}{system}</span>}</header>
      <div className="flex min-w-0 flex-col gap-3">{children}</div>
    </div>
    {after}
  </section>;
}
