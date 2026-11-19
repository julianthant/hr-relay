import type { ReactNode } from "react";
import { Check, PanelsTopLeft } from "lucide-react";
import { Card } from "../../../ds/ui.js";
import { cn } from "../../../lib/utils.js";

/** The page card: icon, title and an optional mode word on the right. Rows go inside as children. */
export function PageCard({ title, mode, bare = false, children }: { title?: string; mode?: string; bare?: boolean; children: ReactNode }) {
  return <Card className={cn("overflow-hidden", bare && "px-3")}>
    {title && <div className="flex min-h-11 items-center gap-2.5 border-b border-ui-stroke px-3 py-2.5"><PanelsTopLeft aria-hidden className="size-4 shrink-0 text-ui-muted" /><h4 className="m-0 text-control font-medium">{title}</h4>{mode !== undefined && <span className="ml-auto text-caption text-ui-muted">{mode}</span>}</div>}
    {children}
  </Card>;
}

/** The read-result line at the foot of a page card. */
export function ResultLine({ label = "Read result", value }: { label?: string; value: string }) {
  return <div className="flex items-baseline justify-between gap-4 border-t border-ui-stroke px-3 py-3 text-body"><span className="inline-flex shrink-0 items-center gap-2.5 font-medium"><Check aria-hidden className="size-3.5 text-ui-muted" />{label}</span><strong className="min-w-0 text-right font-medium text-ui-primary text-balance">{value}</strong></div>;
}
