// Read-only harness proves the login recipe; compositions reuse its tasks.
// Each node is a page visit; failures never park.
import { z } from "zod";
import { defineWorkflow } from "../../../../workflow-kit/workflow-definition.js";
import { requireFact } from "../../../../workflow-kit/workflow.js";
import {
  ReadSeparationTimecardOutputSchema,
  TimecardRangeBoundSchema,
} from "../../../../models/systems/new-kronos/read-separation-timecard.js";
import {
  NewKronosSearchEmployee,
  SearchEmployeeOutputSchema,
} from "../../../../models/systems/new-kronos/search-employee.js";
import { CANONICAL_FIELDS } from "../../../../models/fields/registry.js";
import { EidSchema } from "../../../../rules/identity/ids.js";
import { TimecardDateSchema } from "../../../../rules/kronos/separation-timecard.js";
import {
  classifyNameSimilarity,
  NameSimilarityTierSchema,
} from "../../../../rules/matching/name-match.js";
import { defineCanonicalInput } from "../../../../models/workflow/canonical-input.js";
import { defineWorkflowRole } from "../../../../workflow-kit/validation/module-role.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../models/workflow/presentation.js";
import { timecardNode, KRONOS_TIMECARD_STEP } from "../../workflow.js";
/** The employee's name as the run expects it — the SAME canonical schema object a spreadsheet column binds through, not a structurally identical copy. */
const EmployeeNameSchema = CANONICAL_FIELDS.fullName.schema;

/** Search timeout: a search that answers neither way by this budget reports silence as its own failure, never a no-results negative. */
const SEARCH_TIMEOUT_DEFAULT_MS = 15_000;

/** The ingress schema — the ONE place defaults are applied (ref workflow-model §2). */
export const SeparationsKronosTimecardInput = z.strictObject({
  emplId: EidSchema,
  /** What the run believes the person is called; compared, never substituted. */
  expectedName: EmployeeNameSchema,
  rangeStart: TimecardRangeBoundSchema,
  rangeEnd: TimecardRangeBoundSchema,
  searchTimeoutMs: z
    .number()
    .int()
    .positive()
    .max(120_000)
    .default(SEARCH_TIMEOUT_DEFAULT_MS),
});

/** The validation-only view of the stored snapshot: same shape, no defaults. */
export const SeparationsKronosTimecardCanonicalInput = defineCanonicalInput(
  SeparationsKronosTimecardInput,
  z.strictObject({
    emplId: EidSchema,
    expectedName: EmployeeNameSchema,
    rangeStart: TimecardRangeBoundSchema,
    rangeEnd: TimecardRangeBoundSchema,
    searchTimeoutMs: z.number().int().positive().max(120_000),
  }),
  [
    {
      emplId: "10776990",
      expectedName: "Kou, Nathan",
      rangeStart: "06/01/2026",
      rangeEnd: "08/12/2026",
    },
    {
      emplId: "10001573",
      expectedName: "Blirea, Glaundi",
      rangeStart: "1/1/2026",
      rangeEnd: "3/31/2026",
      searchTimeoutMs: 30_000,
    },
  ],
);

export const SeparationsKronosTimecardResultSchema = z.strictObject({
  /** Who the TIMECARD said it was, beside who the run expected. */
  subject: z.strictObject({
    expectedEid: EidSchema,
    observedEmployeeId: z.string().min(1),
    expectedName: z.string().min(1),
    observedDisplayName: z.string().min(1),
    // EID binds identity; system-specific name differences are reported, never refused.
    nameSimilarity: NameSimilarityTierSchema,
  }),
  // The window the grid was proved to be showing when it was read.
  window: z.strictObject({
    requestedStart: TimecardDateSchema,
    requestedEnd: TimecardDateSchema,
    observedStart: TimecardDateSchema,
    observedEnd: TimecardDateSchema,
    observedLabel: z.string().min(1),
    daysCovered: z.number().int().positive(),
  }),
  /** What the card carried, raw. */
  timecard: z.strictObject({
    // `null` is the real outcome: a card that opened and holds no punches.
    lastPunchDate: TimecardDateSchema.nullable(),
    punchDates: z.array(TimecardDateSchema),
    sickDates: z.array(TimecardDateSchema),
    holidayDates: z.array(TimecardDateSchema),
    payCodeDays:
      ReadSeparationTimecardOutputSchema.shape.grid.shape.payCodeDays,
      // Surface unclassified pay codes so unknown leave cannot silently change filing dates.
    unclassifiedPayCodes: z.array(z.string().min(1)),
  }),
  /** The timecard-local derivation, and ONLY that; reconciliation against the Kuali-carried dates
   *  is the composition's own fold — this chunk must not grow a second home for it. */
  derived: z.strictObject({
    /** Legacy's Last Day Worked candidate: the last physical punch. */
    lastPunchDate: TimecardDateSchema.nullable(),
    // The later of the last sick day and the last holiday day, if any.
    latestLeaveDate: TimecardDateSchema.nullable(),
    /** `max(lastPunch, latestLeave)`; `null` only when the card is empty. */
    separationDateCandidate: TimecardDateSchema.nullable(),
    // Distinguishes a card read with no punches from every failure.
    hasPunches: z.boolean(),
  }),
  /** The candidate list the search page rendered, kept as run evidence. */
  search: z.strictObject({
    totalCount: SearchEmployeeOutputSchema.shape.totalCount,
    candidates: SearchEmployeeOutputSchema.shape.candidates,
    panelContext: SearchEmployeeOutputSchema.shape.panelContext,
  }),
});

/** `MM/DD/YYYY` sorts correctly only after it is reordered; keep it explicit. */
function latestDate(dates: readonly string[]): string | null {
  const ordered = [...dates].sort((left, right) => {
    const [lm = "", ld = "", ly = ""] = left.split("/");
    const [rm = "", rd = "", ry = ""] = right.split("/");
    return `${ly}${lm}${ld}`.localeCompare(`${ry}${rm}${rd}`);
  });
  return ordered.at(-1) ?? null;
}

export const separationsKronosTimecardWorkflow = defineWorkflow({
  id: "separations-kronos-timecard",
  version: 1,
  code: "sk",
  label: "Separation Timecard",
  summary:
    "Chunk 1 of the separations migration: the New Kronos passage on its own. Finds the employee in " +
    "the WFD panel and reads the separation timecard for the plan's window — read-only, and " +
    "hard-failing on anything it cannot read.",
  icon: "CalendarClock",
  category: "timekeeping",
  canonicalInput: SeparationsKronosTimecardCanonicalInput,
  inputSubject: "eid",
  surface: { shape: "single" },
  enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS,
  /** No `inputRun` surface, deliberately: the input is four correlated values (EID, name, both window
   *  bounds) a parser would have to invent the rest of — runs start through the generic start-plan/command path. */
  surfaces: {},
  // Edit Data must not substitute the punch evidence this read establishes.
  verdicts: [
    { key: "no-punches", label: "No punches", tone: "warning", tag: true },
    {
      key: "unclassified-pay-codes",
      label: "Unclassified pay codes",
      tone: "warning",
      tag: true,
    },
  ],
  details: [
    {
      key: "last-punch",
      label: "Last punch",
      source: { nodeId: "timecard", fieldPath: "grid.lastPunchDate" },
      display: "text",
    },
    {
      key: "applied-window",
      label: "Window",
      source: { nodeId: "timecard", fieldPath: "range.observedLabel" },
      display: "text",
    },
    {
      key: "displayed-employee",
      label: "Timecard shows",
      source: { nodeId: "timecard", fieldPath: "subject.observedDisplayName" },
      display: "text",
    },
  ],
  // The timecard's own header names the person, never the search candidate list.
  subjectProjection: {
    nodeId: "timecard",
    fieldPath: "subject.observedDisplayName",
  },
  identity: {
    matchKey: (input) =>
      `kronos-timecard:${input.emplId}:${input.rangeStart}:${input.rangeEnd}`,
  },
  presentation: {
    title: (input) => `EID ${input.emplId}`,
    subtitle: (input) => `${input.rangeStart} – ${input.rangeEnd}`,
  },
  /** The descriptor's own words about each node, projected by the explorer. */
  nodePurposes: [
    {
      nodeId: "search",
      purpose:
        "Searches the New Kronos WFD panel for the employee and leaves them SELECTED — the selection is " +
        "what enables Go To, so this node's real product is browser state and it re-runs on every " +
        "attempt.",
    },
    {
      nodeId: "timecard",
      purpose:
        "Opens the selected employee's timecard and reads the whole separation window — last punch, sick " +
        "and holiday days, and any pay code nobody has classified — refusing a range it cannot prove the " +
        "grid was showing.",
    },
  ],
  scenarios: [
    "separations-kronos-timecard/reads-a-real-timecard",
    "separations-kronos-timecard/timecard-without-punches",
    "separations-kronos-timecard/employee-not-found",
    "separations-kronos-timecard/search-no-signal",
    "separations-kronos-timecard/wrong-employee-timecard",
  ],
  input: SeparationsKronosTimecardInput,
  role: defineWorkflowRole({
    kind: "chunk-harness",
    of: "separations",
    step: KRONOS_TIMECARD_STEP.key,
  }),
  steps: ({ task, result }) => {
    /** `always-rerun`: replaying a checkpoint restores values but cannot restore the WFD panel selection the timecard visit needs, so `replay:"checkpoint"` is unsafe here. */
    const search = task(
      {
        id: "search",
        contract: NewKronosSearchEmployee,
        label: "Employee Search",
        replay: "always-rerun",
      },
      [],
      ({ input }) => ({
        emplId: input.emplId,
        searchTimeoutMs: input.searchTimeoutMs,
      }),
    );
    // This harness search has its own identity; reuse only the composition timecard entry.
    const timecard = task(timecardNode, [search], ({ input, outputs }) => {
      // Search already proved the input EID; require its match before reading the timecard.
      requireFact(outputs.search.matched, "search", "matched");
      return {
        emplId: input.emplId,
        rangeStart: input.rangeStart,
        rangeEnd: input.rangeEnd,
      };
    });
    return {
      // The harness IS the step it proves: one timeline group, the step's own.
      steps: [[KRONOS_TIMECARD_STEP, [search, timecard]]],
      result: result(
        SeparationsKronosTimecardResultSchema,
        [search, timecard],
        ({ input, outputs }) => {
          const { subject, range, grid } = outputs.timecard;
          const latestLeaveDate = latestDate([
            ...grid.sickDates,
            ...grid.holidayDates,
          ]);
          const candidates = [grid.lastPunchDate, latestLeaveDate].filter(
            (value): value is string => value !== null,
          );
          return {
            subject: {
              expectedEid: input.emplId,
              observedEmployeeId: subject.observedEmployeeId,
              expectedName: input.expectedName,
              observedDisplayName: subject.observedDisplayName,
              nameSimilarity: classifyNameSimilarity(
                input.expectedName,
                subject.observedDisplayName,
              ),
            },
            window: {
              requestedStart: range.requestedStart,
              requestedEnd: range.requestedEnd,
              observedStart: range.observedStart,
              observedEnd: range.observedEnd,
              observedLabel: range.observedLabel,
              daysCovered: grid.daysCovered,
            },
            timecard: {
              lastPunchDate: grid.lastPunchDate,
              punchDates: grid.punchDates,
              sickDates: grid.sickDates,
              holidayDates: grid.holidayDates,
              payCodeDays: grid.payCodeDays,
              unclassifiedPayCodes: grid.unclassifiedPayCodes,
            },
            derived: {
              lastPunchDate: grid.lastPunchDate,
              latestLeaveDate,
              separationDateCandidate: latestDate(candidates),
              hasPunches: grid.punchDates.length > 0,
            },
            search: {
              totalCount: outputs.search.totalCount,
              candidates: outputs.search.candidates,
              panelContext: outputs.search.panelContext,
            },
          };
        },
      ),
    };
  },
});
