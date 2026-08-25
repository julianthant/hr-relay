import assert from "node:assert/strict";
import { z } from "zod";
import { describe, it } from "vitest";
import { defineOperatorGateNode, defineTaskNode, defineTransactionNode, flow } from "../../src/base/flow.js";
import { defineWorkflowStep, defineWorkflowStepNodes } from "../../src/base/workflow.js";
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
import type { ItemId, NodeId } from "../../src/domain/ids.js";
import type {
  BranchNode,
  ChildRunNode,
  DelegationPolicy,
  GraphNodeBase,
  ParallelNode,
  RuntimeScope,
  TransactionNode,
  WorkflowRef,
} from "../../src/domain/workflow/graph.js";

const SCENARIO = ScenarioIdSchema.parse("workflow/builder-runtime");
const INPUT = z.strictObject({ eid: EidSchema });

const readOne = defineTaskContract({
  id: taskId("ucpath/search-person-org"),
  title: "Search Person Org",
  effect: "read",
  input: INPUT,
  output: z.strictObject({ eid: EidSchema }),
  errorCodes: ["eid-not-found"] as const,
  subject: {
    kind: "person",
    expected: { fromInput: ContractFieldPathSchema.parse("eid"), identity: "eid" },
    observe: ObservationIdSchema.parse("ucpath.person-org.displayed-eid"),
    match: "normalized-exact-eid",
    requiredAt: "before-subject-read",
  },
  scenarios: [SCENARIO],
  freshness: { defaultMaxAgeMs: 0 },
  provenance: { default: "live" },
  example: { eid: "10800000" },
});

const readTwo = defineTaskContract({
  id: taskId("crm/read-contact"),
  title: "Read CRM contact",
  effect: "read",
  input: INPUT,
  output: z.strictObject({ eid: EidSchema }),
  errorCodes: ["contact-missing"] as const,
  subject: { kind: "none", reason: "keyed by EID" },
  scenarios: [SCENARIO],
  freshness: { defaultMaxAgeMs: 0 },
  provenance: { default: "live" },
  example: { eid: "10800000" },
});

const preparePair = defineTaskContract({
  id: taskId("ucpath/fill-termination"),
  title: "Fill termination",
  effect: "prepare",
  input: INPUT,
  output: z.strictObject({ stagedRows: z.number().int() }),
  errorCodes: ["fill-failed"] as const,
  subject: { kind: "none", reason: "prepare fixture" },
  scenarios: [SCENARIO],
  checkpoint: "in-memory-only",
  example: { stagedRows: 1 },
});

const PROOF = z.strictObject({ transactionId: z.string() });
const commitPair = defineTaskContract({
  id: taskId("ucpath/submit-termination"),
  title: "Submit termination",
  effect: "commit",
  input: INPUT,
  output: PROOF,
  errorCodes: ["submit-failed"] as const,
  subject: {
    kind: "person",
    expected: { fromInput: ContractFieldPathSchema.parse("eid"), identity: "eid" },
    observe: ObservationIdSchema.parse("ucpath.person-org.displayed-eid"),
    match: "normalized-exact-eid",
    requiredAt: "after-prepare-before-fence",
  },
  scenarios: [SCENARIO],
  writeSafety: {
    completion: {
      kind: "receipt" as const,
      proofSchema: PROOF,
      proofFromOutput: (output: z.output<typeof PROOF>) => output,
      proofFromPresentProbe: ({ proof }: { proof: z.output<typeof PROOF> }) => proof,
      outputFromProof: (proof: z.output<typeof PROOF>) => proof,
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
  example: { transactionId: "T1" },
});

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
  it("retains the exact node tuple in declaration order", () => {
    const built = base()
      .step("contact", readTwo, {
        dependsOn: ["search"],
        bind: ({ outputs }) => ({ eid: outputs.search.eid }),
        replay: "checkpoint",
      })
      .build({
        schema: z.object({ eid: EidSchema }),
        dependsOn: ["search"],
        derive: ({ outputs }) => ({ eid: outputs.search.eid }),
      });
    assert.deepEqual(built.nodes.map((node) => node.id), ["search", "contact"]);
    assert.deepEqual(built.nodes.map((node) => node.kind), ["task", "task"]);
    assert.equal(Object.isFrozen(built), true);
    assert.equal(Object.isFrozen(built.nodes[0]), true);
  });

  it("rejects a duplicate node id", () => {
    assert.throws(
      () => base().step("search", readTwo, {
        dependsOn: [],
        bind: ({ input }) => ({ eid: input.eid }),
        replay: "checkpoint",
      }),
      /declares node search more than once/,
    );
  });

  it("rejects a dependency on a node that is not declared upstream", () => {
    assert.throws(
      () => flow(INPUT).step("contact", readTwo, {
        // A forward reference is a runtime backstop for a cast or a generated
        // migration; the typed path already rejects it.
        dependsOn: ["search"] as never,
        bind: ({ input }) => ({ eid: input.eid }),
        replay: "checkpoint",
      }),
      /depends on search, which is not a declared upstream node/,
    );
  });

  it("rejects a repeated dependency", () => {
    assert.throws(
      () => base().step("contact", readTwo, {
        dependsOn: ["search", "search"],
        bind: ({ outputs }) => ({ eid: outputs.search.eid }),
        replay: "checkpoint",
      }),
      /repeats a dependency/,
    );
  });

  it("rejects a node id that is not kebab-case", () => {
    assert.throws(
      () => base().step("readContact", readTwo, {
        dependsOn: ["search"],
        bind: ({ outputs }) => ({ eid: outputs.search.eid }),
        replay: "checkpoint",
      }),
      /node id must be kebab-case/,
    );
  });

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

  it("rejects a transaction without a positive probe-to-fence budget", () => {
    for (const probeToFenceMaxMs of [0, -1, 1.5]) {
      assert.throws(
        () => base().transaction("terminate", {
          dependsOn: ["search"],
          prepare: { uses: preparePair, bind: ({ outputs }) => ({ eid: outputs.search.eid }) },
          commit: { uses: commitPair, bind: ({ outputs }) => ({ eid: outputs.search.eid }) },
          dryRun: "stop-after-prepare",
          probePolicy: "always",
          probeToFenceMaxMs,
        }),
        /positive integer probeToFenceMaxMs budget/,
      );
    }
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
    // A case naming an UPSTREAM node would make the graph cyclic. The targets
    // do not exist when the branch is pushed, so only build() can catch it.
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

  it("rejects a parallel node with fewer than two branches or a repeated branch id", () => {
    assert.throws(
      () => base().parallel("fan", [{ id: "a", nodes: ["search"] }], { join: "all" }),
      /requires at least two branches/,
    );
    assert.throws(
      () => base().parallel("fan", [
        { id: "a", nodes: ["search"] },
        { id: "a", nodes: ["search"] },
      ], { join: "all" }),
      /repeats a branch id/,
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

  it("requires a subscribes source exactly when the gate is not operator-resolved", () => {
    assert.throws(
      () => base().gate("signed", {
        dependsOn: ["search"],
        label: "Signed",
        resolvedBy: "external",
        // The typed path rejects this; the runtime backstop covers a cast.
        subscribes: undefined as never,
        result: z.object({ ticket: z.string() }),
        resolve: () => ({ ticket: "x" }),
      }),
      /resolved by external requires a subscribes source/,
    );
    assert.throws(
      () => base().gate("approval", {
        dependsOn: ["search"],
        label: "Approve",
        resolvedBy: "operator",
        result: z.object({ approved: z.boolean() }),
        subscribes: {
          kind: "external",
          sourceId: "servicenow",
          event: z.object({ ticket: z.string() }),
          correlationKey: "ticket",
        } as never,
      }),
      /resolved by the operator cannot subscribe to a source/,
    );
  });

  it("rejects decorating a node that was never declared", () => {
    assert.throws(
      () => base().decorate("missing" as never, taskId("ucpath/search-person-org") as never, {}, "x"),
      /cannot decorate missing: no such node is declared/,
    );
  });

  it("rejects a terminal result that depends on an undeclared node, and an empty graph", () => {
    assert.throws(
      () => base().build({
        schema: z.object({ eid: EidSchema }),
        dependsOn: ["contact"] as never,
        derive: () => ({ eid: EidSchema.parse("10800000") }),
      }),
      /depends on contact, which is not a declared upstream node/,
    );
    assert.throws(
      () => flow(INPUT).build({
        schema: z.object({}),
        dependsOn: [],
        derive: () => ({}),
      }),
      /requires at least one node/,
    );
  });

  it("carries decorations and instrumentation through to the built flow", () => {
    const built = base()
      .decorate("search", taskId("ucpath/search-person-org"), {}, "audit-shot")
      .instrument({}, "span-hooks")
      .build({
        schema: z.object({ eid: EidSchema }),
        dependsOn: ["search"],
        derive: ({ outputs }) => ({ eid: outputs.search.eid }),
      });
    assert.equal(built.decorations.length, 1);
    assert.equal(built.decorations[0]?.nodeId, "search");
    assert.equal(built.decorations[0]?.contractId, "ucpath/search-person-org");
    assert.equal(built.instrumentation.length, 1);
    assert.equal(built.instrumentation[0]?.label, "span-hooks");
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
  describe("node fragments (D265 §1.2.2 rule 2)", () => {
    it("refuses a step whose folder key is not a kebab-case slug", () => {
      assert.throws(
        () => defineWorkflowStep({ key: "Not Kebab", label: "Invalid folder" }),
        /timeline category key must be a kebab-case slug/,
      );
    });

    const fragmentStep = defineWorkflowStep({ key: "identity-check", label: "Identity check" });
    const contactFragment = defineTaskNode(fragmentStep, "contact", readTwo, { label: "Contact", replay: "always-rerun" });
    const approvalFragment = defineOperatorGateNode(fragmentStep, "approval", {
      label: "Approve",
      statusKey: "awaitingApproval",
      result: z.object({ approved: z.boolean() }),
    });
    const terminateFragment = defineTransactionNode(fragmentStep, "terminate", {
      label: "Terminate",
      prepare: preparePair,
      commit: commitPair,
      dryRun: "stop-after-prepare",
      probePolicy: "retries-and-recovery-only",
      probeToFenceMaxMs: 30_000,
    });

    it("applies a wired fragment through pipe exactly as the hand-written call would", () => {
      const byHand = base()
        .step("contact", readTwo, {
          label: "Contact",
          dependsOn: ["search"],
          bind: ({ outputs }) => ({ eid: outputs.search.eid }),
          replay: "always-rerun",
        })
        .gate("approval", {
          label: "Approve",
          statusKey: "awaitingApproval",
          dependsOn: ["contact"],
          resolvedBy: "operator",
          result: approvalFragment.result,
        })
        .transaction("terminate", {
          label: "Terminate",
          dependsOn: ["approval", "search"],
          prepare: { uses: preparePair, bind: ({ outputs }) => ({ eid: outputs.search.eid }) },
          commit: { uses: commitPair, bind: ({ outputs }) => ({ eid: outputs.search.eid }) },
          dryRun: "stop-after-prepare",
          probePolicy: "retries-and-recovery-only",
          probeToFenceMaxMs: 30_000,
        })
        .build({ schema: z.object({ eid: EidSchema }), dependsOn: ["search"], derive: ({ outputs }) => ({ eid: outputs.search.eid }) });
      const byFragment = base()
        .pipe(contactFragment.wire({ dependsOn: ["search"], bind: ({ outputs }) => ({ eid: outputs.search.eid }) }))
        .pipe(approvalFragment.wire({ dependsOn: ["contact"] }))
        .pipe(terminateFragment.wire({
          dependsOn: ["approval", "search"],
          prepare: { bind: ({ outputs }) => ({ eid: outputs.search.eid }) },
          commit: { bind: ({ outputs }) => ({ eid: outputs.search.eid }) },
        }))
        .build({ schema: z.object({ eid: EidSchema }), dependsOn: ["search"], derive: ({ outputs }) => ({ eid: outputs.search.eid }) });
      const stripBinds = (nodes: readonly GraphNodeBase[]): unknown =>
        JSON.parse(JSON.stringify(nodes, (key, value: unknown) => (
          typeof value === "function" ? "<fn>" : key === "result" ? "<schema>" : key === "uses" ? (value as { id: string }).id : value
        )));
      assert.deepEqual(stripBinds(byFragment.nodes), stripBinds(byHand.nodes));
      assert.equal(byFragment.nodes.length, 4);
      assert.equal(Object.isFrozen(contactFragment), true);
      assert.equal(contactFragment.id, "contact");
      assert.equal(terminateFragment.prepare.id, "ucpath/fill-termination");
    });

    it("refuses a fragment that hands back a different builder", () => {
      const other = base();
      assert.throws(
        // The cast is the point: a fragment that ignores its argument is exactly what pipe refuses.
        () => base().pipe(() => other as never),
        /must return the builder it was given/,
      );
    });

    it("refuses a transaction fragment without a positive probe-to-fence budget, and a bad node id", () => {
      assert.throws(
        () => defineTransactionNode(fragmentStep, "terminate", {
          label: "Terminate", prepare: preparePair, commit: commitPair,
          dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 0,
        }),
        /positive integer probeToFenceMaxMs budget/,
      );
      assert.throws(() => defineTaskNode(fragmentStep, "Not Kebab", readTwo, { label: "x", replay: "checkpoint" }));
    });

    it("derives a step's timeline category from its fragments and refuses a repeated one", () => {
      const category = defineWorkflowStepNodes(fragmentStep, [contactFragment, approvalFragment, terminateFragment]);
      assert.deepEqual(category, { key: "identity-check", label: "Identity check", nodes: ["contact", "approval", "terminate"] });
      assert.equal(Object.isFrozen(category), true);
      assert.throws(
        () => defineWorkflowStepNodes(fragmentStep, [contactFragment, contactFragment]),
        /lists node fragment contact twice/,
      );
    });

    it("refuses a node fragment owned by another workflow step", () => {
      const otherStep = defineWorkflowStep({ key: "job-summary", label: "Job summary" });

      assert.throws(
        () => defineWorkflowStepNodes(otherStep, [contactFragment as never]),
        /step "job-summary" claims node fragment contact, which belongs to step "identity-check"/,
      );
    });

    it("refuses a node fragment claimed by a different step object with the same key", () => {
      const separatelyDeclaredStep = defineWorkflowStep({ key: "identity-check", label: "Secondary identity check" });

      assert.throws(
        () => defineWorkflowStepNodes(separatelyDeclaredStep, [contactFragment]),
        /same key but distinct step objects: "Secondary identity check" and "Identity check"/,
      );
    });
  });
});
