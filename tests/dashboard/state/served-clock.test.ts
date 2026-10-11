
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { deriveServedNow } from "../../../src/dashboard/state/served-clock.js";
import { runTiming } from "../../../src/dashboard/surfaces/shared/status/format.js";
import { isTerminalQueueStatus } from "../../../src/models/dashboard/projection.js";

/** The proof's own numbers: the tab loaded at 15:03:32, the run started at 15:12:17. */
const BOOTSTRAP_INSTANT = "2026-08-20T15:03:32.000Z";
const RUN_STARTED = "2026-08-20T15:12:17.000Z";

const parkedRow = {
  status: "awaiting-approval",
  startedAt: RUN_STARTED,
  endedAt: { state: "absent", reason: "run is awaiting-approval and has not ended" },
} as const;

describe("the served clock", () => {
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


  it("makes a run that started AFTER page load report its real age instead of 0s", () => {
    const frozen = runTiming(parkedRow, deriveServedNow(BOOTSTRAP_INSTANT, 0), isTerminalQueueStatus);
    // 15:03:32 + 11m 43s of ticking = 15:15:15, the instant the proof reloaded at.
    const ticking = runTiming(parkedRow, deriveServedNow(BOOTSTRAP_INSTANT, 703_000), isTerminalQueueStatus);
    assert.deepEqual(ticking, { text: "2m 58s" });

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
