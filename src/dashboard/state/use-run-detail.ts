/**
 * Opening a row: the small header, then only the selected panel section
 * (ref frontend-backend-integration §3.3/§7.4 — a terminal 50-person packet must not ship in the day
 * payload). Selection and section are client UI state; everything they fetch
 * is a finished server read model.
 */
import { useEffect, useState } from "react";
import type { RunDetailWire } from "../../models/dashboard/run-detail.js";
import { DashboardClientError } from "../client/index.js";
import { failed, IDLE, loaded, LOADING, type AsyncResource } from "./async-resource.js";
import { useDashboardClient } from "./client-context.js";

/**
 * How long a burst of day-stream revisions is allowed to settle before the
 * open panel re-reads (D257).
 *
 * A run's version moves on every heartbeat, node transition and rename, and
 * several can land inside one span-tail poll; refetching per envelope would
 * spend a detail read plus every section read on each. The window is short
 * enough that a status transition an operator is watching still arrives as
 * "immediately", and it is a coalescing window rather than a poll — nothing
 * fires while the run is not moving.
 */
export const RUN_DETAIL_FOLLOW_SETTLE_MS = 300;

/** What the panel is currently re-reading at: the run, and that run's adopted revision. */
export interface RunDetailFollowState {
  readonly runId: string | undefined;
  readonly revision: number | undefined;
}

/** `adopt` now, `settle` after the window, or `hold` — the three things a served revision can mean. */
export type RunDetailFollowStep =
  | { readonly action: "adopt"; readonly next: RunDetailFollowState }
  | { readonly action: "settle"; readonly next: RunDetailFollowState }
  | { readonly action: "hold" };

/**
 * What to do when the day stream serves a revision for the open run (D257).
 *
 * It tracks CHANGES to the served revision rather than comparing it against
 * the loaded detail's: a comparison would refetch in a loop for as long as the
 * two disagreed, and they legitimately can — the detail is read from authority
 * and the row from the projection, so one is routinely a beat ahead. A change
 * is a fact about the run moving, and it happens exactly as often as the run
 * moves.
 *
 * A run SWITCH adopts at once: the switch already refetches, so waiting out
 * the window would spend a second read on a run that was just read.
 */
export function planRunDetailFollow(
  current: RunDetailFollowState,
  runId: string | undefined,
  servedRowRevision: number | undefined,
): RunDetailFollowStep {
  if (current.runId !== runId) return { action: "adopt", next: { runId, revision: servedRowRevision } };
  if (current.revision === servedRowRevision) return { action: "hold" };
  return { action: "settle", next: { runId, revision: servedRowRevision } };
}

/**
 * The revision the fetch keys on, for a state that may lag a run switch by one
 * render.
 *
 * Reporting `undefined` during that render and the real value one render later
 * would move the fetch key TWICE for one open — two reads per opened run — so
 * the served value is reported directly until the state catches up.
 */
export function followedRunDetailRevision(
  current: RunDetailFollowState,
  runId: string | undefined,
  servedRowRevision: number | undefined,
): number | undefined {
  return current.runId === runId ? current.revision : servedRowRevision;
}

/**
 * The REVISION the panel re-reads at, debounced (D257). Seeding the state with
 * the first served value is what keeps the mount pass to exactly one fetch —
 * and, with it, keeps a parity capture to the single read it always made.
 */
function useSettledRevision(runId: string | undefined, servedRowRevision: number | undefined): number | undefined {
  const [settled, setSettled] = useState<RunDetailFollowState>(() => ({ runId, revision: servedRowRevision }));

  useEffect(() => {
    const step = planRunDetailFollow(settled, runId, servedRowRevision);
    if (step.action === "hold") return;
    if (step.action === "adopt") {
      setSettled(step.next);
      return;
    }
    const handle = setTimeout(() => setSettled(step.next), RUN_DETAIL_FOLLOW_SETTLE_MS);
    return () => clearTimeout(handle);
  }, [runId, servedRowRevision, settled]);

  return followedRunDetailRevision(settled, runId, servedRowRevision);
}

export function useRunDetail(
  runId: string | undefined,
  /** Bump to refetch the SAME run — an applied Data correction moved its version (2i-C). */
  reloadNonce = 0,
  /**
   * The revision the DAY STREAM currently serves for this run (D257). When it
   * moves, the run moved, and the panel re-reads itself — and, through the
   * refetched detail's own `rowRevision`, every section it had open. Undefined
   * for a run the open day does not hold: nothing to follow.
   */
  servedRowRevision?: number,
): AsyncResource<RunDetailWire> {
  const client = useDashboardClient();
  const [resource, setResource] = useState<AsyncResource<RunDetailWire>>(IDLE);
  const followedRevision = useSettledRevision(runId, servedRowRevision);

  useEffect(() => {
    if (runId === undefined) {
      setResource(IDLE);
      return;
    }
    let live = true;
    // A run that is ALREADY on screen keeps its last wire while the next one
    // is read: a panel that blanked to a spinner every time its run advanced
    // a node would be unreadable for exactly the runs worth watching. Opening
    // a different run still loads, because the panel beside a run it is not
    // about is the wrong answer, not a stale one.
    setResource((current) => (
      current.state === "loaded" && String(current.value.runId) === runId ? current : LOADING
    ));
    client.runDetail(runId).then(
      (value) => {
        if (live) setResource(loaded(value));
      },
      (error: unknown) => {
        if (!live) return;
        if (error instanceof DashboardClientError) {
          setResource(failed(error));
          return;
        }
        throw error;
      },
    );
    return () => {
      live = false;
    };
  }, [client, runId, reloadNonce, followedRevision]);

  return resource;
}
