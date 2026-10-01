import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { manualClock } from "../../../../src/domain/clock.js";
import {
  assertPeriodLabelSwitched,
  didPeriodLabelSwitch,
  formatTimecardDate,
  resolveCurrentVisibleTimecardRange,
  resolvePreviousVisibleTimecardRange,
  timecardCheckWindows,
} from "../../../../src/domain/timecard-period.js";
import type { TimecardDateRange, VisibleTimecardMonthDays } from "../../../../src/domain/timecard-period.js";

function localDate(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day);
}

function range(
  startYear: number, startMonth: number, startDay: number,
  endYear: number, endMonth: number, endDay: number,
): TimecardDateRange {
  return { start: localDate(startYear, startMonth, startDay), end: localDate(endYear, endMonth, endDay) };
}

function visible(
  firstMonth: number, firstDay: number, lastMonth: number, lastDay: number,
): VisibleTimecardMonthDays {
  return { first: { month: firstMonth, day: firstDay }, last: { month: lastMonth, day: lastDay } };
}

describe("formatTimecardDate", () => {
  it("stamps the unique candidate year inside the requested window", () => {
    assert.equal(formatTimecardDate(3, 16, range(2026, 3, 1, 2026, 3, 31)), "03/16/2026");
  });

  it("resolves a December row read from a window that straddles the new year", () => {
    // The legacy Dec→Jan bug: inferring the year from "now" stamped 12/30 with
    // January's year. The window, not the wall clock, decides.
    assert.equal(formatTimecardDate(12, 30, range(2025, 12, 16, 2026, 1, 15)), "12/30/2025");
    assert.equal(formatTimecardDate(1, 5, range(2025, 12, 16, 2026, 1, 15)), "01/05/2026");
  });

  it("throws on an impossible calendar day rather than rolling it forward", () => {
    assert.throws(
      () => formatTimecardDate(2, 30, range(2026, 1, 1, 2026, 12, 31)),
      /impossible date 2\/30/,
    );
    assert.throws(
      () => formatTimecardDate(2, 29, range(2026, 1, 1, 2026, 12, 31)),
      /impossible date 2\/29/,
    );
  });

  it("accepts a real leap day", () => {
    assert.equal(formatTimecardDate(2, 29, range(2028, 2, 1, 2028, 3, 1)), "02/29/2028");
  });

  it("throws when the day falls outside the window in every candidate year", () => {
    assert.throws(
      () => formatTimecardDate(7, 4, range(2026, 3, 1, 2026, 3, 31)),
      /falls outside the requested range/,
    );
  });

  it("throws when a window wider than a year makes the year ambiguous", () => {
    assert.throws(
      () => formatTimecardDate(3, 16, range(2025, 1, 1, 2026, 12, 31)),
      /is ambiguous within .* candidate years 2025, 2026/,
    );
  });

  it("throws on out-of-bounds month/day and on an inverted range", () => {
    assert.throws(() => formatTimecardDate(13, 1, range(2026, 1, 1, 2026, 12, 31)), /impossible parsed grid date/);
    assert.throws(() => formatTimecardDate(1, 0, range(2026, 1, 1, 2026, 12, 31)), /impossible parsed grid date/);
    assert.throws(() => formatTimecardDate(3, 16, range(2026, 4, 1, 2026, 3, 1)), /inverted date range/);
  });
})

describe("resolveCurrentVisibleTimecardRange", () => {
  it("resolves the period that contains the Clock's today", () => {
    const clock = manualClock(localDate(2026, 3, 20));
    assert.deepEqual(
      resolveCurrentVisibleTimecardRange(visible(3, 16, 3, 31), clock),
      range(2026, 3, 16, 2026, 3, 31),
    );
  });

  it("rolls the end year forward for a period straddling the new year", () => {
    const clock = manualClock(localDate(2026, 1, 2));
    assert.deepEqual(
      resolveCurrentVisibleTimecardRange(visible(12, 16, 1, 15), clock),
      range(2025, 12, 16, 2026, 1, 15),
    );
  });

  it("throws when the visible period does not contain today", () => {
    const clock = manualClock(localDate(2026, 6, 1));
    assert.throws(
      () => resolveCurrentVisibleTimecardRange(visible(3, 16, 3, 31), clock),
      /does not contain 06\/01\/2026/,
    );
  });

  it("throws on a month/day pair no year can compose", () => {
    const clock = manualClock(localDate(2026, 2, 20));
    assert.throws(
      () => resolveCurrentVisibleTimecardRange(visible(2, 30, 3, 5), clock),
      /impossible visible current period/,
    );
  });

  it("rejects out-of-bounds grid values before composing anything", () => {
    const clock = manualClock(localDate(2026, 3, 20));
    assert.throws(
      () => resolveCurrentVisibleTimecardRange(visible(0, 16, 3, 31), clock),
      /impossible first visible grid date/,
    );
    assert.throws(
      () => resolveCurrentVisibleTimecardRange(visible(3, 16, 3, 32), clock),
      /impossible last visible grid date/,
    );
  });

  it("rejects a visible span longer than a two-month straddle", () => {
    const clock = manualClock(localDate(2026, 3, 20));
    assert.throws(
      () => resolveCurrentVisibleTimecardRange(visible(1, 1, 6, 30), clock),
      /impossible visible current period/,
    );
  });
})

describe("resolvePreviousVisibleTimecardRange", () => {
  it("resolves the period immediately before the verified current range", () => {
    assert.deepEqual(
      resolvePreviousVisibleTimecardRange(visible(3, 1, 3, 15), range(2026, 3, 16, 2026, 3, 31)),
      range(2026, 3, 1, 2026, 3, 15),
    );
  });

  it("steps back across the new year", () => {
    assert.deepEqual(
      resolvePreviousVisibleTimecardRange(visible(12, 1, 12, 15), range(2025, 12, 16, 2026, 1, 15)),
      range(2025, 12, 1, 2025, 12, 15),
    );
  });

  it("throws when no candidate period sits close enough before the current one", () => {
    assert.throws(
      () => resolvePreviousVisibleTimecardRange(visible(3, 1, 3, 15), range(2026, 9, 1, 2026, 9, 15)),
      /resolved to 0 candidate periods/,
    );
  });

  it("throws on an impossible previous grid pair", () => {
    assert.throws(
      () => resolvePreviousVisibleTimecardRange(visible(2, 31, 3, 5), range(2026, 3, 16, 2026, 3, 31)),
      /impossible visible previous period/,
    );
  });
})

describe("didPeriodLabelSwitch", () => {
  it("confirms a real label change", () => {
    assert.equal(didPeriodLabelSwitch("Current Pay Period", "03/01/2026 - 03/15/2026"), true);
  });

  it("refuses to confirm without a readable baseline", () => {
    assert.equal(didPeriodLabelSwitch("   ", "03/01/2026 - 03/15/2026"), false);
    assert.equal(didPeriodLabelSwitch("Current Pay Period", "  "), false);
  });

  it("treats a case/whitespace-only difference as no change", () => {
    assert.equal(didPeriodLabelSwitch("Current Pay Period", "  current pay period "), false);
  });

  it("rejects an after-label that still matches the current-period pattern", () => {
    assert.equal(
      didPeriodLabelSwitch("Current Pay Period (3/16)", "Current Pay Period", /current pay period/i),
      false,
    );
  });

  it("asserts loudly on every unverifiable case", () => {
    assert.throws(() => assertPeriodLabelSwitched("", "x"), /switch is unverified/);
    assert.doesNotThrow(() => assertPeriodLabelSwitched("before", "after"));
  });
})

describe("timecardCheckWindows", () => {
  it("derives both windows from the Clock, never from a hidden default", () => {
    const clock = manualClock(localDate(2026, 3, 20));
    const windows = timecardCheckWindows(clock);
    assert.deepEqual(windows.current, range(2026, 1, 19, 2026, 3, 27));
    assert.deepEqual(windows.previous, range(2025, 11, 20, 2026, 3, 27));
  });

  it("keeps each window narrow enough to resolve any month/day to one year", () => {
    const clock = manualClock(localDate(2026, 3, 20));
    const { previous } = timecardCheckWindows(clock);
    assert.equal(formatTimecardDate(12, 30, previous), "12/30/2025");
  });

  it("lands every bound on local midnight across a DST transition", () => {
    // 2026-03-20 minus 60 calendar days crosses US spring-forward (2026-03-08).
    // Millisecond arithmetic would land 23:00 on the prior day.
    const windows = timecardCheckWindows(manualClock(localDate(2026, 3, 20)));
    for (const bound of [
      windows.current.start, windows.current.end, windows.previous.start, windows.previous.end,
    ]) {
      assert.equal(bound.getHours(), 0, bound.toString());
      assert.equal(bound.getMinutes(), 0, bound.toString());
    }
  });
})
