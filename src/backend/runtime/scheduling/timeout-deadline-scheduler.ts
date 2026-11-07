
import type { Clock } from "../../../rules/time/clock.js";
import type {
  MonotonicDeadlineHandle,
  MonotonicDeadlineScheduler,
} from "./deadline-scheduler.js";

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
