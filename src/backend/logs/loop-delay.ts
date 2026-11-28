import { randomUUID } from "node:crypto";
import { monitorEventLoopDelay } from "node:perf_hooks";
import type { Clock } from "../../rules/time/clock.js";
import { emitOptionalDiagnostic } from "./debug-events.js";

export const EVENT_LOOP_STALL_THRESHOLD_MS = 200;
const STALL_EVENT_INTERVAL_MS = 10_000;
const SAMPLE_INTERVAL_MS = 1000;

export type LoopDelayMonitor = Readonly<{ stop(): void }>;

/** Omit the choice to run the production stall monitor. `false` leaves it off. A given monitor is used as-is. */
export function composeLoopDelayMonitor(
  choice: false | LoopDelayMonitor | undefined,
  deps: Parameters<typeof startLoopDelayMonitor>[0],
): LoopDelayMonitor {
  if (choice === false) return Object.freeze({ stop() {} });
  if (choice !== undefined) return choice;
  return startLoopDelayMonitor(deps);
}

export function startLoopDelayMonitor(deps: {
  readonly clock: Clock;
  readonly debugEvents: { emit(input: unknown): unknown };
}): LoopDelayMonitor {
  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  let lastEventAt = -Infinity;
  let omitted = 0;
  const timer = setInterval(() => {
    const durationMs = histogram.max / 1_000_000;
    histogram.reset();
    if (durationMs <= EVENT_LOOP_STALL_THRESHOLD_MS) return;
    const now = deps.clock.monotonicMs();
    if (now - lastEventAt < STALL_EVENT_INTERVAL_MS) return;
    const pendingOmissions = omitted;
    const result = emitOptionalDiagnostic(() => deps.debugEvents.emit({ category: "boot", phase: "settled", area: "event-loop",
      reason: "event-loop-stall", correlationId: randomUUID(), durationMs, ...(pendingOmissions > 0 ? { omitted: pendingOmissions } : {}) }),
    () => { omitted += pendingOmissions + 1; });
    omitted = result === "budget-full" ? pendingOmissions + 1 : 0;
    lastEventAt = now;
  }, SAMPLE_INTERVAL_MS);
  timer.unref();
  return Object.freeze({ stop() { clearInterval(timer); histogram.disable(); } });
}
