import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { runtimeTimeZone } from "../../../src/domain/clock.js";
import { ServerClockWireSchema } from "../../../src/domain/dashboard/bootstrap.js";
import { ActivityReportWireSchema } from "../../../src/domain/dashboard/activity.js";
import { ActivityReportSelectionSchema } from "../../../src/domain/dashboard/activity-selection.js";
import {
  ACTIVITY_VOLUME_MAX_YEAR_BUCKETS,
  ActivityVolumeSchema,
  activityDatePartAtInstant,
  buildActivityVolumeBoundarySkeleton,
  chooseActivityVolumeGranularity,
} from "../../../src/domain/dashboard/activity-volume.js";
type ActivityVolumeBoundarySkeleton = ReturnType<typeof buildActivityVolumeBoundarySkeleton>;

const utc = "UTC";

function shiftedDay(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function withCounts(skeleton: ActivityVolumeBoundarySkeleton, counts: readonly number[] = []) {
  return {
    state: "complete",
    ...skeleton,
    coveredRuns: counts.reduce((total, count) => total + count, 0),
    buckets: skeleton.buckets.map((bucket, index) => ({ ...bucket, runs: counts[index] ?? 0 })),
  };
}

function emptyReport() {
  return {
    wireVersion: 1,
    from: "2026-09-08",
    to: "2026-09-08",
    generatedAt: "2026-09-08T12:00:00.000Z",
    totalRuns: 0,
    terminalRuns: 0,
    inFlightRuns: 0,
    people: { state: "present", distinct: 0, evidenceRows: 0 },
    completion: { readBack: 0, warnings: 0, warningsUnknown: 0 },
    days: [],
    workflows: [],
    categories: [],
    statuses: [],
    outcomes: [],
    failures: [],
    durations: {
      measuredRuns: 0,
      unmeasuredRuns: 0,
      medianMs: { state: "absent", reason: "no measured runs" },
      longestMs: { state: "absent", reason: "no measured runs" },
      totalMs: 0,
    },
    ledger: { systems: [] },
  };
}

describe("Activity volume range policy and boundary skeleton", () => {
  it("selects each shared granularity exactly at its inclusive-day threshold", () => {
    const end = "2026-09-26";
    const cases = [
      [1, "hourly"], [2, "daily"], [31, "daily"], [32, "weekly"],
      [180, "weekly"], [181, "monthly"], [730, "monthly"], [731, "yearly"],
    ] as const;

    for (const [days, expected] of cases) {
      const from = shiftedDay(end, -(days - 1));
      assert.equal(chooseActivityVolumeGranularity({ from, to: end }).kind, expected, `${days} inclusive days`);
      assert.equal(buildActivityVolumeBoundarySkeleton({ from, to: end }, utc).granularity, expected, `${days} inclusive days`);
    }
  });

  it("clips Sunday-aligned weekly, calendar-month, and calendar-year intervals to selected dates", () => {
    const weekly = buildActivityVolumeBoundarySkeleton({ from: "2026-08-26", to: "2026-09-26" }, utc);
    assert.equal(weekly.granularity, "weekly");
    assert.deepEqual(weekly.buckets.map(({ start, endExclusive }) => [start, endExclusive]), [
      ["2026-08-26T00:00:00.000+00:00", "2026-08-30T00:00:00.000+00:00"],
      ["2026-08-30T00:00:00.000+00:00", "2026-09-06T00:00:00.000+00:00"],
      ["2026-09-06T00:00:00.000+00:00", "2026-09-13T00:00:00.000+00:00"],
      ["2026-09-13T00:00:00.000+00:00", "2026-09-20T00:00:00.000+00:00"],
      ["2026-09-20T00:00:00.000+00:00", "2026-09-27T00:00:00.000+00:00"],
    ]);

    const monthly = buildActivityVolumeBoundarySkeleton({ from: "2026-03-30", to: "2026-09-26" }, utc);
    assert.equal(monthly.granularity, "monthly");
    assert.deepEqual(monthly.buckets.map(({ start, endExclusive }) => [start.slice(0, 10), endExclusive.slice(0, 10)]), [
      ["2026-03-30", "2026-04-01"], ["2026-04-01", "2026-05-01"],
      ["2026-05-01", "2026-06-01"], ["2026-06-01", "2026-07-01"],
      ["2026-07-01", "2026-08-01"], ["2026-08-01", "2026-09-01"],
      ["2026-09-01", "2026-09-27"],
    ]);

    const yearly = buildActivityVolumeBoundarySkeleton({ from: "2024-06-15", to: "2026-09-26" }, utc);
    assert.equal(yearly.granularity, "yearly");
    assert.deepEqual(yearly.buckets.map(({ start, endExclusive }) => [start.slice(0, 10), endExclusive.slice(0, 10)]), [
      ["2024-06-15", "2025-01-01"], ["2025-01-01", "2026-01-01"], ["2026-01-01", "2026-09-27"],
    ]);
  });

  it("returns 23 real hourly buckets across the spring DST jump", () => {
    const skeleton = buildActivityVolumeBoundarySkeleton({ from: "2026-03-08", to: "2026-03-08" }, "America/Los_Angeles");

    assert.equal(skeleton.granularity, "hourly");
    assert.equal(skeleton.buckets.length, 23);
    assert.equal(skeleton.interval.start, "2026-03-08T00:00:00.000-08:00");
    assert.equal(skeleton.interval.endExclusive, "2026-03-09T00:00:00.000-07:00");
    assert.ok(skeleton.buckets.some(({ start }) => start === "2026-03-08T01:00:00.000-08:00"));
    assert.ok(skeleton.buckets.some(({ start }) => start === "2026-03-08T03:00:00.000-07:00"));
    assert.ok(!skeleton.buckets.some(({ start }) => start.startsWith("2026-03-08T02:")));
  });

  it("returns 25 real hourly buckets with both distinct fall-back 1 AM starts", () => {
    const skeleton = buildActivityVolumeBoundarySkeleton({ from: "2026-11-01", to: "2026-11-01" }, "America/Los_Angeles");
    const repeatedHours = skeleton.buckets.filter(({ start }) => start.startsWith("2026-11-01T01:00:00"));

    assert.equal(skeleton.buckets.length, 25);
    assert.deepEqual(repeatedHours.map(({ start }) => start), [
      "2026-11-01T01:00:00.000-07:00",
      "2026-11-01T01:00:00.000-08:00",
    ]);
    assert.notEqual(Date.parse(repeatedHours[0]?.start ?? ""), Date.parse(repeatedHours[1]?.start ?? ""));
  });

  it("covers leap day and midnight without fixed-duration calendar-day arithmetic", () => {
    const skeleton = buildActivityVolumeBoundarySkeleton({ from: "2024-02-28", to: "2024-03-01" }, utc);

    assert.deepEqual(skeleton.buckets.map(({ start, endExclusive }) => [start.slice(0, 10), endExclusive.slice(0, 10)]), [
      ["2024-02-28", "2024-02-29"],
      ["2024-02-29", "2024-03-01"],
      ["2024-03-01", "2024-03-02"],
    ]);

    const yearZeroLeapDay = buildActivityVolumeBoundarySkeleton({ from: "0000-02-29", to: "0000-02-29" }, utc);
    assert.equal(yearZeroLeapDay.interval.start, "0000-02-29T00:00:00.000+00:00");
    assert.equal(yearZeroLeapDay.interval.endExclusive, "0000-03-01T00:00:00.000+00:00");
  });

  it("keeps yearly spans at or below 32 buckets, including the full supported date range", () => {
    const policy = chooseActivityVolumeGranularity({ from: "0001-01-01", to: "9999-12-31" });
    const skeleton = buildActivityVolumeBoundarySkeleton({ from: "0001-01-01", to: "9999-12-31" }, utc);

    assert.equal(policy.kind, "yearly");
    if (policy.kind !== "yearly") throw new Error("expected yearly policy");
    assert.equal(policy.yearsPerBucket, 313);
    assert.equal(skeleton.granularity, "yearly");
    assert.ok(skeleton.buckets.length <= ACTIVITY_VOLUME_MAX_YEAR_BUCKETS);
    assert.equal(skeleton.interval.start, "0001-01-01T00:00:00.000+00:00");
    assert.equal(skeleton.interval.endExclusive, "+010000-01-01T00:00:00.000+00:00");
    assert.equal(ActivityVolumeSchema.safeParse(withCounts(skeleton, skeleton.buckets.map(() => 0))).success, true);

    const localZone = buildActivityVolumeBoundarySkeleton({ from: "0001-01-01", to: "9999-12-31" }, "America/Los_Angeles");
    assert.ok(localZone.buckets.length <= ACTIVITY_VOLUME_MAX_YEAR_BUCKETS);
    assert.equal(activityDatePartAtInstant(localZone.interval.start, "America/Los_Angeles"), "0001-01-01");
    assert.equal(activityDatePartAtInstant(localZone.interval.endExclusive, "America/Los_Angeles"), "+010000-01-01");
    assert.equal(ActivityVolumeSchema.safeParse(withCounts(localZone, localZone.buckets.map(() => 0))).success, true);
  });

  it("uses contiguous clipped instant boundaries for every granularity", () => {
    const ranges = [
      { from: "2026-03-08", to: "2026-03-08", timeZone: "America/Los_Angeles" },
      { from: "2026-08-26", to: "2026-09-26", timeZone: "America/Los_Angeles" },
      { from: "2026-03-30", to: "2026-09-26", timeZone: utc },
      { from: "2024-06-15", to: "2026-09-26", timeZone: utc },
    ];

    for (const range of ranges) {
      const skeleton = buildActivityVolumeBoundarySkeleton(range, range.timeZone);
      assert.equal(skeleton.buckets[0]?.start, skeleton.interval.start);
      for (let index = 1; index < skeleton.buckets.length; index += 1) {
        assert.equal(skeleton.buckets[index]?.start, skeleton.buckets[index - 1]?.endExclusive);
      }
      assert.equal(skeleton.buckets.at(-1)?.endExclusive, skeleton.interval.endExclusive);
      const coveredMilliseconds = skeleton.buckets.reduce((total, bucket) =>
        total + Date.parse(bucket.endExclusive) - Date.parse(bucket.start), 0);
      assert.equal(coveredMilliseconds, Date.parse(skeleton.interval.endExclusive) - Date.parse(skeleton.interval.start));
    }
  });

  it("returns the report-calendar date at an instant and refuses invalid instants or zones", () => {
    assert.equal(activityDatePartAtInstant("2026-09-26T06:30:00.000Z", "America/Los_Angeles"), "2026-09-25");
    assert.throws(() => activityDatePartAtInstant("not-an-instant", utc), /activityDatePartAtInstant: instant/u);
    assert.throws(() => activityDatePartAtInstant("2026-09-26T06:30:00.000Z", "Mars/Olympus"), /activityDatePartAtInstant: invalid IANA/u);
  });

  it("shares the runtime's resolved IANA zone with the bootstrap clock contract", () => {
    const timeZone = runtimeTimeZone();
    assert.equal(timeZone, new Intl.DateTimeFormat().resolvedOptions().timeZone);
    assert.equal(ServerClockWireSchema.safeParse({ now: "2026-09-26T06:30:00.000Z", zone: timeZone }).success, true);
    assert.equal(ServerClockWireSchema.safeParse({ now: "2026-09-26T06:30:00.000Z", zone: "Mars/Olympus" }).success, false);
  });

  it("refuses malformed, reversed, invalid-zone, and nonexistent local-date ranges by named errors", () => {
    for (const range of [
      { from: "2026-02-30", to: "2026-03-01" },
      { from: "2026-09-10", to: "2026-09-08" },
      { from: "+010000-01-01", to: "+010000-01-02" },
    ]) {
      assert.throws(() => chooseActivityVolumeGranularity(range), /chooseActivityVolumeGranularity: range/u);
    }
    assert.throws(
      () => buildActivityVolumeBoundarySkeleton({ from: "2026-09-08", to: "2026-09-08" }, "Mars/Olympus"),
      /buildActivityVolumeBoundarySkeleton: invalid IANA/u,
    );
    assert.throws(
      () => buildActivityVolumeBoundarySkeleton({ from: "2011-12-30", to: "2011-12-30" }, "Pacific/Apia"),
      /local calendar date 2011-12-30 does not exist/u,
    );
  });
});

describe("Activity volume strict series and selection contract", () => {
  it("requires ordered, contiguous bucket coverage and exact count conservation", () => {
    const skeleton = buildActivityVolumeBoundarySkeleton({ from: "2026-09-08", to: "2026-09-09" }, utc);
    const complete = withCounts(skeleton, [2, 1]);

    assert.deepEqual(ActivityVolumeSchema.parse(complete).coveredRuns, 3);
    assert.equal(ActivityVolumeSchema.safeParse({ ...complete, extra: true }).success, false);
    assert.equal(ActivityVolumeSchema.safeParse({ ...complete, coveredRuns: 2 }).success, false);
    assert.equal(ActivityVolumeSchema.safeParse({
      ...complete,
      buckets: [complete.buckets[0], { ...complete.buckets[1], start: "2026-09-09T00:00:00.001+00:00" }],
    }).success, false);

    const intervalStart = Date.parse(complete.interval.start);
    const intervalEnd = Date.parse(complete.interval.endExclusive);
    const tooManyBuckets = Array.from({ length: ACTIVITY_VOLUME_MAX_YEAR_BUCKETS + 1 }, (_, index) => ({
      start: new Date(intervalStart + Math.floor((intervalEnd - intervalStart) * index / (ACTIVITY_VOLUME_MAX_YEAR_BUCKETS + 1))).toISOString(),
      endExclusive: new Date(intervalStart + Math.floor((intervalEnd - intervalStart) * (index + 1) / (ACTIVITY_VOLUME_MAX_YEAR_BUCKETS + 1))).toISOString(),
      runs: 0,
    }));
    assert.equal(ActivityVolumeSchema.safeParse({ ...complete, buckets: tooManyBuckets, coveredRuns: 0 }).success, false);
  });

  it("keeps legacy wire parsing optional while matching a present volume to report totals and range policy", () => {
    const legacy = emptyReport();
    assert.equal(ActivityReportWireSchema.safeParse(legacy).success, true);

    const skeleton = buildActivityVolumeBoundarySkeleton({ from: legacy.from, to: legacy.to }, utc);
    const volume = withCounts(skeleton, [0]);
    assert.equal(ActivityReportWireSchema.safeParse({ ...legacy, volume }).success, true);
    assert.equal(ActivityReportWireSchema.safeParse({ ...legacy, volume, totalRuns: 1 }).success, false);
    assert.equal(ActivityReportWireSchema.safeParse({ ...legacy, volume: { ...volume, granularity: "daily" } }).success, false);
  });

  it("refuses a report selection without its complete volume series", () => {
    const report = emptyReport();
    const snapshot = {
      from: report.from,
      to: report.to,
      generatedAt: report.generatedAt,
      expiresAt: "2026-09-08T12:15:00.000Z",
      sourceIdentity: "a".repeat(64),
      authorityGeneration: 1,
      reportDigest: "b".repeat(64),
      token: "as1.fixture.signature",
    };

    const withoutVolume = ActivityReportSelectionSchema.safeParse({ ...report, snapshot });
    assert.equal(withoutVolume.success, false);
    if (!withoutVolume.success) assert.ok(withoutVolume.error.issues.some((issue) => issue.path[0] === "volume"));

    const volume = withCounts(buildActivityVolumeBoundarySkeleton({ from: report.from, to: report.to }, utc), [0]);
    const reviewed = ActivityReportSelectionSchema.parse({ ...report, volume, snapshot });
    assert.equal(reviewed.volume.state, "complete");
  });
});
