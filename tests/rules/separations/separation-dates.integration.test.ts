
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { SeparationPlanSchema,assertSeparationDates } from "../../../src/rules/separations/separation-dates.js";

const PLAN = SeparationPlanSchema.parse({
  documentNumber: "4444",
  employeeName: "Person, Deterministic",
  kualiLastDayWorked: "06/18/2026",
  kualiSeparationDate: "06/18/2026",
  asOfDate: "08/20/2026",
  timecardWindow: { start: "05/19/2026", end: "06/19/2026" },
});

describe("separations omittable write steps", () => {

  it("rebuilds the reconciled dates from a typed pair with no invented leave and an honest comment", () => {
    const dates = assertSeparationDates({ plan: PLAN, timekeeperName: "Julian Zaw", lastDayWorked: "06/18/2026", separationDate: "06/19/2026" });
    assert.equal(dates.terminationEffectiveDate, "06/20/2026");
    assert.equal(dates.lastDayWorkedChanged, false);
    assert.equal(dates.separationDateChanged, true);
    assert.deepEqual(
      [dates.latestSickDate, dates.firstHolidayDate, dates.latestHolidayDate, dates.separationDeterminingLeave, dates.unclassifiedPayCodes],
      [null, null, null, null, []],
    );
    assert.match(dates.dateChangeComments, /Updated Separation Date from 06\/18\/2026 to 06\/19\/2026 per operator entry at run start\. -JZ/u);
    assert.doesNotMatch(dates.dateChangeComments, /Kronos/u);
    assert.doesNotMatch(dates.terminationComments, /Sick Leave|Holiday Pay/u);
    assert.throws(
      () => assertSeparationDates({ plan: PLAN, timekeeperName: "Julian Zaw", lastDayWorked: "06/19/2026", separationDate: "06/18/2026" }),
      /precedes the asserted last day worked/u,
    );
  });
});
