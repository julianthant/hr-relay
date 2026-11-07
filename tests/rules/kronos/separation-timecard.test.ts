import assert from "node:assert/strict";
import { describe,it } from "vitest";
import type { TimecardGridRow } from "../../../src/rules/kronos/separation-timecard.js";
import {
assertTimecardCoversRange,
classifyPayCode,
enumerateRangeDays,
foldSeparationTimecard,
formatRangeBound,
parseAppliedRangeLabel,
parseTimecardDate,
periodAlignedResolutionRange,
rangesAreSameDays,
resolveTimecardColumns,
rowHasPunch,
timecardRangeCoverage,
} from "../../../src/rules/kronos/separation-timecard.js";
import type { TimecardDateRange } from "../../../src/rules/time/timecard-period.js";

const EMPTY_CELLS = {
  rawDateCell: "",
  schedule: "",
  punchIn: "",
  punchOut: "",
  transfer: "",
  payCode: "",
  amount: "",
  shift: "",
  daily: "",
  period: "",
  absence: "",
} as const;

function row(month: number, day: number, overrides: Partial<TimecardGridRow> = {}): TimecardGridRow {
  return { ...EMPTY_CELLS, month, day, ...overrides };
}

/** Every calendar day in the window, so a fold is never refused for coverage. */
function coveringRows(range: TimecardDateRange, populated: readonly TimecardGridRow[] = []): TimecardGridRow[] {
  const days = enumerateRangeDays(range).map((day) => {
    const [month = "", date = ""] = day.split("/");
    return row(Number(month), Number(date));
  });
  return [...days, ...populated];
}

const JUNE_WINDOW: TimecardDateRange = {
  start: new Date(2026, 5, 1),
  end: new Date(2026, 5, 30),
};

describe("separation timecard column binding", () => {
  // WFD appends sort-order suffixes to header labels.
  const LIVE_HEADERS = [
    "Schedule 1", "In 1", "Out 1", "Transfer 1", "Pay code 1",
    "Amount 1", "Shift 1", "Daily 1", "Period 1", "Absence 1",
  ];

  it("binds every column by name off the live header row", () => {
    assert.deepEqual(resolveTimecardColumns(LIVE_HEADERS), {
      Schedule: 0, In: 1, Out: 2, Transfer: 3, "Pay code": 4,
      Amount: 5, Shift: 6, Daily: 7, Period: 8, Absence: 9,
    });
  });

  it("follows a column that moved instead of reading the neighbour", () => {
    const moved = ["In 1", "Out 1", "Pay code 1", "Schedule 1", "Transfer 1",
      "Amount 1", "Shift 1", "Daily 1", "Period 1", "Absence 1"];
    assert.equal(resolveTimecardColumns(moved)["Pay code"], 2);
  });

  it("refuses a header row missing a column instead of falling back to an index", () => {
    const withoutPayCode = LIVE_HEADERS.filter((header) => !header.startsWith("Pay code"));
    assert.throws(() => resolveTimecardColumns(withoutPayCode), /missing Pay code/);
  });

  it("refuses an ambiguous header row", () => {
    assert.throws(() => resolveTimecardColumns([...LIVE_HEADERS, "In 2"]), /ambiguous In \(2x\)/);
  });
});

describe("separation timecard coverage guard", () => {
  it("accepts a read that covers every day in the applied window", () => {
    assert.doesNotThrow(() => { assertTimecardCoversRange(coveringRows(JUNE_WINDOW), JUNE_WINDOW); });
  });

  it("refuses a truncated virtualized read rather than deriving from it", () => {

    const truncated = coveringRows(JUNE_WINDOW).slice(0, 20);
    assert.throws(
      () => { assertTimecardCoversRange(truncated, JUNE_WINDOW); },
      /covers 20 of 30 days .* missing 06\/21\/2026/s,
    );
  });


  it("refuses rows that belong to a DIFFERENT period, separately from a short scroll", () => {
    const inWindow = coveringRows(JUNE_WINDOW);
    const foreign = [...inWindow, { ...inWindow[0], month: 12, day: 2 }];
    assert.deepEqual(timecardRangeCoverage(foreign, JUNE_WINDOW).outside, ["12/2"]);
    assert.equal(timecardRangeCoverage(foreign, JUNE_WINDOW).missing.length, 0);
    assert.equal(timecardRangeCoverage(foreign, JUNE_WINDOW).complete, false);
    assert.throws(
      () => { assertTimecardCoversRange(foreign, JUNE_WINDOW); },
      /rows 12\/2 belong to no year inside .* rendered a DIFFERENT period/s,
    );
  });

  it("distinguishes a grid that produced no rows from an empty timecard", () => {
    assert.throws(
      () => { assertTimecardCoversRange([], JUNE_WINDOW); },
      /produced ZERO rows .* this is not an empty timecard/s,
    );
  });
});

describe("separation timecard fold", () => {
  it("derives the last punch, the punch days, and keeps an empty card a real outcome", () => {
    const withPunches = foldSeparationTimecard(coveringRows(JUNE_WINDOW, [
      row(6, 1, { punchIn: "12:24 PM", punchOut: "3:33 PM" }),
      row(6, 12, { punchIn: "10:27 AM", punchOut: "2:32 PM" }),
      row(6, 8, { punchIn: "6:27 PM", punchOut: "10:31 PM" }),
    ]), JUNE_WINDOW);
    assert.equal(withPunches.lastPunchDate, "06/12/2026");
    assert.deepEqual(withPunches.punchDates, ["06/01/2026", "06/08/2026", "06/12/2026"]);

    const empty = foldSeparationTimecard(coveringRows(JUNE_WINDOW), JUNE_WINDOW);
    assert.equal(empty.lastPunchDate, null);
    assert.deepEqual(empty.punchDates, []);
    assert.deepEqual(empty.payCodeDays, []);
  });

  it("classifies sick and holiday and REPORTS every pay code it cannot classify", () => {

    const fold = foldSeparationTimecard(coveringRows(JUNE_WINDOW, [
      row(6, 19, { payCode: "Holiday - Hourly", amount: "4.00" }),
      row(6, 19, { payCode: "Juneteenth Observed", amount: "0.00" }),
      row(6, 22, { payCode: "Sick - Hourly", amount: "8.00" }),
    ]), JUNE_WINDOW);
    assert.deepEqual(fold.holidayDates, ["06/19/2026"]);
    assert.deepEqual(fold.sickDates, ["06/22/2026"]);
    assert.deepEqual(fold.unclassifiedPayCodes, ["Juneteenth Observed"]);
    assert.deepEqual(fold.payCodeDays, [
      { date: "06/19/2026", payCode: "Holiday - Hourly", amount: "4.00" },
      { date: "06/19/2026", payCode: "Juneteenth Observed", amount: "0.00" },
      { date: "06/22/2026", payCode: "Sick - Hourly", amount: "8.00" },
    ]);
  });

  it("resolves a yearless grid date against the APPLIED window, not against now", () => {
    const decemberWindow: TimecardDateRange = { start: new Date(2025, 11, 1), end: new Date(2026, 0, 15) };
    const fold = foldSeparationTimecard(coveringRows(decemberWindow, [
      row(12, 30, { punchIn: "9:00 AM", punchOut: "5:00 PM" }),
      row(1, 5, { punchIn: "9:00 AM", punchOut: "5:00 PM" }),
    ]), decemberWindow);
    assert.deepEqual(fold.punchDates, ["12/30/2025", "01/05/2026"]);
    assert.equal(fold.lastPunchDate, "01/05/2026");
  });

  it("treats either an In or an Out clock time as a punch", () => {
    assert.equal(rowHasPunch(row(6, 1, { punchIn: "12:24 PM" })), true);
    assert.equal(rowHasPunch(row(6, 1, { punchOut: "3:33 PM" })), true);
    assert.equal(rowHasPunch(row(6, 1, { daily: "8.00" })), false);
  });

  it("ports the legacy sick/holiday regexes verbatim", () => {
    assert.equal(classifyPayCode("Sick - Hourly"), "sick");
    assert.equal(classifyPayCode("Holiday - Hourly"), "holiday");
    assert.equal(classifyPayCode("Independence Day Observed"), "unclassified");
    assert.equal(classifyPayCode(""), "unclassified");
  });
});

describe("period-aligned grid rows", () => {
  // WFD paints whole pay periods; ignore rows outside the requested window.
  const AUGUST_WINDOW: TimecardDateRange = { start: new Date(2026, 6, 15), end: new Date(2026, 7, 12) };

  it("keeps a neighbouring rendered day out of the fold instead of refusing it", () => {
    const fold = foldSeparationTimecard(coveringRows(AUGUST_WINDOW, [
      row(8, 10, { punchIn: "9:00 AM", punchOut: "5:00 PM" }),
      row(8, 13, { punchIn: "9:00 AM", punchOut: "5:00 PM" }),
      row(8, 15, { payCode: "Sick - Hourly", amount: "8.00" }),
      row(7, 14, { punchIn: "9:00 AM", punchOut: "5:00 PM" }),
    ]), AUGUST_WINDOW);
    assert.deepEqual(fold.punchDates, ["08/10/2026"]);
    assert.deepEqual(fold.sickDates, []);
    assert.equal(fold.lastPunchDate, "08/10/2026");
  });

  it("still resolves the year of an in-window day across a December boundary", () => {
    const december: TimecardDateRange = { start: new Date(2025, 11, 20), end: new Date(2026, 0, 10) };
    const fold = foldSeparationTimecard(coveringRows(december, [
      row(1, 2, { punchIn: "9:00 AM", punchOut: "5:00 PM" }),
      row(12, 22, { punchIn: "9:00 AM", punchOut: "5:00 PM" }),
    ]), december);
    assert.deepEqual(fold.punchDates, ["12/22/2025", "01/02/2026"]);
  });

  it("refuses a window too wide to widen unambiguously rather than narrowing it", () => {
    assert.throws(
      () => periodAlignedResolutionRange({ start: new Date(2026, 0, 1), end: new Date(2026, 11, 1) }),
      /too wide to resolve grid years unambiguously/,
    );
  });
});

describe("applied range label", () => {
  it("parses the live inconsistently-padded label into real calendar days", () => {
    const parsed = parseAppliedRangeLabel("6/01/2026 - 8/12/2026");
    assert.notEqual(parsed, null);
    assert.equal(formatRangeBound(parsed?.start ?? new Date(0)), "06/01/2026");
    assert.equal(formatRangeBound(parsed?.end ?? new Date(0)), "08/12/2026");
  });

  it("returns null for a named period so it can never read as a match", () => {
    assert.equal(parseAppliedRangeLabel("Current Pay Period"), null);
    assert.equal(parseAppliedRangeLabel(""), null);
    assert.equal(parseAppliedRangeLabel("6/31/2026 - 8/12/2026"), null);
  });

  it("compares ranges on calendar days, not on strings", () => {
    const left = parseAppliedRangeLabel("6/01/2026 - 8/12/2026");
    const right = parseAppliedRangeLabel("06/01/2026 – 08/12/2026");
    assert.notEqual(left, null);
    assert.notEqual(right, null);
    assert.equal(rangesAreSameDays(
      left ?? { start: new Date(0), end: new Date(0) },
      right ?? { start: new Date(1), end: new Date(1) },
    ), true);
  });
});

describe("range day enumeration and input parsing", () => {
  it("enumerates inclusive days across a month boundary", () => {
    const days = enumerateRangeDays({ start: new Date(2026, 5, 29), end: new Date(2026, 6, 2) });
    assert.deepEqual(days, ["06/29/2026", "06/30/2026", "07/01/2026", "07/02/2026"]);
  });

  it("refuses an inverted range", () => {
    assert.throws(
      () => enumerateRangeDays({ start: new Date(2026, 6, 2), end: new Date(2026, 5, 29) }),
      /inverted timecard range/,
    );
  });

  it("refuses a date that is not a real calendar day", () => {
    assert.equal(formatRangeBound(parseTimecardDate("6/1/2026", "range start")), "06/01/2026");
    assert.throws(() => parseTimecardDate("2026-06-01", "range start"), /is not M\/D\/YYYY/);
    assert.throws(() => parseTimecardDate("02/30/2026", "range start"), /is not a real calendar date/);
  });
});
