import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  ACTIVITY_DATE_PRESETS,
  ACTIVITY_MAX_YEAR_BUCKETS,
  ACTIVITY_WEEK_STARTS_ON,
  activityCompactRangeLabel,
  activityPresetOf,
  activityPresetRange,
  activityRangeDraft,
  activityRangeValue,
  applyActivityRangeDraft,
  buildActivityRangeModel,
  parseActivityRange,
} from "../../../../src/dashboard/surfaces/activity-model.js";

function subtractDays(day: string, count: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - count);
  return date.toISOString().slice(0, 10);
}

function readyRange(from: string, to: string) {
  const result = buildActivityRangeModel({ from, to });
  if (result.state !== "ready") throw new Error(result.refusal);
  return result.model;
}

function dateInZone(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instant));
  const value = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

describe("Activity date range model", () => {
  it("publishes the exact ordered preset labels and stable values", () => {
    assert.deepEqual(ACTIVITY_DATE_PRESETS, [
      { value: "this-week", label: "This week" },
      { value: "today", label: "Today" },
      { value: "last-month", label: "Last month" },
      { value: "last-3-months", label: "Last 3 months" },
      { value: "last-6-months", label: "Last 6 months" },
      { value: "last-year", label: "Last year" },
      { value: "custom", label: "Custom range" },
    ]);
  });

  it("builds Sunday-starting and rolling inclusive presets from the report date", () => {
    const today = "2026-09-26";
    const expected = [
      ["this-week", { from: "2026-09-20", to: today }],
      ["today", { from: today, to: today }],
      ["last-month", { from: "2026-08-27", to: today }],
      ["last-3-months", { from: "2026-06-27", to: today }],
      ["last-6-months", { from: "2026-03-27", to: today }],
      ["last-year", { from: "2025-09-27", to: today }],
    ] as const;

    for (const [preset, range] of expected) {
      assert.deepEqual(activityPresetRange(preset, today), range);
      assert.equal(activityPresetOf(range, today), preset);
    }
    assert.equal(activityPresetOf({ from: "2026-09-21", to: today }, today), "custom");
  });

  it("clamps rolling month subtraction at month ends and leap days", () => {
    assert.deepEqual(activityPresetRange("last-month", "2026-03-31"), { from: "2026-03-01", to: "2026-03-31" });
    assert.deepEqual(activityPresetRange("last-3-months", "2026-03-31"), { from: "2026-01-01", to: "2026-03-31" });
    assert.deepEqual(activityPresetRange("last-6-months", "2026-03-31"), { from: "2025-10-01", to: "2026-03-31" });
    assert.deepEqual(activityPresetRange("last-year", "2026-03-31"), { from: "2025-04-01", to: "2026-03-31" });
    assert.deepEqual(activityPresetRange("last-month", "2024-03-31"), { from: "2024-03-01", to: "2024-03-31" });
    assert.deepEqual(activityPresetRange("last-year", "2024-03-31"), { from: "2023-04-01", to: "2024-03-31" });
    assert.deepEqual(activityPresetRange("last-month", "2026-08-31"), { from: "2026-08-01", to: "2026-08-31" });
  });

  it("keeps the URL from..to shape and the applied label exact across year boundaries", () => {
    const parsed = parseActivityRange("2025-12-31..2026-01-01", "2026-01-02");
    assert.deepEqual(parsed, { from: "2025-12-31", to: "2026-01-01" });
    assert.equal(activityRangeValue(parsed), "2025-12-31..2026-01-01");
    assert.equal(activityCompactRangeLabel(parsed), "Dec 31, 2025 – Jan 1, 2026");
    assert.equal(activityCompactRangeLabel({ from: "2026-08-27", to: "2026-09-26" }), "Aug 27 – Sep 26, 2026");
    assert.equal(activityCompactRangeLabel({ from: "2024-02-29", to: "2024-02-29" }), "Feb 29, 2024");
  });

  it("uses the next calendar date as the exclusive end for a one-day leap-day interval", () => {
    const model = readyRange("2024-02-29", "2024-02-29");
    assert.deepEqual(model.interval, { start: "2024-02-29", endExclusive: "2024-03-01" });
    assert.equal(model.inclusiveDays, 1);
    assert.deepEqual(model.granularity, { kind: "hourly", unit: "hour", step: 1 });
  });

  it("selects the exact granularity at every inclusive-day threshold", () => {
    const to = "2026-09-26";
    const thresholds = [
      [1, "hourly"],
      [2, "daily"],
      [31, "daily"],
      [32, "weekly"],
      [180, "weekly"],
      [181, "monthly"],
      [730, "monthly"],
      [731, "yearly"],
    ] as const;

    for (const [days, granularity] of thresholds) {
      const model = readyRange(subtractDays(to, days - 1), to);
      assert.equal(model.inclusiveDays, days);
      assert.equal(model.granularity.kind, granularity, `${days} inclusive days`);
    }
  });

  it("clips partial weekly, monthly, and yearly intervals to the selected dates", () => {
    const weekly = readyRange("2026-08-26", "2026-09-26");
    assert.equal(weekly.inclusiveDays, 32);
    assert.deepEqual(weekly.interval, { start: "2026-08-26", endExclusive: "2026-09-27" });
    assert.deepEqual(weekly.granularity, { kind: "weekly", unit: "week", weekStartsOn: ACTIVITY_WEEK_STARTS_ON });

    const monthly = readyRange("2026-03-30", "2026-09-26");
    assert.equal(monthly.inclusiveDays, 181);
    assert.deepEqual(monthly.interval, { start: "2026-03-30", endExclusive: "2026-09-27" });
    assert.deepEqual(monthly.granularity, { kind: "monthly", unit: "month", step: 1 });

    const yearly = readyRange("2024-06-15", "2026-09-26");
    assert.equal(yearly.granularity.kind, "yearly");
    assert.deepEqual(yearly.interval, { start: "2024-06-15", endExclusive: "2026-09-27" });
  });

  it("coarsens extreme yearly spans to no more than 32 calendar-year buckets", () => {
    const model = readyRange("0001-01-01", "9999-12-31");
    assert.equal(model.granularity.kind, "yearly");
    if (model.granularity.kind !== "yearly") throw new Error("expected yearly granularity");
    assert.equal(model.granularity.yearsPerBucket, 313);
    assert.ok(Math.ceil(9999 / model.granularity.yearsPerBucket) <= ACTIVITY_MAX_YEAR_BUCKETS);
    assert.equal(model.inclusiveDays, 3_652_059);
    assert.deepEqual(model.interval, { start: "0001-01-01", endExclusive: "+010000-01-01" });

    const exclusiveBoundary = new Date(`${model.interval.endExclusive}T00:00:00.000Z`);
    assert.equal(Number.isFinite(exclusiveBoundary.getTime()), true);
    assert.equal(exclusiveBoundary.toISOString(), "+010000-01-01T00:00:00.000Z");
  });

  it("refuses malformed, impossible, incomplete, and reversed ranges without substitution", () => {
    assert.match(parseActivityRange("", "2026-02-30").refusal ?? "", /requested range was not replaced/u);
    for (const value of [
      "2026-09-10..2026-09-08",
      "2026-02-30..2026-03-01",
      "2026-09-08..",
      "2026-09-08..2026-09-09..extra",
      "2026-9-08..2026-09-09",
      "+010000-01-01..+010000-01-02",
    ]) {
      assert.match(parseActivityRange(value, "2026-09-10").refusal ?? "", /requested range was not replaced/u);
    }

    for (const range of [
      { from: "2026-09-10", to: "2026-09-08" },
      { from: "2026-02-30", to: "2026-03-01" },
      { from: "2026-09-08", to: "2026-9-09" },
      { from: "+010000-01-01", to: "+010000-01-02" },
    ]) {
      const result = buildActivityRangeModel(range);
      assert.equal(result.state, "refused");
      if (result.state === "refused") assert.match(result.refusal, /requested range was not replaced/u);
    }

    const draft = activityRangeDraft({ from: "2026-09-01", to: "2026-09-10" });
    assert.deepEqual(draft, { from: "2026-09-01", to: "2026-09-10" });
    const incomplete = applyActivityRangeDraft({ ...draft, to: null });
    assert.equal(incomplete.state, "refused");
    if (incomplete.state === "refused") assert.match(incomplete.refusal, /both From and To/u);
    const reversed = applyActivityRangeDraft({ from: "2026-09-10", to: "2026-09-01" });
    assert.equal(reversed.state, "refused");
  });

  it("keeps report dates stable when browser and report timezones disagree", () => {
    const instant = "2026-09-26T06:30:00.000Z";
    const reportToday = dateInZone(instant, "America/Los_Angeles");
    const browserToday = dateInZone(instant, "Pacific/Kiritimati");
    assert.equal(reportToday, "2026-09-25");
    assert.equal(browserToday, "2026-09-26");

    const todayRange = activityPresetRange("today", reportToday);
    assert.deepEqual(todayRange, { from: "2026-09-25", to: "2026-09-25" });
    assert.equal(activityCompactRangeLabel(todayRange), "Sep 25, 2026");
    assert.deepEqual(readyRange("2026-09-25", "2026-09-25").interval, {
      start: "2026-09-25",
      endExclusive: "2026-09-26",
    });
  });

  it("refuses a preset request without a valid report-calendar today", () => {
    assert.throws(() => activityPresetRange("today", "2026-02-30"), /valid YYYY-MM-DD report-calendar date/u);
  });
});
