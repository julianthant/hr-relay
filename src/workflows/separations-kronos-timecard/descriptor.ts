/**
 * `separations-kronos-timecard` — chunk 1 of the separations migration
 * (`docs/migrations/separations.md` §3): the New Kronos passage, provable
 * ALONE, read-only, and composed later from the same tasks rather than from
 * this descriptor.
 *
 * It is a proving harness with a real job: it brings the `new-kronos` store
 * into existence (driver, login recipe, UI registry, tasks) and it is what
 * gives that store a live dry-run proof before any write chunk depends on it.
 * §3's honest note applies — the full `separations` graph will reuse these
 * TASKS directly, and this descriptor stays as the piece that made them
 * provable.
 *
 * ## What §4b binds here
 *
 * The operator's answer is HARD-FAIL, always: an unreachable Kronos, a failed
 * search, a timecard that will not open, a wrong-subject timecard, an
 * unreadable card — every one of them terminalizes `failed`. There is no park
 * arm and no proceed-on-the-Kuali-date arm in this graph, and there is
 * deliberately no `when` on either node: **no run mode changes the graph at
 * all.** The distinctions §4b insists on surviving live in the task contracts'
 * error codes, which are what a failed run durably records.
 *
 * ## Why two nodes and not five
 *
 * D194 / doc 01 §2.8: a read task's identity is a PAGE VISIT. The search
 * results panel and the timecard are two page visits; Go To, the subject proof,
 * the range apply and the grid read are all one visit to the timecard and
 * cannot be re-entered independently. §2.4's five-task sketch predates the
 * extraction-width rule ratified later in the same document.
 *
 * This module is bundle-safe: it value-imports only zod, `src/domain/**`, and
 * the audited `src/base` builders.
 */
import { z } from "zod";
import { flow } from "../../base/flow.js";
import { defineWorkflowDescriptor, requireFact } from "../../base/workflow.js";
import {
  NewKronosReadSeparationTimecard,
  ReadSeparationTimecardOutputSchema,
  TimecardRangeBoundSchema,
} from "../../domain/contracts/new-kronos/read-separation-timecard.js";
import {
  NewKronosSearchEmployee,
  SearchEmployeeOutputSchema,
} from "../../domain/contracts/new-kronos/search-employee.js";
import { CANONICAL_FIELDS } from "../../domain/fields/registry.js";
import { EidSchema, WorkflowIdSchema } from "../../domain/ids.js";
import { TimecardDateSchema } from "../../domain/kronos/separation-timecard.js";
import { classifyNameSimilarity, NameSimilarityTierSchema } from "../../domain/matching/name-match.js";
import {
  BUILD_MANIFEST,
  resolveWorkflowFingerprint,
} from "../../domain/workflow/build-manifest.js";
import { defineCanonicalInput } from "../../domain/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../domain/workflow/presentation.js";

/**
 * The employee's name as the run expects it — the SAME canonical schema object
 * a spreadsheet column binds through (D172), not a structurally identical copy.
 */
const EmployeeNameSchema = CANONICAL_FIELDS.fullName.schema;

/**
 * How long a search may go without answering EITHER WAY. Defaulted at 15s: the
 * genuine no-results sentinel surfaced in 548ms live on 2026-08-12, so this is
 * not a "give the grid a chance" allowance — it is the line past which silence
 * becomes its own reported failure instead of a fabricated negative (S35).
 */
const SEARCH_TIMEOUT_DEFAULT_MS = 15_000;

/** The ingress schema — the ONE place defaults are applied (doc 02 §2). */
export const SeparationsKronosTimecardInput = z.strictObject({
  emplId: EidSchema,
  /** What the run believes the person is called; compared, never substituted. */
  expectedName: EmployeeNameSchema,
  rangeStart: TimecardRangeBoundSchema,
  rangeEnd: TimecardRangeBoundSchema,
  searchTimeoutMs: z.number().int().positive().max(120_000).default(SEARCH_TIMEOUT_DEFAULT_MS),
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
    /**
     * The same classifier doc 09 §14's identity gate uses. It is REPORTED, not
     * enforced: the wrong-PERSON control is the EID subject binding, which has
     * already failed the run by the time this result exists. UKG and Kuali
     * render names differently, so failing on a name difference here would
     * refuse correct runs while adding nothing the EID proof does not give.
     */
    nameSimilarity: NameSimilarityTierSchema,
  }),
  /** The window the grid was PROVED to be showing when it was read (S40). */
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
    /** `null` is S38's REAL outcome — a card that opened and holds no punches. */
    lastPunchDate: TimecardDateSchema.nullable(),
    punchDates: z.array(TimecardDateSchema),
    sickDates: z.array(TimecardDateSchema),
    holidayDates: z.array(TimecardDateSchema),
    payCodeDays: ReadSeparationTimecardOutputSchema.shape.grid.shape.payCodeDays,
    /**
     * Pay codes the ported `/sick/i` and `/holiday/i` rules do not classify.
     * Surfaced so an unrecognised holiday cannot silently drop out of a date
     * the composition will later file a termination on.
     */
    unclassifiedPayCodes: z.array(z.string().min(1)),
  }),
  /**
   * The timecard-local derivation, and ONLY that. Reconciliation against the
   * Kuali-carried dates (LDW override, separation date, effective date + 1) is
   * separations' own pure mini-store and lands with the composition chunk —
   * this chunk must not grow a second home for it.
   */
  derived: z.strictObject({
    /** Legacy's Last Day Worked candidate: the last physical punch. */
    lastPunchDate: TimecardDateSchema.nullable(),
    /** The later of the last sick day and the last holiday day, if any (S39). */
    latestLeaveDate: TimecardDateSchema.nullable(),
    /** `max(lastPunch, latestLeave)`; `null` only when the card is empty. */
    separationDateCandidate: TimecardDateSchema.nullable(),
    /** Distinguishes "read a card with no punches" from every failure (S34/S38). */
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

const separationsKronosTimecardFlow = flow(SeparationsKronosTimecardInput)
  .step("search", NewKronosSearchEmployee, {
    label: "Employee Search",
    dependsOn: [],
    /**
     * `always-rerun`, and this is the load-bearing choice in the graph.
     *
     * The search's OUTPUT is durable, but its POINT is a side effect that is
     * not: it leaves the employee selected in the WFD search panel, which is
     * the only thing that enables Go To. Replaying the checkpoint restores the
     * output into a FRESH browser that has never opened the panel, so the
     * timecard node then refuses — observed live on run `sk-124132-9beb`
     * (2026-08-12), which replayed the previous attempt's search checkpoint and
     * failed at Go To with an empty panel.
     *
     * The general rule this settles: **a node whose real product is BROWSER
     * state may not be `replay: "checkpoint"`.** Doc 02 §5.3 replay restores
     * values, never page state, so a downstream task whose precondition is a
     * live page must be preceded by a node that actually runs. The search is a
     * ~2s read; re-running it is strictly cheaper than the failure mode.
     */
    replay: "always-rerun",
    bind: ({ input }) => ({ emplId: input.emplId, searchTimeoutMs: input.searchTimeoutMs }),
  })
  .step("timecard", NewKronosReadSeparationTimecard, {
    label: "Timecard",
    // The timecard visit begins from the selection the search node left in the
    // panel, so it depends on it structurally as well as semantically: Go To is
    // disabled without it, and a disabled Go To is a loud failure, never an
    // empty card.
    dependsOn: ["search"],
    replay: "checkpoint",
    bind: ({ input, outputs }) => {
      // The EID comes from the RUN INPUT, not from the row text: the search
      // task already refused unless `matched.employeeId` equalled it, so
      // re-deriving it from the page would add a parse without adding a proof.
      // Reading the fact here is what makes the dependency load-bearing rather
      // than decorative — a search that produced no match never reaches this
      // node at all.
      requireFact(outputs.search.matched, "search", "matched");
      return { emplId: input.emplId, rangeStart: input.rangeStart, rangeEnd: input.rangeEnd };
    },
  })
  .build({
    schema: SeparationsKronosTimecardResultSchema,
    dependsOn: ["search", "timecard"],
    derive: ({ input, outputs }) => {
      const { subject, range, grid } = outputs.timecard;
      const latestLeaveDate = latestDate([...grid.sickDates, ...grid.holidayDates]);
      const candidates = [grid.lastPunchDate, latestLeaveDate]
        .filter((value): value is string => value !== null);
      return {
        subject: {
          expectedEid: input.emplId,
          observedEmployeeId: subject.observedEmployeeId,
          expectedName: input.expectedName,
          observedDisplayName: subject.observedDisplayName,
          nameSimilarity: classifyNameSimilarity(input.expectedName, subject.observedDisplayName),
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
  });

export const separationsKronosTimecardDescriptor = defineWorkflowDescriptor({
  id: "separations-kronos-timecard",
  version: 1,
  contractFingerprint: resolveWorkflowFingerprint(
    BUILD_MANIFEST,
    WorkflowIdSchema.parse("separations-kronos-timecard"),
  ),
  code: "sk",
  label: "Separation Timecard",
  icon: "CalendarClock",
  category: "timekeeping",
  canonicalInput: SeparationsKronosTimecardCanonicalInput,
  inputSubject: "eid",
  surface: { shape: "single" },
  enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS,
  /**
   * No `inputRun` surface, deliberately. The paste-a-line parser splits ONE
   * token per item, and this workflow's input is four correlated values
   * (EID, expected name, and both window bounds) — a parser that emitted only
   * the EID would have to invent the window, which is the substitution this
   * program bans. Runs are started through the generic start-plan / command
   * path with structured input; nothing about that needs a surface here, and
   * the queue and run-detail wires already render this workflow off the
   * registry.
   */
  surfaces: {},
  /**
   * No `capabilities` block at all — no Review panel and no Edit Data fields.
   * The timecard is ground truth for a real termination's dates; an operator
   * correcting a punch date here would be substituting exactly the value the
   * run exists to establish, which is §4b's whole posture ("no path through
   * this workflow files a termination on a date nobody read"). A later chunk
   * declares its own.
   */
  verdicts: [
    { key: "no-punches", label: "No punches", tone: "warning", tag: true },
    { key: "unclassified-pay-codes", label: "Unclassified pay codes", tone: "warning", tag: true },
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
  identity: {
    matchKey: (input) => `kronos-timecard:${input.emplId}:${input.rangeStart}:${input.rangeEnd}`,
  },
  presentation: {
    title: (input) => `EID ${input.emplId}`,
    subtitle: (input) => `${input.rangeStart} – ${input.rangeEnd}`,
  },
  scenarios: [
    "separations-kronos-timecard/reads-a-real-timecard",
    "separations-kronos-timecard/timecard-without-punches",
    "separations-kronos-timecard/employee-not-found",
    "separations-kronos-timecard/search-no-signal",
    "separations-kronos-timecard/wrong-employee-timecard",
  ],
  flow: separationsKronosTimecardFlow,
});
