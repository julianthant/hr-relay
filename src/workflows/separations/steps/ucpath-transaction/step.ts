import type { WorkflowGroupOptions } from "../../../../workflow-kit/workflow-definition.js";
import { z } from "zod";
import { UcpathCreateTermination } from "../../../../models/systems/ucpath/create-termination.js";
import {
  UcpathDeletePendingTerminations,
} from "../../../../models/systems/ucpath/delete-pending-terminations.js";
import { UcpathReadJobSummary } from "../../../../models/systems/ucpath/read-job-summary.js";
import {
  UcpathReadPendingTerminationSet,
} from "../../../../models/systems/ucpath/read-pending-termination-set.js";
import { SearchPersonOrg } from "../../../../models/systems/ucpath/search-person-org.js";
import {
  UcpathStagePendingTerminationSweep,
} from "../../../../models/systems/ucpath/stage-pending-termination-sweep.js";
import { UcpathStageTermination } from "../../../../models/systems/ucpath/stage-termination.js";
import {
  KualiDocumentNumberSchema
} from "../../../../models/ui/kuali-document-identity.js";
import {
  KualiEidFieldSchema,
  KualiOptionFieldSchema,
} from "../../../../models/ui/kuali-separation-document.js";
import {
  UcpathPendingSweepSettlementProofSchema,
  UcpathTerminationProofSchema,
  UcpathUsDateSchema,
} from "../../../../models/ui/ucpath-smart-hr-termination.js";
import { defineCanonicalInput } from "../../../../models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../models/workflow/presentation.js";
import type { StepOmissionDeclaration } from "../../../../models/workflow/step-omission.js";
import { SeparationsMatchIdentity } from "../../../../models/workflows/separations/match-identity.js";
import {
  SeparationsMatchTerminationType,
} from "../../../../models/workflows/separations/match-termination-type.js";
import {
  ReadSeparationDatesOutputSchema
} from "../../../../models/workflows/separations/read-separation-dates.js";
import {
  SeparationsVerifyIdentityApproval,
  VerifyIdentityApprovalOutputSchema,
} from "../../../../models/workflows/separations/verify-identity-approval.js";
import {
  SeparationsVerifyTerminationReceipt,
} from "../../../../models/workflows/separations/verify-termination-receipt.js";
import { EidSchema } from "../../../../rules/identity/ids.js";
import {
  IdentityApprovalResultSchema,
  ResolvedIdentitySubjectSchema,
} from "../../../../rules/separations/identity-approval.js";
import { IdentityEidSourceSchema } from "../../../../rules/separations/identity-evidence.js";
import {
  TERMINATION_RECEIPT_ACCEPTED_STATUSES,
  assertTerminationReceipt,
} from "../../../../rules/separations/termination-receipt.js";
import { noSeparationWritePlan } from "../../../../rules/separations/write-plan.js";
import type { StepProofSpec, WorkflowAuthor, WorkflowEntryScope } from "../../../../workflow-kit/workflow-definition.js";
import { defineStep, defineStepEntries } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
import type { SeparationsCanonicalInput, SeparationsInput } from "../../workflow.js";
import type { buildIdentity, readJobs } from "../identity-check/step.js";
import type { buildTimecard } from "../kronos-timecard/step.js";
import type { buildExtraction } from "../kuali-extraction/step.js";
type Author = WorkflowAuthor<typeof SeparationsInput>;
type Extraction = ReturnType<typeof buildExtraction>;
type Jobs = ReturnType<typeof readJobs>;
type Timecard = ReturnType<typeof buildTimecard>;
type Identity = ReturnType<typeof buildIdentity>;

export const UCPATH_TRANSACTION_STEP = defineWorkflowStep({
  key: "ucpath-transaction",
  label: "UCPath transaction",
});

/** Operator text and fields for this group in Explorer and Logs. */
const UCPATH_TRANSACTION_DISPLAY = {
  description: "Clear pending terminations, file the termination in UCPath and verify its receipt.",
  system: "ucpath",
  operatorFields: [
    { label: "Transaction number", example: "T000000001", sources: [{ nodeId: "receipt", kind: "output", fieldPath: "transactionNumber" }] },
    { label: "Approval status", example: "Submitted", sources: [{ nodeId: "receipt", kind: "output", fieldPath: "approvalStatus" }] },
    { label: "Effective date", example: "4/26/2031", sources: [{ nodeId: "receipt", kind: "output", fieldPath: "effectiveDate" }] },
  ],
  review: {
    pages: [
      {
        id: "smart-hr-search",
        title: "SS Smart HR transaction search",
        mode: "Fill form",
        nodeIds: ["pending-set", "clear-pending"],
        lines: [
          { id: "read-pending", kind: "read", text: "Read the exact pending termination set.", nodeIds: ["pending-set"] },
          { id: "select-pending", kind: "check", text: "Select and verify the conflicting pending terminations.", nodeIds: ["clear-pending"] },
          { id: "clear-pending", kind: "action", text: "In a live run, clear the verified pending terminations.", nodeIds: ["clear-pending"] }
        ],
        fields: []
      },
      {
        id: "termination-setup",
        title: "Smart HR transaction setup",
        mode: "Fill form",
        nodeIds: ["file-termination"],
        lines: [{ id: "setup", kind: "action", text: "Enter the termination template and effective date.", nodeIds: ["file-termination"] }],
        fields: []
      },
      {
        id: "termination-details",
        title: "Smart HR transaction details",
        mode: "Fill form",
        nodeIds: ["file-termination"],
        lines: [
          { id: "details", kind: "action", text: "Fill the employee ID and termination reason.", nodeIds: ["file-termination"] },
          { id: "verify-details", kind: "check", text: "Check the displayed person and dates before continuing.", nodeIds: ["file-termination"] }
        ],
        fields: []
      },
      {
        id: "termination-information",
        title: "Smart HR transaction information",
        mode: "Fill form",
        nodeIds: ["file-termination"],
        lines: [
          { id: "comments", kind: "action", text: "Fill the reviewed comments and verify the prepared termination.", nodeIds: ["file-termination"] },
          { id: "save", kind: "action", text: "In a live run, submit the prepared termination.", nodeIds: ["file-termination"] }
        ],
        fields: []
      },
      {
        id: "transaction-detail",
        title: "SS Smart HR transaction detail",
        mode: "Read only",
        nodeIds: ["receipt"],
        lines: [{ id: "verify-receipt", kind: "check", text: "Read the exact transaction number, approval status and effective date.", nodeIds: ["receipt"] }],
        fields: [
          {
            id: "transaction-number",
            operatorField: "Transaction number",
            source: {
              origin: "UCPath",
              detail: "Number on the filed termination receipt.",
              chain: [],
              read: { stepKey: "ucpath-transaction", page: "SS Smart HR transaction detail", field: "Transaction number" }
            }
          },
          {
            id: "approval-status",
            operatorField: "Approval status",
            source: {
              origin: "UCPath",
              detail: "Current status on the transaction receipt.",
              chain: [],
              read: { stepKey: "ucpath-transaction", page: "SS Smart HR transaction detail", field: "Approval status" }
            }
          },
          {
            id: "effective-date",
            operatorField: "Effective date",
            source: {
              origin: "UCPath",
              detail: "Effective date verified against the filed termination.",
              chain: [],
              read: { stepKey: "ucpath-transaction", page: "SS Smart HR transaction detail", field: "Effective date" }
            }
          }
        ]
      }
    ],
    branchLabels: []
  } as const,
} satisfies WorkflowGroupOptions;

export const PENDING_SET_NODE = "pending-set";
export const SWEEP_NODE = "clear-pending";
export const TERMINATION_NODE = "file-termination";
export const RECEIPT_NODE = "receipt";

const ucpathTransactionEntries = defineStepEntries(UCPATH_TRANSACTION_STEP);

export const pendingSetNode = ucpathTransactionEntries.task(PENDING_SET_NODE, UcpathReadPendingTerminationSet, {
  label: "Read Exact Pending Set",
  replay: "checkpoint",
});

export const clearPendingNode = ucpathTransactionEntries.transaction(SWEEP_NODE, {
  label: "Clear Pending Terminations",
  prepare: UcpathStagePendingTerminationSweep,
  commit: UcpathDeletePendingTerminations,
  dryRun: "stop-after-prepare",
  probePolicy: "always",
  probeToFenceMaxMs: 90_000,
});

export const fileTerminationNode = ucpathTransactionEntries.transaction(TERMINATION_NODE, {
  label: "File Termination",
  prepare: UcpathStageTermination,
  commit: UcpathCreateTermination,
  dryRun: "stop-after-prepare",
  probePolicy: "always",
  probeToFenceMaxMs: 120_000,
});

const receiptNode = ucpathTransactionEntries.task(RECEIPT_NODE, SeparationsVerifyTerminationReceipt, {
  label: "Termination Receipt",
  replay: "always-rerun",
});

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
      const approval = VerifyIdentityApprovalOutputSchema.parse(scope.outputs["approval"]);
      const dates = ReadSeparationDatesOutputSchema.parse(scope.outputs["dates"]);
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



const TerminationInputShape = {
  documentNumber: KualiDocumentNumberSchema,
  employeeName: z.string().min(1),
  emplId: EidSchema,
  emplIdSource: IdentityEidSourceSchema,
  documentEid: KualiEidFieldSchema,
  terminationType: KualiOptionFieldSchema,
  observedTerminationTypeOptions: z.array(z.string().min(1)).min(1),
  emplRecord: z.string().min(1),
  effectiveDate: UcpathUsDateSchema,
  lastDateWorked: UcpathUsDateSchema,
  initiatorComments: z.string().min(1),
} as const;
export const SeparationsUcpathTerminationInput = z.strictObject(TerminationInputShape);
export const SeparationsUcpathTerminationCanonicalInput = defineCanonicalInput(
  SeparationsUcpathTerminationInput,
  z.strictObject(TerminationInputShape),
  [
    {
      documentNumber: "4510",
      employeeName: "Battistessa, Johnnie",
      emplId: "10873698",
      emplIdSource: "document-eid",
      documentEid: { state: "present", value: "10873698" },
      terminationType: { state: "present", value: "Graduated/No longer a Student" },
      observedTerminationTypeOptions: ["- - -", "Graduated/No longer a Student"],
      emplRecord: "0",
      effectiveDate: "06/11/2026",
      lastDateWorked: "06/10/2026",
      initiatorComments: "Separation filed from Kuali RRSS document 4510.",
    },
  ],
);
const SeparationsUcpathTerminationResultSchema = z.strictObject({
  documentNumber: z.string().min(1),
  approved: ResolvedIdentitySubjectSchema,
  pendingSweep: z.strictObject({
    disposition: z.enum(["committed", "already-present"]),
    proof: UcpathPendingSweepSettlementProofSchema,
  }),
  termination: z.strictObject({
    disposition: z.enum(["committed", "already-present"]),
    proof: UcpathTerminationProofSchema,
  }),
});

export function buildTermination({ task, transaction, group }: Author, extraction: Extraction, jobs: Jobs, timecard: Timecard, identity: Identity) {
  const { terminationType } = extraction, { employment } = jobs, { dates } = timecard, { approval } = identity;
  const pendingSet = task(pendingSetNode, [approval], ({ outputs }) => ({
    emplId: outputs["approval"].approved.emplId,
    expectedName: outputs["approval"].approved.ucpathName,
  }));
  const clearPending = transaction(clearPendingNode, [approval, pendingSet], {
    prepareBind: ({ outputs }) => ({
      emplId: outputs["approval"].approved.emplId,
      expectedName: outputs["approval"].approved.ucpathName,
      observedSet: outputs[PENDING_SET_NODE],
    }),
    commitBind: ({ outputs }) => ({
      emplId: outputs["approval"].approved.emplId,
      expectedName: outputs["approval"].approved.ucpathName,
      observedSet: outputs[PENDING_SET_NODE],
    }),
  });
  const terminationDependencies = [approval, terminationType, employment, dates, clearPending] as const;
  const terminationTarget = ({ outputs }: WorkflowEntryScope<typeof SeparationsCanonicalInput, typeof terminationDependencies>) => ({
    emplId: outputs["approval"].approved.emplId,
    expectedName: outputs["approval"].approved.ucpathName,
    emplRecord: outputs["employment"].emplRecord,
    effectiveDate: outputs["dates"].terminationEffectiveDate,
    template: outputs["termination-type"].template,
    reasonCode: outputs["termination-type"].reasonCode,
    lastDateWorked: outputs["dates"].lastDayWorked,
    initiatorComments: outputs["dates"].terminationComments,
  });
  const fileTermination = transaction(fileTerminationNode, terminationDependencies, {
    prepareBind: terminationTarget,
    commitBind: terminationTarget,
    previewBind: scope => ({ prepare: terminationTarget(scope), commit: terminationTarget(scope), samples: [] }),
  });
  const receipt = task(receiptNode, [approval, dates, fileTermination], ({ outputs }) => ({
    proof: outputs[TERMINATION_NODE].output.receipt,
    disposition: outputs[TERMINATION_NODE].disposition,
    approvedEmplId: outputs["approval"].approved.emplId,
    expectedEffectiveDate: outputs["dates"].terminationEffectiveDate,
  }));
  return {
    receipt, clearPending, fileTermination,
    steps: [[group(UCPATH_TRANSACTION_STEP, { ...UCPATH_TRANSACTION_DISPLAY, omission: UCPATH_TRANSACTION_OMISSION }), [pendingSet, clearPending, fileTermination, receipt]]] as const
  };
}

export const separationsUcpathTerminationDefinition = defineStep({
  group: UCPATH_TRANSACTION_STEP, build: buildTermination,
  proof: {
    id: "separations-ucpath-termination", order: 3, build: (): StepProofSpec<typeof SeparationsUcpathTerminationInput, typeof SeparationsUcpathTerminationResultSchema> => ({
      version: 1,
      code: "st",
      label: "UCPath Termination",
      summary: "Chunk 4 of the separations migration: the UCPath termination FILING, provable alone. Reads the "
        + "identity picture, parks for approval, clears any pending termination already on the record, then "
        + "files the termination through the Smart HR wizard.",
      icon: "ShieldCheck",
      category: "separation",
      canonicalInput: SeparationsUcpathTerminationCanonicalInput,
      inputSubject: "eid",
      surface: { shape: "single" },
      enqueue: "reject-active",
      actions: STANDARD_WORKFLOW_ACTIONS,
      surfaces: {},
      verdicts: [
        { key: "no-active-job", label: "No active job in UCPath", tone: "warning", tag: true },
        { key: "concurrent-jobs", label: "Concurrent active jobs", tone: "warning", tag: true },
        { key: "name-differs", label: "Name differs from UCPath", tone: "warning", tag: true },
      ],
      details: [
        {
          key: "ucpath-name",
          label: "UCPath shows",
          source: { nodeId: "job-summary", fieldPath: "displayedName" },
          display: "text",
        },
        {
          key: "template",
          label: "Template",
          source: { nodeId: "termination-type", fieldPath: "template" },
          display: "text",
        },
        {
          key: "reason-code",
          label: "Reason code",
          source: { nodeId: "termination-type", fieldPath: "reasonCode" },
          display: "text",
        },
        {
          key: "transaction-id",
          label: "Transaction",
          source: { nodeId: TERMINATION_NODE, fieldPath: "receipt.transactionId" },
          display: "text",
        },
      ],
      identity: {
        matchKey: (input) => `separations-ucpath-termination:${input.emplId}:${input.effectiveDate}`,
      },
      presentation: {
        title: (input) => `${input.employeeName} (${input.emplId})`,
        subtitle: (input) => `Termination effective ${input.effectiveDate}`,
      },
      nodePurposes: [
        {
          nodeId: "job-summary",
          purpose: "Reads the subject's whole UCPath job summary grid verbatim — every row, every status — and "
            + "classifies nothing; the disposition is a separate, pure fold.",
        },
        {
          nodeId: "name-search",
          purpose: "Searches UCPath Person Org by the document's employee name, unconditionally, so the operator "
            + "sees every person that name matches rather than only the ones a similarity threshold selected.",
        },
        {
          nodeId: "termination-type",
          purpose: "Resolves the document's termination type to the UCPath template and reason code it files under, "
            + "refusing a type nobody has mapped. Pure: it reaches no browser.",
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
            + "not the second one. It probes before it fences, and a dry run stops after staging.",
        },
        {
          nodeId: "file-termination",
          purpose: "Files the termination through the UCPath Smart HR wizard — the real write. It probes for a "
            + "filing that already exists, fences before the click, and a dry run stops after staging.",
        },
      ],
      scenarios: [
        "separations-ucpath-termination/dry-run-preview",
        "separations-ucpath-termination/already-present",
        "separations-ucpath-termination/subject-mismatch",
        "separations-ucpath-termination/committed",
        "separations-ucpath-termination/gate-approved",
        "separations-ucpath-termination/pending-sweep-committed",
        "separations-ucpath-termination/emplid-not-recognized",
        "separations-ucpath-termination/submit-refused",
        "separations-ucpath-termination/last-date-worked-not-verified",
        "separations-ucpath-termination/submit-outcome-unknown",
        "separations-ucpath-termination/unreadable-probe-is-not-absent",
        "separations-ucpath-termination/pending-sweep-nothing-to-do",
        "separations-ucpath-termination/pending-sweep-refuses-unreadable-scan",
      ],
      input: SeparationsUcpathTerminationInput,
      steps: (author: WorkflowAuthor<typeof SeparationsUcpathTerminationInput>) => {
        const { task, gate, transaction, result } = author;
        const jobSummary = task({
          id: "job-summary",
          contract: UcpathReadJobSummary,
          label: "Job Summary",
          replay: "checkpoint",
        }, [], ({ input }) => ({ emplId: input.emplId }));
        const nameSearch = task({
          id: "name-search",
          contract: SearchPersonOrg,
          label: "Name Search",
          replay: "checkpoint",
        }, [], ({ input }) => ({
          kind: "by-name" as const,
          name: input.employeeName,
          keepNonHdh: true,
        }));
        const terminationType = task({
          id: "termination-type",
          contract: SeparationsMatchTerminationType,
          label: "Termination Type",
          replay: "checkpoint",
        }, [], ({ input }) => ({
          terminationType: input.terminationType,
          observedOptions: input.observedTerminationTypeOptions,
          documentNumber: input.documentNumber,
        }));
        const comparison = task({
          id: "comparison",
          contract: SeparationsMatchIdentity,
          label: "Identity Comparison",
          replay: "checkpoint",
        }, [jobSummary, nameSearch], ({ input, outputs }) => ({
          documentNumber: input.documentNumber,
          documentName: input.employeeName,
          documentEid: input.documentEid,
          emplId: input.emplId,
          emplIdSource: input.emplIdSource,
          jobSummary: outputs["job-summary"],
          nameSelection: outputs["name-search"].selection,
          plan: noSeparationWritePlan(
            "this chunk files the UCPath termination alone; the composed `separations` graph is where the whole write plan — the Kuali finalization included — exists to show",
          ),
        }));
        const identityGate = gate({
          id: "identity-approval",
          label: "Identity Approval",
          statusKey: "awaitingIdentityApproval",
          result: IdentityApprovalResultSchema,
          when: {
            kind: "is-true",
            of: { from: "node", nodeId: "comparison", path: "approvalRequired" },
          },
        }, [comparison, terminationType]);
        const approval = task({
          id: "approval",
          contract: SeparationsVerifyIdentityApproval,
          label: "Approval Check",
          replay: "always-rerun",
        }, [comparison, identityGate], ({ outputs }) => ({
          packet: outputs["comparison"].packet,
          evidenceDigest: outputs["comparison"].evidenceDigest,
          approval: outputs["identity-approval"],
        }));
        const pendingSet = task(pendingSetNode, [approval], ({ outputs }) => ({
          emplId: outputs["approval"].approved.emplId,
          expectedName: outputs["approval"].approved.ucpathName,
        }));
        const clearPending = transaction(clearPendingNode, [approval, pendingSet], {
          prepareBind: ({ outputs }) => ({
            emplId: outputs["approval"].approved.emplId,
            expectedName: outputs["approval"].approved.ucpathName,
            observedSet: outputs[PENDING_SET_NODE],
          }),
          commitBind: ({ outputs }) => ({
            emplId: outputs["approval"].approved.emplId,
            expectedName: outputs["approval"].approved.ucpathName,
            observedSet: outputs[PENDING_SET_NODE],
          }),
        });
        const fileTermination = transaction(
          fileTerminationNode,
          [approval, terminationType, clearPending],
          {
            prepareBind: ({ input, outputs }) => ({
              emplId: outputs["approval"].approved.emplId,
              expectedName: outputs["approval"].approved.ucpathName,
              emplRecord: input.emplRecord,
              effectiveDate: input.effectiveDate,
              template: outputs["termination-type"].template,
              reasonCode: outputs["termination-type"].reasonCode,
              lastDateWorked: input.lastDateWorked,
              initiatorComments: input.initiatorComments,
            }),
            commitBind: ({ input, outputs }) => ({
              emplId: outputs["approval"].approved.emplId,
              expectedName: outputs["approval"].approved.ucpathName,
              emplRecord: input.emplRecord,
              effectiveDate: input.effectiveDate,
              template: outputs["termination-type"].template,
              reasonCode: outputs["termination-type"].reasonCode,
              lastDateWorked: input.lastDateWorked,
              initiatorComments: input.initiatorComments,
            }),
          },
        );
        return {
          steps: [[UCPATH_TRANSACTION_STEP, [
            jobSummary,
            nameSearch,
            terminationType,
            comparison,
            identityGate,
            approval,
            pendingSet,
            clearPending,
            fileTermination,
          ]]],
          result: result(
            SeparationsUcpathTerminationResultSchema,
            [approval, clearPending, fileTermination],
            ({ outputs }) => ({
              documentNumber: outputs["approval"].documentNumber,
              approved: outputs["approval"].approved,
              pendingSweep: {
                disposition: outputs[SWEEP_NODE].disposition,
                proof: outputs[SWEEP_NODE].output.cleared,
              },
              termination: {
                disposition: outputs[TERMINATION_NODE].disposition,
                proof: outputs[TERMINATION_NODE].output.receipt,
              },
            }),
          ),
        };
      },
    }),
  },
});
