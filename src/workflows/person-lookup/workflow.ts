// person-lookup: one bundle-safe declaration drives daemon and dashboard.
import { z } from "zod";
import { defineWorkflow } from "../../workflow-kit/workflow-definition.js";
import { requireFact } from "../../workflow-kit/workflow.js";
import {
  CrmReadOnboardingDates,
  ReadOnboardingDatesOutputSchema,
} from "../../models/systems/crm/read-onboarding-dates.js";
import { CrmReadOnboardingRecord } from "../../models/systems/crm/read-onboarding-record.js";
import { CANONICAL_FIELDS } from "../../models/fields/registry.js";
import {
  ActiveStatusOutcomeSchema,
  ReadActiveStatus,
} from "../../models/workflows/person-lookup/read-active-status.js";
import { SearchPersonOrg } from "../../models/systems/ucpath/search-person-org.js";
import { EidSchema } from "../../rules/identity/ids.js";
import { defineCanonicalInput } from "../../models/workflow/canonical-input.js";
import { defineIntakeProjection } from "../../models/intake/projection.js";
import { defineWorkflowRole } from "../../workflow-kit/validation/module-role.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../models/workflow/presentation.js";

/* ── workflow-constant input ─────────────────────────────────────────────── */

// One shared `fullName` schema object; intake proves identity by object.
const PersonNameSchema = CANONICAL_FIELDS.fullName.schema;

// The only place defaults apply; `dryRun` stays kernel envelope state.
export const PersonLookupInput = z.union([
  z.strictObject({
    name: PersonNameSchema,
    keepNonHdh: z.boolean().default(false),
    includeCrmDates: z.boolean().default(false),
  }),
  z.strictObject({
    emplId: EidSchema,
    name: PersonNameSchema.optional(),
    keepNonHdh: z.boolean().default(false),
    includeCrmDates: z.boolean().default(false),
  }),
]);

// Validation-only snapshot: no defaults, so a mismatch fails loudly.
export const PersonLookupCanonicalInput = defineCanonicalInput(
  PersonLookupInput,
  z.union([
    z.strictObject({
      name: PersonNameSchema,
      keepNonHdh: z.boolean(),
      includeCrmDates: z.boolean(),
    }),
    z.strictObject({
      emplId: EidSchema,
      name: PersonNameSchema.optional(),
      keepNonHdh: z.boolean(),
      includeCrmDates: z.boolean(),
    }),
  ]),
  [
    { name: "Battistessa, Johnnie" },
    { emplId: "10873698", includeCrmDates: true },
    { emplId: "10101010", name: "Morrow, Bea", keepNonHdh: true, includeCrmDates: false },
  ],
);

export const PersonLookupResultSchema = z.strictObject({
  activeStatus: ActiveStatusOutcomeSchema,
  crmDates: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("included"), dates: ReadOnboardingDatesOutputSchema }),
    z.strictObject({ state: z.literal("not-requested") }),
  ]),
});

// A spreadsheet fans out one lookup per row; intake stays off the descriptor.
export const personLookupIntake = defineIntakeProjection(PersonLookupInput, {
  emplId: CANONICAL_FIELDS.eid,
  name: CANONICAL_FIELDS.fullName,
});

/* ── the workflow ────────────────────────────────────────────────────────── */

export const personLookupWorkflow = defineWorkflow({
  id: "person-lookup",
  version: 1,
  code: "pl",
  label: "Person Lookup",
  summary:
    "Resolves ONE person across UCPath and the CRM: searches Person Org by EID or name, "
    + "cross-verifies the match against the CRM onboarding record, folds the two into an active / "
    + "inactive verdict, and reads the CRM onboarding dates when the run asks for them.",
  icon: "Search",
  category: "search",
  canonicalInput: PersonLookupCanonicalInput,
  inputSubject: (input) => ("emplId" in input ? "eid" : "name"),
  surface: { shape: "single" },
  enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS,
  capabilities: {
    review: false,
    // Correct only recorded CRM dates; absent outcomes fail full save validation.
    editData: {
      fields: [
        { nodeId: "crm-dates", fieldPath: "invitedOn.value", label: "Invited on" },
        { nodeId: "crm-dates", fieldPath: "startsOn.value", label: "Starts on" },
        { nodeId: "crm-dates", fieldPath: "completedOn.value", label: "Completed on" },
      ],
    },
  },
  verdicts: [
    { key: "not-found", label: "Not found", tone: "warning" },
    { key: "inactive", label: "Inactive", tone: "warning", tag: true },
  ],
  surfaces: {
    inputRun: {
      placeholder: "Enter EIDs or names, semicolon-separated (e.g. 10873698; Battistessa, Johnnie)",
      parser: {
        split: { kind: "delimited", delimiters: [";", "\n"] },
        rules: [
          { when: { kind: "pattern", pattern: "eid" }, emit: "emplId" },
          { when: { kind: "otherwise" }, emit: "name" },
        ],
        constants: [
          { field: "keepNonHdh", value: { kind: "boolean", value: false } },
          { field: "includeCrmDates", value: { kind: "boolean", value: false } },
        ],
      },
      // Examples must parse and satisfy `PersonLookupInput`.
      examples: [
        {
          key: "one-eid",
          label: "One EID",
          text: "10873698",
          note: "the ordinary case — one run for one employee id",
        },
        {
          key: "eid-and-name",
          label: "An EID and a name",
          text: "10873698; Battistessa, Johnnie",
          note: "two runs from one box: the parser reads the first as an employee id and the second as a name, "
            + "and the comma inside the name is not a separator",
        },
      ],
    },
  },
  details: [
    {
      key: "selection-status",
      label: "Selection",
      source: { nodeId: "searching", fieldPath: "selection.status" },
      display: "badge",
    },
    {
      key: "active-state",
      label: "Active status",
      source: { nodeId: "active-status", fieldPath: "state" },
      display: "badge",
    },
  ],
  // Unresolved searches keep the EID title, not a guessed person.
  subjectProjection: { nodeId: "searching", fieldPath: "selection.selected.name" },
  identity: {
    matchKey: (input) => ("emplId" in input ? `eid:${input.emplId}` : `name:${input.name}`),
  },
  presentation: {
    title: (input) => ("emplId" in input ? `EID ${input.emplId}` : input.name),
    subtitle: (input) => (input.includeCrmDates ? "with CRM dates" : "person lookup"),
  },
  /** The descriptor's own words about each node, projected by the explorer. */
  nodePurposes: [
    {
      nodeId: "searching",
      purpose: "Searches UCPath Person Org by the EID or name the run was started with, and returns every "
        + "candidate it saw beside the one it resolved.",
    },
    {
      nodeId: "cross-verify",
      purpose: "Reads the CRM onboarding record for the same person, so the UCPath match is confirmed against a "
        + "second system rather than trusted alone.",
    },
    {
      nodeId: "active-status",
      purpose: "Folds the UCPath picture and the CRM record into one active / inactive / undetermined verdict "
        + "with the reason it reached that verdict. Pure: it reaches no browser.",
    },
    { nodeId: "crm-dates", purpose: "Reads the CRM invited, completed and start dates for the resolved person." },
  ],
  input: PersonLookupInput,
  intake: personLookupIntake,
  // An ordinary workflow that stands on its own — no composition owns it.
  role: defineWorkflowRole({ kind: "standalone" }),
  scenarios: [
    "person-lookup/happy-by-eid",
    "person-lookup/happy-by-eid-with-dates",
    "person-lookup/ambiguous-name",
    "person-lookup/not-found",
    "person-lookup/crm-failure-retry",
    "person-lookup/crm-subject-mismatch",
    "person-lookup/ucpath-drill-subject-mismatch",
    "person-lookup/resume-from-checkpoints",
    "person-lookup/restart-from-start",
  ],
  steps: ({ task, result }) => {
    const searching = task({
      id: "searching",
      contract: SearchPersonOrg,
      label: "Searching",
      replay: "checkpoint",
    }, [], ({ input }) => ("emplId" in input
        ? { kind: "by-eid" as const, emplId: input.emplId }
        : { kind: "by-name" as const, name: input.name, keepNonHdh: input.keepNonHdh }),
    );
    const crossVerify = task({
      id: "cross-verify",
      contract: CrmReadOnboardingRecord,
      label: "Cross Verification",
      replay: "checkpoint",
    }, [searching], ({ input, outputs }) => {
      const selected = requireFact(outputs.searching.selection.selected, "searching", "selection.selected");
      return {
        eid: selected.emplId,
        name: "emplId" in input ? input.name ?? selected.name : input.name,
      };
    });
    const activeStatus = task({
      id: "active-status",
      contract: ReadActiveStatus,
      label: "Active Status",
      // Pure, and cheap: re-running it on resume is strictly safer than replaying
      // a fold whose meaning may have changed with the code that computes it.
      replay: "always-rerun",
    }, [searching, crossVerify], ({ input, outputs }) => ({
      person: outputs.searching,
      crm: outputs["cross-verify"],
      keepNonHdh: input.keepNonHdh,
    }));
    const crmDates = task({
      id: "crm-dates",
      contract: CrmReadOnboardingDates,
      label: "CRM Dates",
      when: { kind: "is-true", of: { from: "input", path: "includeCrmDates" } },
      replay: "checkpoint",
    }, [searching], ({ outputs }) => ({
      eid: requireFact(outputs.searching.selection.selected, "searching", "selection.selected").emplId,
    }));
    return {
      steps: [
        [{ key: "searching", label: "Searching" }, [searching]],
        [{ key: "cross-verify", label: "Cross Verification" }, [crossVerify]],
        [{ key: "active-status", label: "Active Status" }, [activeStatus]],
        [{ key: "crm-dates", label: "CRM Dates" }, [crmDates]],
      ],
      result: result(PersonLookupResultSchema, [activeStatus, crmDates], ({ input, outputs }) => ({
        activeStatus: outputs["active-status"],
        crmDates: input.includeCrmDates
          ? {
            state: "included" as const,
            dates: requireFact(outputs["crm-dates"], "crm-dates", "conditional output"),
          }
          : { state: "not-requested" as const },
      })),
    };
  },
});
