/**
 * The queue row's ONE time fact (D124, ref dashboard-surfaces §"as-built presentation
 * deltas"), extracted from `queue.tsx` so it is measured logic rather than
 * presentation.
 *
 * The defect this pins: the row computed `now − startedAt` for every status
 * except `queued`, so the Phase-1 live exit run — ~14.5 minutes of execution,
 * settled hours earlier — displayed **2h 47m** and kept growing. A finished
 * run must show what it TOOK.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { isTerminalQueueStatus } from "../../../../src/domain/dashboard/projection.js";
import { runTiming } from "../../../../src/dashboard/surfaces/format.js";

const STARTED = "2026-08-04T07:06:26.828Z";
/** The live exit run's real terminal instant: 14m 33s after it was enqueued. */
const ENDED = "2026-08-04T07:20:59.888Z";
/** The browser clock at the moment the defect was observed — 2h47m later. */
const MUCH_LATER = "2026-08-04T09:53:00.000Z";

const terminalRow = {
  status: "done",
  startedAt: STARTED,
  endedAt: { state: "present", value: ENDED },
} as const;

describe("queue row timing (D124)", () => {
  it("shows a settled run's DURATION, not the time since it started", () => {
    const timing = runTiming(terminalRow, MUCH_LATER, isTerminalQueueStatus);
    assert.deepEqual(timing, { text: "14m 33s" });
  });

  it("does not move as the browser clock advances past a terminal run", () => {
    const first = runTiming(terminalRow, ENDED, isTerminalQueueStatus);
    const hoursLater = runTiming(terminalRow, "2026-08-04T23:59:00.000Z", isTerminalQueueStatus);
    assert.deepEqual(first, hoursLater);
  });

  it("keeps live elapsed for a run that is genuinely still in flight", () => {
    const timing = runTiming(
      { status: "running", startedAt: STARTED, endedAt: { state: "absent", reason: "run is running and has not ended" } },
      "2026-08-04T07:07:26.828Z",
      isTerminalQueueStatus,
    );
    assert.deepEqual(timing, { text: "1m 0s" });
  });

  it("keeps counting for a parked run — blocked and awaiting-approval have not ended", () => {
    for (const status of ["blocked", "awaiting-approval"]) {
      const timing = runTiming(
        { status, startedAt: STARTED, endedAt: { state: "absent", reason: `run is ${status} and has not ended` } },
        "2026-08-04T07:08:26.828Z",
        isTerminalQueueStatus,
      );
      assert.deepEqual(timing, { text: "2m 0s" }, status);
    }
  });

  it("shows no timer at all for a run that has started nothing", () => {
    assert.equal(
      runTiming(
        { status: "queued", startedAt: STARTED, endedAt: { state: "absent", reason: "run is queued and has not ended" } },
        MUCH_LATER,
        isTerminalQueueStatus,
      ),
      undefined,
    );
  });

  it("renders an explicit unknown — never `now` — when a terminal row carries no end instant", () => {
    const timing = runTiming(
      {
        status: "failed",
        startedAt: STARTED,
        endedAt: { state: "absent", reason: "neither authority nor its run span recorded an end instant" },
      },
      MUCH_LATER,
      isTerminalQueueStatus,
    );
    assert.deepEqual(timing, {
      text: "duration unknown",
      title: "neither authority nor its run span recorded an end instant",
    });
  });

  it("refuses a status that is not part of the served queue vocabulary", () => {
    assert.throws(() => isTerminalQueueStatus("finished"));
  });
});
