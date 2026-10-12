import { createFlowTaskFixtures } from "../../support/helpers/workflow/flow-task-fixtures.js";
import { default as assert } from "node:assert/strict";
import { describe } from "vitest";
import { expect } from "vitest";
import { it } from "vitest";
import { z } from "zod";


import { deriveSchemaHash } from "../../../src/models/validation/schema-bound-value.js";
import type { BranchNode } from "../../../src/models/workflow/graph.js";
import type { ChildRunNode } from "../../../src/models/workflow/graph.js";
import type { DelegationPolicy } from "../../../src/models/workflow/graph.js";
import type { GraphNodeBase } from "../../../src/models/workflow/graph.js";
import type { ParallelNode } from "../../../src/models/workflow/graph.js";
import type { RuntimeScope } from "../../../src/models/workflow/graph.js";
import type { TransactionNode } from "../../../src/models/workflow/graph.js";
import type { WorkflowRef } from "../../../src/models/workflow/graph.js";
import { projectTransactionOutcome } from "../../../src/models/workflow/graph.js";
import type { ItemId } from "../../../src/rules/identity/ids.js";
import type { NodeId } from "../../../src/rules/identity/ids.js";
import { DelegationEdgeIdSchema } from "../../../src/rules/identity/ids.js";

import { ItemIdSchema } from "../../../src/rules/identity/ids.js";

import { ScenarioIdSchema } from "../../../src/rules/identity/ids.js";

import { WorkflowIdSchema } from "../../../src/rules/identity/ids.js";

import { TransactionOutcomeSchema } from "../../../src/rules/write-safety/write-safety-primitives.js";
import type { TransactionOutcome } from "../../../src/rules/write-safety/write-safety-primitives.js";
import { flow } from "../../../src/workflow-kit/flow.js";
import { WriteFixtureCommit } from "../../support/fixtures/write-sequencer-fixtures.js";
import { WriteFixtureProofSchema } from "../../support/fixtures/write-sequencer-fixtures.js";

{

const OUTPUT_SCHEMA_HASH = deriveSchemaHash(WriteFixtureCommit.output, "output");
const PROOF_SCHEMA_HASH = deriveSchemaHash(WriteFixtureProofSchema, "output");
const OTHER_SCHEMA_HASH = "a".repeat(64);

function storedOutcome(
  overrides: Readonly<{
    disposition?: TransactionOutcome["disposition"];
    proofSource?: TransactionOutcome["proofSource"];
    outputSchemaHash?: string;
    output?: unknown;
    proofSchemaHash?: string;
    proof?: unknown;
  }> = {},
): TransactionOutcome {
  return TransactionOutcomeSchema.parse({
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

describe("transaction outcome graph projection", () => {
  it("projects a schema-bound committed outcome without defaulting or re-deriving its fields", () => {
    expect(projectTransactionOutcome(
      WriteFixtureCommit,
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

  it("preserves the already-present disposition and live-probe proof source", () => {
    expect(projectTransactionOutcome(
      WriteFixtureCommit,
      storedOutcome({ disposition: "already-present", proofSource: "live-probe" }),
      "fixture transaction",
    )).toEqual({
      disposition: "already-present",
      proofSource: "live-probe",
      output: { transactionId: "T123456" },
      proof: { transactionId: "T123456" },
    });
  });

  it("refuses an outcome bound to a different commit-output schema before parsing its value", () => {
    expect(() => projectTransactionOutcome(
      WriteFixtureCommit,
      storedOutcome({ outputSchemaHash: OTHER_SCHEMA_HASH, output: { transactionId: "not-a-transaction" } }),
      "fixture transaction",
    )).toThrow(
      `fixture transaction: stored transaction outcome binds commit output schema ${OTHER_SCHEMA_HASH}, `
      + `and ucpath/submit-write-fixture now declares ${OUTPUT_SCHEMA_HASH}`,
    );
  });

  it("refuses an outcome bound to a different completion-proof schema before parsing its proof", () => {
    expect(() => projectTransactionOutcome(
      WriteFixtureCommit,
      storedOutcome({ proofSchemaHash: OTHER_SCHEMA_HASH, proof: { transactionId: "not-a-transaction" } }),
      "fixture transaction",
    )).toThrow(
      `fixture transaction: stored transaction outcome binds completion proof schema ${OTHER_SCHEMA_HASH}, `
      + `and ucpath/submit-write-fixture now declares ${PROOF_SCHEMA_HASH}`,
    );
  });

  it("refuses malformed output and proof values even when their stored schema hashes match", () => {
    expect(() => projectTransactionOutcome(
      WriteFixtureCommit,
      storedOutcome({ output: { transactionId: "not-a-transaction" } }),
      "fixture transaction output",
    )).toThrow(/transactionId/u);

    expect(() => projectTransactionOutcome(
      WriteFixtureCommit,
      storedOutcome({ proof: { transactionId: "not-a-transaction" } }),
      "fixture transaction proof",
    )).toThrow(/transactionId/u);
  });
});
}

{

const SCENARIO = ScenarioIdSchema.parse("workflow/builder-runtime");
const { INPUT, readOne, readTwo, preparePair, commitPair } = createFlowTaskFixtures(SCENARIO);

const childTarget: WorkflowRef<typeof INPUT, z.ZodObject<{ verified: z.ZodBoolean }>> = {
  id: WorkflowIdSchema.parse("verify"),
  input: INPUT,
  result: z.object({ verified: z.boolean() }),
};
const POLICY: DelegationPolicy = {
  onChildFailed: "fail-parent",
  cascadeCancel: "cascade",
  afterChildRetry: "resume-parent",
  visibility: "inline",
};
const childItemId = (): ItemId => ItemIdSchema.parse("00000000-0000-4000-8000-000000000001");

function base() {
  return flow(INPUT).step("search", readOne, {
    dependsOn: [],
    bind: ({ input }) => ({ eid: input.eid }),
    replay: "checkpoint",
  });
}

function nodeById(nodes: readonly GraphNodeBase[], id: string): GraphNodeBase {
  const found = nodes.find((node) => node.id === id);
  assert.ok(found, `expected node ${id}`);
  return found;
}

describe("workflow flow builder", () => {

  it("pins the transaction node's kernel-owned lease scope and budget", () => {
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
        schema: z.object({ id: z.string() }),
        dependsOn: ["terminate"],
        derive: ({ outputs }) => ({ id: outputs.terminate.output.transactionId }),
      });
    const node = nodeById(built.nodes, "terminate") as TransactionNode<
      RuntimeScope, typeof preparePair, typeof commitPair
    >;
    assert.equal(node.leaseScope, "transaction");
    assert.equal(node.prepare.uses.id, "ucpath/fill-termination");
    assert.equal(node.commit.uses.id, "ucpath/submit-termination");
    assert.equal(node.probeToFenceMaxMs, 30_000);
  });

  it("brands branch case targets, requires a real choice, and rejects an upstream arm", () => {
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
        schema: z.object({ selected: z.string() }),
        dependsOn: ["pick"],
        derive: ({ outputs }) => ({ selected: outputs.pick.selected }),
      });
    const node = nodeById(built.nodes, "pick") as BranchNode<
      RuntimeScope, Readonly<Record<string, readonly NodeId[]>>
    >;
    assert.deepEqual(node.cases, { left: ["contact"], right: ["other"] });
    assert.throws(
      () => base().branch("pick", {
        dependsOn: ["search"],
        choose: () => "only",
        cases: { only: ["search"] },
      }),
      /requires at least two cases/,
    );


    assert.throws(
      () => base()
        .branch("pick", {
          dependsOn: ["search"],
          choose: () => "left",
          cases: { left: ["search"], right: ["search"] },
        })
        .build({
          schema: z.object({ selected: z.string() }),
          dependsOn: ["pick"],
          derive: ({ outputs }) => ({ selected: outputs.pick.selected }),
        }),
      /targets search, which is not downstream/,
    );
  });

  it("records the full delegation policy on a child-run node", () => {
    const built = base()
      .childRun("verify", childTarget, {
        dependsOn: ["search"],
        edgeId: DelegationEdgeIdSchema.parse("verify"),
        cardinality: "one",
        bind: ({ outputs }) => ({ eid: outputs.search.eid }),
        deriveChildItemId: childItemId,
        await: "terminal",
        join: "one",
        policy: POLICY,
      })
      .build({
        schema: z.object({ ok: z.boolean() }),
        dependsOn: ["verify"],
        derive: ({ outputs }) => ({ ok: outputs.verify.state === "done" }),
      });
    const node = nodeById(built.nodes, "verify") as ChildRunNode<RuntimeScope, typeof childTarget>;
    assert.equal(node.edgeId, "verify");
    assert.deepEqual(node.policy, POLICY);
    assert.equal(node.target.id, "verify");
  });

  it("keeps a parallel node's branch node lists branded and frozen", () => {
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
        schema: z.object({ join: z.string() }),
        dependsOn: ["fan"],
        derive: ({ outputs }) => ({ join: outputs.fan.join }),
      });
    const node = nodeById(built.nodes, "fan") as ParallelNode;
    assert.equal(node.join, "all-settled");
    assert.deepEqual(node.branches.map((branch) => branch.id), ["org", "contact"]);
    assert.equal(Object.isFrozen(node.branches), true);
  });
});
}
