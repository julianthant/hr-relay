/** `separations-kuali-finalization` — the Kuali finalization WRITE, provable alone. ONE transaction node (§4e): stage all fields, one save, one reload read-back; identity authority (§14) gates it, and dryRun stop-after-prepare. */
import { z } from "zod";
import { defineWorkflow } from "../../../../workflow-kit/workflow-definition.js";
import { SeparationsMatchDepartmentOption } from "../../../../models/workflows/separations/match-department-option.js";
import { SeparationsMatchIdentity } from "../../../../models/workflows/separations/match-identity.js";
import { SeparationsVerifyIdentityApproval } from "../../../../models/workflows/separations/verify-identity-approval.js";
import { UcpathReadJobSummary } from "../../../../models/systems/ucpath/read-job-summary.js";
import { SearchPersonOrg } from "../../../../models/systems/ucpath/search-person-org.js";
import { EidSchema } from "../../../../rules/identity/ids.js";
import {
  IdentityApprovalResultSchema,
  ResolvedIdentitySubjectSchema,
} from "../../../../rules/separations/identity-approval.js";
import { IdentityEidSourceSchema } from "../../../../rules/separations/identity-evidence.js";
import { noSeparationWritePlan } from "../../../../rules/separations/write-plan.js";
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
  KualiFinalizationCommentsSchema,
  KualiPayrollTitleCodeSchema,
  KualiPayrollTitleSchema,
  KualiSavedFinalizationProofSchema,
} from "../../../../models/ui/kuali-separation-finalization.js";
import { UcpathJobCellSchema } from "../../../../models/ui/ucpath-job-summary.js";
import { UcpathApprovalStatusSchema } from "../../../../models/ui/ucpath-ss-smart-hr.js";
import { assertTerminationReceipt } from "../../../../rules/separations/termination-receipt.js";
import { defineCanonicalInput } from "../../../../models/workflow/canonical-input.js";
import { defineWorkflowRole } from "../../../../workflow-kit/validation/module-role.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../models/workflow/presentation.js";
import {
  APPROVAL_NODE,
  COMPARISON_NODE,
  GATE_NODE,
  NAME_SEARCH_NODE,
  DEPARTMENT_NODE,
  JOB_SUMMARY_NODE,
  FILING_PRESENCE_NODE,
  FINALIZE_NODE,
  filingPresenceNode,
  finalizeKualiNode,
  KUALI_FINALIZATION_STEP,
} from "../../workflow.js";
/** The ingress: the identity-check ingress plus the staged variables no read on THIS graph produces, each a value an earlier chunk composed into this input. `department` is DERIVED, never option text. */
const FinalizationInputShape = {
  actionId: KualiActionIdSchema,
  documentNumber: KualiDocumentNumberSchema,
  employeeName: z.string().min(1),
  emplId: EidSchema,
  emplIdSource: IdentityEidSourceSchema,
  documentEid: KualiEidFieldSchema,
  // The UCPath Dept ID and Department cells, with their absent arms.
  ucpathDeptId: UcpathJobCellSchema,
  ucpathDepartment: UcpathJobCellSchema,
  /** Every option the document's `Department*` control carried when it was read (§3.2). */
  observedDepartmentOptions: z.array(z.string().min(1)).min(1),
  payrollTitleCode: KualiPayrollTitleCodeSchema,
  payrollTitle: KualiPayrollTitleSchema,
  timekeeperName: KualiTimekeeperNameSchema,
  // Stage reconciled dates unconditionally; conditional staging would require another live read.
  lastDayWorked: KualiFormDateSchema,
  separationDate: KualiFormDateSchema,
  terminationEffectiveDate: KualiFormDateSchema,
  /** §4c's receipt: the finalization is never entered without the filed transaction. */
  transactionNumber: KualiTransactionNumberSchema,
  /** The other half of the receipt pair; a number alone is not filing authority. */
  transactionApprovalStatus: UcpathApprovalStatusSchema,
  /** The COMPLETE final comments text, composed upstream from the read below. */
  timekeeperComments: KualiFinalizationCommentsSchema,
  // What the read saw in the comments control, verbatim.
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
  /** The subject established by machine verification or operator approval. */
  approved: ResolvedIdentitySubjectSchema,
  /** Which department option was staged, and the UCPath code it was keyed by. */
  department: z.strictObject({
    option: z.string().min(1),
    departmentCode: z.string().min(1),
  }),
  /** The finalization's landing proof — `proof` is always the reload read-back's; the commit's
   *  own output is a claim nothing promotes. */
  finalization: z.strictObject({
    disposition: z.enum(["committed", "already-present"]),
    proof: KualiSavedFinalizationProofSchema,
  }),
});

export const separationsKualiFinalizationWorkflow = defineWorkflow({
  id: "separations-kuali-finalization",
  version: 1,
  code: "sf",
  label: "Kuali Finalization",
  summary:
    "Chunk 5 of the separations migration: the Kuali finalization SAVE, provable alone. Reads the " +
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
      source: { nodeId: DEPARTMENT_NODE, fieldPath: "option" },
      display: "text",
    },
    {
      key: "transaction-number",
      label: "Transaction",
      // Field paths address commit output, not the transaction outcome envelope.
      source: {
        nodeId: FINALIZE_NODE,
        fieldPath: "savedState.fields.transactionNumber",
      },
      display: "text",
    },
  ],
  identity: {
    // Key by document and transaction; one person can have multiple employment separations.
    matchKey: (input) =>
      `separations-kuali-finalization:${input.documentNumber}:${input.transactionNumber}`,
  },
  presentation: {
    title: (input) => `Kuali ${input.documentNumber} finalization`,
    subtitle: (input) => `${input.employeeName} — ${input.transactionNumber}`,
  },
  /** The descriptor's own words about each node, projected by the explorer. */
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
  role: defineWorkflowRole({
    kind: "chunk-harness",
    of: "separations",
    step: KUALI_FINALIZATION_STEP.key,
  }),
  steps: ({ task, gate, transaction, result }) => {
    /** Identity check + Job summary nodes wired from the harness ingress; authored INLINE here
     *  (a group claims only its own step's identities) with the same id/contract/label/replay as the composition. */
    const jobSummary = task(
      {
        id: JOB_SUMMARY_NODE,
        contract: UcpathReadJobSummary,
        label: "Job Summary",
        replay: "checkpoint",
      },
      [],
      ({ input }) => ({ emplId: input.emplId }),
    );
    const nameSearch = task(
      {
        id: NAME_SEARCH_NODE,
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
    // The fold is downstream of this run's live job-summary read, so naming that dependency
    // gives its derived checkpoint a real observation clock instead of pretending an input-only fold is live.
    const departmentOption = task(
      {
        id: DEPARTMENT_NODE,
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
        id: COMPARISON_NODE,
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
        jobSummary: outputs[JOB_SUMMARY_NODE],
        nameSelection: outputs[NAME_SEARCH_NODE].selection,
        plan: noSeparationWritePlan(
          "this chunk finalizes the Kuali document alone; the composed `separations` graph is where the whole write plan — the UCPath termination included — exists to show",
        ),
      }),
    );
    // Referenced by the GATE, not the transaction, so its refusal precedes any fence.
    const identityGate = gate(
      {
        id: GATE_NODE,
        label: "Identity Approval",
        statusKey: "awaitingIdentityApproval",
        result: IdentityApprovalResultSchema,
        when: {
          kind: "is-true",
          of: {
            from: "node",
            nodeId: COMPARISON_NODE,
            path: "approvalRequired",
          },
        },
      },
      [comparison, departmentOption],
    );
    const approval = task(
      {
        id: APPROVAL_NODE,
        contract: SeparationsVerifyIdentityApproval,
        label: "Approval Check",
        replay: "always-rerun",
      },
      [comparison, identityGate],
      ({ outputs }) => ({
        packet: outputs[COMPARISON_NODE].packet,
        evidenceDigest: outputs[COMPARISON_NODE].evidenceDigest,
        approval: outputs[GATE_NODE],
      }),
    );
    // The composition's identities for this step (`../workflow.ts`), wired from the same
    // ingress where the composition binds the reconciled folds and the receipt.
    const filingPresence = task(
      filingPresenceNode,
      [approval],
      ({ input, outputs }) =>
        assertTerminationReceipt({
          transactionNumber: input.transactionNumber,
          approvalStatus: input.transactionApprovalStatus,
          approvedEmplId: outputs[APPROVAL_NODE].approved.emplId,
          approvedName: outputs[APPROVAL_NODE].approved.ucpathName,
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
          emplId: outputs[APPROVAL_NODE].approved.emplId,
          variables: {
            department: outputs[DEPARTMENT_NODE].option,
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
          emplId: outputs[APPROVAL_NODE].approved.emplId,
          variables: {
            department: outputs[DEPARTMENT_NODE].option,
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
      // The harness IS the step it proves: one timeline group, the step's own.
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
          documentNumber: outputs[APPROVAL_NODE].documentNumber,
          approved: outputs[APPROVAL_NODE].approved,
          department: {
            option: outputs[DEPARTMENT_NODE].option,
            departmentCode: outputs[DEPARTMENT_NODE].departmentCode,
          },
          finalization: {
            disposition: outputs[FINALIZE_NODE].disposition,
            proof: outputs[FINALIZE_NODE].output.savedState,
          },
        }),
      ),
    };
  },
});
