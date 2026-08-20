/**
 * `new-kronos/read-separation-timecard` — ONE visit to the WFD Timecard page
 * (D194 / ref task-contract §2.8).
 *
 * Go To, the subject proof, the custom-range apply and the grid read are all
 * ONE page visit: none of them can be re-entered without redoing the whole
 * navigation, and a separate "set the range" task would hand the next task a
 * page it cannot prove it is still standing on. `separations.md` §2.4's
 * five-task sketch (`open-timecard` · `verify-timecard-subject` ·
 * `set-timecard-range` · `read-separation-timecard`) predates the
 * extraction-width rule ratified later in the same document; this is that rule
 * applied.
 *
 * The output is the page's full useful surface, and three parts of it are
 * first-class rather than assumed:
 *
 *  - **the subject the page itself displays** (`subject`) — S37's wrong-person
 *    control is an OUTPUT, not an internal check, so a run's evidence carries
 *    the EID and the name the timecard showed;
 *  - **whether the requested window actually applied** (`range`) — S40, proved
 *    by parsing WFD's own period label back into calendar days, not by noticing
 *    the label changed;
 *  - **the raw pay-code rows beside the derived dates** (`grid.payCodeDays`,
 *    `grid.unclassifiedPayCodes`) — the live window carried
 *    `Juneteenth Observed` and `Independence Day Observed`, neither of which
 *    legacy's `/holiday/i` rule classifies. Dropping them would hide a day that
 *    may belong in a separation date.
 *
 * `grid.lastPunchDate: null` is the S38 ABSENT ARM: a timecard that opened and
 * genuinely holds no punches is a REAL outcome of a correct read. It is
 * reachable only through a grid whose day set covers the whole applied window —
 * a truncated read of WFD's virtualized grid refuses instead (`timecard-unreadable`).
 */
import { z } from "zod";
import { EidSchema, ObservationIdSchema, taskId } from "../../ids.js";
import { TimecardDateSchema, TimecardPayCodeDaySchema } from "../../kronos/separation-timecard.js";
import { ContractFieldPathSchema, defineTaskContract } from "../base.js";

/** `M/D/YYYY` or `MM/DD/YYYY` — the spelling WFD's range fields accept. */
export const TimecardRangeBoundSchema = z.string().regex(
  /^\d{1,2}\/\d{1,2}\/\d{4}$/u,
  "timecard range bound must be M/D/YYYY",
);

export const ReadSeparationTimecardOutputSchema = z.strictObject({
  subject: z.strictObject({
    observationId: z.literal("new-kronos.timecard.displayed-eid"),
    expectedEid: EidSchema,
    /** `.emp-nav-id` verbatim; deliberately NOT `EidSchema` — a wrong id is the point. */
    observedEmployeeId: z.string().min(1),
    /** The name the timecard's own employee selector displays. */
    observedDisplayName: z.string().min(1),
    matches: z.literal(true),
  }),
  range: z.strictObject({
    requestedStart: TimecardDateSchema,
    requestedEnd: TimecardDateSchema,
    /** WFD's period label verbatim, e.g. `"6/01/2026 - 8/12/2026"`. */
    observedLabel: z.string().min(1),
    observedStart: TimecardDateSchema,
    observedEnd: TimecardDateSchema,
    applied: z.literal(true),
  }),
  grid: z.strictObject({
    /** The header row the columns were bound against, BY NAME. */
    columnHeaders: z.array(z.string().min(1)).min(1),
    /** How many scroll steps the virtualized grid needed. */
    scrollSteps: z.number().int().nonnegative(),
    /** Calendar days the read covered — equal to the applied window by construction. */
    daysCovered: z.number().int().positive(),
    populatedRows: z.number().int().nonnegative(),
    /** S38's absent arm: a real, correct read of a card with no punches. */
    lastPunchDate: TimecardDateSchema.nullable(),
    punchDates: z.array(TimecardDateSchema),
    sickDates: z.array(TimecardDateSchema),
    holidayDates: z.array(TimecardDateSchema),
    payCodeDays: z.array(TimecardPayCodeDaySchema),
    unclassifiedPayCodes: z.array(z.string().min(1)),
  }),
});
export type ReadSeparationTimecardOutput = z.infer<typeof ReadSeparationTimecardOutputSchema>;

export const NewKronosReadSeparationTimecard = defineTaskContract({
  id: taskId("new-kronos/read-separation-timecard"),
  title: "Read New Kronos Separation Timecard",
  effect: "read",
  input: z.strictObject({
    emplId: EidSchema,
    rangeStart: TimecardRangeBoundSchema,
    rangeEnd: TimecardRangeBoundSchema,
  }),
  output: ReadSeparationTimecardOutputSchema,
  errorCodes: [
    "new-kronos-unavailable",
    "unexpected-page-state",
    "subject-mismatch",
    "timecard-navigation-failed",
    "timecard-range-not-applied",
    "timecard-unreadable",
  ],
  /**
   * The wrong-person control (S37, and the `T002173685` class of incident doc
   * ref write-safety §14 exists for). `.emp-nav-id` is the timecard's OWN identity header;
   * page-wide text is forbidden because the searched EID lingers in the search
   * chrome, which is exactly how legacy read one person's punches onto
   * another's separation.
   */
  subject: {
    kind: "person",
    expected: { fromInput: ContractFieldPathSchema.parse("emplId"), identity: "eid" },
    observe: ObservationIdSchema.parse("new-kronos.timecard.displayed-eid"),
    match: "normalized-exact-eid",
    requiredAt: "before-subject-read",
  },
  /** See `search-employee`: `Infinity` is argued by separations §5 residual 5A. */
  freshness: { defaultMaxAgeMs: Number.POSITIVE_INFINITY, defaultOverride: "audited" },
  provenance: { default: "live" },
  scenarios: [
    "separations-kronos-timecard/reads-a-real-timecard",
    "separations-kronos-timecard/timecard-without-punches",
    "separations-kronos-timecard/wrong-employee-timecard",
  ],
  example: {
    subject: {
      observationId: "new-kronos.timecard.displayed-eid",
      expectedEid: "10776990",
      observedEmployeeId: "10776990",
      observedDisplayName: "Kou, Nathan",
      matches: true,
    },
    range: {
      requestedStart: "06/01/2026",
      requestedEnd: "08/12/2026",
      observedLabel: "6/01/2026 - 8/12/2026",
      observedStart: "06/01/2026",
      observedEnd: "08/12/2026",
      applied: true,
    },
    grid: {
      columnHeaders: [
        "Date", "Schedule", "In", "Out", "Transfer", "Pay code",
        "Amount", "Shift", "Daily", "Period", "Absence",
      ],
      scrollSteps: 9,
      daysCovered: 73,
      populatedRows: 74,
      lastPunchDate: "06/12/2026",
      punchDates: ["06/01/2026", "06/08/2026", "06/12/2026"],
      sickDates: [],
      holidayDates: ["06/19/2026"],
      payCodeDays: [
        { date: "06/19/2026", payCode: "Holiday - Hourly", amount: "4.00" },
        { date: "06/19/2026", payCode: "Juneteenth Observed", amount: "0.00" },
      ],
      unclassifiedPayCodes: ["Juneteenth Observed"],
    },
  },
});
