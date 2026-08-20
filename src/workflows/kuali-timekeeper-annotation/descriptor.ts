/**
 * kuali-timekeeper-annotation — Phase 2's transaction proof.
 *
 * ONE transaction node and nothing else. Doc 07's Phase-2 rule is to pick "the
 * smallest controlled test-instance or sacrificial test record whose prepare
 * and commit paths are real and whose outcome is independently queryable", and
 * a graph with a single node is the smallest thing that can carry a real fence.
 * Everything this workflow proves — staged preview, fresh subject binding,
 * fail-closed completion, permanent-key dedupe — is a property of that node.
 *
 * ## What it writes, and why that is the right target
 *
 * The `Timekeeper Name:*` field on a Kuali RRSS Separation Request Form. It is
 * a benign annotation the legacy flow already fills on drafts, it is reversible
 * by writing the previous value back (which prepare captures and returns), and
 * it is the exact field the operator authorized for the 2026-07-23 write
 * round-trip on doc 4444 (D78). It touches no workflow button: `Send Back` and
 * `Mark Complete` — the controls that advance a real separation — are never
 * addressable through this graph.
 *
 * ## Why it is deliberately NOT separation-class
 *
 * Doc 09 §14's ALWAYS-GATE (D77) binds separation FILINGS: the UCPath
 * termination and the Kuali finalization that end someone's employment. This
 * workflow files nothing — it annotates a field — so registering it under the
 * separation class would put a gate in front of a write that is not the wrong-
 * person risk the gate exists for, and would say something false about what it
 * does. The identity control here is the kernel's own beat-③ subject binding
 * against the document's displayed EID. The operator sign-off for the ONE
 * controlled commit is out-of-band and has not been given; see
 * `docs/rebuild/09-write-safety.md` §15.
 *
 * ## dryRun
 *
 * `stop-after-prepare`. A dry run opens the document, stages the value, and
 * observes the subject — then stops with no intent, no fence, no click, and
 * nothing durable. Closing the page discards the staged value, so the document
 * is byte-identical afterwards.
 */
import { z } from "zod";
import { flow } from "../../base/flow.js";
import { defineWorkflowDescriptor } from "../../base/workflow.js";
import { KualiFillTimekeeperAnnotation } from "../../domain/contracts/kuali/fill-timekeeper-annotation.js";
import { KualiSaveTimekeeperAnnotation } from "../../domain/contracts/kuali/save-timekeeper-annotation.js";
import { EidSchema, WorkflowIdSchema } from "../../domain/ids.js";
import {
  KualiActionIdSchema,
  KualiDocumentNumberSchema,
  KualiSavedTimekeeperProofSchema,
  KualiTimekeeperNameSchema,
} from "../../domain/ui/kuali-rrss-document.js";
import {
  BUILD_MANIFEST,
  resolveWorkflowFingerprint,
} from "../../domain/workflow/build-manifest.js";
import { defineCanonicalInput } from "../../domain/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../domain/workflow/presentation.js";

/**
 * The ingress schema. There is deliberately no `dryRun` field — that is kernel
 * envelope state (D6). `actionId` and `documentNumber` are BOTH required: the
 * action id is the reload-safe deep link, the document number is what the page
 * heading independently proves, and a run that carried only one of them could
 * not detect the stale-action-id case observed live on 2026-08-04.
 */
export const KualiTimekeeperAnnotationInput = z.strictObject({
  actionId: KualiActionIdSchema,
  documentNumber: KualiDocumentNumberSchema,
  emplId: EidSchema,
  timekeeperName: KualiTimekeeperNameSchema,
});

export const KualiTimekeeperAnnotationCanonicalInput = defineCanonicalInput(
  KualiTimekeeperAnnotationInput,
  z.strictObject({
    actionId: KualiActionIdSchema,
    documentNumber: KualiDocumentNumberSchema,
    emplId: EidSchema,
    timekeeperName: KualiTimekeeperNameSchema,
  }),
  [
    {
      actionId: "0123456789abcdef01234567",
      documentNumber: "4444",
      emplId: "10800000",
      timekeeperName: "PROBE-DELETE-ME",
    },
  ],
);

export const KualiTimekeeperAnnotationResultSchema = z.strictObject({
  disposition: z.enum(["committed", "already-present"]),
  saved: KualiSavedTimekeeperProofSchema,
});

const TRANSACTION_NODE = "annotate-timekeeper";

const kualiTimekeeperFlow = flow(KualiTimekeeperAnnotationInput)
  .transaction(TRANSACTION_NODE, {
    label: "Timekeeper Annotation",
    dependsOn: [],
    prepare: {
      uses: KualiFillTimekeeperAnnotation,
      bind: ({ input }) => ({
        actionId: input.actionId,
        documentNumber: input.documentNumber,
        emplId: input.emplId,
        timekeeperName: input.timekeeperName,
      }),
    },
    commit: {
      uses: KualiSaveTimekeeperAnnotation,
      // Workflow input only — the durable idempotency key is therefore stable
      // before any page mutation, which is what makes a crash between click and
      // confirmation resolvable at all (doc 02 §3.1).
      bind: ({ input }) => ({
        actionId: input.actionId,
        documentNumber: input.documentNumber,
        emplId: input.emplId,
        timekeeperName: input.timekeeperName,
      }),
    },
    dryRun: "stop-after-prepare",
    // "always": Kuali's probe is one document read, and paying it on the first
    // attempt too is what closes the crash window before the first fence.
    probePolicy: "always",
    // Budget for probe-end → open + stage + read-back + subject observation.
    // D78 measured a full fill→save→reload→verify cycle at ~8-10s/doc and the
    // 2026-08-04 read-only session measured a cold document open at ~6s; 45s is
    // that with headroom, and it is short enough that a stalled page discards
    // the staged form rather than clicking on a stale probe.
    probeToFenceMaxMs: 45_000,
  })
  .build({
    schema: KualiTimekeeperAnnotationResultSchema,
    dependsOn: [TRANSACTION_NODE],
    derive: ({ outputs }) => ({
      disposition: outputs[TRANSACTION_NODE].disposition,
      saved: outputs[TRANSACTION_NODE].output.savedState,
    }),
  });

export const kualiTimekeeperAnnotationDescriptor = defineWorkflowDescriptor({
  id: "kuali-timekeeper-annotation",
  version: 1,
  contractFingerprint: resolveWorkflowFingerprint(
    BUILD_MANIFEST,
    WorkflowIdSchema.parse("kuali-timekeeper-annotation"),
  ),
  code: "kt",
  label: "Kuali Timekeeper Annotation",
  summary:
    "Phase 2's controlled write proof: fills and saves the Timekeeper Name annotation on ONE Kuali "
    + "RRSS separation document, then proves the value landed by reloading the page and reading it "
    + "back. It touches no workflow button — Send Back and Mark Complete are not addressable through "
    + "this graph.",
  icon: "ShieldCheck",
  category: "operations",
  canonicalInput: KualiTimekeeperAnnotationCanonicalInput,
  inputSubject: "eid",
  surface: { shape: "single" },
  enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: {},
  // `fieldPath` is a BUILD-TIME binding, not a runtime read. `defineWorkflowDescriptor`
  // validates it against `outputSchemaOf(node)`, which for a transaction node is the
  // COMMIT contract's bare output (`{ savedState }`) — per D144, "which schema owns this
  // node's field paths" stays the commit output and is deliberately a different question
  // from what the node's graph-scope value is. Read the contrast so the two are not
  // conflated: the scope value is `TypedTransactionOutcome`, where this same value sits at
  // `output.savedState.timekeeperName` and where `disposition` lives (which is why the
  // disposition is surfaced by the result schema instead, and why a detail cannot name it).
  // Declaring the scope path here fails loud at build: `output` is not a field of the
  // commit output. Nothing resolves this path to a VALUE, and after D254 nothing is
  // expected to: the `span.patched` detail channel that was to carry one is RETIRED
  // (it never had a producer). A `details` declaration is read as a DECLARATION —
  // the evidence receipt's mandatory-leaf set, the run-detail data-origin bound, and
  // the Explorer's field census (doc 03 §3.3).
  details: [
    {
      key: "timekeeper-name",
      label: "Timekeeper",
      source: { nodeId: TRANSACTION_NODE, fieldPath: "savedState.timekeeperName" },
      display: "text",
    },
  ],
  identity: {
    matchKey: (input) => `kuali-doc:${input.documentNumber}:timekeeper:${input.timekeeperName}`,
  },
  presentation: {
    title: (input) => `Kuali ${input.documentNumber} timekeeper`,
    subtitle: (input) => `EID ${input.emplId}`,
  },
  /** D229 — the descriptor's own words about each node, projected by the explorer. */
  nodePurposes: [
    {
      nodeId: "annotate-timekeeper",
      purpose: "Stages the timekeeper annotation on the document's own form, fences, saves, and proves the write "
        + "landed by reloading and reading the field back — Kuali's save is UI-silent, so a rendered "
        + "confirmation is not evidence.",
    },
  ],
  scenarios: [
    "kuali-timekeeper-annotation/dry-run-preview",
    "kuali-timekeeper-annotation/subject-mismatch",
    "kuali-timekeeper-annotation/committed",
    "kuali-timekeeper-annotation/already-present",
  ],
  flow: kualiTimekeeperFlow,
});
