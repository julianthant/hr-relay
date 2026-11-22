import { createContext, useContext, useSyncExternalStore } from "react";
import { systemClock } from "../../rules/time/clock.js";

/** One second: `formatDuration`'s smallest unit, so nothing finer would be visible. */
const SERVED_CLOCK_TICK_MS = 1000;

/** The instant a page derives from ONE served instant plus the monotonic time
 * since it arrived. */
export function deriveServedNow(servedInstant: string, sinceReceiptMs: number): string {
  const servedMs = Date.parse(servedInstant);
  if (Number.isNaN(servedMs)) {
    throw new Error(`deriveServedNow: not an ISO instant: ${servedInstant}`);
  }
  if (!Number.isFinite(sinceReceiptMs) || sinceReceiptMs < 0) {
    throw new Error(
      `deriveServedNow: ${String(sinceReceiptMs)}ms since receipt is not a monotonic interval; `
      + "a monotonic clock may not run backwards, so this names a substituted clock, not a slow one",
    );
  }
  return new Date(servedMs + sinceReceiptMs).toISOString();
}

export interface ServedClock {
  /** The instant right now; commands read it when they run. */
  readonly now: () => string;
  /** The instant of the last tick; stable between ticks so subscribers render it. */
  readonly current: () => string;
  /** One shared tick for every subscriber, plus a recalibration when the tab becomes visible again. */
  readonly subscribe: (listener: () => void) => () => void;
}

/** One clock per served instant; a new served instant needs a new clock. */
export function createServedClock(servedInstant: string, tickMs: number = SERVED_CLOCK_TICK_MS): ServedClock {
  const origin = systemClock.monotonicMs();
  const now = (): string => deriveServedNow(servedInstant, systemClock.monotonicMs() - origin);
  let current = now();
  const listeners = new Set<() => void>();
  let stop: (() => void) | undefined;
  const advance = (): void => {
    current = now();
    for (const listener of listeners) listener();
  };
  return {
    now,
    current: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      if (stop === undefined) {
        current = now();
        const handle = setInterval(advance, tickMs);
        document.addEventListener("visibilitychange", advance);
        stop = () => { clearInterval(handle); document.removeEventListener("visibilitychange", advance); };
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) { stop?.(); stop = undefined; }
      };
    },
  };
}

export const ServedClockContext = createContext<ServedClock | undefined>(undefined);

const NO_TICKS = (): (() => void) => () => {};

/** What `view` shows at the clock's instant (at `frozenIso` without a clock: tests, mocks). A tick re-renders only when
 * that value changes, so `view` returns a primitive: the text on screen, never a key for it. */
export function useClockView<T extends string | number | boolean | undefined>(clock: ServedClock | undefined, frozenIso: string, view: (nowIso: string) => T): T {
  const snapshot = (): T => view(clock?.current() ?? frozenIso);
  return useSyncExternalStore(clock?.subscribe ?? NO_TICKS, snapshot, snapshot);
}

/** For the small components that show an age or elapsed time: they tick, their parents do not. */
export function useServedView<T extends string | number | boolean | undefined>(frozenIso: string, view: (nowIso: string) => T): T {
  return useClockView(useContext(ServedClockContext), frozenIso, view);
}
