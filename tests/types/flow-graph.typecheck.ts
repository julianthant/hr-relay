/**
 * Item 1e's real-scale type-inference proof (doc 01 §"Item 1e begins
 * with a new real-scale type-inference proof").
 *
 * This file compiles a representative 21-node graph exercising every builder
 * transform — read steps, a prepare/commit transaction pair, an output-dependent
 * branch, fork/join, typed child runs at both cardinalities and both await
 * modes, operator/children/external gates, decorations, and a terminal result —
 * and pins the negative controls that would otherwise let a transform silently
 * collapse to a top type.
 *
 * The controls matter as much as the graph: `@ts-expect-error` fails the build
 * when the error it expects STOPS happening, so a transform that erodes to
 * `any`/`unknown`/`RuntimeFlowNode` fails this proof itself rather than passing
 * it vacuously. `tests/unit/flow-type-budget.test.ts` records the compile cost.
 *
 * The D71 disposable 40-node simplified chain is a feasibility floor, not a
 * substitute — this file uses the REAL contract factory and the REAL builder.
 */
import { z } from "zod";
import { defineOperatorGateNode, defineTaskNode, defineTransactionNode, flow } from "../../src/base/flow.js";
import type { NodeEntry, OutputsOf } from "../../src/base/flow.js";
import { ContractFieldPathSchema, defineTaskContract } from "../../src/domain/contracts/base.js";
import {
  DelegationEdgeIdSchema,
  EidSchema,
  ItemIdSchema,
  ObservationIdSchema,
  ScenarioIdSchema,
  TaskIdSchema,
  WorkflowIdSchema,
  taskId,
} from "../../src/domain/ids.js";
import type { ItemId } from "../../src/domain/ids.js";
import type {
  ChildRunOutcome,
  DelegationManifestRef,
  DelegationPolicy,
  OperatorGateNode,
  TaskStepNode,
  TransactionNode,
  TypedTransactionOutcome,
  WorkflowRef,
} from "../../src/domain/workflow/graph.js";

/* ── contracts under test ────────────────────────────────────────────────── */

const SCENARIO = ScenarioIdSchema.parse("workflow/type-proof");
const personSubject = (requiredAt: "before-subject-read" | "after-prepare-before-fence") => ({
  kind: "person" as const,
  expected: { fromInput: ContractFieldPathSchema.parse("eid"), identity: "eid" as const },
  observe: ObservationIdSchema.parse("ucpath.person-org.displayed-eid"),
  match: "normalized-exact-eid" as const,
  requiredAt,
});

const searchPersonOrg = defineTaskContract({
  id: taskId("ucpath/search-person-org"),
  title: "Search Person Org",
  effect: "read",
  input: z.strictObject({ eid: EidSchema }),
  output: z.strictObject({ eid: EidSchema, department: z.string(), jobCode: z.string() }),
  errorCodes: ["eid-not-found"] as const,
  subject: personSubject("before-subject-read"),
  scenarios: [SCENARIO],
  freshness: { defaultMaxAgeMs: 60_000 },
  provenance: { default: "live" },
  example: { eid: "10800000", department: "HR", jobCode: "004722" },
});

const readCrmContact = defineTaskContract({
  id: taskId("crm/read-contact"),
  title: "Read CRM contact",
  effect: "read",
  input: z.strictObject({ eid: EidSchema }),
  output: z.strictObject({ email: z.string(), phone: z.string().nullable() }),
  errorCodes: ["contact-missing"] as const,
  subject: { kind: "none", reason: "CRM contact read is keyed by EID, not a displayed subject" },
  scenarios: [SCENARIO],
  freshness: { defaultMaxAgeMs: 3_600_000 },
  provenance: { default: "live" },
  example: { email: "a@b.edu", phone: null },
});

const listDocuments = defineTaskContract({
  id: taskId("onbase/list-documents"),
  title: "List OnBase documents",
  effect: "read",
  input: z.strictObject({ eid: EidSchema }),
  output: z.strictObject({ documentIds: z.array(z.string()) }),
  errorCodes: ["listing-unavailable"] as const,
  subject: { kind: "none", reason: "listing is keyed by EID" },
  scenarios: [SCENARIO],
  freshness: { defaultMaxAgeMs: 300_000 },
  provenance: { default: "live" },
  example: { documentIds: [] },
});

const mergeEnrichment = defineTaskContract({
  id: taskId("workflow:type-proof/merge-enrichment"),
  title: "Merge enrichment",
  effect: "read",
  input: z.strictObject({ department: z.string(), email: z.string() }),
  output: z.strictObject({ summary: z.string() }),
  errorCodes: ["merge-failed"] as const,
  subject: { kind: "none", reason: "pure workflow mini-store transform" },
  scenarios: [],
  freshness: { defaultMaxAgeMs: Number.POSITIVE_INFINITY },
  provenance: { default: "derived" },
  example: { summary: "HR / a@b.edu" },
});

const fillTermination = defineTaskContract({
  id: taskId("ucpath/fill-termination"),
  title: "Fill termination",
  effect: "prepare",
  input: z.strictObject({ eid: EidSchema, effectiveDate: z.string() }),
  output: z.strictObject({ stagedRows: z.number().int() }),
  errorCodes: ["fill-failed"] as const,
  subject: personSubject("before-subject-read"),
  scenarios: [SCENARIO],
  checkpoint: "in-memory-only",
  example: { stagedRows: 1 },
});

const TERMINATION_PROOF = z.strictObject({ transactionId: z.string() });
const submitTermination = defineTaskContract({
  id: taskId("ucpath/submit-termination"),
  title: "Submit termination",
  effect: "commit",
  input: z.strictObject({ eid: EidSchema, effectiveDate: z.string() }),
  output: TERMINATION_PROOF,
  errorCodes: ["submit-failed", "wrong-subject"] as const,
  subject: personSubject("after-prepare-before-fence"),
  scenarios: [SCENARIO],
  writeSafety: {
    completion: {
      kind: "receipt" as const,
      proofSchema: TERMINATION_PROOF,
      proofFromOutput: (output: z.output<typeof TERMINATION_PROOF>) => output,
      proofFromPresentProbe: ({ proof }: { proof: z.output<typeof TERMINATION_PROOF> }) => proof,
      outputFromProof: (proof: z.output<typeof TERMINATION_PROOF>) => proof,
    },
    idempotency: {
      probe: { taskId: TaskIdSchema.parse("ucpath/search-person-org"), effect: "read" as const },
      key: ({ eid }: { eid: string }) => `${eid}|termination`,
      recoveryAbsence: {
        kind: "stabilized" as const,
        minSinceFenceMs: 1_000,
        consistentReads: 2 as const,
        minBetweenReadsMs: 500,
        requireSameSourceState: true as const,
      },
    },
  },
  example: { transactionId: "T123" },
});

/* ── delegation targets and gate sources ─────────────────────────────────── */

const verifyChild: WorkflowRef<
  z.ZodObject<{ eid: typeof EidSchema }>,
  z.ZodObject<{ verified: z.ZodBoolean }>
> = {
  id: WorkflowIdSchema.parse("verify"),
  input: z.object({ eid: EidSchema }),
  result: z.object({ verified: z.boolean() }),
};

const signatureChild: WorkflowRef<
  z.ZodObject<{ documentId: z.ZodString }>,
  z.ZodObject<{ signedAt: z.ZodString }>
> = {
  id: WorkflowIdSchema.parse("oath-signature"),
  input: z.object({ documentId: z.string() }),
  result: z.object({ signedAt: z.string() }),
};

const POLICY: DelegationPolicy = {
  onChildFailed: "fail-parent",
  cascadeCancel: "cascade",
  afterChildRetry: "resume-parent",
  visibility: "inline",
};
const PARTIAL_POLICY: DelegationPolicy = { ...POLICY, onChildFailed: "allow-partial" };

const childItemId = (input: { eid: string }): ItemId =>
  ItemIdSchema.parse(`00000000-0000-4000-8000-${input.eid.padStart(12, "0")}`);
const documentItemId = (input: { documentId: string }): ItemId =>
  ItemIdSchema.parse(`00000000-0000-4000-8000-${input.documentId.padStart(12, "0")}`);

const CHILDREN_EVENT = z.object({ allSigned: z.boolean() });
const EXTERNAL_EVENT = z.object({ ticket: z.string() });

/* ── the representative graph (21 nodes) ─────────────────────────────────── */

const WORKFLOW_INPUT = z.strictObject({
  eid: EidSchema,
  effectiveDate: z.string(),
  mode: z.enum(["read-only", "terminate"]),
});

export const typeProofGraph = flow(WORKFLOW_INPUT)
  // 1 — a read whose bind sees only workflow input
  .step("search-person", searchPersonOrg, {
    dependsOn: [],
    bind: ({ input }) => ({ eid: input.eid }),
    replay: "checkpoint",
  })
  // 2 — a read that reads a declared upstream output
  .step("read-contact", readCrmContact, {
    dependsOn: ["search-person"],
    bind: ({ outputs }) => ({ eid: outputs["search-person"].eid }),
    replay: "checkpoint",
  })
  // 3 — a CONDITIONAL read; its downstream output type becomes `T | undefined`
  .step("list-documents", listDocuments, {
    dependsOn: ["search-person"],
    bind: ({ outputs }) => ({ eid: outputs["search-person"].eid }),
    when: { kind: "equals", of: { from: "input", path: "mode" }, value: "terminate" },
    replay: "always-rerun",
  })
  // 4 — a pure workflow mini-store step joining two upstream outputs
  .step("merge", mergeEnrichment, {
    dependsOn: ["search-person", "read-contact"],
    bind: ({ outputs }) => ({
      department: outputs["search-person"].department,
      email: outputs["read-contact"].email,
    }),
    replay: "checkpoint",
  })
  // 5 — fork/join. Branch members are the nodes the fork RUNS, so they are
  // declared after it; `build()` rejects a member that is not downstream.
  .parallel("enrichment-fan", [
    { id: "org", nodes: ["verify-one"] },
    { id: "contact", nodes: ["sign-many"] },
  ], { join: "all" })
  // 6 — output-dependent branch; both arms name downstream nodes
  .branch("mode-branch", {
    dependsOn: ["merge"],
    choose: ({ input }) => (input.mode === "terminate" ? "write" : "read-only"),
    cases: { write: ["approval"], "read-only": ["notify-many"] },
  })
  // 7 — one child run, awaited, cardinality one
  .childRun("verify-one", verifyChild, {
    dependsOn: ["search-person"],
    edgeId: DelegationEdgeIdSchema.parse("verify-one"),
    cardinality: "one",
    bind: ({ outputs }) => ({ eid: outputs["search-person"].eid }),
    deriveChildItemId: childItemId,
    await: "terminal",
    join: "one",
    policy: POLICY,
  })
  // 8 — many children, all-settled, partial failures visible to the parent
  .childRun("sign-many", signatureChild, {
    dependsOn: ["list-documents"],
    edgeId: DelegationEdgeIdSchema.parse("sign-many"),
    cardinality: "many",
    bind: ({ outputs }) => (outputs["list-documents"]?.documentIds ?? []).map((documentId) => ({ documentId })),
    deriveChildItemId: documentItemId,
    await: "terminal",
    join: "all-settled",
    policy: PARTIAL_POLICY,
  })
  // 9 — an un-awaited fan-out; the output is the manifest, never child outcomes
  .childRun("notify-many", signatureChild, {
    dependsOn: ["list-documents"],
    edgeId: DelegationEdgeIdSchema.parse("notify-many"),
    cardinality: "many",
    bind: ({ outputs }) => (outputs["list-documents"]?.documentIds ?? []).map((documentId) => ({ documentId })),
    deriveChildItemId: documentItemId,
    await: "none",
    join: "none",
    policy: POLICY,
  })
  // 10 — operator gate
  .gate("approval", {
    dependsOn: ["merge"],
    label: "Approve the termination",
    statusKey: "needsReview",
    resolvedBy: "operator",
    result: z.object({ approved: z.boolean(), note: z.string() }),
  })
  // 11 — children-terminal gate
  .gate("signatures-complete", {
    dependsOn: ["sign-many"],
    label: "All signatures collected",
    resolvedBy: "children-terminal",
    subscribes: {
      kind: "workflow",
      workflow: signatureChild,
      event: CHILDREN_EVENT,
      correlationKey: "documentId",
      terminal: ["done"],
    },
    result: z.object({ complete: z.boolean() }),
    resolve: (event: z.output<typeof CHILDREN_EVENT>) => ({ complete: event.allSigned }),
  })
  // 12 — external gate
  .gate("servicenow-ticket", {
    dependsOn: ["approval"],
    label: "ServiceNow ticket raised",
    resolvedBy: "external",
    subscribes: {
      kind: "external",
      sourceId: "servicenow",
      event: EXTERNAL_EVENT,
      correlationKey: "ticket",
    },
    result: z.object({ ticket: z.string() }),
    resolve: (event: z.output<typeof EXTERNAL_EVENT>) => ({ ticket: event.ticket }),
  })
  // 13 — the transaction pair; commit.bind sees no prepare output
  .transaction("terminate", {
    dependsOn: ["search-person", "approval"],
    prepare: {
      uses: fillTermination,
      bind: ({ input, outputs }) => ({
        eid: outputs["search-person"].eid,
        effectiveDate: input.effectiveDate,
      }),
    },
    commit: {
      uses: submitTermination,
      bind: ({ input, outputs }) => ({
        eid: outputs["search-person"].eid,
        effectiveDate: input.effectiveDate,
      }),
    },
    dryRun: "stop-after-prepare",
    probePolicy: "always",
    probeToFenceMaxMs: 30_000,
  })
  // 14-21 — depth past node 20, so a transform that decays late still fails here
  .step("recheck-1", searchPersonOrg, {
    dependsOn: ["terminate"],
    bind: ({ input }) => ({ eid: input.eid }),
    replay: "always-rerun",
  })
  .step("recheck-2", readCrmContact, {
    dependsOn: ["recheck-1"],
    bind: ({ outputs }) => ({ eid: outputs["recheck-1"].eid }),
    replay: "always-rerun",
  })
  .step("recheck-3", listDocuments, {
    dependsOn: ["recheck-1"],
    bind: ({ outputs }) => ({ eid: outputs["recheck-1"].eid }),
    replay: "always-rerun",
  })
  .step("recheck-4", mergeEnrichment, {
    dependsOn: ["recheck-1", "recheck-2"],
    bind: ({ outputs }) => ({
      department: outputs["recheck-1"].department,
      email: outputs["recheck-2"].email,
    }),
    replay: "checkpoint",
  })
  .branch("outcome-branch", {
    dependsOn: ["terminate", "recheck-4"],
    choose: ({ outputs }) =>
      (outputs.terminate.disposition === "committed" ? "committed" : "already-present"),
    cases: { committed: ["verify-after"], "already-present": ["final-signoff"] },
  })
  .childRun("verify-after", verifyChild, {
    dependsOn: ["recheck-1"],
    edgeId: DelegationEdgeIdSchema.parse("verify-after"),
    cardinality: "one",
    bind: ({ outputs }) => ({ eid: outputs["recheck-1"].eid }),
    deriveChildItemId: childItemId,
    await: "terminal",
    join: "one",
    policy: POLICY,
  })
  .gate("final-signoff", {
    dependsOn: ["outcome-branch"],
    label: "Operator sign-off",
    resolvedBy: "operator",
    result: z.object({ signedOff: z.boolean() }),
  })
  .step("final-read", searchPersonOrg, {
    dependsOn: ["final-signoff"],
    bind: ({ input }) => ({ eid: input.eid }),
    replay: "always-rerun",
  })
  .decorate("terminate", taskId("ucpath/submit-termination"), {
    after: (output) => {
      const proof: string = output.transactionId;
      void proof;
    },
  }, "audit-shot")
  .instrument({ onError: (error) => void error }, "span-hooks")
  .build({
    schema: z.object({
      eid: EidSchema,
      summary: z.string(),
      transactionId: z.string().nullable(),
      verified: z.boolean(),
    }),
    dependsOn: ["search-person", "merge", "terminate", "verify-one"],
    derive: ({ outputs }) => ({
      eid: outputs["search-person"].eid,
      summary: outputs.merge.summary,
      transactionId: outputs.terminate.output.transactionId,
      verified: outputs["verify-one"].state === "done" && outputs["verify-one"].output.verified,
    }),
  });

/* ── POSITIVE controls — every output stays concrete ─────────────────────── */

type Entries = typeof typeProofGraph extends { readonly result: { readonly dependsOn: infer _D } }
  ? true
  : never;
const entriesResolved: Entries = true;
void entriesResolved;

export function assertConcreteOutputs(
  outputs: OutputsOf<{
    readonly "search-person": NodeEntry<
      z.output<typeof searchPersonOrg.output>, false, readonly [typeof searchPersonOrg]
    >;
    readonly "list-documents": NodeEntry<
      z.output<typeof listDocuments.output>, true, readonly [typeof listDocuments]
    >;
    readonly terminate: NodeEntry<
      TypedTransactionOutcome<typeof submitTermination>, false, readonly []
    >;
    readonly "verify-one": NodeEntry<ChildRunOutcome<typeof verifyChild>, false, readonly []>;
    readonly "notify-many": NodeEntry<DelegationManifestRef, false, readonly []>;
  }>,
): void {
  // A concrete read output keeps its exact fields.
  const department: string = outputs["search-person"].department;
  void department;
  // A conditional output is `T | undefined` — never silently non-optional.
  const maybeDocs: readonly string[] | undefined = outputs["list-documents"]?.documentIds;
  void maybeDocs;
  // The transaction outcome is the kernel-owned discriminated union.
  const disposition: "committed" | "already-present" = outputs.terminate.disposition;
  void disposition;
  const transactionId: string = outputs.terminate.output.transactionId;
  void transactionId;
  // A child outcome narrows to its target's exact result schema.
  if (outputs["verify-one"].state === "done") {
    const verified: boolean = outputs["verify-one"].output.verified;
    void verified;
  }
  // An un-awaited fan-out is a manifest reference, not an outcome array.
  const childCount: number = outputs["notify-many"].childCount;
  void childCount;
}

/* ── NEGATIVE controls — each must keep failing ──────────────────────────── */

/*
 * Every expression below is deliberately ill-typed, so TypeScript gives it the
 * error type and the `no-unsafe-*` rules fire on the very thing the control is
 * asserting. The file contains no runtime behaviour — it is compiled, never run.
 */
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */

const negatives = flow(WORKFLOW_INPUT)
  .step("search-person", searchPersonOrg, {
    dependsOn: [],
    bind: ({ input }) => ({ eid: input.eid }),
    replay: "checkpoint",
  })
  .step("read-contact", readCrmContact, {
    dependsOn: ["search-person"],
    bind: ({ outputs }) => ({ eid: outputs["search-person"].eid }),
    replay: "checkpoint",
  })
  .step("list-documents", listDocuments, {
    dependsOn: ["search-person"],
    bind: ({ outputs }) => ({ eid: outputs["search-person"].eid }),
    when: { kind: "equals", of: { from: "input", path: "mode" }, value: "terminate" },
    replay: "always-rerun",
  })
  .childRun("verify-one", verifyChild, {
    dependsOn: ["search-person"],
    edgeId: DelegationEdgeIdSchema.parse("verify-one"),
    cardinality: "one",
    bind: ({ outputs }) => ({ eid: outputs["search-person"].eid }),
    deriveChildItemId: childItemId,
    await: "terminal",
    join: "one",
    policy: POLICY,
  })
  .gate("approval", {
    dependsOn: ["read-contact"],
    label: "Approve",
    resolvedBy: "operator",
    result: z.object({ approved: z.boolean() }),
  });

negatives.step("undeclared-read", readCrmContact, {
  dependsOn: ["search-person"],
  // @ts-expect-error a bind may not read an output it did not declare in dependsOn
  bind: ({ outputs }) => ({ eid: outputs["read-contact"].eid }),
  replay: "checkpoint",
});

negatives.step("wrong-bind-shape", readCrmContact, {
  dependsOn: ["search-person"],
  // @ts-expect-error bind must return exactly z.input of the contract's input schema
  bind: ({ outputs }) => ({ employeeId: outputs["search-person"].eid }),
  replay: "checkpoint",
});

negatives.step("renamed-field", mergeEnrichment, {
  dependsOn: ["search-person", "read-contact"],
  // @ts-expect-error renaming a producer's output field breaks every consumer
  bind: ({ outputs }) => ({ department: outputs["search-person"].dept, email: "x" }),
  replay: "checkpoint",
});

// @ts-expect-error replay is required — there is no default resume policy
negatives.step("missing-replay", readCrmContact, {
  dependsOn: ["search-person"],
  bind: ({ outputs }) => ({ eid: outputs["search-person"].eid }),
});

negatives.step("unknown-dependency", readCrmContact, {
  // @ts-expect-error dependsOn may only name nodes already in the accumulator
  dependsOn: ["not-a-node"],
  bind: ({ input }) => ({ eid: input.eid }),
  replay: "checkpoint",
});

negatives.step("conditional-not-optional", mergeEnrichment, {
  dependsOn: ["list-documents", "read-contact"],
  // @ts-expect-error a conditional output is `T | undefined` and cannot be read directly
  bind: ({ outputs }) => ({ department: outputs["list-documents"].documentIds[0], email: "x" }),
  replay: "checkpoint",
});

// @ts-expect-error a prepare contract cannot be a standalone step
negatives.step("prepare-as-step", fillTermination, {
  dependsOn: [],
  bind: ({ input }) => ({ eid: input.eid, effectiveDate: input.effectiveDate }),
  replay: "checkpoint",
});

// @ts-expect-error a commit contract cannot be a standalone step
negatives.step("commit-as-step", submitTermination, {
  dependsOn: [],
  bind: ({ input }) => ({ eid: input.eid, effectiveDate: input.effectiveDate }),
  replay: "checkpoint",
});

negatives.transaction("swapped-pair", {
  dependsOn: [],
  // @ts-expect-error prepare must be a prepare contract, not a commit contract
  prepare: { uses: submitTermination, bind: ({ input }) => ({ eid: input.eid, effectiveDate: input.effectiveDate }) },
  commit: { uses: submitTermination, bind: ({ input }) => ({ eid: input.eid, effectiveDate: input.effectiveDate }) },
  dryRun: "stop-after-prepare",
  probePolicy: "always",
  probeToFenceMaxMs: 30_000,
});

// @ts-expect-error a cardinality:"one" child binds a single input, not an array
negatives.childRun("one-returning-array", verifyChild, {
  dependsOn: ["search-person"],
  edgeId: DelegationEdgeIdSchema.parse("one-returning-array"),
  cardinality: "one",
  bind: ({ outputs }) => [{ eid: outputs["search-person"].eid }],
  deriveChildItemId: childItemId,
  await: "terminal",
  join: "one",
  policy: POLICY,
});

negatives.childRun("wrong-child-input", signatureChild, {
  dependsOn: ["search-person"],
  edgeId: DelegationEdgeIdSchema.parse("wrong-child-input"),
  cardinality: "one",
  // @ts-expect-error the child's own input schema governs the binding
  bind: ({ outputs }) => ({ eid: outputs["search-person"].eid }),
  deriveChildItemId: documentItemId,
  await: "terminal",
  join: "one",
  policy: POLICY,
});

negatives.gate("operator-with-source", {
  dependsOn: ["read-contact"],
  label: "Approve",
  resolvedBy: "operator",
  result: z.object({ approved: z.boolean() }),
  // @ts-expect-error an operator gate has no event source to subscribe to
  subscribes: { kind: "external", sourceId: "x", event: EXTERNAL_EVENT, correlationKey: "ticket" },
});

negatives.decorate(
  "approval",
  // @ts-expect-error a gate owns no task contract, so nothing can decorate it
  taskId("ucpath/search-person-org"),
  {},
  "invalid",
);

negatives.decorate(
  "search-person",
  // @ts-expect-error decoration must name a contract THIS node owns
  taskId("crm/read-contact"),
  {},
  "invalid",
);

negatives.build({
  schema: z.object({ eid: EidSchema }),
  dependsOn: ["search-person"],
  // @ts-expect-error derive may only read the terminal dependencies it declared
  derive: ({ outputs }) => ({ eid: outputs["read-contact"].email }),
});

negatives.build({
  schema: z.object({ eid: EidSchema, extra: z.string() }),
  dependsOn: ["search-person"],
  // @ts-expect-error derive must return exactly z.input of the result schema
  derive: ({ outputs }) => ({ eid: outputs["search-person"].eid }),
});

/* ── node fragments (D265 §1.2.2 rule 2) ─────────────────────────────────── */

const readContactFragment = defineTaskNode("read-contact", readCrmContact, {
  label: "Read contact",
  replay: "checkpoint",
});
const approvalFragment = defineOperatorGateNode("approval", {
  label: "Approve",
  result: z.object({ approved: z.boolean() }),
});
const terminationFragment = defineTransactionNode("terminate", {
  label: "Terminate",
  prepare: fillTermination,
  commit: submitTermination,
  dryRun: "stop-after-prepare",
  probePolicy: "always",
  probeToFenceMaxMs: 30_000,
});

// A fragment applied through `.pipe` keeps the builder's accumulated generics:
// the wiring's bind sees exactly the declared upstream scope, and the nodes
// appended after the fragment can read the fragment's own output.
const piped = flow(WORKFLOW_INPUT)
  .step("search-person", searchPersonOrg, {
    dependsOn: [],
    bind: ({ input }) => ({ eid: input.eid }),
    replay: "checkpoint",
  })
  .pipe(readContactFragment.wire({
    dependsOn: ["search-person"],
    bind: ({ outputs }) => ({ eid: outputs["search-person"].eid }),
  }))
  .pipe(approvalFragment.wire({ dependsOn: ["read-contact"] }))
  .pipe(terminationFragment.wire({
    dependsOn: ["approval", "search-person", "read-contact"],
    prepare: ({ outputs }) => ({
      eid: outputs["search-person"].eid,
      effectiveDate: outputs.approval.approved ? outputs["read-contact"].email : "never",
    }),
    commit: ({ outputs }) => ({
      eid: outputs["search-person"].eid,
      effectiveDate: outputs.approval.approved ? outputs["read-contact"].email : "never",
    }),
  }));

const pipedNodes: readonly [
  TaskStepNode<never, typeof searchPersonOrg>,
  TaskStepNode<never, typeof readCrmContact>,
  OperatorGateNode<z.ZodObject<{ approved: z.ZodBoolean }>>,
  TransactionNode<never, typeof fillTermination, typeof submitTermination>,
] = piped.build({
  schema: z.object({ eid: EidSchema, email: z.string() }),
  dependsOn: ["terminate", "read-contact"],
  derive: ({ outputs }) => ({ eid: outputs.terminate.output.transactionId, email: outputs["read-contact"].email }),
}).nodes;
void pipedNodes;

negatives.pipe(readContactFragment.wire({
  dependsOn: ["search-person"],
  // @ts-expect-error a fragment's bind may not read an output it did not declare in dependsOn
  bind: ({ outputs }) => ({ eid: outputs["list-documents"].eid }),
}));

negatives.pipe(readContactFragment.wire({
  dependsOn: ["search-person"],
  // @ts-expect-error a fragment's bind must return exactly z.input of the fragment's contract
  bind: ({ outputs }) => ({ wrong: outputs["search-person"].eid }),
}));

negatives.pipe(approvalFragment.wire({
  // @ts-expect-error a fragment's dependsOn may only name declared upstream nodes
  dependsOn: ["nowhere"],
}));
