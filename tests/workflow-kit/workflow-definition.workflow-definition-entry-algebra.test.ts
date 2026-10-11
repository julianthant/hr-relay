import assert from "node:assert/strict";
import { describe,expect,it } from "vitest";
import { z } from "zod";
import { UcpathDeletePendingTerminations } from "../../src/models/systems/ucpath/delete-pending-terminations.js";
import { UcpathReadPendingTerminationSet } from "../../src/models/systems/ucpath/read-pending-termination-set.js";
import { SearchPersonOrg } from "../../src/models/systems/ucpath/search-person-org.js";
import { UcpathStagePendingTerminationSweep } from "../../src/models/systems/ucpath/stage-pending-termination-sweep.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../src/models/workflow/presentation.js";
import { ItemIdSchema,WorkflowIdSchema } from "../../src/rules/identity/ids.js";
import { defineWorkflowRole } from "../../src/workflow-kit/validation/module-role.js";
import type { WorkflowAuthor,WorkflowDefinitionSpec } from "../../src/workflow-kit/workflow-definition.js";
import {
defineWorkflow,
workflowEntryKinds
} from "../../src/workflow-kit/workflow-definition.js";
import { descriptorRuntimeNodes } from "../../src/workflow-kit/workflow.js";
import {
PersonLookupCanonicalInput,
PersonLookupInput
} from "../../src/workflows/person-lookup/workflow.js";
import { compileFixtureWorkflow,everyEntryKindWorkflow } from "../support/fixtures/workflow-definition-fixtures.js";

const lookupInput = ({ input }: { input: { emplId?: string; name?: string; keepNonHdh: boolean } }) =>
  input.emplId === undefined
    ? { kind: "by-name" as const, name: input.name ?? "Fixture Person", keepNonHdh: input.keepNonHdh }
    : { kind: "by-eid" as const, emplId: input.emplId };

type Author = WorkflowAuthor<typeof PersonLookupInput>;
type Authored = ReturnType<WorkflowDefinitionSpec<typeof PersonLookupInput, z.ZodType>["steps"]>;

/** A minimal person-lookup-shaped definition whose only variable part is its graph. */
function fixtureWorkflow(id: string, steps: (author: Author) => Authored) {
  return defineWorkflow({
    id,
    version: 1,
    code: "fx",
    label: "Fixture",
    icon: "Search",
    category: "search",
    input: PersonLookupInput,
    canonicalInput: PersonLookupCanonicalInput,
    inputSubject: "eid",
    surface: { shape: "single" },
    enqueue: "reject-active",
    actions: STANDARD_WORKFLOW_ACTIONS,
    surfaces: {},
    details: [],
    identity: { matchKey: () => "fixture" },
    presentation: { title: () => "Fixture" },
    scenarios: ["person-lookup/happy-by-eid"],
    role: defineWorkflowRole({ kind: "standalone" }),
    steps,
  });
}

describe("workflow definition entry algebra", () => {
  it("compiles every explicit entry kind into its existing node kind with the author's exact policies", () => {
    const compiled = compileFixtureWorkflow(everyEntryKindWorkflow);
    expect(workflowEntryKinds(everyEntryKindWorkflow).toSorted())
      .toEqual(["delegate", "gate", "parallel", "task", "transaction"]);
    const nodes = descriptorRuntimeNodes(compiled.descriptor);
    const byId = new Map(nodes.map((node) => [String(node.id), node]));
    expect(nodes.map((node) => `${String(node.id)}:${node.kind}`).toSorted()).toEqual([
      "child:child-run",
      "crm-dates:task",
      "crm-record:task",
      "fan:parallel",
      "pending-set:task",
      "review:gate",
      "search:task",
      "sweep:transaction",
    ]);
    const fan = byId.get("fan");
    assert.ok(fan?.kind === "parallel");
    expect(fan.join).toBe("all");
    expect(fan.branches.map((branch) => ({ id: branch.id, nodes: branch.nodes.map(String) })))
      .toEqual([{ id: "record", nodes: ["crm-record"] }, { id: "dates", nodes: ["crm-dates"] }]);
    // The parallel node precedes its leaves so the builder's downstream check holds.
    const order = nodes.map((node) => String(node.id));
    expect(order.indexOf("fan")).toBeLessThan(order.indexOf("crm-record"));
    expect(order.indexOf("fan")).toBeLessThan(order.indexOf("crm-dates"));
    const child = byId.get("child");
    assert.ok(child?.kind === "child-run");
    expect({ cardinality: child.cardinality, await: child.await, join: child.join, edgeId: String(child.edgeId) })
      .toEqual({ cardinality: "one", await: "terminal", join: "one", edgeId: "fixture-child-lookup" });
    expect(child.dependsOn.map(String)).toEqual(["review"]);
    const sweep = byId.get("sweep");
    assert.ok(sweep?.kind === "transaction");
    expect({ dryRun: sweep.dryRun, probePolicy: sweep.probePolicy, budget: sweep.probeToFenceMaxMs })
      .toEqual({ dryRun: "stop-after-prepare", probePolicy: "always", budget: 90_000 });
    // The timeline names the parallel entry AND each leaf exactly once, in tuple order.
    expect(compiled.descriptor.timeline.map((group) => ({ key: group.key, nodes: group.nodes.map(({ id }) => String(id)) })))
      .toEqual([
        { key: "reads", nodes: ["search", "fan", "crm-record", "crm-dates"] },
        { key: "review", nodes: ["review", "child"] },
        { key: "sweep", nodes: ["pending-set", "sweep"] },
      ]);
    // Leaves contribute their contracts to store derivation.
    expect(compiled.storeNamespaces).toEqual(["ucpath", "crm"]);
  });

  it("refuses an implicit or unsupported control shape by name instead of inferring one", () => {
    const leaf = (author: Author, id: string) =>
      author.task({ id, contract: SearchPersonOrg, replay: "checkpoint" }, [], lookupInput);
    expect(() => fixtureWorkflow("parallel-one-branch", (author) => {
      const fan = author.parallel({ id: "fan", join: "all", failure: "fail-fast" }, [
        { id: "only", leaves: [leaf(author, "a")] },
      ]);
      return { steps: [[{ key: "fan", label: "Fan" }, [fan]]], result: author.result(z.string(), [], () => "done") };
    })).toThrow(/parallel entry "fan" requires at least two branches/u);

    expect(() => fixtureWorkflow("parallel-all-settled", (author) => {
      const fan = author.parallel({ id: "fan", join: "all-settled", failure: "fail-fast" }, [
        { id: "a", leaves: [leaf(author, "a")] },
        { id: "b", leaves: [leaf(author, "b")] },
      ]);
      return { steps: [[{ key: "fan", label: "Fan" }, [fan]]], result: author.result(z.string(), [], () => "done") };
    })).toThrow(/join "all-settled", which the run executor does not interpret \(capability-unavailable\)/u);

    expect(() => fixtureWorkflow("parallel-leaf-in-tuple", (author) => {
      const a = leaf(author, "a");
      const b = leaf(author, "b");
      const fan = author.parallel({ id: "fan", join: "all", failure: "fail-fast" }, [
        { id: "a", leaves: [a] },
        { id: "b", leaves: [b] },
      ]);
      return {
        steps: [[{ key: "fan", label: "Fan" }, [fan, a]]],
        result: author.result(z.string(), [], () => "done"),
      };
    })).toThrow(/workflow entry "a" is a leaf of parallel entry "fan" and may not also appear in a timeline tuple/u);

    expect(() => fixtureWorkflow("parallel-leaf-twice", (author) => {
      const a = leaf(author, "a");
      const fan = author.parallel({ id: "fan", join: "all", failure: "fail-fast" }, [
        { id: "a", leaves: [a] },
        { id: "b", leaves: [a] },
      ]);
      return { steps: [[{ key: "fan", label: "Fan" }, [fan]]], result: author.result(z.string(), [], () => "done") };
    })).toThrow(/parallel entry "fan" lists leaf "a" in more than one branch/u);

    expect(() => fixtureWorkflow("parallel-gate-leaf", (author) => {
      const review = author.gate({ id: "review", label: "Review", result: z.strictObject({ ok: z.boolean() }) }, []);
      const fan = author.parallel({ id: "fan", join: "all", failure: "fail-fast" }, [
        { id: "a", leaves: [leaf(author, "a")] },
        { id: "b", leaves: [review] },
      ]);
      return { steps: [[{ key: "fan", label: "Fan" }, [fan]]], result: author.result(z.string(), [], () => "done") };
    })).toThrow(/leaf "review" is a gate entry; a parallel leaf is a task entry with its own checkpoint/u);

    const target = { id: WorkflowIdSchema.parse("person-lookup"), input: PersonLookupInput, result: z.strictObject({}) };
    const policy = {
      onChildFailed: "fail-parent",
      cascadeCancel: "cascade",
      afterChildRetry: "resume-parent",
      visibility: "inline",
    } as const;
    expect(() => fixtureWorkflow("delegate-shape", (author) => {
      const child = author.delegate({
        id: "child", target, edgeId: "fixture-edge", cardinality: "one", await: "terminal", join: "all", policy,
      }, [], { bind: () => ({ emplId: "10800000" }), deriveChildItemId: () => ItemIdSchema.parse("00000000-0000-4000-8000-000000000fe2") });
      return { steps: [[{ key: "child", label: "Child" }, [child]]], result: author.result(z.string(), [], () => "done") };
    })).toThrow(/delegate entry "child" declares cardinality\/await\/join one\/terminal\/all, which is not one of the typed child-run shapes/u);

    expect(() => fixtureWorkflow("delegate-edge", (author) => {
      const child = author.delegate({
        id: "child", target, edgeId: "Not A Slug", cardinality: "one", await: "terminal", join: "one", policy,
      }, [], { bind: () => ({ emplId: "10800000" }), deriveChildItemId: () => ItemIdSchema.parse("00000000-0000-4000-8000-000000000fe2") });
      return { steps: [[{ key: "child", label: "Child" }, [child]]], result: author.result(z.string(), [], () => "done") };
    })).toThrow(/delegation edge id must be kebab-case/u);

    expect(() => fixtureWorkflow("transaction-budget", (author) => {
      const pendingSet = author.task({ id: "pending-set", contract: UcpathReadPendingTerminationSet, replay: "checkpoint" }, [], () => ({ emplId: "10800000", expectedName: "Fixture, Person" }));
      const sweep = author.transaction({
        id: "sweep",
        prepare: UcpathStagePendingTerminationSweep,
        commit: UcpathDeletePendingTerminations,
        dryRun: "stop-after-prepare",
        probePolicy: "always",
        probeToFenceMaxMs: 0,
      }, [pendingSet], {
        prepareBind: ({ outputs }) => ({ emplId: "10800000", expectedName: "Fixture, Person", observedSet: outputs["pending-set"] }),
        commitBind: ({ outputs }) => ({ emplId: "10800000", expectedName: "Fixture, Person", observedSet: outputs["pending-set"] }),
      });
      return { steps: [[{ key: "sweep", label: "Sweep" }, [pendingSet, sweep]]], result: author.result(z.string(), [], () => "done") };
    })).toThrow(/transaction entry "sweep" requires a positive integer probeToFenceMaxMs budget/u);
  });
});
