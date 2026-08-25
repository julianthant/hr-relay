/**
 * `separations-kuali-finalization` — chunk 5 of the separations migration: the
 * Kuali finalization WRITE, provable alone.
 *
 * ## The graph
 *
 * ```
 *   job-summary ───┐
 *   name-search ───┼─► comparison ──┐
 *   department-option ──────────────┴─► GATE identity-approval ─► approval
 *                                                                    │
 *                                  ┌─────────────────────────────────┘
 *                                  ▼
 *                    finalize-kuali (TXN) ─► result
 * ```
 *
 * ## ONE transaction node, and that is §4e's answer
 *
 * The staged-variables model is normative: every read lands first as a typed
 * variable, ONE prepare stages all twelve Kuali fields in one pass from those
 * variables, ONE save, ONE reload read-back comparing every written field
 * against the exact staged variables. That answers §5 item 1D as well —
 * mutations C and D collapse into ONE Kuali transaction node, and legacy's early
 * org-data write (its step 4, before Kronos and UCPath) does not port as a
 * separate save.
 *
 * It is Option A's rule ("one reload read-back per commit node") applied to a
 * graph with exactly one commit node — **not** Option B, whose trailing verify
 * over several fences could not say which fence landed. §4e's caveat is carried
 * as-is and is a first-live-dry-run finding, not a design assumption: if the
 * fields turn out to span sections owned by DIFFERENT Kuali workflow steps, one
 * save cannot carry them and this node splits into one (save, read-back) pair
 * per step, each with its own fence and its own permanent key. 5c DISCHARGED it
 * for the ten fields staged then (three sections, all `edit` at both live steps,
 * §9.12 item 1); §4e's 2026-08-14 amendment RE-OPENS it for exactly two, because
 * `Last Day Worked` and `Separation Date` sit in the *Employee Information*
 * block whose section id nothing has read.
 *
 * ## Why a "Kuali write chunk" carries the identity gate
 *
 * Because ref write-safety §14's ALWAYS-GATE binds separation FILINGS, and finalizing the
 * RRSS document is what records a real termination against a real person on the
 * source record. `identity-gate-before-commit` enforces it structurally on any
 * descriptor whose id names the separation class: every ancestry path from the
 * transaction node — and from the terminal result — must reach the gate's own
 * ancestry before a graph root. The read half is chunk 3's tasks, reused rather
 * than reimplemented (§3's lego rule).
 *
 * §4d is absolute here: no preset, no prefill, no resume path and no run mode
 * disables the gate, and there is no branch and no `when` anywhere in this
 * graph for one to hide in. §4c's resume — UCPath filed, Kuali finalization
 * parked — re-enters this node under its own permanent key and still crosses
 * this gate; legacy's `txnNumberPrefilled ⇒ skip identity` derivation (pattern
 * D7) does not port in any form.
 *
 * ## Why `department-option` hangs off the GATE
 *
 * Same argument chunk 4 makes for `termination-type`: an S55 refusal must land
 * BEFORE any fence, and the strongest place to put it is before a human is asked
 * at all. Declaring it in the gate's `dependsOn` does that AND satisfies the
 * guard's real property — the department the write stages is data the operator
 * saw, not a side read hanging off the graph root.
 *
 * _(CLOSED 2026-08-14 by chunk 6a: the composed `separations` graph renders the
 * resolved option INTO ref write-safety §14.2's packet, so "you are finalizing document
 * 4510 against `000412 - Housing/Dining/Hospitality`" is on the screen and
 * inside the digest the approval binds to — D211, ref write-safety §14.10. This descriptor
 * stays the proving harness and declares `plan: not-composed` with its
 * reason.)_
 *
 * ## dryRun
 *
 * `stop-after-prepare`. A dry run reads UCPath, parks at the gate, and on
 * approval stages all twelve Kuali controls and reads every one of them back —
 * then stops with no intent, no fence, no click and nothing durable. A Kuali
 * Build document holds staged edits in its own in-page form model until an
 * explicit `Save`, so the document is unchanged afterwards. Legacy makes the
 * same claim about its drafts and **S61** records that the claim is *stated,
 * never verified*; chunk 5c's dry run re-opens the document and checks, which is
 * the verification legacy never did.
 */
import { z } from "zod";
import { flow } from "../../../base/flow.js";
import { defineWorkflowDescriptor } from "../../../base/workflow.js";
import { EidSchema, WorkflowIdSchema } from "../../../domain/ids.js";
import { ApprovedIdentitySubjectSchema } from "../../../domain/separations/identity-approval.js";
import { IdentityEidSourceSchema } from "../../../domain/separations/identity-evidence.js";
import { noSeparationWritePlan } from "../../../domain/separations/write-plan.js";
import {
  KualiActionIdSchema,
  KualiDocumentNumberSchema,
  KualiTimekeeperNameSchema,
} from "../../../domain/ui/kuali-document-identity.js";
import {
  KualiEidFieldSchema,
  KualiFormDateSchema,
  KualiTransactionNumberSchema,
} from "../../../domain/ui/kuali-separation-document.js";
import {
  KualiFinalizationCommentsSchema,
  KualiPayrollTitleCodeSchema,
  KualiPayrollTitleSchema,
  KualiSavedFinalizationProofSchema,
} from "../../../domain/ui/kuali-separation-finalization.js";
import { UcpathJobCellSchema } from "../../../domain/ui/ucpath-job-summary.js";
import {
  BUILD_MANIFEST,
  resolveWorkflowFingerprint,
} from "../../../domain/workflow/build-manifest.js";
import { defineCanonicalInput } from "../../../domain/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../domain/workflow/presentation.js";
import {
  APPROVAL_NODE,
  COMPARISON_NODE,
  GATE_NODE,
  NAME_SEARCH_NODE,
  approvalNode,
  comparisonNode,
  identityApprovalGate,
  nameSearchNode,
} from "../identity-check/nodes.js";
import { DEPARTMENT_NODE, JOB_SUMMARY_NODE, departmentOptionNode, jobSummaryNode } from "../job-summary/nodes.js";
import { FINALIZE_NODE, finalizeKualiNode } from "./nodes.js";

/**
 * The ingress: the identity-check ingress, plus exactly the staged variables no
 * read on THIS graph produces.
 *
 * Every one of them is a value some earlier chunk read — chunk 2's document read
 * supplies the department option list and the existing comments, chunk 4's
 * termination supplies the transaction number, chunk 1 and the date
 * reconciliation supply the effective date. §3's lego rule is what makes that an
 * ingress rather than a graph: chunk 6 composes those outputs into this input,
 * and this descriptor stays provable alone.
 *
 * `department` is deliberately NOT here as an option text. It is DERIVED from the
 * UCPath dept id through the exact-code fold, because an ingress that accepted
 * the option directly would let a caller file a separation against a department
 * nothing matched — S55 wearing a different hat.
 */
const FinalizationInputShape = {
  actionId: KualiActionIdSchema,
  documentNumber: KualiDocumentNumberSchema,
  employeeName: z.string().min(1),
  emplId: EidSchema,
  emplIdSource: IdentityEidSourceSchema,
  documentEid: KualiEidFieldSchema,
  /** The UCPath *Dept ID* and *Department* cells, with their absent arms (S24). */
  ucpathDeptId: UcpathJobCellSchema,
  ucpathDepartment: UcpathJobCellSchema,
  /** Every option the document's `Department*` control carried when it was read (§3.2). */
  observedDepartmentOptions: z.array(z.string().min(1)).min(1),
  payrollTitleCode: KualiPayrollTitleCodeSchema,
  payrollTitle: KualiPayrollTitleSchema,
  timekeeperName: KualiTimekeeperNameSchema,
  /**
   * §4e's 2026-08-14 amendment: legacy's step-13 date write-backs, as staged
   * variables. Both are the RECONCILED values — chunk 6's `dates` node output —
   * and are staged unconditionally, so this ingress carries them like any other
   * variable no read on THIS graph produces.
   */
  lastDayWorked: KualiFormDateSchema,
  separationDate: KualiFormDateSchema,
  terminationEffectiveDate: KualiFormDateSchema,
  /** §4c's receipt: the finalization is never entered without the filed transaction. */
  transactionNumber: KualiTransactionNumberSchema,
  /** The COMPLETE final comments text, composed upstream from the read below. */
  timekeeperComments: KualiFinalizationCommentsSchema,
  /** What that read saw in the comments control, verbatim — S56's baseline. */
  observedExistingComments: z.string().max(4000),
} as const;

export const SeparationsKualiFinalizationInput = z.strictObject(FinalizationInputShape);

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
      ucpathDepartment: { state: "present", value: "HOUSING/DINING/HOSPITALITY" },
      observedDepartmentOptions: ["- - -", "000412 - Housing/Dining/Hospitality"],
      payrollTitleCode: "004921",
      payrollTitle: "STDT 2",
      timekeeperName: "Deterministic Timekeeper",
      lastDayWorked: "06/09/2026",
      separationDate: "06/10/2026",
      terminationEffectiveDate: "06/11/2026",
      transactionNumber: "T002209631",
      timekeeperComments: "Termination effective date set from the reconciled separation date.",
      observedExistingComments: "",
    },
  ],
);

export const SeparationsKualiFinalizationResultSchema = z.strictObject({
  documentNumber: z.string().min(1),
  /** The subject a human approved, and the evidence they approved it on. */
  approved: ApprovedIdentitySubjectSchema,
  /** Which department option was staged, and the UCPath code it was keyed by. */
  department: z.strictObject({
    option: z.string().min(1),
    departmentCode: z.string().min(1),
  }),
  /**
   * The finalization's landing proof. `proof` is always the reload read-back's
   * — the commit's own output is a claim nothing promotes (D128/S59).
   */
  finalization: z.strictObject({
    disposition: z.enum(["committed", "already-present"]),
    proof: KualiSavedFinalizationProofSchema,
  }),
});


const separationsKualiFinalizationFlow = flow(SeparationsKualiFinalizationInput)
  // The Identity check and Job summary steps' fragments, wired straight from
  // the harness ingress (D265 §1.2.2 rule 3 — imported, never restated), then
  // this folder's own finalization fragment wired from the same ingress where
  // the composition binds the reconciled folds and the receipt.
  .pipe(jobSummaryNode.wire({
    dependsOn: [],
    bind: ({ input }) => ({ emplId: input.emplId }),
  }))
  .pipe(nameSearchNode.wire({
    dependsOn: [],
    bind: ({ input }) => ({
      kind: "by-name" as const,
      name: input.employeeName,
      keepNonHdh: true,
    }),
  }))
  .pipe(departmentOptionNode.wire({
    dependsOn: [],
    bind: ({ input }) => ({
      deptId: input.ucpathDeptId,
      department: input.ucpathDepartment,
      observedOptions: input.observedDepartmentOptions,
      documentNumber: input.documentNumber,
    }),
  }))
  .pipe(comparisonNode.wire({
    dependsOn: [JOB_SUMMARY_NODE, NAME_SEARCH_NODE],
    bind: ({ input, outputs }) => ({
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
  }))
  .pipe(identityApprovalGate.wire({ dependsOn: [COMPARISON_NODE, DEPARTMENT_NODE] }))
  .pipe(approvalNode.wire({
    dependsOn: [COMPARISON_NODE, GATE_NODE],
    bind: ({ outputs }) => ({
      packet: outputs[COMPARISON_NODE].packet,
      evidenceDigest: outputs[COMPARISON_NODE].evidenceDigest,
      approval: outputs[GATE_NODE],
    }),
  }))
  .pipe(finalizeKualiNode.wire({
    dependsOn: [APPROVAL_NODE, DEPARTMENT_NODE],
    prepare: { bind: ({ input, outputs }) => ({
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
        transactionNumber: input.transactionNumber,
        timekeeperComments: input.timekeeperComments,
        observedExistingComments: input.observedExistingComments,
      },
    }) },
    commit: { bind: ({ input, outputs }) => ({
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
        transactionNumber: input.transactionNumber,
        timekeeperComments: input.timekeeperComments,
        observedExistingComments: input.observedExistingComments,
      },
    }) },
  }))
  .build({
    schema: SeparationsKualiFinalizationResultSchema,
    dependsOn: [APPROVAL_NODE, DEPARTMENT_NODE, FINALIZE_NODE],
    derive: ({ outputs }) => ({
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
  });

export const separationsKualiFinalizationDescriptor = defineWorkflowDescriptor({
  id: "separations-kuali-finalization",
  version: 1,
  contractFingerprint: resolveWorkflowFingerprint(
    BUILD_MANIFEST,
    WorkflowIdSchema.parse("separations-kuali-finalization"),
  ),
  code: "sf",
  label: "Kuali Finalization",
  summary:
    "Chunk 5 of the separations migration: the Kuali finalization SAVE, provable alone. Reads the "
    + "identity picture, resolves the department option, parks for approval, then stages every "
    + "finalization field in one pass and saves once.",
  icon: "ShieldCheck",
  category: "separation",
  canonicalInput: SeparationsKualiFinalizationCanonicalInput,
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
      key: "department",
      label: "Department",
      source: { nodeId: DEPARTMENT_NODE, fieldPath: "option" },
      display: "text",
    },
    {
      key: "transaction-number",
      label: "Transaction",
      // A transaction node's field paths are the COMMIT contract's bare output
      // (D144), which is `{ savedState }` — not the `TypedTransactionOutcome`
      // envelope the graph scope carries.
      source: { nodeId: FINALIZE_NODE, fieldPath: "savedState.fields.transactionNumber" },
      display: "text",
    },
  ],
  identity: {
    /**
     * The ITEM is the document and the transaction it is being finalized
     * against — the same natural key the commit's permanent key uses, one layer
     * up. Keying it by the person instead would call two separations of two
     * different employments one item.
     */
    matchKey: (input) => `separations-kuali-finalization:${input.documentNumber}:${input.transactionNumber}`,
  },
  presentation: {
    title: (input) => `Kuali ${input.documentNumber} finalization`,
    subtitle: (input) => `${input.employeeName} — ${input.transactionNumber}`,
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
      nodeId: "department-option",
      purpose: "Resolves the subject's UCPath department to the exact option this document's OWN control offers, "
        + "refusing one the control does not carry. Pure: it reaches no browser.",
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
      nodeId: "finalize-kuali",
      purpose: "Stages every finalization field in ONE pass from the reconciled variables, saves once, and "
        + "proves the save by reloading and comparing each written field against exactly what was staged.",
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
  flow: separationsKualiFinalizationFlow,
});
