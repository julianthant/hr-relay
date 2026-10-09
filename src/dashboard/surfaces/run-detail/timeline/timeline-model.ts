import { elapsedSecondsBetween, fmtElapsed } from "../../shared/status/format.js";
import type { RunDetailWireSchema } from "../../../../models/dashboard/run-detail.js";
import type { z } from "zod";

type RunDetailWire = z.infer<typeof RunDetailWireSchema>;

/* ── D273 item 2 — the timeline's two halves, its orphan wait, its dim ────── */

type RunGate = RunDetailWire["gate"];

/**
 * Every state a timeline SEGMENT can be in, whichever strip drew it — D225's
 * categorical steps and the read-forward per-event strip share one vocabulary,
 * so the three folds below are written once against the union rather than
 * twice against each half.
 */
export type TimelineSegmentState =
  | NonNullable<RunDetailWire["timeline"]["steps"]>[number]["state"]
  | RunDetailWire["timeline"]["events"][number]["state"];

/**
 * The states in which a segment ACTUALLY RAN, and therefore in which "no
 * duration" means the panel could not measure it.
 *
 * `pending` never ran, `skipped` was never started, and `replayed` deliberately
 * emitted no span of its own (D259) — each already says so with its own shape
 * and its own word, so dimming them would be a second cue for a fact that is
 * stated, not a missing measurement.
 */
const RAN_STATES: readonly TimelineSegmentState[] = ["active", "done", "failed", "cancelled"];

/**
 * The run-detail fidelity ruling (`994837d1f65abd9b9e2f546b3ca52bff90646583:docs/decisions/dashboard.md` §D273,
 * answered A on 2026-08-26; ledger 2 row B44) — the demo dims a segment it
 * could not measure (`DemoLogPanel.tsx:617`), so an unmeasured step is legible
 * as unmeasured rather than as one whose number happens to be missing.
 */
export function timelineSegmentUnmeasured(
  state: TimelineSegmentState,
  durationSec: number | undefined,
): boolean {
  return durationSec === undefined && RAN_STATES.includes(state);
}

/**
 * D273 item 2 (ledger 2 row B57) — THE ORPHAN WAIT.
 *
 * A run whose gate is open but whose segments record no `blocked` state has no
 * bar for the wait to ride, and the demo keeps a trailing segment precisely so
 * that a wait can never vanish because the shape did not line up: *"the one
 * thing this timeline may not do"* (`DemoLogPanel.tsx:687-705`). The wait is
 * served — `gate.openedAt` is right there — so its absence from the strip would
 * be the surface losing a fact it holds, which is the failure mode this repo's
 * fail-loud rule exists for.
 */
export function timelineHasOrphanGate(
  states: readonly TimelineSegmentState[],
  gate: RunGate,
): boolean {
  return gate.state === "open" && !states.includes("blocked");
}

/**
 * D273 item 2 (ledger 2 rows B60/B61) — the axis names BOTH halves.
 *
 * The segments are equal-width and make no duration claim, so this line is
 * where duration lives — and the demo names the WORKING half and the WAITING
 * half rather than one total (`DemoLogPanel.tsx:711-717`). The rebuild used to
 * print the first→last event SPAN under the word `elapsed`, which is a real
 * number about a different thing: a run parked for an hour after four seconds
 * of work reported an hour of work.
 *
 * `workingSec` is the SUM of the durations the executor actually measured, and
 * it is `undefined` when NOTHING was measured — a zero there would claim a run
 * did no work when the truth is that no span recorded any. `waitingSec` is the
 * open gate's age against the served clock (D256), so the panel and the queue
 * can never report two ages for one wait.
 */
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
