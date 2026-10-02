/**
 * THE dashboard's live "now" (D256, ref dashboard-surfaces §"Wave-2 connection-proof
 * presentation deltas").
 *
 * ## What was wrong
 *
 * `useBootstrap` fetches once, and `boot.serverClock.now` — the instant that
 * ONE fetch carried — was the only value the queue row's in-flight timer, the
 * gate-age pill, the session footer and the worker cards computed against. So
 * every live elapsed on the screen was frozen at page load. The Track C
 * connection proof (separations §9.22 item 2) measured it: a parked run read
 * **`0s` for over two minutes** because the tab had loaded nine minutes BEFORE
 * the run started, so `bootstrapInstant − startedAt` was negative and the
 * clamp turned it into a plausible zero; a plain reload made the same row jump
 * to `2m 54s` and freeze again.
 *
 * ## The shape of the fix
 *
 * The SERVER's instant stays the authority — substituting the browser's wall
 * clock is exactly what D124 forbids, and a machine whose clock is minutes off
 * would then report a duration nobody can act on. What the browser contributes
 * is the one thing it is genuinely authoritative about: **how much time has
 * passed since that instant arrived**, read from the monotonic clock
 * (`systemClock.monotonicMs()`, ref clock-config-secrets's single source), which cannot be moved
 * by an NTP step or a user changing the system clock mid-run.
 *
 * So the page holds ONE calibration — `(servedInstant, monotonicMs at
 * receipt)` — and derives the current instant from it on a tick. One source,
 * one value, every consumer: `dashboard-app.tsx` calls this hook once and
 * passes the result down, exactly as it passed the frozen instant down before.
 * A component that read its own `Date.now()` would put a second clock on one
 * screen, which is how two chips come to disagree about one gate's age.
 *
 * ## Why ONE calibration is enough, and what would end that
 *
 * The BFF is a loopback singleton (`config/runtime-isolation.json` pins its
 * port; D181's `server` role lock admits one holder), so the server clock and
 * the browser's clock are the SAME machine's clock — there is no skew to
 * re-converge on, only the monotonic clock's own drift, which is immaterial at
 * the seconds granularity `fmtElapsed` renders. A re-calibration channel (a
 * server instant on the SSE `health` heartbeat) is therefore deliberately NOT
 * built here: it is a wire change with a server emitter and two fixture
 * emitters behind it, bought for a skew this deployment cannot have. **What
 * would buy it** is the BFF serving a browser it does not share a machine with
 * — ref frontend-backend-integration §6.9's deferred exposed path (D189). Add the field in the commit
 * that adds that, never before it.
 *
 * ## Determinism
 *
 * When no monotonic time has passed the derived instant is exactly the served
 * one, so a harness that freezes the monotonic clock before navigation renders
 * byte-identically to a page that never ticked. The parity lane does exactly
 * that (`tests/parity/helpers/app-driver.ts`, `installFrozenMonotonic`), and
 * it VERIFIES the freeze rather than assuming it — D187's rule.
 */
import { useEffect, useState } from "react";
import { systemClock } from "../../rules/time/clock.js";

/** One second: `fmtElapsed`'s smallest unit, so nothing finer would be visible. */
export const SERVED_CLOCK_TICK_MS = 1000;

interface ServedClockOrigin {
  /** the exact instant the server stated */
  readonly instant: string;
  /** the monotonic reading at the moment that instant reached this page */
  readonly monotonicMs: number;
}

/**
 * The instant a page derives from ONE served instant plus the monotonic time
 * since it arrived.
 *
 * Both refusals are loud on purpose. An unparseable served instant is a wire
 * defect, and a *negative* elapsed since receipt means the monotonic clock ran
 * backwards — which it may not do by definition, so it names a broken
 * substitute rather than a slow one. Neither may be absorbed into a plausible
 * number: the whole defect this closes was a wrong duration that read as a
 * right one.
 */
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

/**
 * The ONE live instant the whole dashboard reads (D256).
 *
 * Re-calibrates whenever a newly served instant arrives, and re-derives on a
 * tick, on tab visibility (a backgrounded tab's interval is throttled to about
 * once a minute, and an operator coming back to it must not read a minute-old
 * age), and on any re-render of the app it is called from.
 */
export function useServedNow(servedInstant: string, tickMs: number = SERVED_CLOCK_TICK_MS): string {
  const [origin, setOrigin] = useState<ServedClockOrigin>(
    () => ({ instant: servedInstant, monotonicMs: systemClock.monotonicMs() }),
  );
  const [, setTick] = useState(0);

  // The mount pass is a no-op by construction: the initializer already holds
  // this instant, so the updater returns the SAME object and React bails out
  // rather than re-seeding the calibration one render late.
  useEffect(() => {
    setOrigin((current) => (
      current.instant === servedInstant
        ? current
        : { instant: servedInstant, monotonicMs: systemClock.monotonicMs() }
    ));
  }, [servedInstant]);

  useEffect(() => {
    const advance = (): void => setTick((tick) => tick + 1);
    const handle = setInterval(advance, tickMs);
    document.addEventListener("visibilitychange", advance);
    return () => {
      clearInterval(handle);
      document.removeEventListener("visibilitychange", advance);
    };
  }, [tickMs]);

  return deriveServedNow(origin.instant, systemClock.monotonicMs() - origin.monotonicMs);
}
