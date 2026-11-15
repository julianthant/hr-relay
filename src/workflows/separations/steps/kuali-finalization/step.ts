import type { WorkflowGroupOptions } from "../../../../workflow-kit/workflow-definition.js";
import { z } from "zod";
import {
  KualiSaveSeparationFinalization,
} from "../../../../models/systems/kuali/save-separation-finalization.js";
import {
  KualiStageSeparationFinalization,
} from "../../../../models/systems/kuali/stage-separation-finalization.js";
import { UcpathCreateTermination } from "../../../../models/systems/ucpath/create-termination.js";
import { UcpathReadJobSummary } from "../../../../models/systems/ucpath/read-job-summary.js";
import { SearchPersonOrg } from "../../../../models/systems/ucpath/search-person-org.js";
import {
  UcpathVerifyTerminationFilingPresent,
} from "../../../../models/systems/ucpath/verify-termination-filing-present.js";
import {
  KualiActionIdSchema,
  KualiDocumentNumberSchema,
  KualiTimekeeperNameSchema,
} from "../../../../models/ui/kuali-document-identity.js";
import {
  KualiEidFieldSchema,
  KualiFormDateSchema,
  KualiTransactionNumberSchema,
} from "../../../../models/ui/kuali-separation-document.js";
import {
  KUALI_FINALIZATION_ASSERTIONS,
  KualiFinalizationCommentsSchema,
  KualiPayrollTitleCodeSchema,
  KualiPayrollTitleSchema,
  KualiSavedFinalizationProofSchema,
} from "../../../../models/ui/kuali-separation-finalization.js";
import { UcpathJobCellSchema } from "../../../../models/ui/ucpath-job-summary.js";
import { UcpathApprovalStatusSchema } from "../../../../models/ui/ucpath-ss-smart-hr.js";
import { defineCanonicalInput } from "../../../../models/workflow/canonical-input.js";
import { DRY_RUN_TRANSACTION_NUMBER } from "../../../../models/workflow/dry-run.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../models/workflow/presentation.js";
import type { StepOmissionDeclaration } from "../../../../models/workflow/step-omission.js";
import {
  SeparationsMatchDepartmentOption,
} from "../../../../models/workflows/separations/match-department-option.js";
import { SeparationsMatchIdentity } from "../../../../models/workflows/separations/match-identity.js";
import {
  SeparationsVerifyIdentityApproval
} from "../../../../models/workflows/separations/verify-identity-approval.js";
import { EidSchema, NodeIdSchema } from "../../../../rules/identity/ids.js";
import {
  IdentityApprovalResultSchema,
  ResolvedIdentitySubjectSchema,
} from "../../../../rules/separations/identity-approval.js";
import { IdentityEidSourceSchema } from "../../../../rules/separations/identity-evidence.js";
import { buildFinalizationComments } from "../../../../rules/separations/separation-dates.js";
import {
  assertTerminationReceipt
} from "../../../../rules/separations/termination-receipt.js";
import { noSeparationWritePlan } from "../../../../rules/separations/write-plan.js";
import type { StepProofSpec, WorkflowAuthor, WorkflowEntryScope } from "../../../../workflow-kit/workflow-definition.js";
import { defineStep, defineStepEntries } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
import type { SeparationsCanonicalInput, SeparationsInput } from "../../workflow.js";
import type { buildIdentity, readJobs } from "../identity-check/step.js";
import type { buildTimecard } from "../kronos-timecard/step.js";
import type { buildExtraction } from "../kuali-extraction/step.js";
import type { buildTermination } from "../ucpath-transaction/step.js";
type Author = WorkflowAuthor<typeof SeparationsInput>;
type Extraction = ReturnType<typeof buildExtraction>;
type Jobs = ReturnType<typeof readJobs>;
type Timecard = ReturnType<typeof buildTimecard>;
type Identity = ReturnType<typeof buildIdentity>;
type Termination = ReturnType<typeof buildTermination>;

export const KUALI_FINALIZATION_STEP = defineWorkflowStep({
  key: "kuali-finalization",
  label: "Kuali finalization",
});

/** Operator text and fields for this group in Explorer and Logs. */
const KUALI_FINALIZATION_DISPLAY = {
  description: "Confirm the termination is current in UCPath, then finalize the Kuali document.",
  system: "kuali",
  operatorFields: [
    { label: "UCPath transaction", example: "T000000001", sources: [{ nodeId: "filing-presence", kind: "output", fieldPath: "transactionId" }] },
    { label: "Approval status", example: "Submitted", sources: [{ nodeId: "filing-presence", kind: "output", fieldPath: "approvalStatus" }] },
  ],
  review: {
    pages: [
      {
        id: "ucpath-filing",
        title: "SS Smart HR transaction detail",
        mode: "Read only",
        nodeIds: ["filing-presence"],
        lines: [{ id: "verify-filing", kind: "check", text: "Confirm the exact termination filing is current in UCPath.", nodeIds: ["filing-presence"] }],
        fields: [
          {
            id: "ucpath-transaction",
            operatorField: "UCPath transaction",
            source: {
              origin: "UCPath",
              detail: "Exact current transaction found for the separation.",
              chain: [],
              read: { stepKey: "kuali-finalization", page: "SS Smart HR transaction detail", field: "UCPath transaction" }
            }
          },
          {
            id: "approval-status",
            operatorField: "Approval status",
            source: {
              origin: "UCPath",
              detail: "Current approval status of the filing.",
              chain: [],
              read: { stepKey: "kuali-finalization", page: "SS Smart HR transaction detail", field: "Approval status" }
            }
          }
        ]
      },
      {
        id: "kuali-document",
        title: "Kuali RRSS Separation Request Form",
        mode: "Fill form",
        nodeIds: ["finalize-kuali"],
        lines: [
          { id: "fill-finalization", kind: "action", text: "Fill the reviewed transaction, dates, department and timekeeper details.", nodeIds: ["finalize-kuali"] },
          { id: "verify-staged", kind: "check", text: "Verify the exact document and staged finalization values.", nodeIds: ["finalize-kuali"] },
          { id: "save-document", kind: "action", text: "In a live run, save the reviewed Kuali document.", nodeIds: ["finalize-kuali"] }
        ],
        fields: [
          {
            id: "kuali-document-department",
            label: "Department",
            transactionFields: [{ nodeId: "finalize-kuali", kind: "input", fieldPath: "variables.department" }],
            source: {
              origin: "Matched department option",
              detail: "The Kuali option matched to the active UCPath department.",
              chain: [],
              read: { stepKey: "job-summary", page: "Person Organizational Summary detail", field: "Kuali department option" }
            }
          },
          {
            id: "kuali-document-payroll-title-code",
            label: "Payroll title code",
            transactionFields: [{ nodeId: "finalize-kuali", kind: "input", fieldPath: "variables.payrollTitleCode" }],
            source: { origin: "UCPath employment", detail: "The payroll title code read from the selected active job.", chain: [] }
          },
          {
            id: "kuali-document-payroll-title",
            label: "Payroll title",
            transactionFields: [{ nodeId: "finalize-kuali", kind: "input", fieldPath: "variables.payrollTitle" }],
            source: {
              origin: "UCPath employment",
              detail: "The payroll title read from the selected active job.",
              chain: [],
              read: { stepKey: "job-summary", page: "Person Organizational Summary detail", field: "Payroll title" }
            }
          },
          {
            id: "kuali-document-timekeeper-name",
            label: "Timekeeper name",
            transactionFields: [{ nodeId: "finalize-kuali", kind: "input", fieldPath: "variables.timekeeperName" }],
            source: { origin: "Configured timekeeper", detail: "The timekeeper name supplied in the admitted run input.", chain: [] }
          },
          {
            id: "kuali-document-last-day-worked",
            label: "Last day worked",
            transactionFields: [{ nodeId: "finalize-kuali", kind: "input", fieldPath: "variables.lastDayWorked" }],
            source: {
              origin: "Reconciled separation dates",
              detail: "Use the reconciled last day worked.",
              chain: [],
              read: { stepKey: "kronos-timecard", page: "Timecard", field: "Last day worked" }
            }
          },
          {
            id: "kuali-document-separation-date",
            label: "Separation date",
            transactionFields: [{ nodeId: "finalize-kuali", kind: "input", fieldPath: "variables.separationDate" }],
            source: {
              origin: "Reconciled separation dates",
              detail: "Use the reconciled separation date.",
              chain: [],
              read: { stepKey: "kronos-timecard", page: "Timecard", field: "Separation date" }
            }
          },
          {
            id: "kuali-document-termination-effective-date",
            label: "Termination effective date",
            transactionFields: [{ nodeId: "finalize-kuali", kind: "input", fieldPath: "variables.terminationEffectiveDate" }],
            source: {
              origin: "Reconciled separation dates and UCPath receipt",
              detail: "Use the reconciled effective date checked against the current UCPath filing.",
              chain: [],
              read: { stepKey: "ucpath-transaction", page: "SS Smart HR transaction detail", field: "Effective date" }
            }
          },
          {
            id: "kuali-document-transaction-number",
            label: "Transaction number",
            transactionFields: [{ nodeId: "finalize-kuali", kind: "input", fieldPath: "variables.transactionNumber" }],
            source: {
              origin: "Verified UCPath receipt",
              detail: "Use the exact transaction whose current filing was independently verified.",
              chain: [],
              read: { stepKey: "ucpath-transaction", page: "SS Smart HR transaction detail", field: "Transaction number" }
            }
          },
          {
            id: "kuali-document-timekeeper-comments",
            label: "Timekeeper comments",
            transactionFields: [{ nodeId: "finalize-kuali", kind: "input", fieldPath: "variables.timekeeperComments" }],
            source: {
              origin: "Existing comments and filing details",
              detail: "Preserve existing Kuali comments, add any date-change explanation and append the verified filing line.",
              chain: [
                { label: "Existing Kuali comments", detail: "Read the existing text from the separation document and preserve it." },
                { label: "Filing details", detail: "Append the transaction number, document number, timekeeper initials and reference date." }
              ]
            }
          },
          {
            id: "kuali-document-request-acknowledged",
            label: "Request acknowledged",
            constant: { nodeIds: ["finalize-kuali"], value: KUALI_FINALIZATION_ASSERTIONS.requestAcknowledged },
            example: "Checked",
            source: { origin: "Workflow rule", detail: "Use the declared separation finalization choice.", chain: [] }
          },
          {
            id: "kuali-document-termination-template-submitted",
            label: "Termination template submitted",
            constant: { nodeIds: ["finalize-kuali"], value: KUALI_FINALIZATION_ASSERTIONS.submittedTerminationTemplate },
            example: "Checked",
            source: { origin: "Workflow rule", detail: "Use the declared separation finalization choice.", chain: [] }
          },
          {
            id: "kuali-document-final-pay",
            label: "Final pay",
            constant: { nodeIds: ["finalize-kuali"], value: KUALI_FINALIZATION_ASSERTIONS.finalPay },
            example: "Does not need final pay · student",
            source: { origin: "Workflow rule", detail: "Use the declared separation finalization choice.", chain: [] }
          }
        ]
      }
    ],
    branchLabels: []
  } as const,
} satisfies WorkflowGroupOptions;

export const FILING_PRESENCE_NODE = "filing-presence";
export const FINALIZE_NODE = "finalize-kuali";

const kualiFinalizationEntries = defineStepEntries(KUALI_FINALIZATION_STEP);

export const filingPresenceNode = kualiFinalizationEntries.task(
  FILING_PRESENCE_NODE,
  UcpathVerifyTerminationFilingPresent,
  { label: "Verify Current UCPath Filing", replay: "always-rerun" },
);

export function existingComments(comments: { state: "present"; value: string } | { state: "absent" }): string {
  return comments.state === "present" ? comments.value : "";
}

export const finalizeKualiNode = kualiFinalizationEntries.transaction(FINALIZE_NODE, {
  label: "Finalize Kuali Document",
  prepare: KualiStageSeparationFinalization,
  commit: KualiSaveSeparationFinalization,
  dryRun: "stop-after-prepare",
  probePolicy: "always",
  probeToFenceMaxMs: 45_000,
});

export const KUALI_FINALIZATION_OMISSION: StepOmissionDeclaration = {
  form: { fields: [] },
  produces: {},
};


const FinalizationInputShape = {
  actionId: KualiActionIdSchema,
  documentNumber: KualiDocumentNumberSchema,
  employeeName: z.string().min(1),
  emplId: EidSchema,
  emplIdSource: IdentityEidSourceSchema,
  documentEid: KualiEidFieldSchema,
  ucpathDeptId: UcpathJobCellSchema,
  ucpathDepartment: UcpathJobCellSchema,
  observedDepartmentOptions: z.array(z.string().min(1)).min(1),
  payrollTitleCode: KualiPayrollTitleCodeSchema,
  payrollTitle: KualiPayrollTitleSchema,
  timekeeperName: KualiTimekeeperNameSchema,
  lastDayWorked: KualiFormDateSchema,
  separationDate: KualiFormDateSchema,
  terminationEffectiveDate: KualiFormDateSchema,
  transactionNumber: KualiTransactionNumberSchema,
  transactionApprovalStatus: UcpathApprovalStatusSchema,
  timekeeperComments: KualiFinalizationCommentsSchema,
  observedExistingComments: z.string().max(4000),
} as const;
export const SeparationsKualiFinalizationInput = z.strictObject(
  FinalizationInputShape,
);
export const SeparationsKualiFinalizationCanonicalInput = defineCanonicalInput(
  SeparationsKualiFinalizationInput,
  z.strictObject(FinalizationInputShape),
  [
    {
      actionId: "6a7a33b2ac106d428b3217e0",
      documentNumber: "4510",
      employeeName: "Battistessa, Johnnie",
      emplId: "10873698",
      emplIdSource: "document-eid",
      documentEid: { state: "present", value: "10873698" },
      ucpathDeptId: { state: "present", value: "000412" },
      ucpathDepartment: {
        state: "present",
        value: "HOUSING/DINING/HOSPITALITY",
      },
      observedDepartmentOptions: [
        "- - -",
        "000412 - Housing/Dining/Hospitality",
      ],
      payrollTitleCode: "004921",
      payrollTitle: "STDT 2",
      timekeeperName: "Deterministic Timekeeper",
      lastDayWorked: "06/09/2026",
      separationDate: "06/10/2026",
      terminationEffectiveDate: "06/11/2026",
      transactionNumber: "T002209631",
      transactionApprovalStatus: "Pending",
      timekeeperComments:
        "Termination effective date set from the reconciled separation date.",
      observedExistingComments: "",
    },
  ],
);
export const SeparationsKualiFinalizationResultSchema = z.strictObject({
  documentNumber: z.string().min(1),
  approved: ResolvedIdentitySubjectSchema,
  department: z.strictObject({
    option: z.string().min(1),
    departmentCode: z.string().min(1),
  }),
  finalization: z.strictObject({
    disposition: z.enum(["committed", "already-present"]),
    proof: KualiSavedFinalizationProofSchema,
  }),
});

export function buildFinalization({ task, transaction, group }: Author, extraction: Extraction, jobs: Jobs, timecard: Timecard, identity: Identity, termination: Termination) {
  const { action, document, plan } = extraction, { employment, departmentOption } = jobs;
  const { dates } = timecard, { approval } = identity, { receipt } = termination;
  const filingPresence = task(filingPresenceNode, [receipt], ({ outputs }) =>
    outputs["receipt"]);
  const finalizationDependencies = [approval, action, document, plan, employment, departmentOption, dates, receipt, filingPresence] as const;
  const finalizationTarget = (
    { input, outputs, protectedInputBindings }: WorkflowEntryScope<typeof SeparationsCanonicalInput, typeof finalizationDependencies>,
    transactionNumber: string,
  ) => ({
    ...(protectedInputBindings === undefined ? {} : { protectedBindings: [...protectedInputBindings] }),
    actionId: outputs["resolve-action"].actionId,
    documentNumber: input.documentNumber,
    emplId: outputs["approval"].approved.emplId,
    variables: {
      department: outputs["department-option"].option,
      payrollTitleCode: outputs["employment"].payrollTitleCode,
      payrollTitle: outputs["employment"].payrollTitle,
      timekeeperName: input.timekeeperName,
      lastDayWorked: outputs["dates"].lastDayWorked,
      separationDate: outputs["dates"].separationDate,
      terminationEffectiveDate: outputs["dates"].terminationEffectiveDate,
      transactionNumber,
      timekeeperComments: buildFinalizationComments({
        existingComments: existingComments(outputs["document"].timekeeper.comments),
        dateChangeComments: outputs["dates"].dateChangeComments,
        documentNumber: input.documentNumber,
        transactionNumber,
        initials: input.timekeeperInitials,
        asOfDate: outputs["plan"].asOfDate,
      }),
      observedExistingComments: existingComments(outputs["document"].timekeeper.comments),
    },
  });
  const finalizeKuali = transaction(finalizeKualiNode, finalizationDependencies, {
    prepareBind: scope => finalizationTarget(scope, scope.outputs[FILING_PRESENCE_NODE].transactionId),
    commitBind: scope => finalizationTarget(scope, scope.outputs[FILING_PRESENCE_NODE].transactionId),
    previewBind: scope => {
      const source = scope.dryRun?.transactions.find(step => step.nodeId === "file-termination");
      if (source === undefined) return undefined;
      if (source.preview.outcome.state === "would-prepare") {
        const value = finalizationTarget(scope, DRY_RUN_TRANSACTION_NUMBER);
        return {
          prepare: value, commit: value, samples: [{
            label: "dry-run sample", sourceNodeId: NodeIdSchema.parse("file-termination"),
            field: "UCPath transaction number", value: DRY_RUN_TRANSACTION_NUMBER
          }]
        };
      }
      const probe = source.preview.probe;
      if (probe.state !== "present" && probe.state !== "durable-intent") return undefined;
      const observed = UcpathCreateTermination.output.parse(probe.output.value);
      const value = finalizationTarget(scope, observed.receipt.transactionId);
      return { prepare: value, commit: value, samples: [] };
    },
  });
  return { finalizeKuali, steps: [[group(KUALI_FINALIZATION_STEP, { ...KUALI_FINALIZATION_DISPLAY, omission: KUALI_FINALIZATION_OMISSION }), [filingPresence, finalizeKuali]]] as const };
}

export const separationsKualiFinalizationDefinition = defineStep({
  group: KUALI_FINALIZATION_STEP, build: buildFinalization,
  proof: {
    id: "separations-kuali-finalization", order: 4, build: (): StepProofSpec<typeof SeparationsKualiFinalizationInput, typeof SeparationsKualiFinalizationResultSchema> => ({
      version: 1,
      code: "sf",
      label: "Kuali Finalization",
      summary: "Chunk 5 of the separations migration: the Kuali finalization SAVE, provable alone. Reads the " +
        "identity picture, resolves the department option, parks for approval, then stages every " +
        "finalization field in one pass and saves once.",
      icon: "ShieldCheck",
      category: "separation",
      canonicalInput: SeparationsKualiFinalizationCanonicalInput,
      inputSubject: "eid",
      surface: { shape: "single" },
      enqueue: "reject-active",
      actions: STANDARD_WORKFLOW_ACTIONS,
      surfaces: {},
      verdicts: [
        {
          key: "no-active-job",
          label: "No active job in UCPath",
          tone: "warning",
          tag: true,
        },
        {
          key: "concurrent-jobs",
          label: "Concurrent active jobs",
          tone: "warning",
          tag: true,
        },
        {
          key: "name-differs",
          label: "Name differs from UCPath",
          tone: "warning",
          tag: true,
        },
      ],
      details: [
        {
          key: "ucpath-name",
          label: "UCPath shows",
          source: { nodeId: "job-summary", fieldPath: "displayedName" },
          display: "text",
        },
        {
          key: "department",
          label: "Department",
          source: { nodeId: "department-option", fieldPath: "option" },
          display: "text",
        },
        {
          key: "transaction-number",
          label: "Transaction",
          source: {
            nodeId: FINALIZE_NODE,
            fieldPath: "savedState.fields.transactionNumber",
          },
          display: "text",
        },
      ],
      identity: {
        matchKey: (input) =>
          `separations-kuali-finalization:${input.documentNumber}:${input.transactionNumber}`,
      },
      presentation: {
        title: (input) => `Kuali ${input.documentNumber} finalization`,
        subtitle: (input) => `${input.employeeName} — ${input.transactionNumber}`,
      },
      nodePurposes: [
        {
          nodeId: "job-summary",
          purpose:
            "Reads the subject's whole UCPath job summary grid verbatim — every row, every status — and " +
            "classifies nothing; the disposition is a separate, pure fold.",
        },
        {
          nodeId: "name-search",
          purpose:
            "Searches UCPath Person Org by the document's employee name, unconditionally, so the operator " +
            "sees every person that name matches rather than only the ones a similarity threshold selected.",
        },
        {
          nodeId: "department-option",
          purpose:
            "Resolves the subject's UCPath department to the exact option this document's OWN control offers, " +
            "refusing one the control does not carry. Pure: it reaches no browser.",
        },
        {
          nodeId: "comparison",
          purpose:
            "Builds the identity evidence packet — DISCONFIRMING evidence first — and the digest that " +
            "machine verification or an operator decision binds to. Pure: it reaches no browser.",
        },
        {
          nodeId: "identity-approval",
          purpose:
            "Requires the typed operator resolve-gate command when the packet's EID came from a name search; " +
            "a supplied-EID packet makes this declared condition false and records no human decision.",
        },
        {
          nodeId: "approval",
          purpose:
            "Re-derives the evidence and produces explicit machine-verification or operator-approval " +
            "authority. It re-runs on every attempt, so moved evidence or identity origin cannot reuse an old answer.",
        },
        {
          nodeId: "filing-presence",
          purpose:
            "Freshly verifies the exact asserted UCPath transaction still exists for the approved subject, " +
            "effective date, termination action, and acceptable status before Kuali can prepare.",
        },
        {
          nodeId: "finalize-kuali",
          purpose:
            "Stages every finalization field in ONE pass from the reconciled variables, saves once, and " +
            "proves the save by reloading and comparing each written field against exactly what was staged.",
        },
      ],
      scenarios: [
        "separations-kuali-finalization/stage-refusals",
        "separations-kuali-finalization/save-verify-read-back",
        "separations-kuali-finalization/department-option-refusals",
        "separations-kuali-finalization/dry-run-preview",
        "separations-kuali-finalization/subject-mismatch",
        "separations-kuali-finalization/committed",
        "separations-kuali-finalization/already-present",
        "separations-kuali-finalization/gate-approved",
        "separations-kuali-finalization/save-not-landed-parks",
      ],
      input: SeparationsKualiFinalizationInput,
      steps: (author: WorkflowAuthor<typeof SeparationsKualiFinalizationInput>) => {
        const { task, gate, transaction, result } = author;
        const jobSummary = task(
          {
            id: "job-summary",
            contract: UcpathReadJobSummary,
            label: "Job Summary",
            replay: "checkpoint",
          },
          [],
          ({ input }) => ({ emplId: input.emplId }),
        );
        const nameSearch = task(
          {
            id: "name-search",
            contract: SearchPersonOrg,
            label: "Name Search",
            replay: "checkpoint",
          },
          [],
          ({ input }) => ({
            kind: "by-name" as const,
            name: input.employeeName,
            keepNonHdh: true,
          }),
        );
        const departmentOption = task(
          {
            id: "department-option",
            contract: SeparationsMatchDepartmentOption,
            label: "Department Option",
            replay: "checkpoint",
          },
          [jobSummary],
          ({ input }) => ({
            deptId: input.ucpathDeptId,
            department: input.ucpathDepartment,
            observedOptions: input.observedDepartmentOptions,
            documentNumber: input.documentNumber,
          }),
        );
        const comparison = task(
          {
            id: "comparison",
            contract: SeparationsMatchIdentity,
            label: "Identity Comparison",
            replay: "checkpoint",
          },
          [jobSummary, nameSearch],
          ({ input, outputs }) => ({
            documentNumber: input.documentNumber,
            documentName: input.employeeName,
            documentEid: input.documentEid,
            emplId: input.emplId,
            emplIdSource: input.emplIdSource,
            jobSummary: outputs["job-summary"],
            nameSelection: outputs["name-search"].selection,
            plan: noSeparationWritePlan(
              "this chunk finalizes the Kuali document alone; the composed `separations` graph is where the whole write plan — the UCPath termination included — exists to show",
            ),
          }),
        );
        const identityGate = gate(
          {
            id: "identity-approval",
            label: "Identity Approval",
            statusKey: "awaitingIdentityApproval",
            result: IdentityApprovalResultSchema,
            when: {
              kind: "is-true",
              of: {
                from: "node",
                nodeId: "comparison",
                path: "approvalRequired",
              },
            },
          },
          [comparison, departmentOption],
        );
        const approval = task(
          {
            id: "approval",
            contract: SeparationsVerifyIdentityApproval,
            label: "Approval Check",
            replay: "always-rerun",
          },
          [comparison, identityGate],
          ({ outputs }) => ({
            packet: outputs["comparison"].packet,
            evidenceDigest: outputs["comparison"].evidenceDigest,
            approval: outputs["identity-approval"],
          }),
        );
        const filingPresence = task(
          filingPresenceNode,
          [approval],
          ({ input, outputs }) =>
            assertTerminationReceipt({
              transactionNumber: input.transactionNumber,
              approvalStatus: input.transactionApprovalStatus,
              approvedEmplId: outputs["approval"].approved.emplId,
              approvedName: outputs["approval"].approved.ucpathName,
              expectedEffectiveDate: input.terminationEffectiveDate,
            }),
        );
        const finalizeKuali = transaction(
          finalizeKualiNode,
          [approval, departmentOption, filingPresence],
          {
            prepareBind: ({ input, outputs }) => ({
              actionId: input.actionId,
              documentNumber: input.documentNumber,
              emplId: outputs["approval"].approved.emplId,
              variables: {
                department: outputs["department-option"].option,
                payrollTitleCode: input.payrollTitleCode,
                payrollTitle: input.payrollTitle,
                timekeeperName: input.timekeeperName,
                lastDayWorked: input.lastDayWorked,
                separationDate: input.separationDate,
                terminationEffectiveDate: input.terminationEffectiveDate,
                transactionNumber: outputs[FILING_PRESENCE_NODE].transactionId,
                timekeeperComments: input.timekeeperComments,
                observedExistingComments: input.observedExistingComments,
              },
            }),
            commitBind: ({ input, outputs }) => ({
              actionId: input.actionId,
              documentNumber: input.documentNumber,
              emplId: outputs["approval"].approved.emplId,
              variables: {
                department: outputs["department-option"].option,
                payrollTitleCode: input.payrollTitleCode,
                payrollTitle: input.payrollTitle,
                timekeeperName: input.timekeeperName,
                lastDayWorked: input.lastDayWorked,
                separationDate: input.separationDate,
                terminationEffectiveDate: input.terminationEffectiveDate,
                transactionNumber: outputs[FILING_PRESENCE_NODE].transactionId,
                timekeeperComments: input.timekeeperComments,
                observedExistingComments: input.observedExistingComments,
              },
            }),
          },
        );
        return {
          steps: [
            [
              KUALI_FINALIZATION_STEP,
              [
                jobSummary,
                nameSearch,
                departmentOption,
                comparison,
                identityGate,
                approval,
                filingPresence,
                finalizeKuali,
              ],
            ],
          ],
          result: result(
            SeparationsKualiFinalizationResultSchema,
            [approval, departmentOption, finalizeKuali],
            ({ outputs }) => ({
              documentNumber: outputs["approval"].documentNumber,
              approved: outputs["approval"].approved,
              department: {
                option: outputs["department-option"].option,
                departmentCode: outputs["department-option"].departmentCode,
              },
              finalization: {
                disposition: outputs[FINALIZE_NODE].disposition,
                proof: outputs[FINALIZE_NODE].output.savedState,
              },
            }),
          ),
        };
      },
    }),
  },
});
