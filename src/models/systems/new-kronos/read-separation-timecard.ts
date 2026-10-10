/** ONE visit to the WFD Timecard page: Go To, subject proof, range apply and grid read, with the page-displayed subject and whether the requested window actually applied as first-class outputs. */
import { z } from "zod";
import { EidSchema, ObservationIdSchema, taskId } from "../../../rules/identity/ids.js";
import { TimecardDateSchema, TimecardPayCodeDaySchema } from "../../../rules/kronos/separation-timecard.js";
import { ContractFieldPathSchema, defineTaskContract } from "../../task/task-contract.js";

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
    /** Absent means a correct read with no punches. */
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
    /* The wrong-person control: `.emp-nav-id` is the timecard's OWN identity header, and page-wide text is forbidden because the searched EID lingers in the search chrome. */
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
