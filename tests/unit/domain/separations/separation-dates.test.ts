/**
 * The separation DATE folds — the values a real termination is filed on.
 *
 * Every arm is a statement about the RULE, and the rules are legacy's
 * (`legacy:src/workflows/separations/schema.ts` @ `1bffbd65…`) plus the four
 * operator answers that changed them: §4b (no path files a termination on a
 * date nobody read), §6 (S7's future refusal ports), §9.1's 2026-08-13 answer
 * (the zero-hour "Observed" holidays stay uncounted and surfaced), and §4e (the
 * finalization comment must be non-empty).
 *
 * The live data is chunk 1's proven read: EID `10776990` over `06/10/2026 –
 * 08/12/2026`, `lastPunchDate 06/12/2026`, `holidayDates ["06/19/2026"]`,
 * `unclassifiedPayCodes ["Independence Day Observed", "Juneteenth Observed"]`
 * (`docs/rebuild/migrations/separations.md` §9.2).
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { DateOnlySchema } from "../../../../src/domain/ids.js";
import {
  addSeparationDays,
  buildDateChangeComments,
  buildFinalizationComments,
  buildTerminationComments,
  computeSeparationDate,
  computeTimecardWindow,
  formatSeparationDate,
  isLaterSeparationDate,
  joinSeparationComments,
  pacificCalendarDay,
  parseSeparationDate,
  planSeparation,
  reconcileSeparationDates,
  separationInitials,
  shiftMonths,
} from "../../../../src/domain/separations/separation-dates.js";
import type { SeparationPlan } from "../../../../src/domain/separations/separation-dates.js";
import type { KualiDateField } from "../../../../src/domain/ui/kuali-separation-document.js";

const date = (raw: string): KualiDateField => ({
  state: "present",
  raw,
  value: DateOnlySchema.parse(`${raw.slice(6, 10)}-${raw.slice(0, 2)}-${raw.slice(3, 5)}`),
});
const blank = (reason: string): KualiDateField => ({ state: "absent", reason });

/** Noon Pacific on 2026-08-14 — comfortably inside one calendar day. */
const OBSERVED_AT = "2026-08-14T19:00:00.000Z";

function plan(overrides: Partial<Parameters<typeof planSeparation>[0]> = {}) {
  return planSeparation({
    documentNumber: "4510",
    employeeName: { state: "present", value: "Kou, Nathan" },
    lastDayWorked: date("06/12/2026"),
    separationDate: date("06/12/2026"),
    observedAt: OBSERVED_AT,
    ...overrides,
  });
}

function plannedPlan(): SeparationPlan {
  const resolution = plan();
  assert.equal(resolution.state, "planned");
  if (resolution.state !== "planned") throw new Error("unreachable");
  return resolution.plan;
}

function reconcile(overrides: Partial<Parameters<typeof reconcileSeparationDates>[0]> = {}) {
  return reconcileSeparationDates({
    plan: plannedPlan(),
    timekeeperName: "Julian Zaw",
    lastPunchDate: "06/12/2026",
    sickDates: [],
    holidayDates: ["06/19/2026"],
    unclassifiedPayCodes: ["Independence Day Observed", "Juneteenth Observed"],
    observedWindow: { start: "05/12/2026", end: "07/12/2026" },
    ...overrides,
  });
}

describe("separation dates — the calendar primitives", () => {
  it("refuses a date that is not a real calendar day, rather than rolling it over", () => {
    // `new Date(2026, 1, 31)` is a VALID Date meaning 3 March. A form holding
    // 02/31/2026 would otherwise become a plausible-but-wrong effective date.
    assert.equal(parseSeparationDate("02/31/2026"), null);
    assert.equal(parseSeparationDate("13/01/2026"), null);
    assert.equal(parseSeparationDate("6/12/2026"), null);
    assert.notEqual(parseSeparationDate("02/28/2026"), null);
  });

  it("round-trips a date through epoch milliseconds", () => {
    const at = parseSeparationDate("06/12/2026");
    assert.notEqual(at, null);
    assert.equal(formatSeparationDate(at ?? 0), "06/12/2026");
  });

  it("orders dates by calendar day and not by string", () => {
    // "06/12/2026" < "12/01/2025" as strings; the whole point of parsing.
    assert.equal(isLaterSeparationDate("06/12/2026", "12/01/2025"), true);
    assert.equal(isLaterSeparationDate("06/12/2026", "06/12/2026"), false);
  });

  it("adds a day across a month boundary and a leap day", () => {
    assert.equal(addSeparationDays("06/30/2026", 1), "07/01/2026");
    assert.equal(addSeparationDays("12/31/2026", 1), "01/01/2027");
    assert.equal(addSeparationDays("02/28/2028", 1), "02/29/2028");
  });

  it("CLAMPS a month shift where legacy's setMonth overflows", () => {
    // legacy: Mar 31 − 1 month targets Feb 31 and lands on Mar 3, so its window
    // is narrower than a month. Clamping lands on Feb 28, which is wider — the
    // safe direction for a READ window.
    assert.equal(shiftMonths("03/31/2026", -1), "02/28/2026");
    assert.equal(shiftMonths("03/31/2028", -1), "02/29/2028");
    assert.equal(shiftMonths("01/15/2026", -1), "12/15/2025");
    assert.equal(shiftMonths("12/15/2026", 1), "01/15/2027");
  });

  it("reads the PACIFIC calendar day of an instant, across DST", () => {
    // 2026-08-14T19:00Z is noon PDT on the 14th.
    assert.equal(pacificCalendarDay("2026-08-14T19:00:00.000Z"), "08/14/2026");
    // 2026-08-15T05:00Z is 10pm PDT on the 14th — a UTC comparison would call
    // this "the 15th" and let a genuinely future date through.
    assert.equal(pacificCalendarDay("2026-08-15T05:00:00.000Z"), "08/14/2026");
    // …and in standard time the offset is 8 hours, not 7.
    assert.equal(pacificCalendarDay("2026-01-15T07:30:00.000Z"), "01/14/2026");
  });

  it("computes the ±1-month Kronos window off the earlier and later date", () => {
    assert.deepEqual(computeTimecardWindow("06/12/2026", "06/19/2026"), {
      start: "05/12/2026",
      end: "07/19/2026",
    });
    // Order-independent: the separation date can precede the last day worked
    // on a document somebody edited.
    assert.deepEqual(computeTimecardWindow("06/19/2026", "06/12/2026"), {
      start: "05/12/2026",
      end: "07/19/2026",
    });
  });
});

describe("separation dates — planSeparation (pre-timecard)", () => {
  it("plans the window and carries the form's two dates verbatim", () => {
    const resolution = plan({
      lastDayWorked: date("06/12/2026"),
      separationDate: date("06/19/2026"),
    });
    assert.equal(resolution.state, "planned");
    if (resolution.state !== "planned") return;
    assert.equal(resolution.plan.kualiLastDayWorked, "06/12/2026");
    assert.equal(resolution.plan.kualiSeparationDate, "06/19/2026");
    assert.equal(resolution.plan.asOfDate, "08/14/2026");
    assert.deepEqual(resolution.plan.timecardWindow, { start: "05/12/2026", end: "07/19/2026" });
  });

  it("refuses a blank employee name, a blank LDW and a blank separation date, each by its own code", () => {
    for (const [code, overrides] of [
      ["employee-name-absent", { employeeName: { state: "absent" as const, reason: "the control was empty" } }],
      ["last-day-worked-absent", { lastDayWorked: blank("the control was empty") }],
      ["separation-date-absent", { separationDate: blank("the control was empty") }],
    ] as const) {
      const resolution = plan(overrides);
      assert.equal(resolution.state, "refused", code);
      if (resolution.state !== "refused") continue;
      assert.equal(resolution.code, code);
    }
  });

  it("refuses a FUTURE date on either field (S7), and accepts today", () => {
    for (const field of ["lastDayWorked", "separationDate"] as const) {
      const resolution = plan({ [field]: date("09/02/2026") });
      assert.equal(resolution.state, "refused");
      if (resolution.state !== "refused") continue;
      assert.equal(resolution.code, "separation-date-in-future");
      assert.match(resolution.reason, /not yet eligible for separation/u);
    }
    // Live doc 4495 carried 09/02/2026 three weeks before it was read — the
    // case chunk 2 deliberately does NOT refuse, because reading a form is not
    // filing a termination. This fold is where it refuses.
    assert.equal(
      plan({ lastDayWorked: date("08/14/2026"), separationDate: date("08/14/2026") }).state,
      "planned",
    );
  });
});

describe("separation dates — reconcileSeparationDates (post-timecard)", () => {
  it("takes the Kronos punch as the LDW and max(LDW, leave) as the separation date", () => {
    const resolution = reconcile();
    assert.equal(resolution.state, "reconciled");
    if (resolution.state !== "reconciled") return;
    const { dates } = resolution;
    assert.equal(dates.lastDayWorked, "06/12/2026");
    assert.equal(dates.separationDate, "06/19/2026", "the holiday moved it");
    assert.equal(dates.terminationEffectiveDate, "06/20/2026", "separation date + 1");
    assert.equal(dates.lastDayWorkedChanged, false);
    assert.equal(dates.separationDateChanged, true);
    assert.equal(dates.separationDeterminingLeave, "holiday");
  });

  it("SURFACES the zero-hour Observed pay codes without ever counting them (§9.1, 2026-08-13)", () => {
    const resolution = reconcile();
    assert.equal(resolution.state, "reconciled");
    if (resolution.state !== "reconciled") return;
    // 07/03/2026's `Independence Day Observed` falls AFTER the counted holiday.
    // Counting it would move a real termination's effective date; the operator
    // decided it does not, and the visibility is the trade.
    assert.deepEqual(resolution.dates.unclassifiedPayCodes, [
      "Independence Day Observed",
      "Juneteenth Observed",
    ]);
    assert.equal(resolution.dates.separationDate, "06/19/2026");
  });

  it("REFUSES a card that opened with no punch rather than falling back to the Kuali date (§4b)", () => {
    const resolution = reconcile({ lastPunchDate: null, holidayDates: [] });
    assert.equal(resolution.state, "refused");
    if (resolution.state !== "refused") return;
    assert.equal(resolution.code, "no-punch-in-window");
    assert.match(resolution.reason, /a date nobody read/u);
  });

  it("refuses a leave day outside the window the grid was proved to be showing (S41)", () => {
    const resolution = reconcile({ holidayDates: ["06/19/2025"] });
    assert.equal(resolution.state, "refused");
    if (resolution.state !== "refused") return;
    assert.equal(resolution.code, "leave-date-outside-window");
  });

  it("never lets a leave day earlier than the punch pull the separation date backwards", () => {
    assert.equal(computeSeparationDate("06/12/2026", ["06/01/2026"], ["05/25/2026"]), "06/12/2026");
  });

  it("reports ONE leave clause: holiday only on a strictly later date, sick wins ties", () => {
    const holidayLater = reconcile({ sickDates: ["06/15/2026"], holidayDates: ["06/19/2026"] });
    assert.equal(holidayLater.state, "reconciled");
    if (holidayLater.state !== "reconciled") return;
    assert.equal(holidayLater.dates.separationDeterminingLeave, "holiday");
    assert.match(holidayLater.dates.terminationComments, /Holiday Pay on 06\/19\/2026\./u);
    assert.doesNotMatch(holidayLater.dates.terminationComments, /Sick Leave/u);

    const tie = reconcile({ sickDates: ["06/19/2026"], holidayDates: ["06/19/2026"] });
    assert.equal(tie.state, "reconciled");
    if (tie.state !== "reconciled") return;
    assert.equal(tie.dates.separationDeterminingLeave, "sick");
    assert.match(tie.dates.terminationComments, /Sick Leave on 06\/19\/2026\./u);
    assert.doesNotMatch(tie.dates.terminationComments, /Holiday Pay/u);
  });

  it("emits an audit line only for a date that actually moved", () => {
    const moved = reconcile({ lastPunchDate: "06/10/2026" });
    assert.equal(moved.state, "reconciled");
    if (moved.state !== "reconciled") return;
    assert.equal(
      moved.dates.dateChangeComments,
      "Updated Last Day Worked from 06/12/2026 to 06/10/2026 per Kronos timesheet. -JZ\n"
      + "Updated Separation Date from 06/12/2026 to 06/19/2026 per Kronos timesheet. -JZ",
    );

    const unchanged = reconcile({ holidayDates: [] });
    assert.equal(unchanged.state, "reconciled");
    if (unchanged.state !== "reconciled") return;
    assert.equal(unchanged.dates.dateChangeComments, "");
    assert.equal(unchanged.dates.separationDeterminingLeave, null);
  });
});

describe("separation dates — the comment builders", () => {
  it("names the PHYSICAL last day worked, never the separation date", () => {
    assert.equal(
      buildTerminationComments({
        terminationEffectiveDate: "06/20/2026",
        lastDayWorked: "06/12/2026",
        documentNumber: "4510",
        latestSickDate: null,
        firstHolidayDate: "06/19/2026",
        latestHolidayDate: "06/19/2026",
      }),
      "Termination eff 06/20/2026. Last Day Worked 06/12/2026. Holiday Pay on 06/19/2026. "
      + "Kuali form #4510.",
    );
  });

  it("reports a holiday RANGE when the card carried two or more holiday days", () => {
    assert.match(
      buildTerminationComments({
        terminationEffectiveDate: "07/06/2026",
        lastDayWorked: "06/30/2026",
        documentNumber: "4510",
        latestSickDate: null,
        firstHolidayDate: "07/03/2026",
        latestHolidayDate: "07/05/2026",
      }),
      /Holiday Pay from 07\/03\/2026 to 07\/05\/2026\./u,
    );
  });

  it("derives initials the way legacy does, and refuses a name it cannot", () => {
    assert.equal(separationInitials("Julian Zaw"), "JZ");
    assert.equal(separationInitials("  Ada  Byron King "), "ABK");
    assert.throws(() => separationInitials("   "));
  });

  it("joins only non-empty comment parts", () => {
    assert.equal(joinSeparationComments("", " a ", "", "b"), "a\nb");
  });

  it("keeps the operator's existing comments and ALWAYS records what was filed (§4e)", () => {
    const composed = buildFinalizationComments({
      existingComments: "Hold off entering this termination waiting for review by HDH HR.",
      dateChangeComments: buildDateChangeComments({
        kualiLastDayWorked: "06/12/2026",
        lastDayWorked: "06/12/2026",
        kualiSeparationDate: "06/12/2026",
        separationDate: "06/19/2026",
        initials: "JZ",
        source: "kronos-timesheet",
      }),
      documentNumber: "4510",
      transactionNumber: "T002209631",
      initials: "JZ",
      asOfDate: "08/14/2026",
    });
    assert.equal(
      composed,
      "Hold off entering this termination waiting for review by HDH HR.\n"
      + "Updated Separation Date from 06/12/2026 to 06/19/2026 per Kronos timesheet. -JZ\n"
      + "Termination filed on UCPath as T002209631. Re Kuali Form #4510. -JZ 08/14/2026",
    );

    // The whole reason the last line is unconditional: `KualiFinalizationCommentsSchema`
    // requires a non-empty value, and §9.12 proved a document finalized with an
    // EMPTY comment can never be probed `present`.
    assert.equal(
      buildFinalizationComments({
        existingComments: "",
        dateChangeComments: "",
        documentNumber: "4510",
        transactionNumber: "T002209631",
        initials: "JZ",
        asOfDate: "08/14/2026",
      }),
      "Termination filed on UCPath as T002209631. Re Kuali Form #4510. -JZ 08/14/2026",
    );
  });
});
