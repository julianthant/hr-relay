import { StatusBadge } from "../shared/status/status.js";
import { dsStatusOf } from "../shared/status/status-model.js";
import { NEEDS_DUO_LABEL, NEEDS_DUO_MEANING, STARTING_LABEL, isNeedsDuo, isStarting, type QueueSurfaceWire } from "../queue/queue-model.js";
import { StartedByLine } from "../shared/status/started-by.js";
import { FlaskConical } from "lucide-react";
import { cn } from "../../lib/utils.js";
import { dsIcon, dsText } from "../../ds/ui.js";

/** The one dry-run mark: the flask and "Dry run" in meta text. The queue row, the Logs header and the identity bar draw it. */
export function DryRunMark({ className, title = "Dry run — this rehearsal reads the systems and writes nothing." }: { className?: string; title?: string }) {
  return <span title={title}
    className={cn(dsText.meta, "inline-flex shrink-0 items-center gap-[var(--ds-space-tight)] text-[color:var(--ds-rehearsal-fg)]", className)}>
    <FlaskConical aria-hidden className={dsIcon.sm} />Dry run</span>;
}

/** The run's state in the panel header: a dry-run marker and the one status the queue row shows. */
export function RunStateChips({ row }: { row: QueueSurfaceWire }) {
  const status = dsStatusOf(row.status);
  return <>
    {row.dryRun && <DryRunMark />}
    <StartedByLine surface={row} />
    <StatusBadge status={status} pauseControl={row.pauseControl} interrupt={row.interrupt} cancelledBy={row.cancelledBy} presentation="queue"
      {...(isNeedsDuo(row) ? { label: NEEDS_DUO_LABEL, meaning: NEEDS_DUO_MEANING } : isStarting(row) ? { label: STARTING_LABEL } : {})} />
  </>;
}
