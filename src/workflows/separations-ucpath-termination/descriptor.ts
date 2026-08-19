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
 * Because doc 09 §14's ALWAYS-GATE binds separation FILINGS, and this chunk is
 * the filing. `identity-gate-before-commit` enforces it structurally on any
 * descriptor whose id names the separation class: every ancestry path from a
 * transaction node — and from the terminal result — must reach the gate's own
 * ancestry before a graph root. The read half is chunk 3's tasks, reused rather
 * than reimplemented, which is exactly what §3's lego rule is for.
 *
 * ## Why `termination-type` hangs off the GATE and not off the transaction
 *
 * A §4a map refusal must land BEFORE any fence, and the strongest place to put
 * it is before the human is asked at all: an unmapped or republished
 * *Type of Termination* should not cost an operator a decision it will not be
 * able to act on. Declaring it in the gate's `dependsOn` does that AND satisfies
 * the guard's real property — data must not reach a commit that the operator
 * never saw. _(CLOSED 2026-08-14 by chunk 6a: the composed `separations` graph
 * renders the resolved `{template, reasonCode}` INTO doc 09 §14.2's packet
 * through `SeparationWritePlanSchema`, so "you are approving a `UC_INVOL_TERM`
 * effective 06/11/2026" is on the screen and inside the digest the approval
 * binds to — D211, doc 09 §14.10. This descriptor stays the proving harness and
 * declares `plan: not-composed` with its reason.)_
 *
 * ## Two transaction nodes, in this order, and the sweep is genuinely first
 *
 * Doc 09 §5 wants BOTH probe kinds ported. The date-agnostic one is the pending
 * sweep — legacy's `deletePendingTransaction`, which deletes every in-progress
 * `Terminat*` row for the EID and is, in legacy, *the first mutation the run
 * performs* with no fence and no read-back (**S30/S31**). A delete is an
 * external write, so it is its own transaction with its own key and its own
 * verifier, composed BEFORE the filing rather than hidden inside its prepare.
 *
 * ## dryRun
 *
 * `stop-after-prepare` on both. A dry run reads UCPath, parks at the gate, and
 * on approval walks the whole three-page wizard and the sweep selection — then
 * stops with no intent, no fence, no click and nothing durable, because the
 * 2026-08-13 live check proved the wizard persists nothing before an explicit
 * Save. That makes this the first workflow in the tree whose dry run exercises
 * a real, complete preparation of a real HR transaction.
 */
import { z } from "zod";
import { flow } from "../../base/flow.js";
import { defineWorkflowDescriptor } from "../../base/workflow.js";
import { SeparationsMatchIdentity } from "../../domain/contracts/separations/match-identity.js";
import { SeparationsMatchTerminationType } from "../../domain/contracts/separations/match-termination-type.js";
import { SeparationsVerifyIdentityApproval } from "../../domain/contracts/separations/verify-identity-approval.js";
import { UcpathDeletePendingTerminations } from "../../domain/contracts/ucpath/delete-pending-terminations.js";
import { UcpathCreateTermination } from "../../domain/contracts/ucpath/create-termination.js";
import { UcpathStagePendingTerminationSweep } from "../../domain/contracts/ucpath/stage-pending-termination-sweep.js";
import { UcpathStageTermination } from "../../domain/contracts/ucpath/stage-termination.js";
import { UcpathReadJobSummary } from "../../domain/contracts/ucpath/read-job-summary.js";
import { SearchPersonOrg } from "../../domain/contracts/ucpath/search-person-org.js";
import { EidSchema, WorkflowIdSchema } from "../../domain/ids.js";
import {
  ApprovedIdentitySubjectSchema,
  IdentityApprovalResultSchema,
} from "../../domain/separations/identity-approval.js";
import { IdentityEidSourceSchema } from "../../domain/separations/identity-evidence.js";
import { noSeparationWritePlan } from "../../domain/separations/write-plan.js";
import { KualiDocumentNumberSchema } from "../../domain/ui/kuali-document-identity.js";
import {
  KualiEidFieldSchema,
  KualiOptionFieldSchema,
} from "../../domain/ui/kuali-separation-document.js";
import {
  UcpathPendingSweepProofSchema,
  UcpathTerminationProofSchema,
  UcpathUsDateSchema,
} from "../../domain/ui/ucpath-smart-hr-termination.js";
import {
  BUILD_MANIFEST,
  resolveWorkflowFingerprint,
} from "../../domain/workflow/build-manifest.js";
import { defineCanonicalInput } from "../../domain/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../domain/workflow/presentation.js";

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
  /** The subject a human approved, and the evidence they approved it on. */
  approved: ApprovedIdentitySubjectSchema,
  /** Whether the sweep had anything to do, and what the grid showed after it. */
  pendingSweep: z.strictObject({
    disposition: z.enum(["committed", "already-present"]),
    proof: UcpathPendingSweepProofSchema,
  }),
  /** The filed termination's receipt PAIR — a number alone is never a proof. */
  termination: z.strictObject({
    disposition: z.enum(["committed", "already-present"]),
    proof: UcpathTerminationProofSchema,
  }),
});

const SWEEP_NODE = "clear-pending";
const TERMINATION_NODE = "file-termination";

const separationsUcpathTerminationFlow = flow(SeparationsUcpathTerminationInput)
  .step("job-summary", UcpathReadJobSummary, {
    label: "Job Summary",
    dependsOn: [],
    replay: "checkpoint",
    bind: ({ input }) => ({ emplId: input.emplId }),
  })
  .step("name-search", SearchPersonOrg, {
    label: "Name Search",
    dependsOn: [],
    replay: "checkpoint",
    bind: ({ input }) => ({
      kind: "by-name" as const,
      name: input.employeeName,
      keepNonHdh: true,
    }),
  })
  .step("termination-type", SeparationsMatchTerminationType, {
    label: "Termination Type",
    dependsOn: [],
    replay: "checkpoint",
    bind: ({ input }) => ({
      terminationType: input.terminationType,
      observedOptions: input.observedTerminationTypeOptions,
      documentNumber: input.documentNumber,
    }),
  })
  .step("comparison", SeparationsMatchIdentity, {
    label: "Identity Comparison",
    dependsOn: ["job-summary", "name-search"],
    replay: "checkpoint",
    bind: ({ input, outputs }) => ({
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
    }),
  })
  .gate("identity-approval", {
    label: "Identity Approval",
    statusKey: "awaitingIdentityApproval",
    /**
     * `termination-type` is a declared dependency so §4a's refusal lands before
     * a human is asked, and so the mapping is inside the gate's own ancestry —
     * which is what lets the resolved template and reason code reach the commit
     * at all (`identity-gate-before-commit`).
     */
    dependsOn: ["comparison", "termination-type"],
    resolvedBy: "operator",
    result: IdentityApprovalResultSchema,
  })
  .step("approval", SeparationsVerifyIdentityApproval, {
    label: "Approval Check",
    dependsOn: ["comparison", "identity-approval"],
    replay: "always-rerun",
    bind: ({ outputs }) => ({
      packet: outputs.comparison.packet,
      evidenceDigest: outputs.comparison.evidenceDigest,
      approval: outputs["identity-approval"],
    }),
  })
  .transaction(SWEEP_NODE, {
    label: "Clear Pending Terminations",
    dependsOn: ["approval"],
    prepare: {
      uses: UcpathStagePendingTerminationSweep,
      bind: ({ outputs }) => ({
        emplId: outputs.approval.approved.emplId,
        expectedName: outputs.approval.approved.ucpathName,
      }),
    },
    commit: {
      uses: UcpathDeletePendingTerminations,
      bind: ({ outputs }) => ({
        emplId: outputs.approval.approved.emplId,
        expectedName: outputs.approval.approved.ucpathName,
      }),
    },
    dryRun: "stop-after-prepare",
    // "always": the sweep's probe is one page read that the termination's probe
    // needs anyway, and paying it on the first attempt too is what closes the
    // crash window before the first fence.
    probePolicy: "always",
    // Measured live 2026-08-13 (§9.7): probe search open 4.6 s + search run
    // 7.4 s + detail 4.9 s ≈ 17 s to read the grid, then the selection itself is
    // checkbox clicks. 90 s is ~5x that, and short enough that a stalled page
    // loses its selection rather than deleting on a stale probe.
    probeToFenceMaxMs: 90_000,
  })
  .transaction(TERMINATION_NODE, {
    label: "File Termination",
    dependsOn: ["approval", "termination-type", SWEEP_NODE],
    prepare: {
      uses: UcpathStageTermination,
      bind: ({ input, outputs }) => ({
        emplId: outputs.approval.approved.emplId,
        expectedName: outputs.approval.approved.ucpathName,
        emplRecord: input.emplRecord,
        effectiveDate: input.effectiveDate,
        template: outputs["termination-type"].template,
        reasonCode: outputs["termination-type"].reasonCode,
        lastDateWorked: input.lastDateWorked,
        initiatorComments: input.initiatorComments,
      }),
    },
    commit: {
      uses: UcpathCreateTermination,
      bind: ({ input, outputs }) => ({
        emplId: outputs.approval.approved.emplId,
        expectedName: outputs.approval.approved.ucpathName,
        emplRecord: input.emplRecord,
        effectiveDate: input.effectiveDate,
        template: outputs["termination-type"].template,
        reasonCode: outputs["termination-type"].reasonCode,
        lastDateWorked: input.lastDateWorked,
        initiatorComments: input.initiatorComments,
      }),
    },
    dryRun: "stop-after-prepare",
    probePolicy: "always",
    /**
     * §4f3's answer is "measure it, no guessed constant", and this is that
     * measurement rather than a placeholder. The 2026-08-13 live wizard walk
     * timed every step on production: template + date **172 ms**, Create
     * Transaction **7.3 s**, Empl ID (including the blur lookup) **4.2 s**,
     * reason **3.1 s**, Continue **9.2 s**, LDW override **6.2 s**, comments
     * **2.2 s** — **≈ 32.4 s** of staging end to end, on top of ≈ 17 s of probe.
     * 120 s is ~3.7x the measured staging worst case.
     *
     * **The follow-up is still open and is named:** the first live dry-run
     * through the real start-plan → command → worker path records
     * probe-complete → prepare-complete off the run's own per-beat spans, and
     * that number tightens or confirms this one (§9.7).
     */
    probeToFenceMaxMs: 120_000,
  })
  .build({
    schema: SeparationsUcpathTerminationResultSchema,
    dependsOn: ["approval", SWEEP_NODE, TERMINATION_NODE],
    derive: ({ outputs }) => ({
      documentNumber: outputs.approval.documentNumber,
      approved: outputs.approval.approved,
      pendingSweep: {
        disposition: outputs[SWEEP_NODE].disposition,
        proof: outputs[SWEEP_NODE].output.cleared,
      },
      termination: {
        disposition: outputs[TERMINATION_NODE].disposition,
        proof: outputs[TERMINATION_NODE].output.receipt,
      },
    }),
  });

export const separationsUcpathTerminationDescriptor = defineWorkflowDescriptor({
  id: "separations-ucpath-termination",
  version: 1,
  contractFingerprint: resolveWorkflowFingerprint(
    BUILD_MANIFEST,
    WorkflowIdSchema.parse("separations-ucpath-termination"),
  ),
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
      purpose: "Builds the identity evidence packet the gate shows — DISCONFIRMING evidence first — and the "
        + "digest an approval binds to. Pure: it reaches no browser.",
    },
    {
      nodeId: "identity-approval",
      purpose: "The ALWAYS-GATE. A human confirms this is the right person before anything downstream may "
        + "consume the identity, and only the typed resolve-gate command can settle it.",
    },
    {
      nodeId: "approval",
      purpose: "Re-derives the evidence and checks the stored approval against it, so an approval of a packet "
        + "that has since moved cannot stand. It re-runs on every attempt rather than replaying its own "
        + "previous answer.",
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
  flow: separationsUcpathTerminationFlow,
});
