/** `separations-identity-check` — the UCPath identity passage, provable ALONE and read-only, carrying write-safety's identity-authority policy: one gate condition, and a result no write binds without authority. */
import { z } from "zod";
import { defineWorkflow } from "../../../../workflow-kit/workflow-definition.js";
import { EidSchema } from "../../../../rules/identity/ids.js";
import { ResolvedIdentitySubjectSchema } from "../../../../rules/separations/identity-approval.js";
import { IdentityEidSourceSchema } from "../../../../rules/separations/identity-evidence.js";
import { noSeparationWritePlan } from "../../../../rules/separations/write-plan.js";
import { JobSummaryClassificationSchema } from "../../../../rules/separations/job-summary-classification.js";
import { KualiDocumentNumberSchema } from "../../../../models/ui/kuali-document-identity.js";
import { KualiEidFieldSchema } from "../../../../models/ui/kuali-separation-document.js";
import { defineCanonicalInput } from "../../../../models/workflow/canonical-input.js";
import { defineWorkflowRole } from "../../../../workflow-kit/validation/module-role.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../models/workflow/presentation.js";
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
} from "../../workflow.js";

/** The ingress. `emplIdSource` is not decoration: it records *where the EID came from*, and `superRefine` makes that claim checkable rather than decorative. */
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
  const documentValue =
    input.documentEid.state === "present" ? input.documentEid.value : undefined;
  if (input.emplIdSource === "document-eid" && documentValue !== input.emplId) {
    context.addIssue({
      code: "custom",
      path: ["emplIdSource"],
      message:
        "a document-eid source requires the document's own EID field to hold exactly this EID",
    });
  }
  if (input.emplIdSource !== "document-eid" && input.emplIdSource !== "operator-entered" && documentValue !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["emplIdSource"],
      message: `${input.emplIdSource} requires the document to supply no EID`,
    });
  }
}

const SeparationsIdentityCheckInput = z
  .strictObject(IdentityCheckInputShape)
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
      documentEid: {
        state: "absent",
        reason: "the harness supplies the EID directly",
      },
    },
    {
      documentNumber: "4502",
      employeeName: "Hernandez, Jose Santos",
      emplId: "10401814",
      emplIdSource: "name-resolved",
      documentEid: {
        state: "absent",
        reason: "the separation document's EID field was blank",
      },
    },
  ],
);

const SeparationsIdentityCheckResultSchema = z.strictObject({
  documentNumber: z.string().min(1),
  /** The subject established by machine verification or operator approval. */
  approved: ResolvedIdentitySubjectSchema,
  // The employment picture approval was granted over.
  jobs: JobSummaryClassificationSchema,
});

export const separationsIdentityCheckWorkflow = defineWorkflow({
  id: "separations-identity-check",
  version: 1,
  code: "si",
  label: "Identity Check",
  summary:
    "Chunk 3 of the separations migration: the UCPath identity passage, read-only, carrying ref write-safety " +
    "§14's typed authority. A supplied EID verified by UCPath read-back proceeds with machine authority; " +
    "a name-resolved EID parks for the operator gate.",
  icon: "ShieldCheck",
  category: "separation",
  canonicalInput: SeparationsIdentityCheckCanonicalInput,
  inputSubject: "eid",
  surface: { shape: "single" },
  enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS,
  /** No `inputRun` surface: the input is five correlated values a paste-a-line parser can't
   *  reconstruct; runs start through the generic start-plan/command path. */
  surfaces: {},
  // Identity evidence cannot be corrected without a live read.
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
  /** Ref dashboard-surfaces: the start input's `employeeName` is the KUALI FORM'S CLAIM, so before
   *  Job Summary answers the row keeps the claim; after, it states UCPath's record instead. */
  subjectProjection: { nodeId: "job-summary", fieldPath: "displayedName" },
  identity: {
    matchKey: (input) =>
      `separations-identity:${input.documentNumber}:${input.emplId}`,
  },
  presentation: {
    title: (input) => `${input.employeeName} (${input.emplId})`,
    subtitle: (input) => `Separation document ${input.documentNumber}`,
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
  role: defineWorkflowRole({
    kind: "chunk-harness",
    of: "separations",
    step: IDENTITY_CHECK_STEP.key,
  }),
  steps: ({ task, gate, result }) => {
    const jobSummary = task(jobSummaryNode, [], ({ input }) => ({
      emplId: input.emplId,
    }));
    const nameSearch = task(nameSearchNode, [], ({ input }) => ({
      kind: "by-name" as const,
      name: input.employeeName,
      keepNonHdh: true,
    }));
    const comparison = task(
      comparisonNode,
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
          "this chunk resolves an identity and files nothing; the composed `separations` graph is where a write plan exists to show",
        ),
      }),
    );
    const identityGate = gate(identityApprovalGate, [comparison]);
    const approval = task(
      approvalNode,
      [comparison, identityGate],
      ({ outputs }) => ({
        packet: outputs[COMPARISON_NODE].packet,
        evidenceDigest: outputs[COMPARISON_NODE].evidenceDigest,
        approval: outputs[GATE_NODE],
      }),
    );
    return {
      // Keep Job Summary before identity checks to preserve graph order.
      steps: [
        [JOB_SUMMARY_STEP, [jobSummary]],
        [IDENTITY_CHECK_STEP, [nameSearch, comparison, identityGate, approval]],
      ],
      /** Depends on `approval` and NOTHING else: the authority node carries the facts forward, so
       *  both the machine and human arms dominate the run's whole product. */
      result: result(
        SeparationsIdentityCheckResultSchema,
        [approval],
        ({ outputs }) => outputs[APPROVAL_NODE],
      ),
    };
  },
});
