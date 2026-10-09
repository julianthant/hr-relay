/**
 * The closed wire-status fold and its operator-facing words.
 *
 * This is browser-safe so a report caveat and the dashboard pills can share
 * one display vocabulary without making the domain contract import React.
 */
import type { z } from "zod";
import type { QueueStatusSchema } from "./projection.js";

type QueueStatus = z.infer<typeof QueueStatusSchema>;

type DisplayStatus =
  | "queued"
  | "running"
  | "cancelling"
  | "waiting"
  | "parked"
  | "verifiedDone"
  | "doneWarnings"
  | "failed"
  | "cancelled";

export const DISPLAY_STATUS_LABELS: Readonly<Record<DisplayStatus, string>> = Object.freeze({
  queued: "Queued",
  running: "Running",
  cancelling: "Cancelling",
  waiting: "Review",
  parked: "Write parked",
  verifiedDone: "Done",
  doneWarnings: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
});

const WIRE_TO_DISPLAY_STATUS: Readonly<Record<QueueStatus, DisplayStatus>> = Object.freeze({
  queued: "queued",
  running: "running",
  cancelling: "cancelling",
  blocked: "parked",
  "awaiting-approval": "waiting",
  done: "verifiedDone",
  failed: "failed",
  cancelled: "cancelled",
  partial: "doneWarnings",
});

export function displayStatusOf(status: QueueStatus): DisplayStatus {
  return WIRE_TO_DISPLAY_STATUS[status];
}

/**
 * The same closed vocabulary in sentence case. `waiting` keeps the operator's
 * established prose, while the parked arm keeps the pill's words in sentence
 * case. The exact pill label remains available from `DISPLAY_STATUS_LABELS`.
 */
export function displayStatusProseLabelOf(status: QueueStatus): string {
  switch (displayStatusOf(status)) {
    case "queued": return "queued";
    case "running": return "running";
    case "cancelling": return "cancelling";
    case "waiting": return "waiting on you";
    case "parked": return "write parked";
    case "verifiedDone": return "done";
    case "doneWarnings": return "done with warnings";
    case "failed": return "failed";
    case "cancelled": return "cancelled";
  }
}
