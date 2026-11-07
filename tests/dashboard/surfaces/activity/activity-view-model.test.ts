import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { ACTIVITY_SAMPLE_RANGE,activitySample } from "../../../../src/dashboard/surfaces/activity/activity-fixture.js";
import { activityCompletionRate,activityDuration } from "../../../../src/dashboard/surfaces/activity/activity-view-model.js";
describe("frontend presentation producers", () => {
  it("keeps new performance metrics scoped to finished and measured runs, with unknown distinct from zero", () => {
    assert.equal(activityCompletionRate(38, 40), "95%");
    assert.equal(activityCompletionRate(0, 0), "No finished runs");
    assert.equal(activityDuration(4643), "1h 17m");
    const missing = activitySample(ACTIVITY_SAMPLE_RANGE, "incomplete");
    const empty = activitySample(ACTIVITY_SAMPLE_RANGE, "empty");
    if (missing.state !== "loaded" || empty.state !== "loaded") throw new Error("samples must load");
    assert.equal(missing.report.duration.longestSeconds, null);
    assert.equal(missing.report.duration.totalSeconds, null);
    assert.equal(missing.report.failures, null);
    assert.equal(empty.report.duration.longestSeconds, null);
    assert.equal(empty.report.duration.totalSeconds, 0);
    assert.deepEqual(empty.report.failures, []);
    const today = activitySample({ from: "2026-09-26", to: "2026-09-26" }, "normal");
    if (today.state !== "loaded") throw new Error("today sample must load");
    assert.equal(activityCompletionRate(today.report.completed, today.report.terminal), "100%");
    assert.equal(today.report.duration.longestSeconds, 134);
    assert.equal(today.report.duration.totalSeconds, 536);
  });
});
