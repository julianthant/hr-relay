import assert_m1 from "node:assert/strict";
import { describe as describe_m0,describe as describe_m1,expect as expect_m0,it as it_m0,it as it_m1 } from "vitest";
import { z as z_m1 } from "zod";
import { ContractFieldPathSchema as ContractFieldPathSchema_m1,defineTaskContract as defineTaskContract_m1 } from "../../../src/models/task/task-contract.js";
import { deriveSchemaHash as deriveSchemaHash_m0 } from "../../../src/models/validation/schema-bound-value.js";
import type {
BranchNode as BranchNode_m1,
ChildRunNode as ChildRunNode_m1,
DelegationPolicy as DelegationPolicy_m1,
GraphNodeBase as GraphNodeBase_m1,
ParallelNode as ParallelNode_m1,
RuntimeScope as RuntimeScope_m1,
TransactionNode as TransactionNode_m1,
WorkflowRef as WorkflowRef_m1
} from "../../../src/models/workflow/graph.js";
import { projectTransactionOutcome as projectTransactionOutcome_m0 } from "../../../src/models/workflow/graph.js";
import type { ItemId as ItemId_m1,NodeId as NodeId_m1 } from "../../../src/rules/identity/ids.js";
import {
DelegationEdgeIdSchema as DelegationEdgeIdSchema_m1,
EidSchema as EidSchema_m1,
ItemIdSchema as ItemIdSchema_m1,
ObservationIdSchema as ObservationIdSchema_m1,
ScenarioIdSchema as ScenarioIdSchema_m1,
TaskIdSchema as TaskIdSchema_m1,
WorkflowIdSchema as WorkflowIdSchema_m1,
taskId as taskId_m1
} from "../../../src/rules/identity/ids.js";
import {
TransactionOutcomeSchema as TransactionOutcomeSchema_m0,
type TransactionOutcome as TransactionOutcome_m0
} from "../../../src/rules/write-safety/write-safety-primitives.js";
import { flow as flow_m1 } from "../../../src/workflow-kit/flow.js";
import {
WriteFixtureCommit as WriteFixtureCommit_m0,
WriteFixtureProofSchema as WriteFixtureProofSchema_m0
} from "../../support/fixtures/write-sequencer-fixtures.js";


{


const OUTPUT_SCHEMA_HASH = deriveSchemaHash_m0(WriteFixtureCommit_m0.output, "output");
const PROOF_SCHEMA_HASH = deriveSchemaHash_m0(WriteFixtureProofSchema_m0, "output");
const OTHER_SCHEMA_HASH = "a".repeat(64);

function storedOutcome(
  overrides: Readonly<{
    disposition?: TransactionOutcome_m0["disposition"];
    proofSource?: TransactionOutcome_m0["proofSource"];
    outputSchemaHash?: string;
    output?: unknown;
    proofSchemaHash?: string;
    proof?: unknown;
  }> = {},
): TransactionOutcome_m0 {
  return TransactionOutcomeSchema_m0.parse({
    disposition: overrides.disposition ?? "committed",
    proofSource: overrides.proofSource ?? "normal-output",
    output: {
      schemaHash: overrides.outputSchemaHash ?? OUTPUT_SCHEMA_HASH,
      value: overrides.output ?? { transactionId: "T123456" },
    },
    proof: {
      schemaHash: overrides.proofSchemaHash ?? PROOF_SCHEMA_HASH,
      value: overrides.proof ?? { transactionId: "T123456" },
    },
    ...((overrides.disposition ?? "committed") === "committed"
      ? { confirmedAt: "2026-08-04T18:00:00.000Z" }
      : { observedAt: "2026-08-04T17:59:00.000Z" }),
  });
}

describe_m0("transaction outcome graph projection", () => {
  it_m0("projects a schema-bound committed outcome without defaulting or re-deriving its fields", () => {
    expect_m0(projectTransactionOutcome_m0(
      WriteFixtureCommit_m0,
      storedOutcome({
        output: { transactionId: "T654321" },
        proof: { transactionId: "T456789" },
      }),
      "fixture transaction",
    )).toEqual({
      disposition: "committed",
      proofSource: "normal-output",
      output: { transactionId: "T654321" },
      proof: { transactionId: "T456789" },
    });
  });

  it_m0("preserves the already-present disposition and live-probe proof source", () => {
    expect_m0(projectTransactionOutcome_m0(
      WriteFixtureCommit_m0,
      storedOutcome({ disposition: "already-present", proofSource: "live-probe" }),
      "fixture transaction",
    )).toEqual({
      disposition: "already-present",
      proofSource: "live-probe",
      output: { transactionId: "T123456" },
      proof: { transactionId: "T123456" },
    });
  });

  it_m0("refuses an outcome bound to a different commit-output schema before parsing its value", () => {
    expect_m0(() => projectTransactionOutcome_m0(
      WriteFixtureCommit_m0,
      storedOutcome({ outputSchemaHash: OTHER_SCHEMA_HASH, output: { transactionId: "not-a-transaction" } }),
      "fixture transaction",
    )).toThrow(
      `fixture transaction: stored transaction outcome binds commit output schema ${OTHER_SCHEMA_HASH}, `
      + `and ucpath/submit-write-fixture now declares ${OUTPUT_SCHEMA_HASH}`,
    );
  });

  it_m0("refuses an outcome bound to a different completion-proof schema before parsing its proof", () => {
    expect_m0(() => projectTransactionOutcome_m0(
      WriteFixtureCommit_m0,
      storedOutcome({ proofSchemaHash: OTHER_SCHEMA_HASH, proof: { transactionId: "not-a-transaction" } }),
      "fixture transaction",
    )).toThrow(
      `fixture transaction: stored transaction outcome binds completion proof schema ${OTHER_SCHEMA_HASH}, `
      + `and ucpath/submit-write-fixture now declares ${PROOF_SCHEMA_HASH}`,
    );
  });

  it_m0("refuses malformed output and proof values even when their stored schema hashes match", () => {
    expect_m0(() => projectTransactionOutcome_m0(
      WriteFixtureCommit_m0,
      storedOutcome({ output: { transactionId: "not-a-transaction" } }),
      "fixture transaction output",
    )).toThrow(/transactionId/u);

    expect_m0(() => projectTransactionOutcome_m0(
      WriteFixtureCommit_m0,
      storedOutcome({ proof: { transactionId: "not-a-transaction" } }),
      "fixture transaction proof",
    )).toThrow(/transactionId/u);
  });
});
}

{


const SCENARIO = ScenarioIdSchema_m1.parse("workflow/builder-runtime");
const INPUT = z_m1.strictObject({ eid: EidSchema_m1 });

const readOne = defineTaskContract_m1({
  id: taskId_m1("ucpath/search-person-org"),
  title: "Search Person Org",
  effect: "read",
  input: INPUT,
  output: z_m1.strictObject({ eid: EidSchema_m1 }),
  errorCodes: ["eid-not-found"] as const,
  subject: {
    kind: "person",
    expected: { fromInput: ContractFieldPathSchema_m1.parse("eid"), identity: "eid" },
    observe: ObservationIdSchema_m1.parse("ucpath.person-org.displayed-eid"),
    match: "normalized-exact-eid",
    requiredAt: "before-subject-read",
  },
  scenarios: [SCENARIO],
  freshness: { defaultMaxAgeMs: 0 },
  provenance: { default: "live" },
  example: { eid: "10800000" },
});

const readTwo = defineTaskContract_m1({
  id: taskId_m1("crm/read-contact"),
  title: "Read CRM contact",
  effect: "read",
  input: INPUT,
  output: z_m1.strictObject({ eid: EidSchema_m1 }),
  errorCodes: ["contact-missing"] as const,
  subject: { kind: "none", reason: "keyed by EID" },
  scenarios: [SCENARIO],
  freshness: { defaultMaxAgeMs: 0 },
  provenance: { default: "live" },
  example: { eid: "10800000" },
});

const preparePair = defineTaskContract_m1({
  id: taskId_m1("ucpath/fill-termination"),
  title: "Fill termination",
  effect: "prepare",
  input: INPUT,
  output: z_m1.strictObject({ stagedRows: z_m1.number().int() }),
  errorCodes: ["fill-failed"] as const,
  subject: { kind: "none", reason: "prepare fixture" },
  scenarios: [SCENARIO],
  checkpoint: "in-memory-only",
  example: { stagedRows: 1 },
});

const PROOF = z_m1.strictObject({ transactionId: z_m1.string() });
const commitPair = defineTaskContract_m1({
  id: taskId_m1("ucpath/submit-termination"),
  title: "Submit termination",
  effect: "commit",
  input: INPUT,
  output: PROOF,
  errorCodes: ["submit-failed"] as const,
  subject: {
    kind: "person",
    expected: { fromInput: ContractFieldPathSchema_m1.parse("eid"), identity: "eid" },
    observe: ObservationIdSchema_m1.parse("ucpath.person-org.displayed-eid"),
    match: "normalized-exact-eid",
    requiredAt: "after-prepare-before-fence",
  },
  scenarios: [SCENARIO],
  writeSafety: {
    completion: {
      kind: "receipt" as const,
      proofSchema: PROOF,
      proofFromOutput: (output: z_m1.output<typeof PROOF>) => output,
      proofFromPresentProbe: ({ proof }: { proof: z_m1.output<typeof PROOF> }) => proof,
      outputFromProof: (proof: z_m1.output<typeof PROOF>) => proof,
    },
    idempotency: {
      probe: { taskId: TaskIdSchema_m1.parse("ucpath/search-person-org"), effect: "read" as const },
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
  example: { transactionId: "T1" },
});

const childTarget: WorkflowRef_m1<typeof INPUT, z_m1.ZodObject<{ verified: z_m1.ZodBoolean }>> = {
  id: WorkflowIdSchema_m1.parse("verify"),
  input: INPUT,
  result: z_m1.object({ verified: z_m1.boolean() }),
};
const POLICY: DelegationPolicy_m1 = {
  onChildFailed: "fail-parent",
  cascadeCancel: "cascade",
  afterChildRetry: "resume-parent",
  visibility: "inline",
};
const childItemId = (): ItemId_m1 => ItemIdSchema_m1.parse("00000000-0000-4000-8000-000000000001");

function base() {
  return flow_m1(INPUT).step("search", readOne, {
    dependsOn: [],
    bind: ({ input }) => ({ eid: input.eid }),
    replay: "checkpoint",
  });
}

function nodeById(nodes: readonly GraphNodeBase_m1[], id: string): GraphNodeBase_m1 {
  const found = nodes.find((node) => node.id === id);
  assert_m1.ok(found, `expected node ${id}`);
  return found;
}

describe_m1("workflow flow builder", () => {

  it_m1("pins the transaction node's kernel-owned lease scope and budget", () => {
    const built = base()
      .transaction("terminate", {
        dependsOn: ["search"],
        prepare: { uses: preparePair, bind: ({ outputs }) => ({ eid: outputs.search.eid }) },
        commit: { uses: commitPair, bind: ({ outputs }) => ({ eid: outputs.search.eid }) },
        dryRun: "stop-after-prepare",
        probePolicy: "always",
        probeToFenceMaxMs: 30_000,
      })
      .build({
        schema: z_m1.object({ id: z_m1.string() }),
        dependsOn: ["terminate"],
        derive: ({ outputs }) => ({ id: outputs.terminate.output.transactionId }),
      });
    const node = nodeById(built.nodes, "terminate") as TransactionNode_m1<
      RuntimeScope_m1, typeof preparePair, typeof commitPair
    >;
    assert_m1.equal(node.leaseScope, "transaction");
    assert_m1.equal(node.prepare.uses.id, "ucpath/fill-termination");
    assert_m1.equal(node.commit.uses.id, "ucpath/submit-termination");
    assert_m1.equal(node.probeToFenceMaxMs, 30_000);
  });

  it_m1("brands branch case targets, requires a real choice, and rejects an upstream arm", () => {
    const built = base()
      .branch("pick", {
        dependsOn: ["search"],
        choose: ({ outputs }) => (outputs.search.eid === "10800000" ? "left" : "right"),
        cases: { left: ["contact"], right: ["other"] },
      })
      .step("contact", readTwo, {
        dependsOn: ["pick"],
        bind: ({ outputs }) => ({ eid: outputs.pick.selected === "left" ? "10800000" : "10800001" }),
        replay: "checkpoint",
      })
      .step("other", readTwo, {
        dependsOn: ["pick"],
        bind: () => ({ eid: "10800001" }),
        replay: "checkpoint",
      })
      .build({
        schema: z_m1.object({ selected: z_m1.string() }),
        dependsOn: ["pick"],
        derive: ({ outputs }) => ({ selected: outputs.pick.selected }),
      });
    const node = nodeById(built.nodes, "pick") as BranchNode_m1<
      RuntimeScope_m1, Readonly<Record<string, readonly NodeId_m1[]>>
    >;
    assert_m1.deepEqual(node.cases, { left: ["contact"], right: ["other"] });
    assert_m1.throws(
      () => base().branch("pick", {
        dependsOn: ["search"],
        choose: () => "only",
        cases: { only: ["search"] },
      }),
      /requires at least two cases/,
    );
    // A case naming an UPSTREAM node would make the graph cyclic. The targets
    // do not exist when the branch is pushed, so only build() can catch it.
    assert_m1.throws(
      () => base()
        .branch("pick", {
          dependsOn: ["search"],
          choose: () => "left",
          cases: { left: ["search"], right: ["search"] },
        })
        .build({
          schema: z_m1.object({ selected: z_m1.string() }),
          dependsOn: ["pick"],
          derive: ({ outputs }) => ({ selected: outputs.pick.selected }),
        }),
      /targets search, which is not downstream/,
    );
  });

  it_m1("records the full delegation policy on a child-run node", () => {
    const built = base()
      .childRun("verify", childTarget, {
        dependsOn: ["search"],
        edgeId: DelegationEdgeIdSchema_m1.parse("verify"),
        cardinality: "one",
        bind: ({ outputs }) => ({ eid: outputs.search.eid }),
        deriveChildItemId: childItemId,
        await: "terminal",
        join: "one",
        policy: POLICY,
      })
      .build({
        schema: z_m1.object({ ok: z_m1.boolean() }),
        dependsOn: ["verify"],
        derive: ({ outputs }) => ({ ok: outputs.verify.state === "done" }),
      });
    const node = nodeById(built.nodes, "verify") as ChildRunNode_m1<RuntimeScope_m1, typeof childTarget>;
    assert_m1.equal(node.edgeId, "verify");
    assert_m1.deepEqual(node.policy, POLICY);
    assert_m1.equal(node.target.id, "verify");
  });

  it_m1("keeps a parallel node's branch node lists branded and frozen", () => {
    const built = base()
      .step("contact", readTwo, {
        dependsOn: ["search"],
        bind: ({ outputs }) => ({ eid: outputs.search.eid }),
        replay: "checkpoint",
      })
      .parallel("fan", [
        { id: "org", nodes: ["left-arm"] },
        { id: "contact", nodes: ["right-arm"] },
      ], { join: "all-settled" })
      .step("left-arm", readTwo, {
        dependsOn: ["contact"],
        bind: ({ outputs }) => ({ eid: outputs.contact.eid }),
        replay: "checkpoint",
      })
      .step("right-arm", readTwo, {
        dependsOn: ["contact"],
        bind: ({ outputs }) => ({ eid: outputs.contact.eid }),
        replay: "checkpoint",
      })
      .build({
        schema: z_m1.object({ join: z_m1.string() }),
        dependsOn: ["fan"],
        derive: ({ outputs }) => ({ join: outputs.fan.join }),
      });
    const node = nodeById(built.nodes, "fan") as ParallelNode_m1;
    assert_m1.equal(node.join, "all-settled");
    assert_m1.deepEqual(node.branches.map((branch) => branch.id), ["org", "contact"]);
    assert_m1.equal(Object.isFrozen(node.branches), true);
  });
});
}
