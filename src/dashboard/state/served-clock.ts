import { useEffect, useState } from "react";
import { systemClock } from "../../rules/time/clock.js";

/** One second: `fmtElapsed`'s smallest unit, so nothing finer would be visible. */
const SERVED_CLOCK_TICK_MS = 1000;

interface ServedClockOrigin {
  readonly instant: string;
  readonly monotonicMs: number;
}

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

/** Recalibrate on served instants and visibility so returning tabs cannot display throttled stale ages. */
export function useServedNow(servedInstant: string, tickMs: number = SERVED_CLOCK_TICK_MS): string {
  const [origin, setOrigin] = useState<ServedClockOrigin>(
    () => ({ instant: servedInstant, monotonicMs: systemClock.monotonicMs() }),
  );
  const [, setTick] = useState(0);

  const current = origin.instant === servedInstant
    ? origin : { instant: servedInstant, monotonicMs: systemClock.monotonicMs() };
  if (current !== origin) setOrigin(current);

  useEffect(() => {
    const advance = (): void => setTick((tick) => tick + 1);
    const handle = setInterval(advance, tickMs);
    document.addEventListener("visibilitychange", advance);
    return () => {
      clearInterval(handle);
      document.removeEventListener("visibilitychange", advance);
    };
  }, [tickMs]);

  return deriveServedNow(current.instant, systemClock.monotonicMs() - current.monotonicMs);
}
