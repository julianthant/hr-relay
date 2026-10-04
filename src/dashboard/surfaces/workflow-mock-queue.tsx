import { dsFocus } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { queueRowTitle, type QueueSurfaceWire } from "./queue-model.js";
import { StatusBadge } from "./status.js";
import { dsStatusOf } from "./status-model.js";

export function WorkflowMockQueue({ label, rows, selected, onSelect }: {
  label: string; rows: readonly QueueSurfaceWire[]; selected?: string; onSelect: (id: string) => void;
}) {
  return <section aria-label={`${label} queue`} className="min-h-0 flex-1 overflow-y-auto bg-ui-panel p-3">
    <h2 className="mb-1 mt-0 text-section font-medium">{label}</h2>
    <ul className="m-0 flex list-none flex-col gap-2 p-0">{rows.filter(row => row.lineage.state !== "child").map(row => <li key={row.runId}><button type="button"
      onClick={() => onSelect(row.runId)} aria-pressed={selected === row.runId}
      className={cn("flex w-full items-start justify-between gap-3 rounded-xl border border-ui-stroke bg-ui-table p-3 text-left hover:border-ui-stroke-control", dsFocus, selected === row.runId && "border-ui-info")}>
      <span className="min-w-0"><span className="block truncate text-body font-medium">{queueRowTitle(row)}</span><span className="mt-1 block text-caption text-ui-muted">{row.traceId}</span></span><StatusBadge status={dsStatusOf(row.status)} />
    </button></li>)}</ul>
    {rows.length === 0 && <p className="text-body text-ui-muted">No runs match this filter.</p>}
  </section>;
}
