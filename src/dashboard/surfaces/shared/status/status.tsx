import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
import { cn } from "../../../lib/utils.js";
import { DS_STATUS, StatusPill } from "../../../ds/ui.js";
import type { QueueSurfaceWire, StepInterruptWire } from "../../../../models/dashboard/projection.js";
import {
  stepInterruptLabel,
  type QueueBusinessOutcome,
  type OutcomeWire,
  type ProposedStatus,
  type QueueStatus,
  type TerminalOutcomeResult,
} from "./status-model.js";

export type { OutcomeWire, ProposedStatus, QueueStatus, TerminalOutcomeResult };

/** the wire types, the wire→ds maps and the naming functions live in `status-model.ts` */


const RELAY_CANCELLATION = { logout: "RUN_LOGOUT_CANCELLED", "stale-queue": "RUN_STALE_QUEUE_CANCELLED" } as const;

/** The row-level status chip. A thin wrapper over the one ratified
 * `StatusPill` so a status can never be rendered two ways */
export function StatusBadge({
  status,
  label,
  age,
  hideIcon,
  presentation,
  outcome,
  pauseControl,
  cancelledBy,
  interrupt,
  meaning: servedMeaning,
}: {
  status: ProposedStatus;
  cancelledBy?: QueueSurfaceWire["cancelledBy"];
  pauseControl?: QueueSurfaceWire["pauseControl"];
  interrupt?: StepInterruptWire;
  /** The served reason for this exact status, overriding the general meaning. */
  meaning?: string;
  outcome?: QueueBusinessOutcome;
  label?: string;
  age?: string;
  hideIcon?: boolean;
  presentation?: "default" | "queue";
}) {
  const completedOutcome = (status === "verifiedDone" || status === "doneWarnings") ? outcome : undefined;
  const tone = completedOutcome ? DS_STATUS[completedOutcome.tone === "success" ? "verifiedDone" : completedOutcome.tone === "warning" ? "doneWarnings" : "cancelled"] : undefined;
  const pause = pauseControl?.state === "paused" ? "paused" : pauseControl?.state === "pause-pending" ? "requested" : undefined;
  const meaning = servedMeaning ?? (status === "cancelled" && cancelledBy !== undefined && cancelledBy !== "operator"
    ? ERROR_CATALOG[RELAY_CANCELLATION[cancelledBy]].text
    : pause === "paused" ? undefined : stepInterruptLabel(interrupt));
  return <StatusPill status={status} pause={pause} className={tone && cn(tone.chip, tone.text)} label={completedOutcome?.label ?? label} age={age} size="sm" hideIcon={pause === "paused" ? false : hideIcon} presentation={presentation}
    {...(meaning === undefined ? {} : { meaning })} />;
}
