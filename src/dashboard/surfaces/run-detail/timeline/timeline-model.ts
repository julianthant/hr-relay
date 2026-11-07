import { elapsedSecondsBetween, fmtElapsed } from "../../shared/status/format.js";
import type { RunDetailWireSchema } from "../../../../models/dashboard/run-detail.js";
import type { z } from "zod";

type RunDetailWire = z.infer<typeof RunDetailWireSchema>;

/** ── the timeline's two halves, its orphan wait, its dim ────── */

type RunGate = RunDetailWire["gate"];

export type TimelineSegmentState =
  | NonNullable<RunDetailWire["timeline"]["steps"]>[number]["state"]
  | RunDetailWire["timeline"]["events"][number]["state"];

// Missing duration means unmeasured only for segments that ran.
const RAN_STATES: readonly TimelineSegmentState[] = ["active", "done", "failed", "cancelled"];

/** an unmeasured segment is legible as unmeasured rather than as one whose number happens to be missing */
export function timelineSegmentUnmeasured(
  state: TimelineSegmentState,
  durationSec: number | undefined,
): boolean {
  return durationSec === undefined && RAN_STATES.includes(state);
}

export function timelineHasOrphanGate(
  states: readonly TimelineSegmentState[],
  gate: RunGate,
): boolean {
  return gate.state === "open" && !states.includes("blocked");
}

/** the axis names BOTH halves, because the equal-width segments make no duration claim */
export interface TimelineAxisTotals {
  /** The measured working time, or `undefined` when no segment was measured. */
  readonly workingSec: number | undefined;
  /** The open gate's age, or `undefined` when no gate is open. */
  readonly waitingSec: number | undefined;
}

export function timelineAxisTotals(
  durationsSec: readonly (number | undefined)[],
  gate: RunGate,
  nowIso: string,
): TimelineAxisTotals {
  const measured = durationsSec.filter((sec): sec is number => sec !== undefined);
  return {
    workingSec: measured.length === 0 ? undefined : measured.reduce((sum, sec) => sum + sec, 0),
    waitingSec: gate.state === "open" ? elapsedSecondsBetween(gate.openedAt, nowIso) : undefined,
  };
}

/** The age of the decision currently waiting on the operator. */
export function decisionAge(openedAt: string, nowIso: string): string {
  return fmtElapsed(elapsedSecondsBetween(openedAt, nowIso));
}
