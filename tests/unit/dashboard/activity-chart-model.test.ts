import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  ActivityVolumeSchema,
  buildActivityVolumeBoundarySkeleton,
  type ActivityVolume,
} from "../../../src/domain/dashboard/activity-volume.js";
import { createActivityVolumeChartModel } from "../../../src/dashboard/surfaces/activity/activity-chart-model.js";

function volumeForRange(
  from: string,
  to: string,
  runs: readonly number[] | ((index: number, count: number) => number) = () => 0,
  timeZone = "America/Los_Angeles",
): ActivityVolume {
  const skeleton = buildActivityVolumeBoundarySkeleton({ from, to }, timeZone);
  const buckets = skeleton.buckets.map((boundary, index) => ({
    ...boundary,
    runs: typeof runs === "function" ? runs(index, skeleton.buckets.length) : runs[index] ?? 0,
  }));
  return ActivityVolumeSchema.parse({
    state: "complete",
    ...skeleton,
    coveredRuns: buckets.reduce((total, bucket) => total + bucket.runs, 0),
    buckets,
  });
}

describe("Activity volume chart model", () => {
  it("keeps every authoritative interval while thinning labels at the two desktop widths", () => {
    const volume = volumeForRange("2026-08-01", "2026-08-31", (index) => index % 7);
    assert.equal(volume.granularity, "daily");
    assert.equal(volume.buckets.length, 31);

    // DsBodyScope caps the body at 828px: at the 1024px canvas the chart spans
    // that body; at 1440px it occupies the right third. The measured plot
    // widths exclude the y-axis rail and card insets.
    const at1024 = createActivityVolumeChartModel(volume, 776);
    const at1440 = createActivityVolumeChartModel(volume, 220);
    assert.equal(at1024.state, "complete");
    assert.equal(at1440.state, "complete");
    if (at1024.state !== "complete" || at1440.state !== "complete") return;

    assert.equal(at1024.buckets.length, 31);
    assert.equal(at1440.buckets.length, 31);
    assert.ok(at1024.buckets.filter((bucket) => bucket.showAxisLabel).length > at1440.buckets.filter((bucket) => bucket.showAxisLabel).length);
    assert.equal(at1024.buckets[0]?.showAxisLabel, true);
    assert.equal(at1024.buckets.at(-1)?.showAxisLabel, true);
    assert.equal(at1440.buckets[0]?.showAxisLabel, true);
    assert.equal(at1440.buckets.at(-1)?.showAxisLabel, true);
    assert.equal(at1440.title, "Daily volume");
    assert.equal(at1440.totalRuns, volume.coveredRuns);
    assert.ok(at1440.axisTicks.every((tick) => Number.isInteger(tick.value)));
  });

  it("keeps all seven formatted day labels when they fit and preserves both endpoints when they do not", () => {
    const oneWeek = volumeForRange("2026-09-20", "2026-09-26", (index) => index + 1);
    const fitted = createActivityVolumeChartModel(oneWeek, 640);
    const crowded = createActivityVolumeChartModel(oneWeek, 160);
    assert.equal(fitted.state, "complete");
    assert.equal(crowded.state, "complete");
    if (fitted.state !== "complete" || crowded.state !== "complete") return;

    assert.ok(fitted.buckets.every((bucket) => bucket.showAxisLabel));
    assert.ok(crowded.buckets.filter((bucket) => bucket.showAxisLabel).length < crowded.buckets.length);
    assert.equal(crowded.buckets[0]?.showAxisLabel, true);
    assert.equal(crowded.buckets.at(-1)?.showAxisLabel, true);
    assert.ok(fitted.buckets.every((bucket) => !bucket.axisLabel.includes("…")));
  });

  it("labels 14 clipped Sunday weeks, 13 months, and bounded multi-year intervals", () => {
    const weekly = createActivityVolumeChartModel(volumeForRange("2026-01-04", "2026-04-11"), 320);
    const monthly = createActivityVolumeChartModel(volumeForRange("2025-01-01", "2026-01-31"), 320);
    const yearly = createActivityVolumeChartModel(volumeForRange("2020-01-01", "2026-12-31"), 320);
    const groupedYears = createActivityVolumeChartModel(volumeForRange("1990-01-01", "2035-12-31"), 320);

    assert.equal(weekly.state, "complete");
    assert.equal(monthly.state, "complete");
    assert.equal(yearly.state, "complete");
    assert.equal(groupedYears.state, "complete");
    if (weekly.state !== "complete" || monthly.state !== "complete" || yearly.state !== "complete" || groupedYears.state !== "complete") return;

    assert.equal(weekly.granularity, "weekly");
    assert.equal(weekly.buckets.length, 14);
    assert.match(weekly.title, /Weekly/u);
    assert.equal(monthly.granularity, "monthly");
    assert.equal(monthly.buckets.length, 13);
    assert.match(monthly.title, /Monthly/u);
    assert.equal(yearly.granularity, "yearly");
    assert.equal(yearly.buckets.length, 7);
    assert.match(yearly.title, /Yearly/u);
    assert.ok(groupedYears.buckets.length <= 32);
    assert.equal(groupedYears.buckets[0]?.timeZone, "America/Los_Angeles");
  });

  it("distinguishes a complete known-empty series from a missing series", () => {
    const empty = createActivityVolumeChartModel(volumeForRange("2026-09-20", "2026-09-26"), 280);
    const missing = createActivityVolumeChartModel(undefined, 280);
    assert.equal(empty.state, "complete");
    assert.equal(missing.state, "unavailable");
    if (empty.state !== "complete") return;
    assert.equal(empty.empty, true);
    assert.equal(empty.totalRuns, 0);
    assert.equal(empty.buckets.length, 7);
    assert.ok(empty.buckets.every((bucket) => bucket.runs === 0 && bucket.barHeightPercent === 0));
    assert.match(empty.summary, /0 runs across 7 day intervals/u);
  });

  it("keeps zero, one, and large counts exact and uses integer ticks", () => {
    const one = createActivityVolumeChartModel(volumeForRange("2026-09-20", "2026-09-20", (index) => index === 0 ? 1 : 0), 280);
    const large = createActivityVolumeChartModel(volumeForRange("2026-09-20", "2026-09-20", (index) => index === 0 ? 1_234_567 : 0), 280);
    assert.equal(one.state, "complete");
    assert.equal(large.state, "complete");
    if (one.state !== "complete" || large.state !== "complete") return;
    assert.equal(one.totalRuns, 1);
    assert.equal(one.buckets[0]?.runs, 1);
    assert.equal(large.totalRuns, 1_234_567);
    assert.equal(large.buckets[0]?.runs, 1_234_567);
    assert.ok(large.axisTicks.every((tick) => Number.isInteger(tick.value)));
    assert.ok(large.axisMax >= 1_234_567);
  });

  it("uses top-origin plot coordinates for zero, one, non-round, and large values", () => {
    const cases = [
      volumeForRange("2026-09-20", "2026-09-20"),
      volumeForRange("2026-09-20", "2026-09-20", [1]),
      volumeForRange("2026-09-20", "2026-09-23", [0, 3, 9, 11]),
      volumeForRange("2026-09-20", "2026-09-22", [0, 3_000_000, 12_000_000]),
    ];

    for (const volume of cases) {
      const model = createActivityVolumeChartModel(volume, 280);
      assert.equal(model.state, "complete");
      if (model.state !== "complete") continue;

      const maximum = model.axisTicks.find((tick) => tick.value === model.axisMax);
      const zero = model.axisTicks.find((tick) => tick.value === 0);
      assert.equal(maximum?.topPercent, 0);
      assert.equal(zero?.topPercent, 100);
      assert.ok(model.axisTicks.every((tick, index, ticks) => index === 0 || tick.topPercent > (ticks[index - 1]?.topPercent ?? -1)));

      const barTopByRuns = new Map<number, number>();
      for (const bucket of model.buckets) {
        barTopByRuns.set(bucket.runs, 100 - bucket.barHeightPercent);
      }
      for (const tick of model.axisTicks) {
        const barTop = barTopByRuns.get(tick.value);
        if (barTop === undefined) continue;
        assert.equal(barTop, tick.topPercent);
      }
    }
  });

  it("uses concise inclusive labels and distinguishes repeated local hours", () => {
    const volume = volumeForRange("2026-11-01", "2026-11-01", (index) => index === 1 || index === 2 ? 1 : 0);
    const model = createActivityVolumeChartModel(volume, 280);
    assert.equal(model.state, "complete");
    if (model.state !== "complete") return;

    const repeatedHour = model.buckets.filter((bucket) => bucket.axisLabel.startsWith("1 AM"));
    assert.equal(repeatedHour.length, 2);
    assert.notEqual(repeatedHour[0]?.intervalStart, repeatedHour[1]?.intervalStart);
    assert.match(repeatedHour[0]?.axisLabel ?? "", /GMT-7/u);
    assert.match(repeatedHour[1]?.axisLabel ?? "", /GMT-8/u);
    assert.match(repeatedHour[0]?.accessibleLabel ?? "", /-07:00/u);
    assert.match(repeatedHour[1]?.accessibleLabel ?? "", /-08:00/u);
    assert.match(repeatedHour[0]?.accessibleLabel ?? "", /America\/Los_Angeles/u);
    assert.match(repeatedHour[0]?.accessibleLabel ?? "", /^Interval \[/u);
    assert.match(repeatedHour[0]?.accessibleLabel ?? "", /\) in America\/Los_Angeles:/u);
    assert.match(repeatedHour[0]?.intervalLabel ?? "", /1 AM/u);
    assert.match(repeatedHour[0]?.intervalLabel ?? "", /GMT-7/u);
    assert.match(repeatedHour[1]?.intervalLabel ?? "", /GMT-8/u);
    assert.doesNotMatch(repeatedHour[0]?.intervalLabel ?? "", /to before/u);

    const daily = createActivityVolumeChartModel(volumeForRange("2026-09-22", "2026-09-23"), 280);
    assert.equal(daily.state, "complete");
    if (daily.state === "complete") {
      assert.equal(daily.buckets[0]?.intervalLabel, "09/22/2026");
      assert.match(daily.buckets[0]?.accessibleLabel ?? "", /^Interval \[2026-09-22T00:00:00\.000-07:00, 2026-09-23T00:00:00\.000-07:00\) in America\/Los_Angeles: 0 runs$/u);
    }
  });
});
