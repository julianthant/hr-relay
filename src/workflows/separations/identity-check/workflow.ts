/**
 * `separations-identity-check` — chunk 3 of the separations migration
 * (`docs/migrations/separations.md` §3): the UCPath identity passage, provable
 * ALONE, strictly read-only, and carrying ref write-safety §14's identity
 * authority policy.
 *
 * ## The graph, with one authority condition
 *
 * ```
 *   job-summary ─┐
 *                ├─► comparison ─► GATE identity-approval ─► approval ─► result
 *   name-search ─┘        (packet + digest)   (name-only)    (machine or human)
 * ```
 *
 * There is no branch and exactly one declared `when`: the operator gate runs
 * when `comparison.packet.emplIdSource === "name-resolved"`. No run mode,
 * preset, caller or frontend controls that condition. Every run still reads the
 * job summary, searches the document's name and builds the same packet. An
 * independently supplied EID continues only when UCPath's actual read-back
 * matches; a name-derived EID parks for the real operator command.
 *
 * `name-search` running unconditionally is the sharpest instance. Legacy
 * performs it only when its name tier came back `different`
 * (`legacy:src/workflows/separations/workflow.ts:211-269`, commit `1bffbd65`) —
 * so the alternative candidate that the `T002173685` incident turned on exists
 * only on the runs a Levenshtein threshold happened to select, and S15's
 * `similar` arm is precisely the case where it does NOT run. Running it every
 * time costs one UCPath search and makes ref write-safety §14.2's two-candidate
 * side-by-side presentation a property of the graph.
 *
 * ## Why identity authority is the last thing before the result
 *
 * This chunk files nothing, so §14.3's "before the transaction node, never
 * inside it" has no transaction to sit before. What it has instead is the
 * obligation that makes the composition safe: this workflow's terminal result
 * is a resolved identity with an explicit `machine-verification` or
 * `operator-approval` discriminator. It is graph-reachable only through the
 * authority task. The composed descriptor consumes that subject as the
 * `expected` side of the write's binding proof. `identity-gate-before-commit`
 * asserts the authority dominance and the exact name-only gate condition.
 *
 * ## What this chunk deliberately does NOT do
 *
 * - **It resolves nothing by itself (S18).** The run is told which EID to check
 *   AND where that EID came from (`emplIdSource`). Legacy's fallback — a blank
 *   or short Kuali EID delegating to person-lookup — is a *resolution* step over
 *   the Kuali document read, which is chunk 2's output and the composition's
 *   job. What this chunk owes is that the origin remains typed: an EID the
 *   document did not supply requires the name-only operator gate.
 * - **It never writes a name (S15).** Legacy rewrites the UCPath spelling into
 *   the live Kuali document on the `similar` tier, with no review, in dry-run
 *   too. There is no `prepare` node and no `commit` node in this graph.
 * - **It does not decide "already terminated" (S21/S22).** It reports the whole
 *   employment grid and its classification. Business-rule refusal remains
 *   independent from identity authority.
 *
 * This module is bundle-safe: it value-imports only zod, `src/domain/**`, and
 * the audited `src/base` builders.
 */
import { z } from "zod";
import { defineWorkflow } from "../../../base/workflow-definition.js";
import { EidSchema } from "../../../domain/ids.js";
import { ResolvedIdentitySubjectSchema } from "../../../domain/separations/identity-approval.js";
import { IdentityEidSourceSchema } from "../../../domain/separations/identity-evidence.js";
import { noSeparationWritePlan } from "../../../domain/separations/write-plan.js";
import { JobSummaryClassificationSchema } from "../../../domain/separations/job-summary-classification.js";
import { KualiDocumentNumberSchema } from "../../../domain/ui/kuali-document-identity.js";
import { KualiEidFieldSchema } from "../../../domain/ui/kuali-separation-document.js";
import { defineCanonicalInput } from "../../../domain/workflow/canonical-input.js";
import { defineWorkflowRole } from "../../../domain/workflow/module-role.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../domain/workflow/presentation.js";
import {
  APPROVAL_NODE,
  COMPARISON_NODE,
  GATE_NODE,
  IDENTITY_CHECK_STEP,
  JOB_SUMMARY_NODE,
  JOB_SUMMARY_STEP,
  NAME_SEARCH_NODE,
  approvalNode,
  comparisonNode,
  identityApprovalGate,
  jobSummaryNode,
  nameSearchNode,
} from "../workflow.js";

/**
 * The ingress.
 *
 * `emplIdSource` is not decoration: S18 and S19 are the same page of legacy
 * behaviour read from two sides, and the difference between them is *where the
 * EID came from*. A run that says `document-eid` is claiming the separation
 * document itself named this person, and the `superRefine` below makes that
 * claim checkable rather than decorative — a mis-stated source would put a
 * one-click approve in front of an identity nothing confirmed.
 */
const IdentityCheckInputShape = {
  documentNumber: KualiDocumentNumberSchema,
  /** The employee name the separation document carries, verbatim. */
  employeeName: z.string().min(1),
  /** The EID this run checks. */
  emplId: EidSchema,
  emplIdSource: IdentityEidSourceSchema,
  /** The document's own EID field — present with a value, or absent with a reason. */
  documentEid: KualiEidFieldSchema,
} as const;

function refineIdentityInput(
  input: Readonly<{
    emplId: string;
    emplIdSource: z.infer<typeof IdentityEidSourceSchema>;
    documentEid: z.infer<typeof KualiEidFieldSchema>;
  }>,
  context: z.RefinementCtx,
): void {
  const documentValue = input.documentEid.state === "present" ? input.documentEid.value : undefined;
  if (input.emplIdSource === "document-eid" && documentValue !== input.emplId) {
    context.addIssue({
      code: "custom",
      path: ["emplIdSource"],
      message: "a document-eid source requires the document's own EID field to hold exactly this EID",
    });
  }
  if (input.emplIdSource !== "document-eid" && documentValue !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["emplIdSource"],
      message: `${input.emplIdSource} requires the document to supply no EID`,
    });
  }
}

export const SeparationsIdentityCheckInput = z.strictObject(IdentityCheckInputShape)
  .superRefine(refineIdentityInput);

export const SeparationsIdentityCheckCanonicalInput = defineCanonicalInput(
  SeparationsIdentityCheckInput,
  z.strictObject(IdentityCheckInputShape).superRefine(refineIdentityInput),
  [
    {
      documentNumber: "4510",
      employeeName: "Battistessa, Johnnie",
      emplId: "10873698",
      emplIdSource: "document-eid",
      documentEid: { state: "present", value: "10873698" },
    },
    {
      documentNumber: "4511",
      employeeName: "Canonical Harness Person",
      emplId: "10873698",
      emplIdSource: "canonical-eid",
      documentEid: { state: "absent", reason: "the harness supplies the EID directly" },
    },
    {
      documentNumber: "4502",
      employeeName: "Hernandez, Jose Santos",
      emplId: "10401814",
      emplIdSource: "name-resolved",
      documentEid: { state: "absent", reason: "the separation document's EID field was blank" },
    },
  ],
);

export const SeparationsIdentityCheckResultSchema = z.strictObject({
  documentNumber: z.string().min(1),
  /** The subject established by machine verification or operator approval. */
  approved: ResolvedIdentitySubjectSchema,
  /** The employment picture that approval was granted over (S21–S24). */
  jobs: JobSummaryClassificationSchema,
});

export const separationsIdentityCheckWorkflow = defineWorkflow({
  id: "separations-identity-check",
  version: 1,
  code: "si",
  label: "Identity Check",
  summary:
    "Chunk 3 of the separations migration: the UCPath identity passage, read-only, carrying ref write-safety "
    + "§14's typed authority. A supplied EID verified by UCPath read-back proceeds with machine authority; "
    + "a name-resolved EID parks for the operator gate.",
  icon: "ShieldCheck",
  category: "separation",
  canonicalInput: SeparationsIdentityCheckCanonicalInput,
  inputSubject: "eid",
  surface: { shape: "single" },
  enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS,
  /**
   * No `inputRun` surface: the input is five correlated values and a
   * paste-a-line parser splits one token per item, so a parser here would have
   * to invent the four it did not receive. Runs start through the generic
   * start-plan / command path, and the queue and run-detail wires render this
   * workflow off the registry.
   */
  surfaces: {},
  /**
   * No `capabilities` block, and here that is a SAFETY property rather than a
   * scoping one. An Edit Data field on this graph would let an operator patch a
   * checkpoint scalar — the displayed name, the EID, a job row's status —
   * without any live read behind it, which is the wrong-person class arriving
   * through the correction rail instead of through a name search. The one thing
   * an operator may change about this run is the gate decision, and that goes
   * through the typed gate command.
   */
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
      key: "employment",
      label: "Employment",
      source: { nodeId: "comparison", fieldPath: "packet.jobs.disposition" },
      display: "text",
    },
    {
      key: "name-tier",
      label: "Name match",
      source: { nodeId: "comparison", fieldPath: "packet.nameTier" },
      display: "text",
    },
    {
      key: "approval-shape",
      label: "Approval required",
      source: { nodeId: "comparison", fieldPath: "packet.approvalShape" },
      display: "text",
    },
  ],
  /**
   * Ref dashboard-surfaces §1.2. The start input's `employeeName` is the KUALI FORM'S CLAIM —
   * it is the thing this chunk exists to check, so a row that kept printing it
   * would be titling itself with the unverified half of its own question. Once
   * Job Summary has answered, the row states UCPath's record instead; before
   * that, the claim stands, which is all the run knows.
   */
  subjectProjection: { nodeId: "job-summary", fieldPath: "displayedName" },
  identity: {
    matchKey: (input) => `separations-identity:${input.documentNumber}:${input.emplId}`,
  },
  presentation: {
    title: (input) => `${input.employeeName} (${input.emplId})`,
    subtitle: (input) => `Separation document ${input.documentNumber}`,
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
  ],
  scenarios: [
    "separations-identity-check/single-active-job",
    "separations-identity-check/similar-name-never-auto-proceeds",
    "separations-identity-check/different-name-two-candidates",
    "separations-identity-check/already-terminated-single-row",
    "separations-identity-check/already-terminated-multi-row",
    "separations-identity-check/concurrent-active-jobs",
    "separations-identity-check/unreadable-department",
    "separations-identity-check/job-summary-not-found",
    "separations-identity-check/gate-approved",
    "separations-identity-check/gate-rejected",
    "separations-identity-check/gate-evidence-moved",
  ],
  input: SeparationsIdentityCheckInput,
  // A proving harness for one step of `separations`, never a peer workflow (D219) —
  // the step it proves is the folder it lives in, read from the composition's own
  // declaration rather than re-typed here (D265 §1.2.2 rule 3).
  role: defineWorkflowRole({ kind: "chunk-harness", of: "separations", step: IDENTITY_CHECK_STEP.key }),
  steps: ({ task, gate, result }) => {
    // The composition's own step identities (`../workflow.ts`) and the Job
    // summary step's read, wired straight from the harness ingress: the EID and
    // the name are the run's input here, where the composition resolves them
    // from the Kuali reads.
    const jobSummary = task(jobSummaryNode, [], ({ input }) => ({ emplId: input.emplId }));
    const nameSearch = task(nameSearchNode, [], ({ input }) => ({
      kind: "by-name" as const,
      name: input.employeeName,
      keepNonHdh: true,
    }));
    const comparison = task(comparisonNode, [jobSummary, nameSearch], ({ input, outputs }) => ({
      documentNumber: input.documentNumber,
      documentName: input.employeeName,
      documentEid: input.documentEid,
      emplId: input.emplId,
      emplIdSource: input.emplIdSource,
      jobSummary: outputs[JOB_SUMMARY_NODE],
      nameSelection: outputs[NAME_SEARCH_NODE].selection,
      plan: noSeparationWritePlan(
        "this chunk resolves an identity and files nothing; the composed `separations` graph is where a write plan exists to show",
      ),
    }));
    const identityGate = gate(identityApprovalGate, [comparison]);
    const approval = task(approvalNode, [comparison, identityGate], ({ outputs }) => ({
      packet: outputs[COMPARISON_NODE].packet,
      evidenceDigest: outputs[COMPARISON_NODE].evidenceDigest,
      approval: outputs[GATE_NODE],
    }));
    return {
      // Two groups, both the composition's: the Job summary read this harness
      // proves for the step that has no harness of its own (D265 mapping), then
      // the identity step itself. Job summary first keeps the graph in the
      // order the hand-authored descriptor listed its nodes.
      steps: [
        [JOB_SUMMARY_STEP, [jobSummary]],
        [IDENTITY_CHECK_STEP, [nameSearch, comparison, identityGate, approval]],
      ],
      /**
       * Depends on `approval` and NOTHING else — the guard caught the first
       * draft, which read the document number and employment picture straight
       * off the comparison node. The authority node carries those facts
       * forward, so both the machine and human arms dominate the run's whole
       * product.
       */
      result: result(SeparationsIdentityCheckResultSchema, [approval], ({ outputs }) => outputs[APPROVAL_NODE]),
    };
  },
});
