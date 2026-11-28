import { StatusBadge } from "../shared/status/status.js";
import { dsStatusOf } from "../shared/status/status-model.js";
import { NEEDS_DUO_LABEL, NEEDS_DUO_MEANING, STARTING_LABEL, isNeedsDuo, isStarting, type QueueSurfaceWire } from "../queue/queue-model.js";
import { useContext } from "react";
import { OperatorLabelContext } from "../../state/operator-label.js";
import { FlaskConical } from "lucide-react";
import { cn } from "../../lib/utils.js";
import { dsIcon, dsText } from "../../ds/ui.js";

/** The one dry-run mark: the flask and "Dry run" in meta text. The queue row, the Logs header and the identity bar draw it. */
export function DryRunMark({ className, title = "Dry run — this rehearsal reads the systems and writes nothing." }: { className?: string; title?: string }) {
  return <span title={title}
    className={cn(dsText.meta, "inline-flex shrink-0 items-center gap-[var(--ds-space-tight)] text-[color:var(--ds-rehearsal-fg)]", className)}>
    <FlaskConical aria-hidden className={dsIcon.sm} />Dry run</span>;
}

/** "Started by the assistant for <operator> · read only", on a run an assistant command started; nothing otherwise. */
export function StartedByLine({ surface, className, wrap = false }: { surface: Pick<QueueSurfaceWire, "startedBy">; className?: string; wrap?: boolean }) {
  const operator = useContext(OperatorLabelContext);
  if (surface.startedBy === undefined) return null;
  const text = `Started by the assistant for ${operator}${surface.startedBy.readOnly ? " · read only" : ""}`;
  return <span data-started-by title={text} className={cn(dsText.meta, "min-w-0 text-[color:var(--ds-fg-muted)]", wrap ? "block break-words" : "truncate", className)}>{text}</span>;
}

/** The run's state in the panel header: a dry-run marker and the one status the queue row shows. */
export function RunStateChips({ row }: { row: QueueSurfaceWire }) {
  const status = dsStatusOf(row.status);
  return <>
    {row.dryRun && <DryRunMark />}
    <StatusBadge status={status} pauseControl={row.pauseControl} interrupt={row.interrupt} cancelledBy={row.cancelledBy} presentation="queue"
      {...(isNeedsDuo(row) ? { label: NEEDS_DUO_LABEL, meaning: NEEDS_DUO_MEANING } : isStarting(row) ? { label: STARTING_LABEL } : {})} />
  </>;
}
