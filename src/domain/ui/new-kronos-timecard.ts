/**
 * New Kronos (UKG Dimensions / WFD) — the two page visits the separations
 * timecard read touches, and the semantic vocabulary its driver resolves.
 *
 * TWO screens, therefore TWO tasks (D194 / doc 01 §2.8): the **Employee Search
 * results** panel and the **Timecard**. Everything a run does on the timecard —
 * Go To, the subject proof, the range apply, the grid read — is one visit to
 * one page, because none of those steps can be re-entered without redoing the
 * whole navigation; doc `separations.md` §2.4's five-task draft predates the
 * extraction-width rule ratified later in the same document.
 *
 * Facts that shape every recipe below, each live-verified read-only on
 * **2026-08-12** against `https://ucsd-sso.prd.mykronos.com/wfd/home`:
 *
 *  - **The search panel renders in TWO contexts and the driver must probe both.**
 *    On a fresh home load it is inside `iframe[name^="portal-frame-"]` (the
 *    suffix is session-scoped — `portal-frame-172554836363` and
 *    `portal-frame-227531434843` in two sessions minutes apart). After a
 *    timecard navigation it renders TOP-LEVEL and the page has **no named
 *    frames at all**. Legacy learned this the hard way (`locator.fill: Timeout`,
 *    2026-06-18); it is re-confirmed here rather than inherited.
 *  - **A timeout is never a negative.** The genuine "no such employee" sentinel
 *    (`There are no items to display.`) surfaced in **548 ms** for EID
 *    `99999999`. Legacy waits 15 s and reports silence as `found:false`
 *    (**S35** / pattern D5); here silence is its own outcome and the task fails
 *    loud with that reason.
 *  - **The Go To button proves the SELECTION, not the click.**
 *    `#goToDropdownButton` resolves to exactly ONE node in whichever context
 *    hosts the panel and is `ng-disabled` until a slat is selected — verified
 *    live moving `Selected [0] → Selected [1]`. Enabled is the only evidence
 *    that Angular registered the pick.
 *  - **The timecard grid is VIRTUALIZED.** A 73-day window renders 51 date rows
 *    at `scrollTop: 0`. The driver scrolls and accumulates; the fold refuses a
 *    day set that does not cover the applied window (see
 *    `../kronos/separation-timecard.ts`).
 *  - **The applied range is proved by VALUE.** After Apply the period label
 *    reads `6/01/2026 - 8/12/2026`, so S40 is answered by parsing the label and
 *    comparing calendar days — not by legacy's "the label is different now".
 *
 * Every recipe is role- or id-anchored with no `.or()` chain and no `.first()`
 * on an ambiguous match: each one was counted live and resolves to exactly one
 * node. The one legacy recipe that did NOT (`timecard.payPeriodTriggerButton()`
 * matches both the icon button and `#_timeFrame`) is narrowed, and the
 * narrowing is recorded on the port.
 */
import { z } from "zod";
import {
  EidSchema,
  IsoInstantSchema,
  ElementIdSchema,
  ObservationIdSchema,
  PageStateIdSchema,
  ScreenIdSchema,
} from "../ids.js";
import { TimecardDateSchema, TimecardPayCodeDaySchema } from "../kronos/separation-timecard.js";

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

/**
 * The SUBJECT of every timecard read. `.emp-nav-id` is the timecard's own
 * identity header, and it is the wrong-person control S37 names: page-wide text
 * is forbidden here because the searched EID lingers in the search chrome, which
 * is exactly how legacy read one employee's punches onto another's separation.
 */
export const NEW_KRONOS_TIMECARD_DISPLAYED_EID = ObservationIdSchema.parse(
  "new-kronos.timecard.displayed-eid",
);

/** The employee-search input's own accessible name, used to prove the panel is up. */
export const NEW_KRONOS_SEARCH_QUERY_LABEL = "Search by Employee Name or ID";
/** The literal no-results sentinel, live-verified 2026-08-12. */
export const NEW_KRONOS_NO_RESULTS_SENTINEL = "There are no items to display.";
/**
 * The COMPLETE Go To option list, mapped live 2026-08-12 (§3.2 MAP EVERYTHING).
 * Recorded whole so a later migration knows what else that menu can reach;
 * this chunk uses only `Timecard`.
 */
export const NEW_KRONOS_GO_TO_OPTIONS = Object.freeze([
  "Timecard",
  "Schedule",
  "People",
  "Reports",
] as const);
/**
 * The COMPLETE pay-period dropdown option list, mapped live 2026-08-12.
 * This chunk uses none of them — it always applies an explicit custom range —
 * but the list is the raw material a later chunk would otherwise re-map.
 */
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

/**
 * What one visit to the Employee Search results panel yields.
 *
 * FOUR states, deliberately distinct (S34/S35 — "the day the operator flags a
 * real special case, those are the values the new composition will be selected
 * on"): `resolved` — the queried EID is among the rendered rows; `no-match` —
 * rows rendered but none of them is this person; `no-results` — WFD's own
 * sentinel rendered, a REAL negative; `no-signal` — neither surfaced inside the
 * bound, which is "the check could not run" and never "this person is not
 * timekept here".
 */
export const NewKronosSearchReadSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("resolved"),
    query: z.string().min(1),
    /** WFD's own `Total [N]` counter, verbatim as a number. */
    totalCount: z.number().int().nonnegative(),
    /** Every rendered candidate, in render order — the D194 full surface. */
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
  /** True only when the observed bounds are the requested calendar days (S40). */
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

/**
 * New Kronos's task-facing semantic surface.
 *
 * Two operations, one per page visit. Raw Playwright — the `portal-frame`
 * probe, the virtualized-grid scroll loop, the keystroke date entry — stays in
 * `stores/new-kronos/driver/interpreter.ts`; a task can reach neither.
 *
 * There is no `commit` and no `fill`: this store is read-only for the whole of
 * chunk 1, and adding a mutating operation is a separate, gated slice.
 */
export const NewKronosTimecardDriverSchema = z.strictObject({
  system: z.literal("new-kronos"),
  searchEmployee: SearchEmployeeOperationSchema,
  readSeparationTimecard: ReadSeparationTimecardOperationSchema,
});
export type NewKronosTimecardDriver = z.infer<typeof NewKronosTimecardDriverSchema>;
