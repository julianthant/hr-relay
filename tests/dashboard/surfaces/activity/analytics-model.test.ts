import assert from "node:assert/strict";
import { it } from "vitest";
import { analyticsBuckets, analyticsPeriodLabel, shiftRange, type AnalyticsWorkflow } from "../../../../src/dashboard/surfaces/activity/analytics-model.js";

const workflow: AnalyticsWorkflow = { id: "w", label: "W", done: 3, failed: 1, attention: 0, typicalSeconds: 60, failedAt: [],
  days: [{ date: "2026-09-20", done: 2, failed: 0, attention: 0, seconds: 50 }, { date: "2026-09-22", done: 1, failed: 1, attention: 0, seconds: 70 }] };

it("buckets one bar per day, filling days the report has no row for", () => {
  const buckets = analyticsBuckets({ from: "2026-09-20", to: "2026-09-26" }, [workflow]);
  assert.deepEqual(buckets.map(bucket => bucket.label), ["Sun 20", "Mon 21", "Tue 22", "Wed 23", "Thu 24", "Fri 25", "Sat 26"]);
  assert.deepEqual(buckets.map(bucket => bucket.done + bucket.failed), [2, 0, 2, 0, 0, 0, 0]);
  assert.equal(buckets[2]?.date, "Sep 22, 2026");
});
it("groups a period longer than a month by week and moves whole periods", () => {
  const buckets = analyticsBuckets({ from: "2026-08-01", to: "2026-09-26" }, [workflow]);
  assert.equal(buckets.length, 9);
  assert.equal(buckets[0]?.date, "Aug 1 – 7, 2026");
  assert.deepEqual(shiftRange({ from: "2026-09-20", to: "2026-09-26" }, -1), { from: "2026-09-13", to: "2026-09-19" });
  assert.equal(analyticsPeriodLabel({ from: "2026-08-28", to: "2026-09-26" }), "Aug 28 – Sep 26, 2026");
});
