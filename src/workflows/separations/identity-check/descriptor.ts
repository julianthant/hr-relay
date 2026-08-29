/**
 * `separations-identity-check` — chunk 3 of the separations migration
 * (`docs/migrations/separations.md` §3): the UCPath identity passage, provable
 * ALONE, strictly read-only, and carrying ref write-safety §14's **ALWAYS-GATE**.
 *
 * ## The graph, and why every node is unconditional
 *
 * ```
 *   job-summary ─┐
 *                ├─► comparison ─► GATE identity-approval ─► approval ─► result
 *   name-search ─┘        (packet + digest)     (operator)      (checks)
 * ```
 *
 * There is **no branch and no `when`** in this graph, and that is the design.
 * §3.1 says scenario variability is served by recomposition rather than by
 * conditionals; §4d says NO run mode, preset, prefill or resume may change the
 * identity path. A graph with no conditional edge cannot have one: every run
 * reads the job summary, every run searches the document's name, every run
 * builds the packet, and every run parks at the gate.
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
 * ## Why the gate is the LAST thing before the result, in a read-only workflow
 *
 * This chunk files nothing, so §14.3's "before the transaction node, never
 * inside it" has no transaction to sit before. What it has instead is the
 * obligation that makes the composition safe: this workflow's **terminal
 * result** is an *approved subject*, and it is graph-reachable only through the
 * gate. The composed `separations` descriptor will consume that subject as the
 * `expected` side of the write's binding proof — so a commit with no backing
 * approval has nothing to bind to, exactly as §14.6 risk 2 requires.
 * `identity-gate-before-commit` asserts both halves statically.
 *
 * ## What this chunk deliberately does NOT do
 *
 * - **It resolves nothing by itself (S18).** The run is told which EID to check
 *   AND where that EID came from (`emplIdSource`). Legacy's fallback — a blank
 *   or short Kuali EID delegating to person-lookup — is a *resolution* step over
 *   the Kuali document read, which is chunk 2's output and the composition's
 *   job; expressing it as a branch here would be the conditional identity path
 *   §4d forbids. What this chunk owes is that the fork is VISIBLE: an EID the
 *   document did not supply is a `type-the-eid` gate, never a one-click one.
 * - **It never writes a name (S15).** Legacy rewrites the UCPath spelling into
 *   the live Kuali document on the `similar` tier, with no review, in dry-run
 *   too. There is no `prepare` node and no `commit` node in this graph.
 * - **It does not decide "already terminated" (S21/S22).** It reports the whole
 *   employment grid and its classification; whether a person with no active job
 *   should be separated anyway is a question for the human at the gate.
 *
 * This module is bundle-safe: it value-imports only zod, `src/domain/**`, and
 * the audited `src/base` builders.
 */
import { z } from "zod";
import { flow } from "../../../base/flow.js";
import { defineWorkflowDescriptor } from "../../../base/workflow.js";
import { EidSchema, WorkflowIdSchema } from "../../../domain/ids.js";
import { redactionDigest } from "../../../domain/redaction.js";
import { ApprovedIdentitySubjectSchema } from "../../../domain/separations/identity-approval.js";
import { IdentityEidSourceSchema } from "../../../domain/separations/identity-evidence.js";
import { noSeparationWritePlan } from "../../../domain/separations/write-plan.js";
import { JobSummaryClassificationSchema } from "../../../domain/separations/job-summary-classification.js";
import { KualiDocumentNumberSchema } from "../../../domain/ui/kuali-document-identity.js";
import { KualiEidFieldSchema } from "../../../domain/ui/kuali-separation-document.js";
import {
  BUILD_MANIFEST,
  resolveWorkflowFingerprint,
} from "../../../domain/workflow/build-manifest.js";
import { defineCanonicalInput } from "../../../domain/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../domain/workflow/presentation.js";
import { JOB_SUMMARY_NODE, jobSummaryNode } from "../job-summary/nodes.js";
import {
  APPROVAL_NODE,
  COMPARISON_NODE,
  GATE_NODE,
  NAME_SEARCH_NODE,
  approvalNode,
  comparisonNode,
  identityApprovalGate,
  nameSearchNode,
} from "./nodes.js";

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
  if (input.emplIdSource === "name-resolved" && documentValue === input.emplId) {
    context.addIssue({
      code: "custom",
      path: ["emplIdSource"],
      message: "a name-resolved source may not name the EID the document already supplied",
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
  /** The subject a human approved, and the evidence they approved it on. */
  approved: ApprovedIdentitySubjectSchema,
  /** The employment picture that approval was granted over (S21–S24). */
  jobs: JobSummaryClassificationSchema,
});

const separationsIdentityCheckFlow = flow(SeparationsIdentityCheckInput)
  // The step's own fragments (`./nodes.ts`) and the Job summary step's read,
  // wired straight from the harness ingress: the EID and the name are the run's
  // input here, where the composition resolves them from the Kuali reads.
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
        "this chunk resolves an identity and files nothing; the composed `separations` graph is where a write plan exists to show",
      ),
    }),
  }))
  .pipe(identityApprovalGate.wire({ dependsOn: [COMPARISON_NODE] }))
  .pipe(approvalNode.wire({
    dependsOn: [COMPARISON_NODE, GATE_NODE],
    bind: ({ outputs }) => ({
      packet: outputs[COMPARISON_NODE].packet,
      evidenceDigest: outputs[COMPARISON_NODE].evidenceDigest,
      approval: outputs[GATE_NODE],
    }),
  }))
  /**
   * `dependsOn: ["approval"]` and NOTHING else — the guard caught the first
   * draft, which read the document number and the employment picture straight
   * off the PRE-gate comparison node and therefore had two ancestry paths to a
   * root that never crossed the gate. The post-gate node carries those facts
   * forward instead, so the run's whole product is a post-approval fact.
   */
  .build({
    schema: SeparationsIdentityCheckResultSchema,
    dependsOn: [APPROVAL_NODE],
    derive: ({ outputs }) => outputs[APPROVAL_NODE],
  });

export const separationsIdentityCheckDescriptor = defineWorkflowDescriptor({
  id: "separations-identity-check",
  version: 1,
  contractFingerprint: resolveWorkflowFingerprint(
    BUILD_MANIFEST,
    WorkflowIdSchema.parse("separations-identity-check"),
  ),
  code: "si",
  label: "Identity Check",
  summary:
    "Chunk 3 of the separations migration: the UCPath identity passage, read-only, carrying ref write-safety "
    + "§14's ALWAYS-GATE. Every run reads the job summary, searches the document's name, builds the "
    + "evidence packet, and parks for a human — no run mode changes that.",
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
    matchKey: (input) => `separations-identity:${input.documentNumber}:${redactionDigest(input.emplId)}`,
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
  flow: separationsIdentityCheckFlow,
});
