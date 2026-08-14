/**
 * `separations-identity-check` — chunk 3 of the separations migration
 * (`docs/migrations/separations.md` §3): the UCPath identity passage, provable
 * ALONE, strictly read-only, and carrying doc 09 §14's **ALWAYS-GATE**.
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
 * time costs one UCPath search and makes doc 09 §14.2's two-candidate
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
import { flow } from "../../base/flow.js";
import { defineWorkflowDescriptor } from "../../base/workflow.js";
import { SeparationsMatchIdentity } from "../../domain/contracts/separations/match-identity.js";
import { SeparationsVerifyIdentityApproval } from "../../domain/contracts/separations/verify-identity-approval.js";
import { SearchPersonOrg } from "../../domain/contracts/ucpath/search-person-org.js";
import { UcpathReadJobSummary } from "../../domain/contracts/ucpath/read-job-summary.js";
import { EidSchema, WorkflowIdSchema } from "../../domain/ids.js";
import {
  ApprovedIdentitySubjectSchema,
  IdentityApprovalResultSchema,
} from "../../domain/separations/identity-approval.js";
import { IdentityEidSourceSchema } from "../../domain/separations/identity-evidence.js";
import { noSeparationWritePlan } from "../../domain/separations/write-plan.js";
import { JobSummaryClassificationSchema } from "../../domain/separations/job-summary-classification.js";
import { KualiDocumentNumberSchema } from "../../domain/ui/kuali-document-identity.js";
import { KualiEidFieldSchema } from "../../domain/ui/kuali-separation-document.js";
import {
  BUILD_MANIFEST,
  resolveWorkflowFingerprint,
} from "../../domain/workflow/build-manifest.js";
import { defineCanonicalInput } from "../../domain/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../domain/workflow/presentation.js";

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
  .step("job-summary", UcpathReadJobSummary, {
    label: "Job Summary",
    dependsOn: [],
    /**
     * `replay: "checkpoint"` is safe here for chunk 2's reason read the same
     * way: this node's product is its VALUE, not browser state. Nothing
     * downstream stands on the page it opened — the consumers are two pure
     * folds and one operator gate — and a gate resume ALWAYS lands in a fresh
     * browser, because the executor releases every session on the way into a
     * park. A node whose product were browser state could not be replayed
     * across a park at all.
     */
    replay: "checkpoint",
    bind: ({ input }) => ({ emplId: input.emplId }),
  })
  .step("name-search", SearchPersonOrg, {
    label: "Name Search",
    dependsOn: [],
    replay: "checkpoint",
    /**
     * `keepNonHdh: true`, always. The HDH filter exists so person-lookup can
     * pick a preferred candidate; here the point is to SHOW the operator every
     * person this name resolves to, and a filter that hid the career employee a
     * common name matched would hide exactly the candidate `T002173685` turned
     * on.
     */
    bind: ({ input }) => ({
      kind: "by-name" as const,
      name: input.employeeName,
      keepNonHdh: true,
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
        "this chunk resolves an identity and files nothing; the composed `separations` graph is where a write plan exists to show",
      ),
    }),
  })
  .gate("identity-approval", {
    label: "Identity Approval",
    statusKey: "awaitingIdentityApproval",
    dependsOn: ["comparison"],
    /**
     * `resolvedBy: "operator"` and nothing else can resolve it (§14.4). Not a
     * retry, not a bump, not a cascade from a parent, not AI (charter §23/D60),
     * and not a generic "Done" — the kernel's ONLY path into
     * `gate_results` is the typed `resolve-gate` command, which parses this
     * exact schema and CASes the run version.
     */
    resolvedBy: "operator",
    result: IdentityApprovalResultSchema,
  })
  .step("approval", SeparationsVerifyIdentityApproval, {
    label: "Approval Check",
    dependsOn: ["comparison", "identity-approval"],
    /**
     * `always-rerun`, deliberately: this node's whole job is to compare a stored
     * gate result against re-derived evidence, and a replayed checkpoint would
     * be the previous comparison's ANSWER standing in for the comparison.
     */
    replay: "always-rerun",
    bind: ({ outputs }) => ({
      packet: outputs.comparison.packet,
      evidenceDigest: outputs.comparison.evidenceDigest,
      approval: outputs["identity-approval"],
    }),
  })
  /**
   * `dependsOn: ["approval"]` and NOTHING else — the guard caught the first
   * draft, which read the document number and the employment picture straight
   * off the PRE-gate comparison node and therefore had two ancestry paths to a
   * root that never crossed the gate. The post-gate node carries those facts
   * forward instead, so the run's whole product is a post-approval fact.
   */
  .build({
    schema: SeparationsIdentityCheckResultSchema,
    dependsOn: ["approval"],
    derive: ({ outputs }) => outputs.approval,
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
  identity: {
    matchKey: (input) => `separations-identity:${input.documentNumber}:${input.emplId}`,
  },
  presentation: {
    title: (input) => `${input.employeeName} (${input.emplId})`,
    subtitle: (input) => `Separation document ${input.documentNumber}`,
  },
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
