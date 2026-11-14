import type { ApplicationLifecycle } from "../../models/dashboard/application-lifecycle.js";
import { isClaimedRunState, type RunPause, type RunState } from "../../models/run/record.js";

/** The operator's pause or stop request on one run that has not yet taken effect. */
export type PendingInterrupt = "none" | "pause-requested" | "paused" | "stop-requested";

export type RunInterruptFacts = Readonly<{
  lifecycle: Readonly<{ state: RunState }>;
  pause?: Readonly<{ state: RunPause["state"] }>;
  cancelRequested?: true;
}>;

/** Which interrupt wins: a settled run has none, and stop beats pause. */
export function pendingInterruptOf(run: RunInterruptFacts): PendingInterrupt {
  if (run.lifecycle.state === "terminal") return "none";
  if (run.cancelRequested === true) return "stop-requested";
  if (run.pause?.state === "requested") return "pause-requested";
  return run.pause?.state === "paused" ? "paused" : "none";
}

export type InterruptEvent =
  | Readonly<{ kind: "pause" | "resume" | "stop" | "acknowledge-pause" }>
  | Readonly<{ kind: "lifecycle"; to: RunState }>;

export type InterruptRefusal = "settled" | "write-parked" | "stop-pending" | "not-paused" | "not-pause-requested" | "no-worker" | "pause-pending";

export type InterruptTransition =
  | Readonly<{ state: "applied"; interrupt: PendingInterrupt }>
  | Readonly<{ state: "refused"; reason: InterruptRefusal }>;

const applied = (interrupt: PendingInterrupt): InterruptTransition => ({ state: "applied", interrupt });
const refused = (reason: InterruptRefusal): InterruptTransition => ({ state: "refused", reason });

/**
 * The interrupt after an operator event (pause, resume, stop), the worker stopping at a step
 * boundary (acknowledge-pause) or a lifecycle change. Authorization stays with the writer.
 */
export function interruptTransition(run: RunInterruptFacts, event: InterruptEvent): InterruptTransition {
  const from = run.lifecycle.state;
  const pending = pendingInterruptOf(run);
  const claimed = isClaimedRunState(from);
  if (event.kind === "lifecycle") {
    if (event.to === "terminal") return applied("none");
    // A paused or pausing run is never claimed; a stop is settled by the worker that claims it.
    if (event.to === "claimed" && !claimed && (pending === "pause-requested" || pending === "paused")) return refused("pause-pending");
    const released = claimed && (event.to === "queued" || event.to === "parked-gate");
    return applied(released && pending === "pause-requested" ? "paused" : pending);
  }
  if (from === "terminal") return refused("settled");
  if (from === "parked-write") return refused("write-parked");
  if (event.kind === "stop") {
    // A queued run takes a stop request only as a delegation parent; the writer checks that.
    return claimed || from === "queued" || pending === "stop-requested" ? applied("stop-requested") : refused("no-worker");
  }
  if (pending === "stop-requested") return refused("stop-pending");
  switch (event.kind) {
    case "pause": return applied(pending !== "none" ? pending : claimed ? "pause-requested" : "paused");
    // Resume before a requested pause takes effect withdraws it.
    case "resume": return pending === "paused" || pending === "pause-requested" ? applied("none") : refused("not-paused");
    case "acknowledge-pause":
      // A worker that stopped for a pause Resume has since withdrawn releases the run with nothing pending.
      if (pending === "none" && claimed) return applied("none");
      if (pending !== "pause-requested") return refused("not-pause-requested");
      return claimed ? applied("paused") : refused("no-worker");
  }
}

/** The served application pause over the runs that can still take one: any unpaused run means running, then a pending pause means pause-pending. */
export function applicationPauseOf(runs: readonly RunInterruptFacts[]): ApplicationLifecycle["pause"] {
  const pausable = runs.filter(run => interruptTransition(run, { kind: "pause" }).state === "applied").map(pendingInterruptOf);
  if (pausable.length === 0 || pausable.includes("none")) return "running";
  return pausable.includes("pause-requested") ? "pause-pending" : "paused";
}

/** The served application state: a quit in progress wins, then a held admission reads as pausing. */
export function applicationStateOf(input: Readonly<{ quitting: boolean; admission: "open" | "draining" }>): ApplicationLifecycle["state"] {
  if (input.quitting) return "quitting";
  return input.admission === "open" ? "ready" : "pausing";
}
