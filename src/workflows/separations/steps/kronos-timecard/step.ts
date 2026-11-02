// The read-only proof covers the login recipe and timecard passage.
import { z } from "zod";
import { CANONICAL_FIELDS } from "../../../../models/fields/registry.js";
import {
  NewKronosReadSeparationTimecard,
  ReadSeparationTimecardOutputSchema,
  TimecardRangeBoundSchema,
} from "../../../../models/systems/new-kronos/read-separation-timecard.js";
import { NewKronosSearchEmployee, SearchEmployeeOutputSchema } from "../../../../models/systems/new-kronos/search-employee.js";
import { defineCanonicalInput } from "../../../../models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../models/workflow/presentation.js";
import type { StepOmissionDeclaration } from "../../../../models/workflow/step-omission.js";
import {
  SeparationsReadSeparationDates
} from "../../../../models/workflows/separations/read-separation-dates.js";
import {
  ReadSeparationPlanOutputSchema
} from "../../../../models/workflows/separations/read-separation-plan.js";
import { EidSchema } from "../../../../rules/identity/ids.js";
import { TimecardDateSchema } from "../../../../rules/kronos/separation-timecard.js";
import {
  classifyNameSimilarity,
  NameSimilarityTierSchema,
} from "../../../../rules/matching/name-match.js";
import {
  assertSeparationDates
} from "../../../../rules/separations/separation-dates.js";
import type { JsonObject, JsonValue } from "../../../../rules/validation/canonical-json.js";
import type { StepProofSpec, WorkflowAuthor } from "../../../../workflow-kit/workflow-definition.js";
import { defineStep, defineStepEntries } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep, requireFact } from "../../../../workflow-kit/workflow.js";
import type { SeparationsInput } from "../../workflow.js";
import type { resolveSubject } from "../identity-check/step.js";
import type { buildExtraction } from "../kuali-extraction/step.js";
type Author = WorkflowAuthor<typeof SeparationsInput>;
type Extraction = ReturnType<typeof buildExtraction>;
type Subject = ReturnType<typeof resolveSubject>;

export const KRONOS_TIMECARD_STEP = defineWorkflowStep({
  key: "kronos-timecard",
  label: "Kronos timecard",
});

export const TIMECARD_SEARCH_NODE = "timecard-search";
export const TIMECARD_NODE = "timecard";
export const DATES_NODE = "dates";

const kronosTimecardEntries = defineStepEntries(KRONOS_TIMECARD_STEP);

const timecardSearchNode = kronosTimecardEntries.task(TIMECARD_SEARCH_NODE, NewKronosSearchEmployee, {
  label: "Timecard Search",
  replay: "always-rerun",
});

export const timecardNode = kronosTimecardEntries.task(TIMECARD_NODE, NewKronosReadSeparationTimecard, {
  label: "Timecard",
  replay: "checkpoint",
});

const datesNode = kronosTimecardEntries.task(DATES_NODE, SeparationsReadSeparationDates, {
  label: "Reconciled Dates",
  replay: "checkpoint",
});

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const KronosTimecardFactsSchema = z.strictObject({
  lastDayWorked: z.string().min(1),
  separationDate: z.string().min(1),
});

export const KRONOS_TIMECARD_OMISSION: StepOmissionDeclaration = {
  form: {
    fields: [
      {
        key: "lastDayWorked", label: "Last day worked", kind: "us-date",
        help: "The employee's last physical day of work, MM/DD/YYYY. Kronos is not read; this stands in for the card's last punch.",
      },
      {
        key: "separationDate", label: "Separation date", kind: "us-date",
        help: "The last day on pay status, MM/DD/YYYY — the same day as the last day worked unless paid leave follows it. The termination is effective the next day.",
      },
    ],
  },
  produces: {
    [DATES_NODE]: ({ facts, scope }) => {
      const typed = KronosTimecardFactsSchema.parse(facts);
      const plan = ReadSeparationPlanOutputSchema.parse(scope.outputs["plan"]);
      if (!isJsonObject(scope.input)) {
        throw new Error("kronos-timecard omission requires the run's canonical input object to read the timekeeper name");
      }
      const timekeeperName = scope.input.timekeeperName;
      if (typeof timekeeperName !== "string" || timekeeperName.length === 0) {
        throw new Error("kronos-timecard omission requires input.timekeeperName to be a non-empty string");
      }
      return assertSeparationDates({
        plan,
        timekeeperName,
        lastDayWorked: typed.lastDayWorked,
        separationDate: typed.separationDate,
      });
    },
  },
};



const EmployeeNameSchema = CANONICAL_FIELDS.fullName.schema;
const SEARCH_TIMEOUT_DEFAULT_MS = 15_000;
const SeparationsKronosTimecardInput = z.strictObject({
  emplId: EidSchema,
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
const SeparationsKronosTimecardCanonicalInput = defineCanonicalInput(
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
      emplId: "10101010",
      expectedName: "Morrow, Bea",
      rangeStart: "1/1/2026",
      rangeEnd: "3/31/2026",
      searchTimeoutMs: 30_000,
    },
  ],
);
const SeparationsKronosTimecardResultSchema = z.strictObject({
  subject: z.strictObject({
    expectedEid: EidSchema,
    observedEmployeeId: z.string().min(1),
    expectedName: z.string().min(1),
    observedDisplayName: z.string().min(1),
    nameSimilarity: NameSimilarityTierSchema,
  }),
  window: z.strictObject({
    requestedStart: TimecardDateSchema,
    requestedEnd: TimecardDateSchema,
    observedStart: TimecardDateSchema,
    observedEnd: TimecardDateSchema,
    observedLabel: z.string().min(1),
    daysCovered: z.number().int().positive(),
  }),
  timecard: z.strictObject({
    lastPunchDate: TimecardDateSchema.nullable(),
    punchDates: z.array(TimecardDateSchema),
    sickDates: z.array(TimecardDateSchema),
    holidayDates: z.array(TimecardDateSchema),
    payCodeDays:
      ReadSeparationTimecardOutputSchema.shape.grid.shape.payCodeDays,
    unclassifiedPayCodes: z.array(z.string().min(1)),
  }),
  derived: z.strictObject({
    lastPunchDate: TimecardDateSchema.nullable(),
    latestLeaveDate: TimecardDateSchema.nullable(),
    separationDateCandidate: TimecardDateSchema.nullable(),
    hasPunches: z.boolean(),
  }),
  search: z.strictObject({
    totalCount: SearchEmployeeOutputSchema.shape.totalCount,
    candidates: SearchEmployeeOutputSchema.shape.candidates,
    panelContext: SearchEmployeeOutputSchema.shape.panelContext,
  }),
});
function latestDate(dates: readonly string[]): string | null {
  const ordered = [...dates].sort((left, right) => {
    const [lm = "", ld = "", ly = ""] = left.split("/");
    const [rm = "", rd = "", ry = ""] = right.split("/");
    return `${ly}${lm}${ld}`.localeCompare(`${ry}${rm}${rd}`);
  });
  return ordered.at(-1) ?? null;
}

export function buildTimecard({ task, group }: Author, extraction: Extraction, resolved: Subject) {
  const { plan } = extraction, { subject } = resolved;
  const timecardSearch = task(timecardSearchNode, [subject], ({ input, outputs }) => ({
    emplId: outputs["subject"].emplId,
    searchTimeoutMs: input.searchTimeoutMs,
  }));
  const timecard = task(timecardNode, [subject, plan, timecardSearch], ({ outputs }) => {
    requireFact(outputs[TIMECARD_SEARCH_NODE].matched, TIMECARD_SEARCH_NODE, "matched");
    return {
      emplId: outputs["subject"].emplId,
      rangeStart: outputs["plan"].timecardWindow.start,
      rangeEnd: outputs["plan"].timecardWindow.end,
    };
  });
  const dates = task(datesNode, [plan, timecard], ({ input, outputs }) => ({
    plan: outputs["plan"],
    timekeeperName: input.timekeeperName,
    lastPunchDate: outputs[TIMECARD_NODE].grid.lastPunchDate,
    sickDates: outputs[TIMECARD_NODE].grid.sickDates,
    holidayDates: outputs[TIMECARD_NODE].grid.holidayDates,
    unclassifiedPayCodes: outputs[TIMECARD_NODE].grid.unclassifiedPayCodes,
    observedWindow: {
      start: outputs[TIMECARD_NODE].range.observedStart,
      end: outputs[TIMECARD_NODE].range.observedEnd,
    },
  }));
  return { dates, steps: [[group(KRONOS_TIMECARD_STEP, { omission: KRONOS_TIMECARD_OMISSION }), [timecardSearch, timecard, dates]]] as const };
}

export const separationsKronosTimecardDefinition = defineStep({
  group: KRONOS_TIMECARD_STEP, build: buildTimecard,
  proof: {
    id: "separations-kronos-timecard", order: 0, build: (): StepProofSpec<typeof SeparationsKronosTimecardInput, typeof SeparationsKronosTimecardResultSchema> => ({
      version: 1,
      code: "sk",
      label: "Separation Timecard",
      summary: "Chunk 1 of the separations migration: the New Kronos passage on its own. Finds the employee in " +
        "the WFD panel and reads the separation timecard for the plan's window — read-only, and " +
        "hard-failing on anything it cannot read.",
      icon: "CalendarClock",
      category: "timekeeping",
      canonicalInput: SeparationsKronosTimecardCanonicalInput,
      inputSubject: "eid",
      surface: { shape: "single" },
      enqueue: "reject-active",
      actions: STANDARD_WORKFLOW_ACTIONS,
      surfaces: {},
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
      steps: (author: WorkflowAuthor<typeof SeparationsKronosTimecardInput>) => {
        const { task, result } = author;
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
        const timecard = task(timecardNode, [search], ({ input, outputs }) => {
          requireFact(outputs.search.matched, "search", "matched");
          return {
            emplId: input.emplId,
            rangeStart: input.rangeStart,
            rangeEnd: input.rangeEnd,
          };
        });
        return {
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
    }),
  },
});
