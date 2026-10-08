/**
 * The dashboard's ONE live instant (D256, ref dashboard-surfaces §"Wave-2 connection-proof
 * presentation deltas").
 *
 * The defect these pin, measured on the Track C connection proof (separations
 * §9.22 item 2): the app derived every live elapsed from `boot.serverClock.now`
 * — the instant ONE bootstrap fetch carried — so a parked run read **`0s` for
 * over two minutes** (the tab had loaded before the run started, so the
 * difference was negative and the clamp made it a plausible zero), and a plain
 * reload made the same row jump to `2m 54s` and freeze there.
 *
 * This tree renders no React in the unit lane, so the hook's fold is exported
 * as a pure function and pinned here; the hook around it is three lines of
 * calibration that the parity lane executes for real.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { deriveServedNow } from "../../../../../src/dashboard/state/served-clock.js";
import { elapsedSecondsBetween, fmtActionClock, fmtClock, fmtElapsed, runTiming } from "../../../../../src/dashboard/surfaces/shared/status/format.js";
import { isTerminalQueueStatus } from "../../../../../src/models/dashboard/projection.js";

/** The proof's own numbers: the tab loaded at 15:03:32, the run started at 15:12:17. */
const BOOTSTRAP_INSTANT = "2026-08-20T15:03:32.000Z";
const RUN_STARTED = "2026-08-20T15:12:17.000Z";

describe("confirmed action timestamps", () => {
  it("distinguishes successive seconds in the operator's local clock", () => {
    const at = new Date(2026, 8, 30, 9, 31, 14);
    assert.equal(fmtActionClock(at.toISOString()), "09:31:14");
    assert.equal(fmtActionClock(new Date(at.getTime() + 1_000).toISOString()), "09:31:15");
    assert.equal(fmtClock(at.toISOString()), "9:31 AM");
  });

  it("keeps midnight and end-of-day readings unambiguous", () => {
    assert.equal(fmtActionClock(new Date(2026, 8, 30, 0, 0, 0).toISOString()), "00:00:00");
    assert.equal(fmtActionClock(new Date(2026, 8, 30, 23, 59, 59).toISOString()), "23:59:59");
  });

  it("refuses an invalid served instant", () => {
    assert.throws(() => fmtActionClock("after the click"), /fmtActionClock: not an ISO instant/u);
  });
});

const parkedRow = {
  status: "awaiting-approval",
  startedAt: RUN_STARTED,
  endedAt: { state: "absent", reason: "run is awaiting-approval and has not ended" },
} as const;

describe("the served clock (D256)", () => {
  it("is EXACTLY the served instant when no monotonic time has passed", () => {
    assert.equal(deriveServedNow(BOOTSTRAP_INSTANT, 0), "2026-08-20T15:03:32.000Z");
  });

  it("advances by the monotonic time since that instant arrived, never by a browser wall clock", () => {
    assert.equal(deriveServedNow(BOOTSTRAP_INSTANT, 1_000), "2026-08-20T15:03:33.000Z");
    assert.equal(deriveServedNow(BOOTSTRAP_INSTANT, 703_000), "2026-08-20T15:15:15.000Z");
  });

  it("refuses a monotonic interval that ran backwards rather than reporting a plausible instant", () => {
    assert.throws(() => deriveServedNow(BOOTSTRAP_INSTANT, -1), /may not run backwards/);
    assert.throws(() => deriveServedNow(BOOTSTRAP_INSTANT, Number.NaN), /monotonic interval/);
  });

  it("refuses a served instant it cannot parse", () => {
    assert.throws(() => deriveServedNow("shortly after lunch", 0), /not an ISO instant/);
  });

  /**
   * The whole defect in one case: the same row, on the same page, read through
   * a frozen clock and through a ticking one.
   */
  it("makes a run that started AFTER page load report its real age instead of 0s", () => {
    const frozen = runTiming(parkedRow, deriveServedNow(BOOTSTRAP_INSTANT, 0), isTerminalQueueStatus);
    // 15:03:32 + 11m 43s of ticking = 15:15:15, the instant the proof reloaded at.
    const ticking = runTiming(parkedRow, deriveServedNow(BOOTSTRAP_INSTANT, 703_000), isTerminalQueueStatus);
    assert.deepEqual(ticking, { text: "2m 58s" });
    // The frozen reading is what the proof saw, and it is no longer `0s`: an
    // elapsed measured backwards now SAYS so instead of wearing a zero.
    assert.deepEqual(frozen, { text: "-8m 45s" });
  });

  it("keeps a settled row's duration untouched as the clock ticks", () => {
    const settled = {
      status: "done",
      startedAt: RUN_STARTED,
      endedAt: { state: "present", value: "2026-08-20T15:20:37.000Z" },
    } as const;
    const early = runTiming(settled, deriveServedNow(BOOTSTRAP_INSTANT, 0), isTerminalQueueStatus);
    const late = runTiming(settled, deriveServedNow(BOOTSTRAP_INSTANT, 3_600_000), isTerminalQueueStatus);
    assert.deepEqual(early, { text: "8m 20s" });
    assert.deepEqual(late, early);
  });
});

describe("a backwards elapsed is drawn, not clamped (D256)", () => {
  it("returns the SIGNED interval so 'the clock is behind' cannot read as 'just now'", () => {
    assert.equal(elapsedSecondsBetween(RUN_STARTED, BOOTSTRAP_INSTANT), -525);
    assert.equal(elapsedSecondsBetween(BOOTSTRAP_INSTANT, RUN_STARTED), 525);
  });

  it("still renders a sub-second skew as 0s — this arm fires only on a real defect", () => {
    assert.equal(fmtElapsed(elapsedSecondsBetween("2026-08-20T15:00:00.400Z", "2026-08-20T15:00:00.000Z")), "0s");
  });

  it("spells a genuinely negative interval with its sign, at every magnitude", () => {
    assert.equal(fmtElapsed(-9), "-9s");
    assert.equal(fmtElapsed(-525), "-8m 45s");
    assert.equal(fmtElapsed(-7_260), "-2h 1m");
  });
});
