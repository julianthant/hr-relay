import { DRY_RUN_TRANSACTION_NUMBER } from "../../models/workflow/dry-run.js";
import type { WorkflowEntryScope } from "../../workflow-kit/workflow-definition.js";
import { NodeIdSchema } from "../../rules/identity/ids.js";
/** `separations` — one Kuali separation document → one terminated employee across three systems; reads before writes, gated by operator approval. */
import { z } from "zod";
import { EID_PATTERN, EidSchema } from "../../rules/identity/ids.js";
import { SeparationsResultSchema } from "../../models/workflows/separations/result.js";
export { SeparationsResultSchema } from "../../models/workflows/separations/result.js";
import { defineWorkflow, defineStepEntries } from "../../workflow-kit/workflow-definition.js";
import { requireFact, defineWorkflowStep } from "../../workflow-kit/workflow.js";
import {
  IdentityApprovalResultSchema,
} from "../../rules/separations/identity-approval.js";
import {
  buildFinalizationComments,
  separationInitials,
  assertSeparationDates,
} from "../../rules/separations/separation-dates.js";
import {
  TERMINATION_RECEIPT_ACCEPTED_STATUSES,
  assertTerminationReceipt,
} from "../../rules/separations/termination-receipt.js";
import {
  KualiDocumentNumberSchema,
  KualiTimekeeperNameSchema,
} from "../../models/ui/kuali-document-identity.js";
import { defineCanonicalInput } from "../../models/workflow/canonical-input.js";
import { defineWorkflowRole } from "../../workflow-kit/validation/module-role.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../models/workflow/presentation.js";
import { KualiReadSeparationDocument } from "../../models/systems/kuali/read-separation-document.js";
import { KualiSearchSeparationAction } from "../../models/systems/kuali/search-separation-action.js";
import {
  SeparationsMatchTerminationType,
} from "../../models/workflows/separations/match-termination-type.js";
import {
  SeparationsReadSeparationPlan,
  ReadSeparationPlanOutputSchema,
} from "../../models/workflows/separations/read-separation-plan.js";
import { SeparationsMatchIdentity } from "../../models/workflows/separations/match-identity.js";
import {
  SeparationsMatchSeparationSubject,
} from "../../models/workflows/separations/match-separation-subject.js";
import {
  SeparationsVerifyIdentityApproval,
  VerifyIdentityApprovalOutputSchema,
} from "../../models/workflows/separations/verify-identity-approval.js";
import { SearchPersonOrg } from "../../models/systems/ucpath/search-person-org.js";
import {
  SeparationsMatchActiveEmployment,
} from "../../models/workflows/separations/match-active-employment.js";
import {
  SeparationsMatchDepartmentOption,
} from "../../models/workflows/separations/match-department-option.js";
import { UcpathReadJobSummary } from "../../models/systems/ucpath/read-job-summary.js";
import {
  NewKronosReadSeparationTimecard,
} from "../../models/systems/new-kronos/read-separation-timecard.js";
import { NewKronosSearchEmployee } from "../../models/systems/new-kronos/search-employee.js";
import {
  SeparationsReadSeparationDates,
  ReadSeparationDatesOutputSchema,
} from "../../models/workflows/separations/read-separation-dates.js";
import type { JsonObject, JsonValue } from "../../rules/validation/canonical-json.js";
import type { StepOmissionDeclaration } from "../../models/workflow/step-omission.js";
import {
  SeparationsVerifyTerminationReceipt,
} from "../../models/workflows/separations/verify-termination-receipt.js";
import { UcpathCreateTermination } from "../../models/systems/ucpath/create-termination.js";
import {
  UcpathDeletePendingTerminations,
} from "../../models/systems/ucpath/delete-pending-terminations.js";
import {
  UcpathStagePendingTerminationSweep,
} from "../../models/systems/ucpath/stage-pending-termination-sweep.js";
import { UcpathStageTermination } from "../../models/systems/ucpath/stage-termination.js";
import {
  UcpathReadPendingTerminationSet,
} from "../../models/systems/ucpath/read-pending-termination-set.js";
import {
  KualiSaveSeparationFinalization,
} from "../../models/systems/kuali/save-separation-finalization.js";
import {
  KualiStageSeparationFinalization,
} from "../../models/systems/kuali/stage-separation-finalization.js";
import {
  UcpathVerifyTerminationFilingPresent,
} from "../../models/systems/ucpath/verify-termination-filing-present.js";

/* ── the timeline's step identities: authored here in timeline order; a step's harness imports its own ── */

/* ── step `kuali-extraction` — group, node ids, entry identities ── */

export const KUALI_EXTRACTION_STEP = defineWorkflowStep({
  key: "kuali-extraction",
  label: "Kuali extraction",
});

/** The step's node ids, declared apart from the entries so an omission declaration and every bind can name them. */
export const ACTION_NODE = "resolve-action";
export const DOCUMENT_NODE = "document";
export const PLAN_NODE = "plan";
export const TERMINATION_TYPE_NODE = "termination-type";

const kualiExtractionEntries = defineStepEntries(KUALI_EXTRACTION_STEP);

// Checkpointed addresses are revalidated by openDocument.
export const actionNode = kualiExtractionEntries.task(ACTION_NODE, KualiSearchSeparationAction, {
  label: "Kuali Action",
  replay: "checkpoint",
});

// Checkpoints restore values, not browser selection.
export const documentNode = kualiExtractionEntries.task(DOCUMENT_NODE, KualiReadSeparationDocument, {
  label: "Separation Document",
  replay: "checkpoint",
});

const planNode = kualiExtractionEntries.task(PLAN_NODE, SeparationsReadSeparationPlan, {
  label: "Separation Plan",
  replay: "checkpoint",
});

export const terminationTypeNode = kualiExtractionEntries.task(TERMINATION_TYPE_NODE, SeparationsMatchTerminationType, {
  label: "Termination Type",
  replay: "checkpoint",
});

/* ── step `identity-check` — group, node ids, entry identities ── */

export const IDENTITY_CHECK_STEP = defineWorkflowStep({
  key: "identity-check",
  label: "Identity check",
});

/** The step's node ids, declared apart from the entries so an omission declaration and every bind can name them. */
export const NAME_SEARCH_NODE = "name-search";
const SUBJECT_NODE = "subject";
export const COMPARISON_NODE = "comparison";
export const GATE_NODE = "identity-approval";
export const APPROVAL_NODE = "approval";

const identityCheckEntries = defineStepEntries(IDENTITY_CHECK_STEP);

// Keep all candidates; filtering HDH would hide matching career employees.
export const nameSearchNode = identityCheckEntries.task(NAME_SEARCH_NODE, SearchPersonOrg, {
  label: "Name Search",
  replay: "checkpoint",
});

const subjectNode = identityCheckEntries.task(SUBJECT_NODE, SeparationsMatchSeparationSubject, {
  label: "Separation Subject",
  replay: "checkpoint",
});

export const comparisonNode = identityCheckEntries.task(COMPARISON_NODE, SeparationsMatchIdentity, {
  label: "Identity Comparison",
  replay: "checkpoint",
});

// Name-resolved and operator-entered identities require version-checked approval.
export const identityApprovalGate = identityCheckEntries.operatorGate(GATE_NODE, {
  label: "Identity Approval",
  statusKey: "awaitingIdentityApproval",
  result: IdentityApprovalResultSchema,
  when: { kind: "is-true", of: { from: "node", nodeId: COMPARISON_NODE, path: "approvalRequired" } },
});

// Recheck stored approval against current evidence; checkpoints preserve only the prior answer.
export const approvalNode = identityCheckEntries.task(APPROVAL_NODE, SeparationsVerifyIdentityApproval, {
  label: "Approval Check",
  replay: "always-rerun",
});

/* ── step `job-summary` — group, node ids, entry identities ── */

export const JOB_SUMMARY_STEP = defineWorkflowStep({
  key: "job-summary",
  label: "Job summary",
});

/** The step's node ids, declared apart from the entries so an omission declaration and every bind can name them. */
export const JOB_SUMMARY_NODE = "job-summary";
const EMPLOYMENT_NODE = "employment";
export const DEPARTMENT_NODE = "department-option";

const jobSummaryEntries = defineStepEntries(JOB_SUMMARY_STEP);

// Downstream nodes need the value, not this browser page.
export const jobSummaryNode = jobSummaryEntries.task(JOB_SUMMARY_NODE, UcpathReadJobSummary, {
  label: "Job Summary",
  replay: "checkpoint",
});

const employmentNode = jobSummaryEntries.task(EMPLOYMENT_NODE, SeparationsMatchActiveEmployment, {
  label: "Employment",
  replay: "checkpoint",
});

const departmentOptionNode = jobSummaryEntries.task(DEPARTMENT_NODE, SeparationsMatchDepartmentOption, {
  label: "Department Option",
  replay: "checkpoint",
});

/* ── step `kronos-timecard` — group, node ids, entry identities, omission ── */

export const KRONOS_TIMECARD_STEP = defineWorkflowStep({
  key: "kronos-timecard",
  label: "Kronos timecard",
});

/** The step's node ids, declared apart from the entries so an omission declaration and every bind can name them. */
const TIMECARD_SEARCH_NODE = "timecard-search";
const TIMECARD_NODE = "timecard";
export const DATES_NODE = "dates";

const kronosTimecardEntries = defineStepEntries(KRONOS_TIMECARD_STEP);

// The search's point is the panel selection, not a restorable value.
const timecardSearchNode = kronosTimecardEntries.task(TIMECARD_SEARCH_NODE, NewKronosSearchEmployee, {
  label: "Timecard Search",
  replay: "always-rerun",
});

// The visit needs the search's selection; a disabled Go To fails loudly.
export const timecardNode = kronosTimecardEntries.task(TIMECARD_NODE, NewKronosReadSeparationTimecard, {
  label: "Timecard",
  replay: "checkpoint",
});

const datesNode = kronosTimecardEntries.task(DATES_NODE, SeparationsReadSeparationDates, {
  label: "Reconciled Dates",
  replay: "checkpoint",
});

// Omission: operator entries rebuild the date fold; browser reads are skipped.
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
      const plan = ReadSeparationPlanOutputSchema.parse(scope.outputs[PLAN_NODE]);
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

/* ── step `ucpath-transaction` — group, node ids, entry identities, omission ── */

export const UCPATH_TRANSACTION_STEP = defineWorkflowStep({
  key: "ucpath-transaction",
  label: "UCPath transaction",
});

/** The step's node ids, declared apart from the entries so an omission declaration and every bind can name them. */
export const PENDING_SET_NODE = "pending-set";
export const SWEEP_NODE = "clear-pending";
export const TERMINATION_NODE = "file-termination";
const RECEIPT_NODE = "receipt";

const ucpathTransactionEntries = defineStepEntries(UCPATH_TRANSACTION_STEP);

export const pendingSetNode = ucpathTransactionEntries.task(PENDING_SET_NODE, UcpathReadPendingTerminationSet, {
  label: "Read Exact Pending Set",
  replay: "checkpoint",
});

// The probe serves the termination's own probe; the budget covers a stalled page.
export const clearPendingNode = ucpathTransactionEntries.transaction(SWEEP_NODE, {
  label: "Clear Pending Terminations",
  prepare: UcpathStagePendingTerminationSweep,
  commit: UcpathDeletePendingTerminations,
  dryRun: "stop-after-prepare",
  probePolicy: "always",
  probeToFenceMaxMs: 90_000,
});

/** The real HR write: its probe-to-fence budget gives the live wizard staging and the probe ample headroom. */
export const fileTerminationNode = ucpathTransactionEntries.transaction(TERMINATION_NODE, {
  label: "File Termination",
  prepare: UcpathStageTermination,
  commit: UcpathCreateTermination,
  dryRun: "stop-after-prepare",
  probePolicy: "always",
  probeToFenceMaxMs: 120_000,
});

// Recheck the proof every run; a checkpoint would stand in for the check.
const receiptNode = ucpathTransactionEntries.task(RECEIPT_NODE, SeparationsVerifyTerminationReceipt, {
  label: "Termination Receipt",
  replay: "always-rerun",
});

// Omission: operator entries rebuild the receipt; neither transaction runs.
const UcpathTransactionFactsSchema = z.strictObject({
  transactionNumber: z.string().min(1),
  approvalStatus: z.string().min(1),
});

export const UCPATH_TRANSACTION_OMISSION: StepOmissionDeclaration = {
  form: {
    fields: [
      {
        key: "transactionNumber", label: "UCPath transaction number", kind: "text",
        help: "The T-number of the termination already filed in UCPath (T followed by 6–12 digits). This run files nothing in UCPath.",
      },
      {
        key: "approvalStatus", label: "Approval status", kind: "enum",
        values: [...TERMINATION_RECEIPT_ACCEPTED_STATUSES],
        help: "The transaction's approval status as UCPath shows it now. Only a status that means the termination took effect can be asserted.",
      },
    ],
  },
  produces: {
    [RECEIPT_NODE]: ({ facts, scope }) => {
      const typed = UcpathTransactionFactsSchema.parse(facts);
      const approval = VerifyIdentityApprovalOutputSchema.parse(scope.outputs[APPROVAL_NODE]);
      const dates = ReadSeparationDatesOutputSchema.parse(scope.outputs[DATES_NODE]);
      return assertTerminationReceipt({
        transactionNumber: typed.transactionNumber,
        approvalStatus: typed.approvalStatus,
        approvedEmplId: approval.approved.emplId,
        approvedName: approval.approved.ucpathName,
        expectedEffectiveDate: dates.terminationEffectiveDate,
      });
    },
  },
};

/* ── step `kuali-finalization` — group, node ids, entry identities, omission ── */

export const KUALI_FINALIZATION_STEP = defineWorkflowStep({
  key: "kuali-finalization",
  label: "Kuali finalization",
});

/** The step's node ids, declared apart from the entries so an omission declaration and every bind can name them. */
export const FILING_PRESENCE_NODE = "filing-presence";
export const FINALIZE_NODE = "finalize-kuali";

const kualiFinalizationEntries = defineStepEntries(KUALI_FINALIZATION_STEP);

// Re-read the filing so a stale observation cannot authorize the write.
export const filingPresenceNode = kualiFinalizationEntries.task(
  FILING_PRESENCE_NODE,
  UcpathVerifyTerminationFilingPresent,
  { label: "Verify Current UCPath Filing", replay: "always-rerun" },
);

  // `""` when the control was empty; a real value, not a default.
export function existingComments(comments: { state: "present"; value: string } | { state: "absent" }): string {
  return comments.state === "present" ? comments.value : "";
}

// The probe is one read of a page the run is already on.
export const finalizeKualiNode = kualiFinalizationEntries.transaction(FINALIZE_NODE, {
  label: "Finalize Kuali Document",
  prepare: KualiStageSeparationFinalization,
  commit: KualiSaveSeparationFinalization,
  dryRun: "stop-after-prepare",
  probePolicy: "always",
  probeToFenceMaxMs: 45_000,
});

// Omission: the write is skipped and the result carries an omitted arm.
export const KUALI_FINALIZATION_OMISSION: StepOmissionDeclaration = {
  form: { fields: [] },
  produces: {},
};

// Search silence is a reported timeout, never a fabricated no-result.
const SEARCH_TIMEOUT_DEFAULT_MS = 15_000;

// A re-read is a new logical item, so it can never double-file.
const SeparationReReadSchema = z.strictObject({
  ordinal: z.number().int().min(1).max(99),
  reason: z.string().min(1).max(200),
});

const SeparationsInputShape = {
    // The employee ID is supplied only by the declared Logs correction.
  operatorEmployeeId: EidSchema.optional(),
  documentNumber: KualiDocumentNumberSchema,
    // The timekeeper is retained input so `explain run` can show it.
  timekeeperName: KualiTimekeeperNameSchema,
} as const;

export const SeparationsInput = z.strictObject({
  ...SeparationsInputShape,
  searchTimeoutMs: z.number().int().positive().max(120_000).default(SEARCH_TIMEOUT_DEFAULT_MS),
  reRead: SeparationReReadSchema.optional(),
});

export const SeparationsCanonicalInput = defineCanonicalInput(
  SeparationsInput,
  z.strictObject({
    ...SeparationsInputShape,
    searchTimeoutMs: z.number().int().positive().max(120_000),
    reRead: SeparationReReadSchema.optional(),
  }),
  [
    {
      documentNumber: "4510",
      timekeeperName: "Synthetic Timekeeper",
    },
    {
      operatorEmployeeId: SeparationsMatchIdentity.example.packet.emplId,
      documentNumber: "4524",
      timekeeperName: "Synthetic Timekeeper",
      searchTimeoutMs: 30_000,
      reRead: { ordinal: 1, reason: "the department corrected the last day worked" },
    },
  ],
);

// An omitted node reads as `undefined` in the terminal derive.
function omittedOr<T, R>(
  value: T,
  step: string,
  present: (value: T) => R,
): R | Readonly<{ state: "omitted"; step: string }> {
  const widened: T | undefined = value;
  return widened === undefined ? Object.freeze({ state: "omitted" as const, step }) : present(widened);
}

export const separationsWorkflow = defineWorkflow({
  id: "separations",
  version: 1,
  code: "sp",
  label: "Separations",
  summary:
    "The composition: ONE Kuali RRSS separation document becomes ONE terminated employee across three "
    + "systems. It reads Kuali, UCPath and Kronos, reconciles the dates against what the timecard "
    + "actually shows, establishes identity from supplied-EID read-back or the name-only gate, then clears any pending termination, "
    + "files the termination, verifies the receipt, and finalizes the Kuali document.",
  icon: "ShieldCheck",
  category: "separation",
  canonicalInput: SeparationsCanonicalInput,
  failureCorrections: [{ nodeId: JOB_SUMMARY_NODE, code: "employee-not-found", inputField: "operatorEmployeeId",
    label: "Employee ID", actionLabel: "Enter EID", pattern: EID_PATTERN.source },
  { nodeId: ACTION_NODE, code: "document-not-in-action-list", inputField: "documentNumber",
    label: "Document number", actionLabel: "Enter document number", pattern: z.toJSONSchema(KualiDocumentNumberSchema).pattern }],
  rerunValues: [
    { nodeId: DATES_NODE, fieldPath: "lastDayWorked", label: "Last day worked", targetStepKey: "kronos-timecard", targetFieldPath: "lastDayWorked" },
    { nodeId: DATES_NODE, fieldPath: "separationDate", label: "Separation date", targetStepKey: "kronos-timecard", targetFieldPath: "separationDate" },
    { nodeId: RECEIPT_NODE, fieldPath: "transactionNumber", label: "UCPath transaction number", targetStepKey: "ucpath-transaction", targetFieldPath: "transactionNumber" },
    { nodeId: RECEIPT_NODE, fieldPath: "approvalStatus", label: "Approval status", targetStepKey: "ucpath-transaction", targetFieldPath: "approvalStatus" },
  ],
  protectedInputs: [{ inputPath: "timekeeperName", name: "timekeeperName" }],
  inputSubject: "document",
  surface: { shape: "single" },
  // One document runs at a time; the mutex refuses the second fence.
  enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS,
  // The start box takes only the document number; the id is a graph output.
  surfaces: {
    inputRun: {
      placeholder: "Enter Kuali document numbers, semicolon-separated (e.g. 4502; 4510)",
      parser: {
        split: { kind: "delimited", delimiters: [";", "\n"] },
        // Anything that is not a document number refuses the whole box.
        rules: [
          { when: { kind: "pattern", pattern: "document-number" }, emit: "documentNumber" },
        ],
      },
      // Examples must parse and satisfy `SeparationsInput`; one box starts several runs.
      examples: [
        {
          key: "one-document",
          label: "One document",
          text: "4502",
          note: "the ordinary case — one run for one Kuali separation document",
        },
        {
          key: "two-documents",
          label: "Two documents",
          text: "4502; 4510",
          note: "two runs from one box: each document number starts its own separation, and the "
            + "action id for each is resolved from the Kuali Action List at run time",
        },
      ],
    },
  },
  // No Edit Data: patching read-established values without a live read is unsafe.
  verdicts: [
    { key: "name-differs", label: "Name differs from UCPath", tone: "warning", tag: true },
    { key: "eid-name-resolved", label: "EID resolved by name", tone: "warning", tag: true },
    { key: "dates-moved", label: "Kronos moved the dates", tone: "neutral", tag: true },
    { key: "unclassified-pay-codes", label: "Unclassified pay codes", tone: "warning", tag: true },
  ],
  details: [
    {
      key: "ucpath-name",
      label: "UCPath shows",
      source: { nodeId: JOB_SUMMARY_NODE, fieldPath: "displayedName" },
      display: "text",
    },
    {
      key: "template",
      label: "Template",
      source: { nodeId: TERMINATION_TYPE_NODE, fieldPath: "template" },
      display: "text",
    },
    {
      key: "reason-code",
      label: "Reason code",
      source: { nodeId: TERMINATION_TYPE_NODE, fieldPath: "reasonCode" },
      display: "text",
    },
    {
      key: "last-day-worked",
      label: "Last day worked",
      source: { nodeId: DATES_NODE, fieldPath: "lastDayWorked" },
      display: "text",
    },
    {
      key: "effective-date",
      label: "Termination effective",
      source: { nodeId: DATES_NODE, fieldPath: "terminationEffectiveDate" },
      display: "text",
    },
    {
      key: "department",
      label: "Department",
      source: { nodeId: DEPARTMENT_NODE, fieldPath: "option" },
      display: "text",
    },
    {
      key: "transaction-id",
        // A transaction node's field paths are the COMMIT contract's bare output
        // — `{ receipt }`, not the `TypedTransactionOutcome` envelope.
      label: "Transaction",
      source: { nodeId: TERMINATION_NODE, fieldPath: "receipt.transactionId" },
      display: "text",
    },
    {
      key: "approval-status",
      label: "Transaction status",
      source: { nodeId: TERMINATION_NODE, fieldPath: "receipt.approvalStatus" },
      display: "text",
    },
  ],
  // Queue row shows the document number until Job Summary answers.
  subjectProjection: { nodeId: JOB_SUMMARY_NODE, fieldPath: "displayedName" },
  identity: {
    // The item is document + re-read ordinal, so a re-read cannot double-file.
    matchKey: (input) => (input.reRead === undefined
      ? `separations:${input.documentNumber}`
      : `separations:${input.documentNumber}#re-read-${String(input.reRead.ordinal)}`),
  },
  presentation: {
    title: (input) => `Separation ${input.documentNumber}`,
    subtitle: (input) => (input.reRead === undefined
      ? undefined
      : `re-read ${String(input.reRead.ordinal)} — ${input.reRead.reason}`),
  },
  /** The descriptor's own words about each node, projected by the explorer. */
  nodePurposes: [
    {
      nodeId: "resolve-action",
      purpose: "Turns the Kuali document number the operator typed into the action id Kuali is actually "
        + "addressed by, by filtering the Action List's own search box and reading the matched row's link. "
        + "It refuses a document nobody holds an action on, and refuses two actions for one number.",
    },
    {
      nodeId: "document",
      purpose: "Reads the entire Kuali RRSS separation request form in ONE page visit: the employee, the "
        + "separation dates, the comments, and every control's own option list as this run observed it.",
    },
    {
      nodeId: "termination-type",
      purpose: "Resolves the document's termination type to the UCPath template and reason code it files under, "
        + "refusing a type nobody has mapped. Pure: it reaches no browser.",
    },
    {
      nodeId: "name-search",
      purpose: "Searches UCPath Person Org by the document's employee name, unconditionally, so the operator "
        + "sees every person that name matches rather than only the ones a similarity threshold selected.",
    },
    {
      nodeId: "job-summary",
      purpose: "Reads the subject's whole UCPath job summary grid verbatim — every row, every status — and "
        + "classifies nothing; the disposition is a separate, pure fold.",
    },
    {
      nodeId: "department-option",
      purpose: "Resolves the subject's UCPath department to the exact option this document's OWN control offers, "
        + "refusing one the control does not carry. Pure: it reaches no browser.",
    },
    {
      nodeId: "comparison",
      purpose: "Builds the identity evidence packet — DISCONFIRMING evidence first — and the digest that "
        + "machine verification or an operator decision binds to. Pure: it reaches no browser.",
    },
    {
      nodeId: "identity-approval",
      purpose: "Requires the typed operator resolve-gate command when the packet's EID came from a name search; "
        + "a supplied-EID packet makes this declared condition false and records no human decision.",
    },
    {
      nodeId: "approval",
      purpose: "Re-derives the evidence and produces explicit machine-verification or operator-approval "
        + "authority. It re-runs on every attempt, so moved evidence or identity origin cannot reuse an old answer.",
    },
    {
      nodeId: "pending-set",
      purpose: "Reads and freezes the exact stable-ID set of eligible pending terminations plus every protected "
        + "transaction before the sweep. The run admission authorizes this machine observation; it is not another gate.",
    },
    {
      nodeId: "clear-pending",
      purpose: "Sweeps any pending termination already sitting on the subject's record, so the filing below is "
        + "not the second one. It probes before it fences, and a dry run stages without submitting.",
    },
    {
      nodeId: "file-termination",
      purpose: "Files the termination through the UCPath Smart HR wizard — the real write. It probes for a "
        + "filing that already exists, fences before the click, and a dry run stages without submitting.",
    },
    {
      nodeId: "finalize-kuali",
      purpose: "Stages every finalization field in ONE pass from the reconciled variables, saves once, and "
        + "proves the save by reloading and comparing each written field against exactly what was staged.",
    },
    {
      nodeId: "plan",
      purpose: "Derives the separation plan from the document — the employee's name, the dates to reconcile, and "
        + "the timecard window to read — as of the instant this run READ the document, never a clock.",
    },
    {
      nodeId: "subject",
      purpose: "Reduces the name-search candidates to the ONE person this separation is about, using the "
        + "document's own EID. A grid it cannot reduce to one row is a run that cannot compute what it is "
        + "about to write, so it refuses before the gate opens.",
    },
    {
      nodeId: "employment",
      purpose: "Folds the job summary into the employment facts the filing needs — empl record, department, "
        + "payroll title — and refuses a subject with no active job.",
    },
    {
      nodeId: "timecard-search",
      purpose: "Searches the New Kronos WFD panel for the employee and leaves them SELECTED — the selection is "
        + "what enables Go To, so this node's real product is browser state and it re-runs on every "
        + "attempt.",
    },
    {
      nodeId: "timecard",
      purpose: "Opens the selected employee's timecard and reads the whole separation window — last punch, sick "
        + "and holiday days, and any pay code nobody has classified — refusing a range it cannot prove the "
        + "grid was showing.",
    },
    {
      nodeId: "dates",
      purpose: "Reconciles the Kuali dates against what the timecard actually shows: the last day worked, the "
        + "separation date, the termination effective date, and the comments that explain any move.",
    },
    {
      nodeId: "receipt",
      purpose: "Checks the receipt the filing produced against the approved subject and the effective date. It "
        + "re-runs on every attempt rather than replaying its own previous answer.",
    },
    {
      nodeId: "filing-presence",
      purpose: "Freshly re-reads the exact UCPath transaction named by the durable receipt and requires its "
        + "subject, effective date, termination action, and acceptable status to survive before Kuali can prepare.",
    },
  ],
  input: SeparationsInput,
  // The composed graph the five separations chunk harnesses each prove a step
  // of — the `of` target every one of them names.
  role: defineWorkflowRole({ kind: "composition" }),
  scenarios: [
    "separations/action-resolved",
    "separations/action-not-in-action-list",
    "separations/action-ambiguous",
    "separations/plan-refusals",
    "separations/subject-resolution",
    "separations/employment-refusals",
    "separations/date-reconciliation",
    "separations/receipt-refusals",
    "separations/kronos-hard-fails",
    "separations/gate-approved",
    "separations/dry-run-preview",
    "separations/subject-mismatch",
    "separations/pending-sweep-committed",
    "separations/pending-sweep-nothing-to-do",
    "separations/termination-committed",
    "separations/termination-already-present",
    "separations/finalization-committed",
    "separations/finalization-already-present",
    "separations/finalization-parks-after-termination",
    "separations/re-read-is-a-new-item",
    "separations/gate-resume-shape",
  ],
  steps: ({ group, task, transaction, gate, result }) => {
    const action = task(actionNode, [], ({ input }) => ({
      documentNumber: input.documentNumber,
    }));
    const document = task(documentNode, [action], ({ input, outputs }) => ({
      actionId: outputs[ACTION_NODE].actionId,
      documentNumber: input.documentNumber,
    }));
    const plan = task(planNode, [document], ({ input, outputs }) => ({
      documentNumber: input.documentNumber,
      employeeName: outputs[DOCUMENT_NODE].employee.name,
      lastDayWorked: outputs[DOCUMENT_NODE].separation.lastDayWorked,
      separationDate: outputs[DOCUMENT_NODE].separation.separationDate,
      // The reference is the READ's own instant, not a clock: the refusal then
      // says what is true — *as of the moment this run read the document*.
      observedAt: outputs[DOCUMENT_NODE].observedAt,
    }));
    const terminationType = task(
      terminationTypeNode,
      [document],
      ({ input, outputs }) => ({
      terminationType: outputs[DOCUMENT_NODE].separation.terminationType,
      // The complete option list this run ACTUALLY observed, so a republished
      // control refuses on the first run that sees it (§4a's accepted cost).
      observedOptions: outputs[DOCUMENT_NODE].options.terminationType,
      documentNumber: input.documentNumber,
      }),
    );
    const nameSearch = task(nameSearchNode, [plan], ({ outputs }) => ({
    // `keepNonHdh: true`, always, and UNCONDITIONALLY run — the identity's own
    // doc says why; the composition feeds it the plan's employee name.
      kind: "by-name" as const,
      name: outputs[PLAN_NODE].employeeName,
      keepNonHdh: true,
    }));
    const subject = task(subjectNode, [document, plan, nameSearch], ({ input, outputs }) => ({
      documentNumber: input.documentNumber,
      employeeName: outputs[PLAN_NODE].employeeName,
      ...(input.operatorEmployeeId === undefined ? {} : { operatorEmployeeId: input.operatorEmployeeId }),
      documentEid: outputs[DOCUMENT_NODE].employee.eid,
      nameSelection: outputs[NAME_SEARCH_NODE].selection,
    }));
    const jobSummary = task(jobSummaryNode, [subject], ({ outputs }) => ({
      emplId: outputs[SUBJECT_NODE].emplId,
    }));
    const employment = task(employmentNode, [document, jobSummary], ({ input, outputs }) => ({
      documentNumber: input.documentNumber,
      jobSummary: outputs[JOB_SUMMARY_NODE],
    }));
    const departmentOption = task(
      departmentOptionNode,
      [document, employment],
      ({ input, outputs }) => ({
      deptId: outputs[EMPLOYMENT_NODE].deptId,
      department: outputs[EMPLOYMENT_NODE].department,
      // Read current department options; new campus departments must not require code changes.
      observedOptions: outputs[DOCUMENT_NODE].options.department,
      documentNumber: input.documentNumber,
      }),
    );
    const timecardSearch = task(timecardSearchNode, [subject], ({ input, outputs }) => ({
      emplId: outputs[SUBJECT_NODE].emplId,
      searchTimeoutMs: input.searchTimeoutMs,
    }));
    const timecard = task(timecardNode, [subject, plan, timecardSearch], ({ outputs }) => {
      // Go To requires this search selection; failed selection is never an empty timecard.
      requireFact(outputs[TIMECARD_SEARCH_NODE].matched, TIMECARD_SEARCH_NODE, "matched");
      return {
        emplId: outputs[SUBJECT_NODE].emplId,
        rangeStart: outputs[PLAN_NODE].timecardWindow.start,
        rangeEnd: outputs[PLAN_NODE].timecardWindow.end,
      };
    });
    const dates = task(datesNode, [plan, timecard], ({ input, outputs }) => ({
      plan: outputs[PLAN_NODE],
      timekeeperName: input.timekeeperName,
      lastPunchDate: outputs[TIMECARD_NODE].grid.lastPunchDate,
      sickDates: outputs[TIMECARD_NODE].grid.sickDates,
      holidayDates: outputs[TIMECARD_NODE].grid.holidayDates,
      unclassifiedPayCodes: outputs[TIMECARD_NODE].grid.unclassifiedPayCodes,
      // The window the grid was PROVED to be showing, not the one asked for
      // — a leave day outside it is a year-stamp defect, not a leave day.
      observedWindow: {
        start: outputs[TIMECARD_NODE].range.observedStart,
        end: outputs[TIMECARD_NODE].range.observedEnd,
      },
    }));
    const comparison = task(
      comparisonNode,
      [document, plan, subject, jobSummary, nameSearch, terminationType, departmentOption, employment, dates],
      ({ input, outputs, protectedInputBindings }) => {
      const timekeeperBinding=protectedInputBindings?.find(({ name }) => name === "timekeeperName");
      if (timekeeperBinding === undefined) throw new Error("protected input timekeeperName binding is absent");
      return {
      ...(protectedInputBindings === undefined ? {} : { protectedBindings: [...protectedInputBindings] }),
    /** Everything identity authority consumes depends INTO this node — so `identity-gate-before-commit`
     *  passes with three transaction nodes: no write consumes a value outside the bound packet. */
      documentNumber: input.documentNumber,
      documentName: outputs[PLAN_NODE].employeeName,
      documentEid: outputs[DOCUMENT_NODE].employee.eid,
      emplId: outputs[SUBJECT_NODE].emplId,
      emplIdSource: outputs[SUBJECT_NODE].emplIdSource,
      jobSummary: outputs[JOB_SUMMARY_NODE],
      nameSelection: outputs[NAME_SEARCH_NODE].selection,
      // Approval binds to these values, so a moved date re-opens the gate.
      plan: {
        state: "planned" as const,
        termination: {
          terminationType: outputs[TERMINATION_TYPE_NODE].terminationType,
          classification: outputs[TERMINATION_TYPE_NODE].classification,
          template: outputs[TERMINATION_TYPE_NODE].template,
          reasonCode: outputs[TERMINATION_TYPE_NODE].reasonCode,
          emplRecord: outputs[EMPLOYMENT_NODE].emplRecord,
          effectiveDate: outputs[DATES_NODE].terminationEffectiveDate,
          lastDateWorked: outputs[DATES_NODE].lastDayWorked,
          initiatorComments: outputs[DATES_NODE].terminationComments,
        },
        document: {
          documentNumber: input.documentNumber,
          department: outputs[DEPARTMENT_NODE].option,
          departmentCode: outputs[DEPARTMENT_NODE].departmentCode,
          ucpathDepartment: outputs[DEPARTMENT_NODE].ucpathDepartment,
          payrollTitleCode: outputs[EMPLOYMENT_NODE].payrollTitleCode,
          payrollTitle: outputs[EMPLOYMENT_NODE].payrollTitle,
          terminationEffectiveDate: outputs[DATES_NODE].terminationEffectiveDate,
          timekeeperName: timekeeperBinding,
        },
        dates: {
          kualiLastDayWorked: outputs[DATES_NODE].kualiLastDayWorked,
          lastDayWorked: outputs[DATES_NODE].lastDayWorked,
          lastDayWorkedChanged: outputs[DATES_NODE].lastDayWorkedChanged,
          kualiSeparationDate: outputs[DATES_NODE].kualiSeparationDate,
          separationDate: outputs[DATES_NODE].separationDate,
          separationDateChanged: outputs[DATES_NODE].separationDateChanged,
          separationDeterminingLeave: outputs[DATES_NODE].separationDeterminingLeave,
          unclassifiedPayCodes: outputs[DATES_NODE].unclassifiedPayCodes,
          source: outputs[DATES_NODE].source,
        },
      },
      };
      },
    );
    const identityGate = gate(identityApprovalGate, [comparison]);
    const approval = task(approvalNode, [comparison, identityGate], ({ outputs }) => ({
      packet: outputs[COMPARISON_NODE].packet,
      evidenceDigest: outputs[COMPARISON_NODE].evidenceDigest,
      approval: outputs[GATE_NODE],
    }));
    const pendingSet = task(pendingSetNode, [approval], ({ outputs }) => ({
      emplId: outputs[APPROVAL_NODE].approved.emplId,
      expectedName: outputs[APPROVAL_NODE].approved.ucpathName,
    }));
    const clearPending = transaction(clearPendingNode, [approval, pendingSet], {
    prepareBind: ({ outputs }) => ({
      emplId: outputs[APPROVAL_NODE].approved.emplId,
      expectedName: outputs[APPROVAL_NODE].approved.ucpathName,
      observedSet: outputs[PENDING_SET_NODE],
    }),
    commitBind: ({ outputs }) => ({
      emplId: outputs[APPROVAL_NODE].approved.emplId,
      expectedName: outputs[APPROVAL_NODE].approved.ucpathName,
      observedSet: outputs[PENDING_SET_NODE],
    }),
    });
    const terminationDependencies = [approval, terminationType, employment, dates, clearPending] as const;
    const terminationTarget = ({ outputs }: WorkflowEntryScope<typeof SeparationsCanonicalInput, typeof terminationDependencies>) => ({
      emplId: outputs[APPROVAL_NODE].approved.emplId,
      expectedName: outputs[APPROVAL_NODE].approved.ucpathName,
      emplRecord: outputs[EMPLOYMENT_NODE].emplRecord,
      effectiveDate: outputs[DATES_NODE].terminationEffectiveDate,
      template: outputs[TERMINATION_TYPE_NODE].template,
      reasonCode: outputs[TERMINATION_TYPE_NODE].reasonCode,
      lastDateWorked: outputs[DATES_NODE].lastDayWorked,
      initiatorComments: outputs[DATES_NODE].terminationComments,
    });
    const fileTermination = transaction(fileTerminationNode, terminationDependencies, {
      prepareBind: terminationTarget,
      commitBind: terminationTarget,
      previewBind: scope => ({ prepare: terminationTarget(scope), commit: terminationTarget(scope), samples: [] }),
    });
    const receipt = task(receiptNode, [approval, dates, fileTermination], ({ outputs }) => ({
      // A transaction node's scope value is the typed outcome envelope;
      // `output` is the COMMIT contract's own bare output.
      proof: outputs[TERMINATION_NODE].output.receipt,
      disposition: outputs[TERMINATION_NODE].disposition,
      approvedEmplId: outputs[APPROVAL_NODE].approved.emplId,
      expectedEffectiveDate: outputs[DATES_NODE].terminationEffectiveDate,
    }));
    const filingPresence = task(filingPresenceNode, [receipt], ({ outputs }) =>
      outputs[RECEIPT_NODE]);
    const finalizationDependencies = [approval, action, document, plan, employment, departmentOption, dates, receipt, filingPresence] as const;
    const finalizationTarget = (
      { input, outputs, protectedInputBindings }: WorkflowEntryScope<typeof SeparationsCanonicalInput, typeof finalizationDependencies>,
      transactionNumber: string,
    ) => ({
      ...(protectedInputBindings === undefined ? {} : { protectedBindings: [...protectedInputBindings] }),
      actionId: outputs[ACTION_NODE].actionId,
      documentNumber: input.documentNumber,
      emplId: outputs[APPROVAL_NODE].approved.emplId,
      variables: {
        department: outputs[DEPARTMENT_NODE].option,
        payrollTitleCode: outputs[EMPLOYMENT_NODE].payrollTitleCode,
        payrollTitle: outputs[EMPLOYMENT_NODE].payrollTitle,
        timekeeperName: input.timekeeperName,
        // Stage reconciled values unconditionally; conditional staging would require another live read.
        lastDayWorked: outputs[DATES_NODE].lastDayWorked,
        separationDate: outputs[DATES_NODE].separationDate,
        terminationEffectiveDate: outputs[DATES_NODE].terminationEffectiveDate,
        transactionNumber,
        timekeeperComments: buildFinalizationComments({
          existingComments: existingComments(outputs[DOCUMENT_NODE].timekeeper.comments),
          dateChangeComments: outputs[DATES_NODE].dateChangeComments,
          documentNumber: input.documentNumber,
          transactionNumber,
          initials: separationInitials(input.timekeeperName),
          asOfDate: outputs[PLAN_NODE].asOfDate,
        }),
        observedExistingComments: existingComments(outputs[DOCUMENT_NODE].timekeeper.comments),
      },
    });
    const finalizeKuali = transaction(finalizeKualiNode, finalizationDependencies, {
      prepareBind: scope => finalizationTarget(scope, scope.outputs[FILING_PRESENCE_NODE].transactionId),
      commitBind: scope => finalizationTarget(scope, scope.outputs[FILING_PRESENCE_NODE].transactionId),
      previewBind: scope => {
        const source = scope.dryRun?.transactions.find(step => step.nodeId === TERMINATION_NODE);
        if (source === undefined) return undefined;
        if (source.preview.outcome.state === "would-prepare") {
          const value = finalizationTarget(scope, DRY_RUN_TRANSACTION_NUMBER);
          return { prepare: value, commit: value, samples: [{ label: "dry-run sample", sourceNodeId: NodeIdSchema.parse(TERMINATION_NODE),
            field: "UCPath transaction number", value: DRY_RUN_TRANSACTION_NUMBER }] };
        }
        const probe = source.preview.probe;
        if (probe.state !== "present" && probe.state !== "durable-intent") return undefined;
        const observed = UcpathCreateTermination.output.parse(probe.output.value);
        const value = finalizationTarget(scope, observed.receipt.transactionId);
        return { prepare: value, commit: value, samples: [] };
      },
    });

    return {
      steps: [
        [KUALI_EXTRACTION_STEP, [action, document, plan, terminationType]],
        [IDENTITY_CHECK_STEP, [nameSearch, subject, comparison, identityGate, approval]],
        [JOB_SUMMARY_STEP, [jobSummary, employment, departmentOption]],
        [group(KRONOS_TIMECARD_STEP, { omission: KRONOS_TIMECARD_OMISSION }), [timecardSearch, timecard, dates]],
        [group(UCPATH_TRANSACTION_STEP, { omission: UCPATH_TRANSACTION_OMISSION }), [pendingSet, clearPending, fileTermination, receipt]],
        [group(KUALI_FINALIZATION_STEP, { omission: KUALI_FINALIZATION_OMISSION }), [filingPresence, finalizeKuali]],
      ],
      result: result(
        SeparationsResultSchema,
        [approval, employment, departmentOption, dates, receipt, clearPending, fileTermination, finalizeKuali],
        ({ input, outputs }) => ({
      documentNumber: input.documentNumber,
      approved: outputs[APPROVAL_NODE].approved,
      employment: {
        emplRecord: outputs[EMPLOYMENT_NODE].emplRecord,
        payrollTitleCode: outputs[EMPLOYMENT_NODE].payrollTitleCode,
        payrollTitle: outputs[EMPLOYMENT_NODE].payrollTitle,
      },
      department: {
        option: outputs[DEPARTMENT_NODE].option,
        departmentCode: outputs[DEPARTMENT_NODE].departmentCode,
      },
      dates: {
        kualiLastDayWorked: outputs[DATES_NODE].kualiLastDayWorked,
        lastDayWorked: outputs[DATES_NODE].lastDayWorked,
        kualiSeparationDate: outputs[DATES_NODE].kualiSeparationDate,
        separationDate: outputs[DATES_NODE].separationDate,
        terminationEffectiveDate: outputs[DATES_NODE].terminationEffectiveDate,
        lastDayWorkedChanged: outputs[DATES_NODE].lastDayWorkedChanged,
        separationDateChanged: outputs[DATES_NODE].separationDateChanged,
      },
      // An omitted write step's node is absent from the scope (the
      // factory admits it as `step-omitted`); the result names the step.
      pendingSweep: omittedOr(outputs[SWEEP_NODE], UCPATH_TRANSACTION_STEP.key, (sweep) => ({
        disposition: sweep.disposition,
        proof: sweep.output.cleared,
      })),
      termination: outputs[RECEIPT_NODE],
      finalization: omittedOr(outputs[FINALIZE_NODE], KUALI_FINALIZATION_STEP.key, (finalize) => ({
        disposition: finalize.disposition,
        proof: finalize.output.savedState,
      })),
        }),
      ),
    };
  },
});
