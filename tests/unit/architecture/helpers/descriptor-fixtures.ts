/**
 * A representative fixture descriptor for the graph-shaped guards.
 *
 * The registered corpus is deliberately thin in 1e — person-lookup is four read
 * steps — so a guard that only swept `DESCRIPTORS` would pass by having nothing
 * to check. Every graph-shaped guard therefore also runs against this fixture,
 * which carries a branch, a parallel, an operator gate, an awaited many-child
 * delegation, and a transaction: exactly the paths those guards exist to
 * police. `guard-manifest` already applies this rule to the mechanical ratchets;
 * this is the same idea for the descriptor guards.
 */
import { z } from "zod";
import { flow } from "../../../../src/base/flow.js";
import { defineWorkflowDescriptor } from "../../../../src/base/workflow.js";
import { defineTaskContract } from "../../../../src/domain/contracts/base.js";
import { ContractFieldPathSchema } from "../../../../src/domain/contracts/base.js";
import type { ItemId } from "../../../../src/domain/ids.js";
import {
  DelegationEdgeIdSchema,
  EidSchema,
  FingerprintSchema,
  ItemIdSchema,
  ObservationIdSchema,
  ScenarioIdSchema,
  TaskIdSchema,
  WorkflowIdSchema,
} from "../../../../src/domain/ids.js";
import { defineCanonicalInput } from "../../../../src/domain/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/domain/workflow/presentation.js";

const OBSERVATION = ObservationIdSchema.parse("ucpath.person-org.displayed-eid");
const SCENARIO = ScenarioIdSchema.parse("ucpath/person-org-happy");
const PROBE = { taskId: TaskIdSchema.parse("ucpath/read-termination-receipt"), effect: "read" as const };

const SubjectInput = z.strictObject({ eid: EidSchema });
const ProofSchema = z.strictObject({ transactionId: z.string().min(1) });

function personSubject(requiredAt: "before-subject-read" | "after-prepare-before-fence") {
  return {
    kind: "person" as const,
    expected: { fromInput: ContractFieldPathSchema.parse("eid"), identity: "eid" as const },
    observe: OBSERVATION,
    match: "normalized-exact-eid" as const,
    requiredAt,
  };
}

export const FixtureReadReceipt = defineTaskContract({
  id: TaskIdSchema.parse("ucpath/read-termination-receipt"),
  title: "Read Termination Receipt",
  effect: "read" as const,
  input: SubjectInput,
  output: z.strictObject({ eid: EidSchema, present: z.boolean() }),
  errorCodes: ["unexpected-page-state"] as const,
  subject: personSubject("before-subject-read"),
  scenarios: [SCENARIO],
  freshness: { defaultMaxAgeMs: 60_000, defaultOverride: "forbidden" as const },
  provenance: { default: "live" as const },
  example: { eid: "10800000", present: true },
});

export const FixtureStage = defineTaskContract({
  id: TaskIdSchema.parse("ucpath/fill-termination"),
  title: "Fill Termination",
  effect: "prepare" as const,
  input: SubjectInput,
  output: z.strictObject({ staged: z.literal(true) }),
  errorCodes: ["unexpected-page-state"] as const,
  subject: personSubject("after-prepare-before-fence"),
  scenarios: [SCENARIO],
  checkpoint: "in-memory-only" as const,
  example: { staged: true as const },
});

export const FixtureCommit = defineTaskContract({
  id: TaskIdSchema.parse("ucpath/submit-termination"),
  title: "Submit Termination",
  effect: "commit" as const,
  input: SubjectInput,
  output: ProofSchema,
  errorCodes: ["submit-failed", "wrong-subject"] as const,
  subject: personSubject("after-prepare-before-fence"),
  scenarios: [SCENARIO],
  writeSafety: {
    completion: {
      kind: "receipt" as const,
      proofSchema: ProofSchema,
      proofFromOutput: (output: z.output<typeof ProofSchema>) => output,
      proofFromPresentProbe: ({ proof }: { proof: z.output<typeof ProofSchema> }) => proof,
      outputFromProof: (proof: z.output<typeof ProofSchema>) => proof,
    },
    idempotency: {
      probe: PROBE,
      key: ({ eid }: z.output<typeof SubjectInput>) => `${eid}|termination`,
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

export const FixtureChildInput = z.strictObject({ eid: EidSchema, note: z.string().min(1) });
export const FixtureChildResult = z.strictObject({ acknowledged: z.boolean() });
export const FixtureChildWorkflow = Object.freeze({
  id: WorkflowIdSchema.parse("fixture-child"),
  input: FixtureChildInput,
  result: FixtureChildResult,
});

const FixtureInput = z.strictObject({
  eid: EidSchema,
  mode: z.enum(["read-only", "write"]),
  notes: z.array(z.string().min(1)).default([]),
});

const FixtureCanonicalInput = defineCanonicalInput(
  FixtureInput,
  z.strictObject({
    eid: EidSchema,
    mode: z.enum(["read-only", "write"]),
    notes: z.array(z.string().min(1)),
  }),
  [{ eid: "10800000", mode: "write" }, { eid: "10800001", mode: "read-only", notes: ["a"] }],
);

/** Derived per child, from the note — never an array index or a run id. */
export function fixtureChildItemId(input: { readonly note: string }): ItemId {
  const suffix = [...input.note]
    .map((character) => character.codePointAt(0)?.toString(16) ?? "0")
    .join("")
    .padStart(12, "0")
    .slice(-12);
  return ItemIdSchema.parse(`00000000-0000-4000-8000-${suffix}`);
}

const fixtureFlow = flow(FixtureInput)
  .step("probe", FixtureReadReceipt, {
    dependsOn: [],
    replay: "checkpoint",
    bind: ({ input }) => ({ eid: input.eid }),
  })
  .branch("mode-branch", {
    dependsOn: ["probe"],
    choose: ({ input }) => input.mode,
    cases: { "read-only": ["recheck"], write: ["submit"] },
  })
  .step("recheck", FixtureReadReceipt, {
    dependsOn: ["mode-branch"],
    replay: "always-rerun",
    bind: ({ outputs }) => ({ eid: outputs["mode-branch"].selected === "write" ? "10800000" : "10800001" }),
  })
  .gate("approval", {
    dependsOn: ["mode-branch"],
    label: "Approval",
    statusKey: "needsReview",
    resolvedBy: "operator",
    result: z.strictObject({ approved: z.boolean() }),
  })
  .parallel("fan", [
    { id: "left", nodes: ["notify"] },
    { id: "right", nodes: ["submit"] },
  ], { join: "all" })
  .childRun("notify", FixtureChildWorkflow, {
    dependsOn: ["approval"],
    edgeId: DelegationEdgeIdSchema.parse("notify-many"),
    cardinality: "many",
    bind: ({ input }) => input.notes.map((note) => ({ eid: input.eid, note })),
    deriveChildItemId: fixtureChildItemId,
    await: "terminal",
    join: "all-settled",
    policy: {
      onChildFailed: "allow-partial",
      cascadeCancel: "cascade",
      afterChildRetry: "resume-parent",
      visibility: "inline",
    },
  })
  .transaction("submit", {
    dependsOn: ["approval"],
    prepare: { uses: FixtureStage, bind: ({ input }) => ({ eid: input.eid }) },
    commit: { uses: FixtureCommit, bind: ({ input }) => ({ eid: input.eid }) },
    dryRun: "stop-after-prepare",
    probePolicy: "always",
    probeToFenceMaxMs: 30_000,
  })
  .build({
    schema: z.strictObject({ transactionId: z.string().min(1) }),
    dependsOn: ["submit"],
    derive: ({ outputs }) => ({ transactionId: outputs.submit.output.transactionId }),
  });

export const fixtureDescriptor = defineWorkflowDescriptor({
  id: "fixture-graph",
  version: 1,
  contractFingerprint: FingerprintSchema.parse("f".repeat(64)),
  code: "fx",
  label: "Fixture Graph",
  icon: "ShieldCheck",
  category: "operations",
  canonicalInput: FixtureCanonicalInput,
  inputSubject: "eid",
  surface: { shape: "single" },
  enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: {},
  details: [],
  identity: { matchKey: (input) => `eid:${input.eid}` },
  presentation: { title: (input) => `Fixture ${input.eid}` },
  scenarios: ["fixture-graph/happy"],
  flow: fixtureFlow,
});
