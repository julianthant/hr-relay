/**
 * person-lookup — ref workflow-model §8's worked example, and Phase 1's live exit slice.
 *
 * This module is bundle-safe: it value-imports only zod, `src/domain/**`, and
 * the audited `src/base` builders, so the same declaration drives the daemon and
 * the dashboard. Everything the legacy client hand-maintained for this workflow
 * — its rail entry, icon, category, input panel and parser, session-card label,
 * pipeline chips, and `notFound`/`inactive` statuses — is a projection of the
 * object below.
 *
 * The contracts are imported by VALUE, so renaming a field on
 * `ucpath/search-person-org` fails `tsc` here rather than at the first run.
 */
import { z } from "zod";
import { flow } from "../../base/flow.js";
import { defineWorkflowDescriptor, requireFact } from "../../base/workflow.js";
import {
  CrmReadOnboardingDates,
  ReadOnboardingDatesOutputSchema,
} from "../../domain/contracts/crm/read-onboarding-dates.js";
import { CrmReadOnboardingRecord } from "../../domain/contracts/crm/read-onboarding-record.js";
import { CANONICAL_FIELDS } from "../../domain/fields/registry.js";
import {
  ActiveStatusOutcomeSchema,
  ReadActiveStatus,
} from "../../domain/contracts/person-lookup/read-active-status.js";
import { SearchPersonOrg } from "../../domain/contracts/ucpath/search-person-org.js";
import { EidSchema, WorkflowIdSchema } from "../../domain/ids.js";
import { redactionDigest } from "../../domain/redaction.js";
import {
  BUILD_MANIFEST,
  resolveWorkflowFingerprint,
} from "../../domain/workflow/build-manifest.js";
import { defineCanonicalInput } from "../../domain/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../domain/workflow/presentation.js";

/* ── workflow-constant input ─────────────────────────────────────────────── */

/**
 * The person's name, as one schema object shared by both arms of the input
 * union and by the canonical view (D172).
 *
 * It IS the canonical `fullName` schema rather than a structurally identical
 * `z.string().min(1)`, because `defineIntakeProjection` proves ref data-intake-and-edit-data §1 by
 * OBJECT IDENTITY: a spreadsheet column bound to `name` is coerced through
 * `CANONICAL_FIELDS.fullName.coerce` and must then satisfy the very schema this
 * workflow validates with, not a copy that agrees today. Sharing one object
 * across both arms is the other half of the same fact — two arms spelling the
 * constraint twice would be two schemas for one field, which the resolver
 * refuses by name.
 */
const PersonNameSchema = CANONICAL_FIELDS.fullName.schema;

/**
 * The ingress schema — the ONE place defaults are applied (ref workflow-model §2). There is
 * deliberately no `dryRun` field: that is kernel envelope state (D6), and a
 * workflow that could declare it could also disagree with the executor about
 * whether a run may commit.
 */
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

/**
 * The validation-only view of the stored snapshot. Same shape, no defaults —
 * so a redeployed default can never rewrite an in-flight run's input, and a
 * snapshot that no longer matches fails loud instead of being re-derived.
 */
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
    { emplId: "10001573", name: "Blirea, Glaundi", keepNonHdh: true, includeCrmDates: false },
  ],
);

export const PersonLookupResultSchema = z.strictObject({
  activeStatus: ActiveStatusOutcomeSchema,
  crmDates: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("included"), dates: ReadOnboardingDatesOutputSchema }),
    z.strictObject({ state: z.literal("not-requested") }),
  ]),
});

/* ── the graph ───────────────────────────────────────────────────────────── */

const personLookupFlow = flow(PersonLookupInput)
  .step("searching", SearchPersonOrg, {
    dependsOn: [],
    replay: "checkpoint",
    bind: ({ input }) => ("emplId" in input
      ? { kind: "by-eid", emplId: input.emplId }
      : { kind: "by-name", name: input.name, keepNonHdh: input.keepNonHdh }),
  })
  .step("cross-verify", CrmReadOnboardingRecord, {
    label: "Cross Verification",
    dependsOn: ["searching"],
    replay: "checkpoint",
    bind: ({ input, outputs }) => {
      const selected = requireFact(outputs.searching.selection.selected, "searching", "selection.selected");
      return {
        eid: selected.emplId,
        name: "emplId" in input ? input.name ?? selected.name : input.name,
      };
    },
  })
  .step("active-status", ReadActiveStatus, {
    label: "Active Status",
    dependsOn: ["searching", "cross-verify"],
    // Pure, and cheap: re-running it on resume is strictly safer than replaying
    // a fold whose meaning may have changed with the code that computes it.
    replay: "always-rerun",
    bind: ({ input, outputs }) => ({
      person: outputs.searching,
      crm: outputs["cross-verify"],
      keepNonHdh: input.keepNonHdh,
    }),
  })
  .step("crm-dates", CrmReadOnboardingDates, {
    label: "CRM Dates",
    dependsOn: ["searching"],
    when: { kind: "is-true", of: { from: "input", path: "includeCrmDates" } },
    replay: "checkpoint",
    bind: ({ outputs }) => ({
      eid: requireFact(outputs.searching.selection.selected, "searching", "selection.selected").emplId,
    }),
  })
  .build({
    schema: PersonLookupResultSchema,
    dependsOn: ["active-status", "crm-dates"],
    derive: ({ input, outputs }) => ({
      activeStatus: outputs["active-status"],
      crmDates: input.includeCrmDates
        ? {
          state: "included" as const,
          dates: requireFact(outputs["crm-dates"], "crm-dates", "conditional output"),
        }
        : { state: "not-requested" as const },
    }),
  });

/* ── the descriptor ──────────────────────────────────────────────────────── */

export const personLookupDescriptor = defineWorkflowDescriptor({
  id: "person-lookup",
  version: 1,
  contractFingerprint: resolveWorkflowFingerprint(
    BUILD_MANIFEST,
    WorkflowIdSchema.parse("person-lookup"),
  ),
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
    // Ref data-intake-and-edit-data §6.2: the three CRM dates are the fields an operator genuinely
    // corrects — a misread date fixed before anything downstream consumes it.
    // Each path names the `present` arm's value; a correction against a stored
    // `absent` outcome fails the save's full re-parse, which is the honest
    // answer ("there is no recorded date to correct").
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
      /**
       * D250. Both texts are the placeholder's own values, so nothing new is
       * introduced here, and the factory proves each one parses AND satisfies
       * `PersonLookupInput` before this descriptor exists. The pair is chosen to
       * show the parser's discrimination — the arm an operator cannot guess from
       * a placeholder is that a name goes in the SAME box, unquoted, with the
       * comma inside it left alone because the delimiter is a semicolon.
       */
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
  /**
   * Ref dashboard-surfaces §1.2: an EID-started lookup titles itself `EID 10873698` until the
   * Person Org search has RESOLVED somebody, and then says who. The path runs
   * through the selection's discriminated union on purpose — `selected` is
   * `null` on the not-found and ambiguous arms, so the resolver reads those as
   * *no subject* and the row keeps the EID it was started from, which is
   * precisely what an unresolved lookup should still be called.
   */
  subjectProjection: { nodeId: "searching", fieldPath: "selection.selected.name" },
  identity: {
    matchKey: (input) => ("emplId" in input
      ? `eid:${redactionDigest(input.emplId)}`
      : `name:${redactionDigest(input.name)}`),
  },
  presentation: {
    title: (input) => ("emplId" in input ? `EID ${input.emplId}` : input.name),
    subtitle: (input) => (input.includeCrmDates ? "with CRM dates" : "person lookup"),
  },
  /** D229 — the descriptor's own words about each node, projected by the explorer. */
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
  scenarios: [
    "person-lookup/happy-by-eid",
    "person-lookup/happy-by-eid-with-dates",
    "person-lookup/ambiguous-name",
    "person-lookup/not-found",
    "person-lookup/crm-failure-retry",
    "person-lookup/crm-subject-mismatch",
    "person-lookup/ucpath-drill-subject-mismatch",
  ],
  flow: personLookupFlow,
});
