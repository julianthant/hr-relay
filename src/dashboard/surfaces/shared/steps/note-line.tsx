import { useEffect, useRef } from "react";
import { Info } from "lucide-react";
import { cn } from "../../../lib/utils.js";

export type NoteTone = "positive" | "danger" | "info";

/** The note or check line. `announce` moves focus to the message when it appears. */
export function NoteLine({ message, tone, announce = false, announceKey }: { message: string; tone?: NoteTone; announce?: boolean; announceKey?: string }) {
  const target = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (announce) target.current?.focus(); }, [announceKey, announce]);
  return <div className={cn("grid grid-cols-[1rem_minmax(0,1fr)] items-baseline gap-3 py-1 text-body", tone === "positive" ? "text-ui-positive" : tone === "danger" ? "text-ui-danger" : tone === "info" ? "text-ui-info" : "text-ui-secondary")}><Info aria-hidden className="size-3.5 self-start translate-y-0.5 text-ui-muted" /><p ref={target} tabIndex={announce ? -1 : undefined} className="m-0 min-w-0 rounded-sm text-balance [overflow-wrap:break-word] focus-visible:outline-2 focus-visible:outline-ui-info">{message}</p></div>;
}
