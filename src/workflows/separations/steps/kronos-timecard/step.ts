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
import type { StepProofSpec, WorkflowAuthor, WorkflowGroupOptions } from "../../../../workflow-kit/workflow-definition.js";
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

/** Operator text and fields for this group in Explorer and Logs. */
const KRONOS_TIMECARD_DISPLAY = {
  description: "Find the employee's Kronos timecard, read the punches and reconcile the separation dates.",
  system: "new-kronos",
  operatorFields: [
    { label: "Kronos employee", example: "Quillan, Petra A.", sources: [{ nodeId: "timecard-search", kind: "output", fieldPath: "matched.displayName" }] },
    { label: "Last day worked", example: "4/25/2031", sources: [{ nodeId: "dates", kind: "output", fieldPath: "lastDayWorked" }] },
    { label: "Separation date", example: "4/26/2031", sources: [{ nodeId: "dates", kind: "output", fieldPath: "separationDate" }] },
    { label: "Termination effective date", example: "4/26/2031", sources: [{ nodeId: "dates", kind: "output", fieldPath: "terminationEffectiveDate" }] },
  ],
  review: {
    pages: [
      {
        id: "employee-search",
        title: "Employee Search",
        mode: "Read only",
        nodeIds: ["timecard-search"],
        lines: [{ id: "find-employee", kind: "action", text: "Find and verify the employee in Kronos.", nodeIds: ["timecard-search"] }],
        fields: [
          {
            id: "kronos-employee",
            operatorField: "Kronos employee",
            source: {
              origin: "Kronos",
              detail: "Name displayed for the matched employee.",
              chain: [],
              read: { stepKey: "kronos-timecard", page: "Employee Search", field: "Kronos employee" }
            }
          }
        ]
      },
      {
        id: "timecard",
        title: "Timecard",
        mode: "Read only",
        nodeIds: ["timecard", "dates"],
        lines: [
          { id: "read-period", kind: "action", text: "Open the timecard and apply the separation window.", nodeIds: ["timecard"] },
          { id: "read-punches", kind: "read", text: "Read punches, leave and pay codes for the applied window.", nodeIds: ["timecard"] },
          { id: "reconcile-dates", kind: "check", text: "Reconcile last day worked and separation dates with the Kuali plan.", nodeIds: ["dates"] }
        ],
        fields: [
          {
            id: "last-day-worked",
            operatorField: "Last day worked",
            source: {
              origin: "Kronos and Kuali",
              detail: "Date reconciled from the timecard and separation document.",
              chain: [
                { label: "Kronos timecard", detail: "Last punch and leave evidence in the selected window." },
                { label: "Kuali request", detail: "Date stated on the separation document." }
              ],
              read: { stepKey: "kronos-timecard", page: "Timecard", field: "Last day worked" }
            }
          },
          {
            id: "separation-date",
            operatorField: "Separation date",
            source: {
              origin: "Kronos and Kuali",
              detail: "Separation date after timecard reconciliation.",
              chain: [],
              read: { stepKey: "kronos-timecard", page: "Timecard", field: "Separation date" }
            }
          },
          {
            id: "termination-effective-date",
            operatorField: "Termination effective date",
            source: {
              origin: "Reconciled dates",
              detail: "Effective termination date derived from the reconciled separation date.",
              chain: [],
              read: { stepKey: "kronos-timecard", page: "Timecard", field: "Termination effective date" }
            }
          }
        ]
      }
    ],
    branchLabels: []
  } as const,
} satisfies WorkflowGroupOptions;

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
        throw new Error("kronos-timecard omission requires the run's canonical input object to read the timekeeper initials");
      }
      const timekeeperInitials = scope.input.timekeeperInitials;
      if (typeof timekeeperInitials !== "string" || timekeeperInitials.length === 0) {
        throw new Error("kronos-timecard omission requires input.timekeeperInitials to be a non-empty string");
      }
      return assertSeparationDates({
        plan,
        timekeeperInitials,
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
    timekeeperInitials: input.timekeeperInitials,
    lastPunchDate: outputs[TIMECARD_NODE].grid.lastPunchDate,
    sickDates: outputs[TIMECARD_NODE].grid.sickDates,
    holidayDates: outputs[TIMECARD_NODE].grid.holidayDates,
    unclassifiedPayCodes: outputs[TIMECARD_NODE].grid.unclassifiedPayCodes,
    observedWindow: {
      start: outputs[TIMECARD_NODE].range.observedStart,
      end: outputs[TIMECARD_NODE].range.observedEnd,
    },
  }));
  return { dates, steps: [[group(KRONOS_TIMECARD_STEP, { ...KRONOS_TIMECARD_DISPLAY, omission: KRONOS_TIMECARD_OMISSION }), [timecardSearch, timecard, dates]]] as const };
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
