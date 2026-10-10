
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { GateDecisionWireSchema } from "../../../../../src/models/dashboard/run-detail.js";
import {
  timelineAxisTotals,
  timelineHasOrphanGate,
  timelineSegmentUnmeasured,
} from "../../../../../src/dashboard/surfaces/run-detail/log-panel-model.js";

const GATE_ID = "e1b8ae3e-0000-4000-8000-0000000000a1";
const OPENED_AT = "2026-08-25T12:00:00.000Z";
const NOW = "2026-08-25T12:04:30.000Z";

const OPEN_GATE = GateDecisionWireSchema.parse({
  state: "open",
  gateId: GATE_ID,
  label: "Confirm this is the right person",
  openedAt: OPENED_AT,
  revision: 3,
});

const NO_GATE = GateDecisionWireSchema.parse({
  state: "absent",
  reason: "this run declares no gate",
});

const RESOLVED_GATE = GateDecisionWireSchema.parse({
  state: "resolved",
  gateId: GATE_ID,
  label: "Confirm this is the right person",
  resolution: "approved",
  resolvedBy: "julian",
  resolvedAt: NOW,
  revision: 4,
});

describe("the untimed segment dims only where a measurement is missing", () => {
  it("dims a segment that ran and recorded no duration", () => {
    for (const state of ["active", "done", "failed", "cancelled"] as const) {
      assert.equal(timelineSegmentUnmeasured(state, undefined), true, state);
    }
  });

  it("does not dim a measured segment", () => {
    assert.equal(timelineSegmentUnmeasured("done", 12), false);
    // Zero is a MEASUREMENT, not an absence: a step the executor timed at under
    // a second is not a step it failed to time.
    assert.equal(timelineSegmentUnmeasured("done", 0), false);
  });

  it("does not dim a state that already says why it has no duration", () => {

    assert.equal(timelineSegmentUnmeasured("pending", undefined), false);
    assert.equal(timelineSegmentUnmeasured("skipped", undefined), false);
    assert.equal(timelineSegmentUnmeasured("replayed", undefined), false);
    assert.equal(timelineSegmentUnmeasured("blocked", undefined), false);
  });
});

describe("an open gate that no segment carries still gets a segment", () => {
  it("reports the orphan when no segment records the wait", () => {
    assert.equal(timelineHasOrphanGate(["done", "done", "pending"], OPEN_GATE), true);
  });

  it("reports no orphan when a segment IS blocked", () => {
    assert.equal(timelineHasOrphanGate(["done", "blocked", "pending"], OPEN_GATE), false);
  });

  it("reports no orphan when there is no open gate", () => {
    assert.equal(timelineHasOrphanGate(["done", "done"], NO_GATE), false);
    assert.equal(timelineHasOrphanGate(["done", "done"], RESOLVED_GATE), false);
  });

  it("reports the orphan for a gated run with no segments at all", () => {

    assert.equal(timelineHasOrphanGate([], OPEN_GATE), true);
  });
});

describe("the axis names the working half and the waiting half", () => {
  it("sums the measured durations rather than spanning first to last", () => {
    const totals = timelineAxisTotals([4, 6, undefined, 2], NO_GATE, NOW);
    assert.equal(totals.workingSec, 12);
    assert.equal(totals.waitingSec, undefined);
  });

  it("reports no working time when NOTHING was measured", () => {
    // Not `0`. A run whose steps recorded no duration did not work for zero
    // seconds — nothing measured it, and the axis must be able to say so.
    const totals = timelineAxisTotals([undefined, undefined], NO_GATE, NOW);
    assert.equal(totals.workingSec, undefined);
  });

  it("reports no working time for a run with no segments", () => {
    assert.equal(timelineAxisTotals([], NO_GATE, NOW).workingSec, undefined);
  });

  it("carries the open gate's age against the served clock", () => {
    const totals = timelineAxisTotals([4], OPEN_GATE, NOW);
    assert.equal(totals.waitingSec, 270);
    assert.equal(totals.workingSec, 4);
  });

  it("carries no wait for a resolved or absent gate", () => {
    assert.equal(timelineAxisTotals([4], RESOLVED_GATE, NOW).waitingSec, undefined);
    assert.equal(timelineAxisTotals([4], NO_GATE, NOW).waitingSec, undefined);
  });
});
