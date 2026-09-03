/**
 * `separations-ucpath-termination` — chunk 4 of the separations migration: the
 * UCPath termination WRITE, provable alone.
 *
 * ## The graph
 *
 * ```
 *   job-summary ───┐
 *   name-search ───┼─► comparison ──┐
 *   termination-type ───────────────┴─► GATE identity-approval ─► approval
 *                                                                    │
 *                            ┌───────────────────────────────────────┘
 *                            ▼
 *        clear-pending (TXN) ─► file-termination (TXN) ─► result
 * ```
 *
 * ## Why the identity gate is in a "write chunk"
 *
 * Ref write-safety §14 requires typed identity authority before a filing. The
 * supplied-EID arm uses exact UCPath read-back; the name-resolved arm uses the
 * real operator gate. `identity-gate-before-commit` enforces that every
 * transaction and identity-bearing result is dominated by the shared authority
 * task, and pins the gate's exact name-only condition.
 *
 * ## Why `termination-type` hangs off the GATE and not off the transaction
 *
 * A §4a map refusal must land BEFORE any fence, and the strongest place to put
 * it is before the human is asked at all: an unmapped or republished
 * *Type of Termination* should not cost an operator a decision it will not be
 * able to act on. Declaring it in the gate's `dependsOn` does that AND satisfies
 * the guard's real property — data must not reach a commit that the operator
 * never saw. _(CLOSED 2026-08-14 by chunk 6a: the composed `separations` graph
 * renders the resolved `{template, reasonCode}` INTO ref write-safety §14.2's packet
 * through `SeparationWritePlanSchema`, so "you are approving a `UC_INVOL_TERM`
 * effective 06/11/2026" is on the screen and inside the digest the approval
 * binds to — D211, ref write-safety §14.10. This descriptor stays the proving harness and
 * declares `plan: not-composed` with its reason.)_
 *
 * ## Two transaction nodes, in this order, and the sweep is genuinely first
 *
 * Ref write-safety §5 wants BOTH probe kinds ported. The date-agnostic one is the pending
 * sweep — legacy's `deletePendingTransaction`, which deletes every in-progress
 * `Terminat*` row for the EID and is, in legacy, *the first mutation the run
 * performs* with no fence and no read-back (**S30/S31**). A delete is an
 * external write, so it is its own transaction with its own key and its own
 * verifier, composed BEFORE the filing rather than hidden inside its prepare.
 *
 * ## dryRun
 *
 * `stop-after-prepare` on both. A dry run reads UCPath, parks at the gate only
 * for name-resolved identity, then walks the whole three-page wizard and the sweep selection — then
 * stops with no intent, no fence, no click and nothing durable, because the
 * 2026-08-13 live check proved the wizard persists nothing before an explicit
 * Save. That makes this the first workflow in the tree whose dry run exercises
 * a real, complete preparation of a real HR transaction.
 */
import { z } from "zod";
import { defineWorkflow } from "../../../base/workflow-definition.js";
import { SeparationsMatchIdentity } from "../../../domain/contracts/separations/match-identity.js";
import { SeparationsMatchTerminationType } from "../../../domain/contracts/separations/match-termination-type.js";
import { SeparationsVerifyIdentityApproval } from "../../../domain/contracts/separations/verify-identity-approval.js";
import { UcpathReadJobSummary } from "../../../domain/contracts/ucpath/read-job-summary.js";
import { SearchPersonOrg } from "../../../domain/contracts/ucpath/search-person-org.js";
import { EidSchema } from "../../../domain/ids.js";
import {
  IdentityApprovalResultSchema,
  ResolvedIdentitySubjectSchema,
} from "../../../domain/separations/identity-approval.js";
import { IdentityEidSourceSchema } from "../../../domain/separations/identity-evidence.js";
import { noSeparationWritePlan } from "../../../domain/separations/write-plan.js";
import { KualiDocumentNumberSchema } from "../../../domain/ui/kuali-document-identity.js";
import {
  KualiEidFieldSchema,
  KualiOptionFieldSchema,
} from "../../../domain/ui/kuali-separation-document.js";
import {
  UcpathPendingSweepHistoricalOrCurrentProofSchema,
  UcpathTerminationProofSchema,
  UcpathUsDateSchema,
} from "../../../domain/ui/ucpath-smart-hr-termination.js";
import { defineCanonicalInput } from "../../../domain/workflow/canonical-input.js";
import { defineWorkflowRole } from "../../../domain/workflow/module-role.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../domain/workflow/presentation.js";
import {
  APPROVAL_NODE,
  COMPARISON_NODE,
  GATE_NODE,
  NAME_SEARCH_NODE,
} from "../identity-check/node-ids.js";
import { JOB_SUMMARY_NODE } from "../job-summary/node-ids.js";
import { TERMINATION_TYPE_NODE } from "../kuali-extraction/node-ids.js";
import { PENDING_SET_NODE, SWEEP_NODE, TERMINATION_NODE } from "./node-ids.js";
import { clearPendingNode, fileTerminationNode, pendingSetNode } from "./nodes.js";
import { UCPATH_TRANSACTION_STEP } from "./step.js";

/**
 * The ingress. It is the identity-check ingress plus exactly the facts a
 * termination needs that no read on this graph produces: the empl record, the
 * two dates, and the comment text.
 *
 * `template` and `reasonCode` are deliberately NOT here. They are DERIVED from
 * the document's verbatim *Type of Termination* through §4a's exact-match map,
 * because an ingress that accepted them directly would let a caller file a
 * reason code the map never sanctioned — which is dangerous pattern D1 wearing
 * a different hat.
 */
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

export const SeparationsUcpathTerminationResultSchema = z.strictObject({
  documentNumber: z.string().min(1),
  /** The subject established by machine verification or operator approval. */
  approved: ResolvedIdentitySubjectSchema,
  /** Whether the sweep had anything to do, and what the grid showed after it. */
  pendingSweep: z.strictObject({
    disposition: z.enum(["committed", "already-present"]),
    proof: UcpathPendingSweepHistoricalOrCurrentProofSchema,
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
      // A transaction node's field paths are the COMMIT contract's bare output
      // (D144), which is `{ receipt }` — not the `TypedTransactionOutcome`
      // envelope the graph scope carries.
      source: { nodeId: TERMINATION_NODE, fieldPath: "receipt.transactionId" },
      display: "text",
    },
  ],
  identity: {
    /**
     * The ITEM is the person and the effective date — the same natural key the
     * commit's permanent key uses, one layer up. Keying it by the document
     * instead would let two documents file two terminations for one person on
     * one date and call them different items.
     */
    matchKey: (input) => `separations-ucpath-termination:${input.emplId}:${input.effectiveDate}`,
  },
  presentation: {
    title: (input) => `${input.employeeName} (${input.emplId})`,
    subtitle: (input) => `Termination effective ${input.effectiveDate}`,
  },
  /** D229 — the descriptor's own words about each node, projected by the explorer. */
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
  // A proving harness for one step of `separations`, never a peer workflow (D219) —
  // the step it proves is the folder it lives in, read from that folder's own
  // declaration rather than re-typed here (D265 §1.2.2 rule 3).
  role: defineWorkflowRole({ kind: "chunk-harness", of: "separations", step: UCPATH_TRANSACTION_STEP.key }),
  steps: ({ task, gate, transaction, result }) => {
    /**
     * The Identity check, Job summary and Kuali extraction nodes, wired straight
     * from the harness ingress where the composition resolves them from the
     * Kuali reads. They are AUTHORED INLINE here rather than passed as those
     * steps' shared identities: this harness declares one timeline group — its
     * own step — and a group may claim only its own step's identities. Same id,
     * same contract, same label, same replay policy, so the graph the harness
     * proves is the graph the composition runs (D265 §1.2.2 rule 3).
     */
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
    /**
     * `termination-type` is referenced by the GATE and not by the transaction:
     * a §4a map refusal must land before the human is asked at all, and the
     * gate's references are what put it there while still satisfying the
     * guard's real property — data must not reach a commit the operator never
     * saw.
     */
    const identityGate = gate({
      id: GATE_NODE,
      label: "Identity Approval",
      statusKey: "awaitingIdentityApproval",
      result: IdentityApprovalResultSchema,
      when: {
        kind: "equals",
        of: { from: "node", nodeId: COMPARISON_NODE, path: "packet.emplIdSource" },
        value: "name-resolved",
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
    // This folder's own step identities (`./nodes.ts`), wired from the same
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
