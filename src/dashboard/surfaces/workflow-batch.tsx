import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Button, dsBorder, dsFocus, dsIcon, dsRadius, dsSurface, dsText } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { fmtClock } from "./format.js";
import { statusAccessibleName, dsStatusOf } from "./status-model.js";
import type { QueueBatch } from "./queue-model.js";

export function WorkflowBatchGroup({ batch, label, selected, children, history, onGrouping }: {
  batch: QueueBatch;
  label: string;
  selected: string | undefined;
  children: ReactNode;
  history: ReactNode;
  onGrouping?: (batch: QueueBatch, grouped: boolean) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [collapsedSelection, setCollapsedSelection] = useState<string>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const open = expanded || (selected !== undefined && selected !== collapsedSelection);
  const counts = new Map<string, number>();
  for (const row of batch.members) {
    const status = statusAccessibleName(dsStatusOf(row.status));
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return (
    <section aria-label={`${label} batch`} className={cn("mx-[var(--ds-space-cozy)] mt-[var(--ds-space-base)] border", dsBorder.base, dsRadius.md, dsSurface.card)}>
      <div className="flex items-center gap-[var(--ds-space-snug)] p-[var(--ds-space-snug)]">
        <button type="button" aria-expanded={open} onClick={() => { setExpanded(!open); setCollapsedSelection(open ? selected : undefined); }} className={cn("flex min-w-0 flex-1 items-center gap-[var(--ds-space-snug)] text-left", dsFocus, dsText.ui)}>
          <ChevronDown aria-hidden className={cn(dsIcon.sm, !open && "-rotate-90")} />
          <span className="min-w-0 truncate font-semibold">{label} · {batch.members.length} {batch.members.length === 1 ? "item" : "items"}</span>
        </button>
        {onGrouping !== undefined && <Button size="sm" variant="ghost" disabled={pending} onClick={() => {
          setPending(true); setError(undefined);
          onGrouping(batch, false).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught))).finally(() => setPending(false));
        }}>{pending ? "Saving…" : "Show separately"}</Button>}
      </div>
      <p className={cn(dsText.meta, "px-[var(--ds-space-cozy)] pb-[var(--ds-space-snug)] text-[color:var(--ds-fg-muted)]")}>
        Started {fmtClock(batch.startedAt)} · {[...counts].map(([status, count]) => `${count} ${status}`).join(" · ")}
      </p>
      {error !== undefined && <p role="alert" className={cn(dsText.meta, "px-[var(--ds-space-cozy)] text-[color:var(--ds-danger)]")}>{error}</p>}
      {open && <div>{children}{batch.history.length > 0 && <details open={selected !== undefined || undefined} className="pb-[var(--ds-space-base)]"><summary className={cn(dsText.meta, dsFocus, "cursor-pointer px-[var(--ds-space-cozy)]")}>Previous attempts ({batch.history.length})</summary>{history}</details>}</div>}
    </section>
  );
}

export function GroupWorkflowBatchButton({ batch, onGrouping }: { batch: QueueBatch; onGrouping?: (batch: QueueBatch, grouped: boolean) => Promise<void> }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  if (onGrouping === undefined) return null;
  return <div className="mx-[var(--ds-space-cozy)] mt-[var(--ds-space-base)]">
    <Button size="sm" variant="ghost" disabled={pending} onClick={() => {
      setPending(true); setError(undefined);
      onGrouping(batch, true).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught))).finally(() => setPending(false));
    }}>{pending ? "Saving…" : `Group batch · ${batch.members.length} ${batch.members.length === 1 ? "item" : "items"}`}</Button>
    {error !== undefined && <p role="alert" className={cn(dsText.meta, "text-[color:var(--ds-danger)]")}>{error}</p>}
  </div>;
}
