import { z } from "zod";
import {
  KualiDocumentNumberSchema,
  KualiTimekeeperNameSchema,
} from "../../models/ui/kuali-document-identity.js";
import { ProfileInitialsSchema } from "../../models/profiles/profile.js";
import { defineCanonicalInput } from "../../models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../models/workflow/presentation.js";
import { SeparationsMatchIdentity } from "../../models/workflows/separations/match-identity.js";
import { SeparationsResultSchema } from "../../models/workflows/separations/result.js";
import { EID_PATTERN, EidSchema } from "../../rules/identity/ids.js";
import { defineWorkflowRole } from "../../workflow-kit/validation/module-role.js";
import { defineWorkflow } from "../../workflow-kit/workflow-definition.js";
import { APPROVAL_NODE, DEPARTMENT_NODE, EMPLOYMENT_NODE, JOB_SUMMARY_NODE, separationsIdentityCheckDefinition } from "./steps/identity-check/step.js";
import { DATES_NODE, separationsKronosTimecardDefinition } from "./steps/kronos-timecard/step.js";
import { ACTION_NODE, TERMINATION_TYPE_NODE, separationsKualiReadDefinition } from "./steps/kuali-extraction/step.js";
import { FINALIZE_NODE, KUALI_FINALIZATION_STEP, separationsKualiFinalizationDefinition } from "./steps/kuali-finalization/step.js";
import { RECEIPT_NODE, SWEEP_NODE, TERMINATION_NODE, UCPATH_TRANSACTION_STEP, separationsUcpathTerminationDefinition } from "./steps/ucpath-transaction/step.js";
export { KRONOS_TIMECARD_OMISSION } from "./steps/kronos-timecard/step.js";
export { KUALI_FINALIZATION_OMISSION } from "./steps/kuali-finalization/step.js";
export { UCPATH_TRANSACTION_OMISSION } from "./steps/ucpath-transaction/step.js";
const SEARCH_TIMEOUT_DEFAULT_MS = 15_000;

const SeparationReReadSchema = z.strictObject({
  ordinal: z.number().int().min(1).max(99),
  reason: z.string().min(1).max(200),
});

const SeparationsInputShape = {
  operatorEmployeeId: EidSchema.optional(),
  documentNumber: KualiDocumentNumberSchema,
  timekeeperName: KualiTimekeeperNameSchema,
  timekeeperInitials: ProfileInitialsSchema,
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
      timekeeperInitials: "ST",
    },
    {
      operatorEmployeeId: SeparationsMatchIdentity.example.packet.emplId,
      documentNumber: "4524",
      timekeeperName: "Synthetic Timekeeper",
      timekeeperInitials: "ST",
      searchTimeoutMs: 30_000,
      reRead: { ordinal: 1, reason: "the department corrected the last day worked" },
    },
  ],
);

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
  requiredWorkbookFields: [],
  version: 1,
  code: "sp",
  label: "Separations",
  summary: "The composition: ONE Kuali RRSS separation document becomes ONE terminated employee across three "
    + "systems. It reads Kuali, UCPath and Kronos, reconciles the dates against what the timecard "
    + "actually shows, establishes identity from supplied-EID read-back or the name-only gate, then clears any pending termination, "
    + "files the termination, verifies the receipt, and finalizes the Kuali document.",
  icon: "ShieldCheck",
  category: "separation",
  canonicalInput: SeparationsCanonicalInput,
  failureCorrections: [{
    nodeId: JOB_SUMMARY_NODE, code: "employee-not-found", inputField: "operatorEmployeeId",
    label: "Employee ID", actionLabel: "Enter EID", pattern: EID_PATTERN.source, displaySafe: true
  },
  {
    nodeId: ACTION_NODE, code: "document-not-in-action-list", inputField: "documentNumber",
    label: "Document number", actionLabel: "Enter document number", pattern: z.toJSONSchema(KualiDocumentNumberSchema).pattern
  }],
  rerunValues: [
    { nodeId: DATES_NODE, fieldPath: "lastDayWorked", label: "Last day worked", targetStepKey: "kronos-timecard", targetFieldPath: "lastDayWorked" },
    { nodeId: DATES_NODE, fieldPath: "separationDate", label: "Separation date", targetStepKey: "kronos-timecard", targetFieldPath: "separationDate" },
    { nodeId: RECEIPT_NODE, fieldPath: "transactionNumber", label: "UCPath transaction number", targetStepKey: "ucpath-transaction", targetFieldPath: "transactionNumber" },
    { nodeId: RECEIPT_NODE, fieldPath: "approvalStatus", label: "Approval status", targetStepKey: "ucpath-transaction", targetFieldPath: "approvalStatus" },
  ],
  protectedInputs: [{ inputPath: "timekeeperName", name: "timekeeperName" }],
  inputSubject: "document",
  surface: { shape: "single" },
  enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: {
    inputRun: {
      placeholder: "Enter Kuali document numbers, semicolon-separated (e.g. 4502; 4510)",
      parser: {
        split: { kind: "delimited", delimiters: [";", "\n"] },
        rules: [
          { when: { kind: "pattern", pattern: "document-number" }, emit: "documentNumber" },
        ],
      },
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
  subjectProjection: { nodeId: JOB_SUMMARY_NODE, fieldPath: "displayedName", eidFieldPath: "emplId" },
  identity: {
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
  input: SeparationsInput,
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
  steps: author => {
    const { result } = author;
    const extraction = separationsKualiReadDefinition.build(author);
    const resolved = separationsIdentityCheckDefinition.resolveSubject(author, extraction);
    const jobs = separationsIdentityCheckDefinition.readJobs(author, extraction, resolved);
    const timecard = separationsKronosTimecardDefinition.build(author, extraction, resolved);
    const identity = separationsIdentityCheckDefinition.build(author, extraction, resolved, jobs, timecard);
    const termination = separationsUcpathTerminationDefinition.build(author, extraction, jobs, timecard, identity);
    const finalization = separationsKualiFinalizationDefinition.build(author, extraction, jobs, timecard, identity, termination);
    const { approval } = identity, { employment, departmentOption } = jobs, { dates } = timecard;
    const { receipt, clearPending, fileTermination } = termination, { finalizeKuali } = finalization;
    return {
      steps: [...extraction.steps, ...identity.steps, ...timecard.steps, ...termination.steps, ...finalization.steps],
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
      )
    };
  },
});

export { SeparationsResultSchema } from "../../models/workflows/separations/result.js";
export { COMPARISON_NODE, DEPARTMENT_NODE, GATE_NODE, JOB_SUMMARY_NODE, NAME_SEARCH_NODE } from "./steps/identity-check/step.js";
export { actionNode } from "./steps/kuali-extraction/step.js";
export { FINALIZE_NODE } from "./steps/kuali-finalization/step.js";
