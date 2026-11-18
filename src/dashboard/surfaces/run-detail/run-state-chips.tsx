import { StatusBadge } from "../shared/status/status.js";
import { dsStatusOf } from "../shared/status/status-model.js";
import { NEEDS_DUO_LABEL, NEEDS_DUO_MEANING, STARTING_LABEL, isNeedsDuo, isStarting, type QueueSurfaceWire } from "../queue/queue-model.js";
import { cn } from "../../lib/utils.js";
import { dsRadius, dsText } from "../../ds/ui.js";

/** The run's state in the panel header: a dry-run marker and the one status the queue row shows. */
export function RunStateChips({ row }: { row: QueueSurfaceWire }) {
  const status = dsStatusOf(row.status);
  return <>
    {row.dryRun && <span title="Dry run — this rehearsal reads the systems and writes nothing."
      className={cn("inline-flex h-[var(--ds-h-xs)] shrink-0 items-center border px-[var(--ds-space-snug)] tracking-[var(--ds-tracking-caps)]", dsRadius.sm, dsText.micro, dsText.caps, dsText.flush,
        "border-[color:var(--ds-rehearsal-border)] bg-[var(--ds-rehearsal-bg)] text-[color:var(--ds-rehearsal-fg)]")}>dry run</span>}
    <StatusBadge status={status} pauseControl={row.pauseControl} interrupt={row.interrupt} cancelledBy={row.cancelledBy} presentation="queue"
      {...(isNeedsDuo(row) ? { label: NEEDS_DUO_LABEL, meaning: NEEDS_DUO_MEANING } : isStarting(row) ? { label: STARTING_LABEL } : {})} />
  </>;
}
