/** New Kronos (UKG Dimensions / WFD) — the two page visits the separations timecard read touches, and the semantic vocabulary its driver resolves. */
import { z } from "zod";
import {
  EidSchema,
  IsoInstantSchema,
  ElementIdSchema,
  ObservationIdSchema,
  PageStateIdSchema,
  ScreenIdSchema,
} from "../../rules/identity/ids.js";
import { TimecardDateSchema, TimecardPayCodeDaySchema } from "../../rules/kronos/separation-timecard.js";

export const NEW_KRONOS_EMPLOYEE_SEARCH_SCREEN = ScreenIdSchema.parse("new-kronos.employee-search");
export const NEW_KRONOS_TIMECARD_SCREEN = ScreenIdSchema.parse("new-kronos.timecard");

export const NEW_KRONOS_SEARCH_OPEN_BUTTON = ElementIdSchema.parse(
  "new-kronos.employee-search.open-button",
);
export const NEW_KRONOS_SEARCH_QUERY_FIELD = ElementIdSchema.parse(
  "new-kronos.employee-search.query-field",
);
export const NEW_KRONOS_SEARCH_SUBMIT_BUTTON = ElementIdSchema.parse(
  "new-kronos.employee-search.submit-button",
);
export const NEW_KRONOS_SEARCH_NO_RESULTS_TEXT = ElementIdSchema.parse(
  "new-kronos.employee-search.no-results-text",
);
export const NEW_KRONOS_SEARCH_RESULT_SLAT = ElementIdSchema.parse(
  "new-kronos.employee-search.result-slat",
);
export const NEW_KRONOS_SEARCH_RESULT_CHECKBOX = ElementIdSchema.parse(
  "new-kronos.employee-search.result-select-checkbox",
);
export const NEW_KRONOS_SEARCH_CLOSE_BUTTON = ElementIdSchema.parse(
  "new-kronos.employee-search.close-button",
);
export const NEW_KRONOS_SEARCH_GO_TO_BUTTON = ElementIdSchema.parse(
  "new-kronos.employee-search.go-to-button",
);
export const NEW_KRONOS_SEARCH_GO_TO_TIMECARD_OPTION = ElementIdSchema.parse(
  "new-kronos.employee-search.go-to-timecard-option",
);

export const NEW_KRONOS_TIMECARD_EMPLOYEE_ID = ElementIdSchema.parse(
  "new-kronos.timecard.employee-id",
);
export const NEW_KRONOS_TIMECARD_PERIOD_TRIGGER = ElementIdSchema.parse(
  "new-kronos.timecard.period-trigger-button",
);
export const NEW_KRONOS_TIMECARD_PERIOD_LABEL = ElementIdSchema.parse(
  "new-kronos.timecard.period-label",
);
export const NEW_KRONOS_TIMECARD_SELECT_RANGE_BUTTON = ElementIdSchema.parse(
  "new-kronos.timecard.select-range-button",
);
export const NEW_KRONOS_TIMECARD_RANGE_START_FIELD = ElementIdSchema.parse(
  "new-kronos.timecard.range-start-field",
);
export const NEW_KRONOS_TIMECARD_RANGE_END_FIELD = ElementIdSchema.parse(
  "new-kronos.timecard.range-end-field",
);
export const NEW_KRONOS_TIMECARD_RANGE_APPLY_BUTTON = ElementIdSchema.parse(
  "new-kronos.timecard.range-apply-button",
);

export const NEW_KRONOS_SEARCH_RESULTS_READY = PageStateIdSchema.parse(
  "new-kronos.employee-search.results-ready",
);
export const NEW_KRONOS_SEARCH_NO_RESULTS = PageStateIdSchema.parse(
  "new-kronos.employee-search.no-results",
);
export const NEW_KRONOS_TIMECARD_READY = PageStateIdSchema.parse("new-kronos.timecard.ready");
export const NEW_KRONOS_TIMECARD_RANGE_APPLIED = PageStateIdSchema.parse(
  "new-kronos.timecard.range-applied",
);

/** The SUBJECT of every timecard read: `.emp-nav-id` is the timecard's own identity header, and page-wide text is forbidden because the searched EID lingers in the search chrome. */
export const NEW_KRONOS_TIMECARD_DISPLAYED_EID = ObservationIdSchema.parse(
  "new-kronos.timecard.displayed-eid",
);

/** The employee-search input's own accessible name, used to prove the panel is up. */
export const NEW_KRONOS_SEARCH_QUERY_LABEL = "Search by Employee Name or ID";
/** The literal no-results sentinel. */
export const NEW_KRONOS_NO_RESULTS_SENTINEL = "There are no items to display.";
/** Preserve the complete observed menu; this operation uses only Timecard. */
export const NEW_KRONOS_GO_TO_OPTIONS = Object.freeze([
  "Timecard",
  "Schedule",
  "People",
  "Reports",
] as const);
/** Retain the observed options; this operation applies an explicit custom range. */
export const NEW_KRONOS_PERIOD_OPTIONS = Object.freeze([
  "Previous Pay Period",
  "Current Pay Period",
  "Next Pay Period",
  "Previous Schedule Period",
  "Current Schedule Period",
  "Next Schedule Period",
  "Next Schedule Period + 1",
  "Next Schedule Period + 2",
  "Today",
  "Yesterday",
  "Tomorrow",
  "Week to Date",
  "Month to Date",
  "Last Week",
  "Yesterday, Today, Tomorrow",
  "Yesterday Plus 6 Days",
  "Yesterday Minus 13 Days",
  "Last 7 Days",
  "Last 30 Days",
  "Current Week",
  "Last 4 Weeks",
  "Last 3 Months",
  "Last 90 Days",
  "Last 4 Quarters",
] as const);

/** One candidate the search panel rendered, off the row's own accessible name. */
export const NewKronosSearchCandidateSchema = z.strictObject({
  /** `Last, First M` exactly as WFD rendered it. */
  displayName: z.string().min(1),
  employeeId: z.string().regex(/^\d{6,10}$/u, "Kronos employee id must be 6-10 digits"),
});
export type NewKronosSearchCandidate = z.infer<typeof NewKronosSearchCandidateSchema>;

/** What one visit to the Employee Search results panel yields: FOUR states, deliberately distinct, so a run that could not search is never reported as a person who is not timekept. */
export const NewKronosSearchReadSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("resolved"),
    query: z.string().min(1),
    /** WFD's own `Total [N]` counter, verbatim as a number. */
    totalCount: z.number().int().nonnegative(),
    /** Every rendered candidate, in render order — the full surface. */
    candidates: z.array(NewKronosSearchCandidateSchema).min(1),
    /** The row whose employee id equals the queried EID. */
    matched: NewKronosSearchCandidateSchema,
    /** WFD's `Selected [N]` counter AFTER the pick; the Go To enable proof. */
    selectedCount: z.number().int().positive(),
    /** Which context rendered the panel on this visit. */
    panelContext: z.enum(["portal-frame", "top-level"]),
    observedAt: IsoInstantSchema,
  }),
  z.strictObject({
    state: z.literal("no-match"),
    query: z.string().min(1),
    totalCount: z.number().int().positive(),
    /** Every row WFD did render, so the operator can see WHO it offered instead. */
    candidates: z.array(NewKronosSearchCandidateSchema).min(1),
    panelContext: z.enum(["portal-frame", "top-level"]),
    observedAt: IsoInstantSchema,
  }),
  z.strictObject({
    state: z.literal("no-results"),
    query: z.string().min(1),
    /** The sentinel text observed, verbatim. */
    sentinel: z.literal(NEW_KRONOS_NO_RESULTS_SENTINEL),
    panelContext: z.enum(["portal-frame", "top-level"]),
    observedAt: IsoInstantSchema,
  }),
  z.strictObject({
    state: z.literal("no-signal"),
    query: z.string().min(1),
    /** Why the check could not run — never a stand-in for "not found". */
    reason: z.string().min(1),
    waitedMs: z.number().int().nonnegative(),
    observedAt: IsoInstantSchema,
  }),
]);
export type NewKronosSearchRead = z.infer<typeof NewKronosSearchReadSchema>;

/** The timecard's own identity, read off its header before anything else. */
export const NewKronosTimecardSubjectSchema = z.strictObject({
  observationId: z.literal(NEW_KRONOS_TIMECARD_DISPLAYED_EID),
  expectedEid: EidSchema,
  /** `.emp-nav-id` verbatim. Not constrained to `EidSchema`: a WRONG employee is the whole point. */
  observedEmployeeId: z.string().min(1),
  /** `#combo_inptxt` — the name the timecard itself displays. */
  observedDisplayName: z.string().min(1),
  matches: z.boolean(),
});
export type NewKronosTimecardSubject = z.infer<typeof NewKronosTimecardSubjectSchema>;

/** The window the view is PROVED to be showing, parsed back off the period label. */
export const NewKronosAppliedRangeSchema = z.strictObject({
  requestedStart: TimecardDateSchema,
  requestedEnd: TimecardDateSchema,
  /** The period label verbatim, e.g. `"6/01/2026 - 8/12/2026"`. */
  observedLabel: z.string().min(1),
  observedStart: TimecardDateSchema,
  observedEnd: TimecardDateSchema,
  /** True only when observed bounds equal the requested calendar days. */
  applied: z.literal(true),
});
export type NewKronosAppliedRange = z.infer<typeof NewKronosAppliedRangeSchema>;

/** What the accumulated, coverage-checked grid read yielded. */
export const NewKronosTimecardGridSchema = z.strictObject({
  /** Header row verbatim, as the columns were bound BY NAME. */
  columnHeaders: z.array(z.string().min(1)).min(1),
  /** How many scroll steps the virtualized grid needed; 0 means it all fitted. */
  scrollSteps: z.number().int().nonnegative(),
  /** Calendar days the read covered — equal to the applied window, by construction. */
  daysCovered: z.number().int().positive(),
  /** Grid rows carrying any value; a day with nothing on it contributes none. */
  populatedRows: z.number().int().nonnegative(),
  lastPunchDate: TimecardDateSchema.nullable(),
  punchDates: z.array(TimecardDateSchema),
  sickDates: z.array(TimecardDateSchema),
  holidayDates: z.array(TimecardDateSchema),
  payCodeDays: z.array(TimecardPayCodeDaySchema),
  unclassifiedPayCodes: z.array(z.string().min(1)),
});
export type NewKronosTimecardGrid = z.infer<typeof NewKronosTimecardGridSchema>;

/** One visit to the Timecard page: navigate, prove subject, apply range, read. */
export const NewKronosTimecardReadSchema = z.strictObject({
  subject: NewKronosTimecardSubjectSchema,
  range: NewKronosAppliedRangeSchema,
  grid: NewKronosTimecardGridSchema,
  observedAt: IsoInstantSchema,
});
export type NewKronosTimecardRead = z.infer<typeof NewKronosTimecardReadSchema>;

const SearchEmployeeOperationSchema = z.custom<(
  input: Readonly<{ employeeId: string; searchTimeoutMs: number }>,
) => Promise<NewKronosSearchRead>>((value) => typeof value === "function");

const ReadSeparationTimecardOperationSchema = z.custom<(
  input: Readonly<{ employeeId: string; rangeStart: string; rangeEnd: string }>,
) => Promise<NewKronosTimecardRead>>((value) => typeof value === "function");

/** New Kronos's task-facing semantic surface; two operations, one per page visit. */
export const NewKronosTimecardDriverSchema = z.strictObject({
  system: z.literal("new-kronos"),
  searchEmployee: SearchEmployeeOperationSchema,
  readSeparationTimecard: ReadSeparationTimecardOperationSchema,
});
export type NewKronosTimecardDriver = z.infer<typeof NewKronosTimecardDriverSchema>;
