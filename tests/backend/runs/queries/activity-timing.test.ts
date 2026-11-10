import { describe, expect, it } from "vitest";
import { activityTypicalTime, successfulActivityTiming } from "../../../../src/backend/runs/queries/activity-timing.js";

describe("workflow typical time", () => {
  it("averages measured successful roots, including zero, with explicit missing coverage", () => {
    const timing = successfulActivityTiming("fixture", [
      { workflowId: "fixture", status: "done", parentRunId: null, durationMs: 0 },
      { workflowId: "fixture", status: "done", parentRunId: null, durationMs: 1501 },
      { workflowId: "fixture", status: "done", parentRunId: null, durationMs: null },
      { workflowId: "fixture", status: "done", parentRunId: "parent", durationMs: 90000 },
      { workflowId: "fixture", status: "failed", parentRunId: null, durationMs: 90000 },
      { workflowId: "other", status: "done", parentRunId: null, durationMs: 90000 },
    ]);
    expect(timing).toEqual({ workflowId: "fixture", totalMs: 1501, measured: 2, unmeasured: 1 });
    expect(activityTypicalTime(timing)).toEqual({ measure: "successful-root-run-mean", measuredRuns: 2, unmeasuredRuns: 1,
      meanMs: { state: "present", value: 750.5 } });
  });

  it("keeps absent, unmeasured and a measured zero distinct", () => {
    for (const [rows, unmeasured] of [[[], 0], [[{ workflowId: "fixture", status: "done", parentRunId: null, durationMs: null }], 1]] as const) {
      expect(activityTypicalTime(successfulActivityTiming("fixture", rows))).toEqual({ measure: "successful-root-run-mean", measuredRuns: 0, unmeasuredRuns: unmeasured,
        meanMs: { state: "absent", reason: "no successful root run in range carries a duration" } });
    }
    expect(activityTypicalTime(successfulActivityTiming("fixture", [{ workflowId: "fixture", status: "done", parentRunId: null, durationMs: 0 }])).meanMs)
      .toEqual({ state: "present", value: 0 });
  });
});
