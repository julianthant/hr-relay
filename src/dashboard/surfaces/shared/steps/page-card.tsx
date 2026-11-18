import type { ReactNode } from "react";
import { GitBranch, PanelsTopLeft } from "lucide-react";
import { cn } from "../../../lib/utils.js";

/** The page card: icon, title and an optional mode word on the right. Rows go inside as children. */
export function PageCard({ title, mode, bare = false, children }: { title?: string; mode?: string; bare?: boolean; children: ReactNode }) {
  return <div className={cn("overflow-hidden rounded-lg border border-ui-stroke bg-ui-table", bare && "px-3")}>
    {title && <div className={cn("flex items-center gap-2.5 border-b border-ui-stroke px-3", mode === undefined ? "py-3" : "min-h-11 py-2.5")}><PanelsTopLeft aria-hidden className="size-4 shrink-0 text-ui-muted" /><h4 className="m-0 text-control font-medium">{title}</h4>{mode !== undefined && <span className="ml-auto text-caption text-ui-muted">{mode}</span>}</div>}
    {children}
  </div>;
}

/** The read-result line at the foot of a page card. */
export function ResultLine({ label = "Read result", value }: { label?: string; value: string }) {
  return <div className="flex items-baseline justify-between gap-4 border-t border-ui-stroke px-3 py-3 text-body"><span className="inline-flex shrink-0 items-center gap-2.5 font-medium"><GitBranch aria-hidden className="size-3.5 text-ui-info" />{label}</span><strong className="min-w-0 text-right font-semibold text-ui-positive text-balance">{value}</strong></div>;
}
