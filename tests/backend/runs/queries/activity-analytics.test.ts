import { describe, expect, it } from "vitest";
import { failureStepOfTaskSpans } from "../../../../src/backend/runs/queries/activity-analytics.js";

const NO_FAILED_SPAN = "the failed run has no task span that records the step where it failed";

describe("failureStepOfTaskSpans", () => {
  it("selects the later offset instant when the timestamp text sorts the other way", () => {
    const step = failureStepOfTaskSpans([
      { attempt: 1, spanPath: "trace/early-step#1.1", name: "Earlier step", endedAt: "2026-10-01T12:00:00.000Z", outcome: "failed" },
      { attempt: 1, spanPath: "trace/later-step#1.1", name: "Later step", endedAt: "2026-10-01T08:00:00.000-07:00", outcome: "failed" },
    ], undefined);
    expect(step).toEqual({ state: "known", nodeId: "later-step", title: "Later step" });
  });

  it("keeps a run with no failed span unavailable and ignores a missing end", () => {
    expect(failureStepOfTaskSpans([
      { attempt: 1, spanPath: "trace/done-step#1.1", name: "Done step", endedAt: "2026-10-01T18:00:00.000Z", outcome: "done" },
    ], undefined)).toEqual({ state: "unavailable", reason: NO_FAILED_SPAN });
    expect(failureStepOfTaskSpans([
      { attempt: 1, spanPath: "trace/open-step#1.1", name: "Open step", outcome: "failed" },
      { attempt: 1, spanPath: "trace/closed-step#1.1", name: "Closed step", endedAt: "2026-10-01T12:00:00.000Z", outcome: "failed" },
    ], undefined)).toEqual({ state: "known", nodeId: "closed-step", title: "Closed step" });
  });
});
