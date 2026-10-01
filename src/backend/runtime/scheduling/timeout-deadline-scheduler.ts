/**
 * The ONE real timer behind the kernel's `MonotonicDeadlineScheduler` port.
 *
 * It lived inside the worker composition root until D178, when the dashboard
 * process gained a second admitted-provider consumer (ref operator-trust §4.4's on-demand
 * advisory). Two composition roots needing the same timer is exactly the shape
 * that grows a second ad-hoc `setTimeout` — and a bound armed on one of those
 * is invisible to the kernel that is supposed to own it.
 *
 * It sits with runtime scheduling because it implements the kernel's timer port
 * for both worker and dashboard composition.
 */
import type { Clock } from "../../../domain/clock.js";
import type {
  MonotonicDeadlineHandle,
  MonotonicDeadlineScheduler,
} from "../deadline-scheduler.js";

export function createTimeoutDeadlineScheduler(clock: Clock): MonotonicDeadlineScheduler {
  return Object.freeze({
    schedule(deadlineMonotonicMs: number, onDeadline: () => void): MonotonicDeadlineHandle {
      const delayMs = Math.max(0, deadlineMonotonicMs - clock.monotonicMs());
      const handle = setTimeout(onDeadline, delayMs);
      return Object.freeze({
        cancel: (): void => {
          clearTimeout(handle);
        },
      });
    },
  });
}
