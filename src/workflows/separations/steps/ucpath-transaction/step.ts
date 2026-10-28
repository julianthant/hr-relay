/** `separations-ucpath-termination` — the UCPath termination WRITE, provable alone. Identity authority (§14) gates it; two transaction nodes — the pending sweep first (legacy's unfenced first mutation), then the filing — dryRun stop-after-prepare. */
import { z } from "zod";
import { defineWorkflow } from "../../../../workflow-kit/workflow-definition.js";
import { SeparationsMatchIdentity } from "../../../../models/workflows/separations/match-identity.js";
import { SeparationsMatchTerminationType } from "../../../../models/workflows/separations/match-termination-type.js";
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
import { KualiDocumentNumberSchema } from "../../../../models/ui/kuali-document-identity.js";
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
import { defineWorkflowRole } from "../../../../workflow-kit/validation/module-role.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../models/workflow/presentation.js";
import {
  APPROVAL_NODE,
  COMPARISON_NODE,
  GATE_NODE,
  NAME_SEARCH_NODE,
  JOB_SUMMARY_NODE,
  TERMINATION_TYPE_NODE,
  PENDING_SET_NODE,
  SWEEP_NODE,
  TERMINATION_NODE,
  clearPendingNode,
  fileTerminationNode,
  pendingSetNode,
  UCPATH_TRANSACTION_STEP,
} from "../../workflow.js";
/** The ingress: the identity-check ingress plus the termination facts no read here produces
 *  (empl record, two dates, comment text). `template`/`reasonCode` are DERIVED through §4a's exact-match map, never ingested. */
const TerminationInputShape = {
  documentNumber: KualiDocumentNumberSchema,
  employeeName: z.string().min(1),
  emplId: EidSchema,
  emplIdSource: IdentityEidSourceSchema,
  documentEid: KualiEidFieldSchema,
  /** The document's *Type of Termination*, verbatim, with its absent arm. */
  terminationType: KualiOptionFieldSchema,
  /** Every option that control carried when it was read (§3.2, §4a's drift check). */
  observedTerminationTypeOptions: z.array(z.string().min(1)).min(1),
  /** The UCPath employment record number the termination is filed against. */
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
  /** The subject established by machine verification or operator approval. */
  approved: ResolvedIdentitySubjectSchema,
  /** Whether the sweep had anything to do, and what the grid showed after it. */
  pendingSweep: z.strictObject({
    disposition: z.enum(["committed", "already-present"]),
    proof: UcpathPendingSweepSettlementProofSchema,
  }),
  /** The filed termination's receipt PAIR — a number alone is never a proof. */
  termination: z.strictObject({
    disposition: z.enum(["committed", "already-present"]),
    proof: UcpathTerminationProofSchema,
  }),
});


export const separationsUcpathTerminationWorkflow = defineWorkflow({
  id: "separations-ucpath-termination",
  version: 1,
  code: "st",
  label: "UCPath Termination",
  summary:
    "Chunk 4 of the separations migration: the UCPath termination FILING, provable alone. Reads the "
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
      // Field paths address commit output, not the transaction outcome envelope.
      source: { nodeId: TERMINATION_NODE, fieldPath: "receipt.transactionId" },
      display: "text",
    },
  ],
  identity: {
    // Key by person and effective date so duplicate documents cannot double-file.
    matchKey: (input) => `separations-ucpath-termination:${input.emplId}:${input.effectiveDate}`,
  },
  presentation: {
    title: (input) => `${input.employeeName} (${input.emplId})`,
    subtitle: (input) => `Termination effective ${input.effectiveDate}`,
  },
  /** The descriptor's own words about each node, projected by the explorer. */
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
  role: defineWorkflowRole({ kind: "chunk-harness", of: "separations", step: UCPATH_TRANSACTION_STEP.key }),
  steps: ({ task, gate, transaction, result }) => {
    /** Identity check, Job summary and Kuali extraction nodes wired from the harness ingress;
     *  AUTHORED INLINE (a group claims only its own step's identities) with the same id/contract/label/replay as the composition. */
    const jobSummary = task({
      id: JOB_SUMMARY_NODE,
      contract: UcpathReadJobSummary,
      label: "Job Summary",
      replay: "checkpoint",
    }, [], ({ input }) => ({ emplId: input.emplId }));
    const nameSearch = task({
      id: NAME_SEARCH_NODE,
      contract: SearchPersonOrg,
      label: "Name Search",
      replay: "checkpoint",
    }, [], ({ input }) => ({
      kind: "by-name" as const,
      name: input.employeeName,
      keepNonHdh: true,
    }));
    const terminationType = task({
      id: TERMINATION_TYPE_NODE,
      contract: SeparationsMatchTerminationType,
      label: "Termination Type",
      replay: "checkpoint",
    }, [], ({ input }) => ({
      terminationType: input.terminationType,
      observedOptions: input.observedTerminationTypeOptions,
      documentNumber: input.documentNumber,
    }));
    const comparison = task({
      id: COMPARISON_NODE,
      contract: SeparationsMatchIdentity,
      label: "Identity Comparison",
      replay: "checkpoint",
    }, [jobSummary, nameSearch], ({ input, outputs }) => ({
      documentNumber: input.documentNumber,
      documentName: input.employeeName,
      documentEid: input.documentEid,
      emplId: input.emplId,
      emplIdSource: input.emplIdSource,
      jobSummary: outputs[JOB_SUMMARY_NODE],
      nameSelection: outputs[NAME_SEARCH_NODE].selection,
      plan: noSeparationWritePlan(
        "this chunk files the UCPath termination alone; the composed `separations` graph is where the whole write plan — the Kuali finalization included — exists to show",
      ),
    }));
    // Resolve termination type before approval; commits must use the evidence shown.
    const identityGate = gate({
      id: GATE_NODE,
      label: "Identity Approval",
      statusKey: "awaitingIdentityApproval",
      result: IdentityApprovalResultSchema,
      when: {
        kind: "is-true",
        of: { from: "node", nodeId: COMPARISON_NODE, path: "approvalRequired" },
      },
    }, [comparison, terminationType]);
    const approval = task({
      id: APPROVAL_NODE,
      contract: SeparationsVerifyIdentityApproval,
      label: "Approval Check",
      replay: "always-rerun",
    }, [comparison, identityGate], ({ outputs }) => ({
      packet: outputs[COMPARISON_NODE].packet,
      evidenceDigest: outputs[COMPARISON_NODE].evidenceDigest,
      approval: outputs[GATE_NODE],
    }));
    // The composition's identities for this step (`../workflow.ts`), wired from the same
    // ingress where the composition binds the reconciled folds.
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
    const fileTermination = transaction(
      fileTerminationNode,
      [approval, terminationType, clearPending],
      {
        prepareBind: ({ input, outputs }) => ({
          emplId: outputs[APPROVAL_NODE].approved.emplId,
          expectedName: outputs[APPROVAL_NODE].approved.ucpathName,
          emplRecord: input.emplRecord,
          effectiveDate: input.effectiveDate,
          template: outputs[TERMINATION_TYPE_NODE].template,
          reasonCode: outputs[TERMINATION_TYPE_NODE].reasonCode,
          lastDateWorked: input.lastDateWorked,
          initiatorComments: input.initiatorComments,
        }),
        commitBind: ({ input, outputs }) => ({
          emplId: outputs[APPROVAL_NODE].approved.emplId,
          expectedName: outputs[APPROVAL_NODE].approved.ucpathName,
          emplRecord: input.emplRecord,
          effectiveDate: input.effectiveDate,
          template: outputs[TERMINATION_TYPE_NODE].template,
          reasonCode: outputs[TERMINATION_TYPE_NODE].reasonCode,
          lastDateWorked: input.lastDateWorked,
          initiatorComments: input.initiatorComments,
        }),
      },
    );
    return {
      // The harness IS the step it proves: one timeline group, the step's own.
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
          documentNumber: outputs[APPROVAL_NODE].documentNumber,
          approved: outputs[APPROVAL_NODE].approved,
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
});
