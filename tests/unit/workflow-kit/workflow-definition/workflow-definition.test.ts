import { describe, expect, it } from "vitest";
import { z } from "zod";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import {
  compileWorkflow,
  composeWorkflowModule,
  defineWorkflow,
  workflowDefinitionOf,
  workflowEntryKinds,
  workflowExplorerDeclaration,
} from "../../../../src/workflow-kit/workflow-definition.js";
import type { AnyWorkflowEntry, WorkflowAuthor, WorkflowDefinitionSpec } from "../../../../src/workflow-kit/workflow-definition.js";
import { descriptorRuntimeNodes } from "../../../../src/workflow-kit/workflow.js";
import { declaredWorkflowId } from "../../../../scripts/build/workflow-build-manifest.js";
import { BUILD_MANIFEST } from "../../../../src/workflow-kit/validation/build-manifest.js";
import { SearchPersonOrg } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { UcpathDeletePendingTerminations } from "../../../../src/models/systems/ucpath/delete-pending-terminations.js";
import { UcpathReadPendingTerminationSet } from "../../../../src/models/systems/ucpath/read-pending-termination-set.js";
import { UcpathStagePendingTerminationSweep } from "../../../../src/models/systems/ucpath/stage-pending-termination-sweep.js";
import { ItemIdSchema, WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { compileFixtureWorkflow, everyEntryKindWorkflow } from "../../../support/fixtures/workflow-definition-fixtures.js";
import { defineWorkflowRole } from "../../../../src/workflow-kit/validation/module-role.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import type { RegisteredTaskStore } from "../../../../src/workflow-kit/task-registry.js";
import {
  PersonLookupCanonicalInput,
  PersonLookupInput,
  personLookupWorkflow,
} from "../../../../src/workflows/person-lookup/workflow.js";
import { actionNode } from "../../../../src/workflows/separations/workflow.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";

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

describe("workflow definition compiler", () => {
  it("exports the compiled ordered tuple product and refuses an uncompiled definition", () => {
    const declaration = workflowExplorerDeclaration(personLookupWorkflow);
    expect(declaration.map((group) => [group.key, group.label, group.entries.map((entry) => ({
      id: entry.id, nodeIds: entry.nodeIds.map(String), dependsOn: entry.dependsOn.map(String),
    }))])).toEqual([
      ["searching", "Searching", [{ id: "searching", nodeIds: ["searching"], dependsOn: [] }]],
      ["cross-verify", "Cross Verification", [{ id: "cross-verify", nodeIds: ["cross-verify"], dependsOn: ["searching"] }]],
      ["active-status", "Active Status", [{ id: "active-status", nodeIds: ["active-status"], dependsOn: ["searching", "cross-verify"] }]],
      ["crm-dates", "CRM Dates", [{ id: "crm-dates", nodeIds: ["crm-dates"], dependsOn: ["searching"] }]],
    ]);
    expect(Object.isFrozen(declaration)).toBe(true);
    expect(Object.isFrozen(declaration[0]?.entries[0]?.nodeIds)).toBe(true);
    const uncompiled = fixtureWorkflow("uncompiled-explorer", ({ task, result }) => {
      const read = task({ id: "read", contract: SearchPersonOrg, replay: "checkpoint" }, [], lookupInput);
      return { steps: [[{ key: "read", label: "Read" }, [read]]], result: result(z.string(), [], () => "done") };
    });
    expect(() => workflowExplorerDeclaration(uncompiled)).toThrow(/has no compiled definition/u);
  });

  it("derives execution order and edges from entry references while preserving tuple presentation order", () => {
    const graph = descriptorRuntimeNodes(personLookupDescriptor);

    expect(graph.map((node) => ({ id: String(node.id), dependsOn: node.dependsOn.map(String) }))).toEqual([
      { id: "searching", dependsOn: [] },
      { id: "cross-verify", dependsOn: ["searching"] },
      { id: "active-status", dependsOn: ["searching", "cross-verify"] },
      { id: "crm-dates", dependsOn: ["searching"] },
    ]);
    expect(personLookupWorkflow.steps.map(([group]) => group.key)).toEqual([
      "searching",
      "cross-verify",
      "active-status",
      "crm-dates",
    ]);
    expect(workflowDefinitionOf(personLookupDescriptor)).toBe(personLookupWorkflow);
    expect(compileWorkflow(personLookupWorkflow).descriptor).toBe(personLookupDescriptor);
    expect(personLookupWorkflow.kind).toBe("workflow-definition");
    expect(compileWorkflow(personLookupWorkflow).kind).toBe("compiled-workflow");
  });

  it("memoizes one compiled workflow per definition AND build manifest; a second manifest refuses instead of returning the first compile", () => {
    const compiled = compileWorkflow(personLookupWorkflow);
    expect(compileWorkflow(personLookupWorkflow, { manifest: BUILD_MANIFEST })).toBe(compiled);
    // A structurally equal replacement manifest is a different identity from the memoized definition manifest.
    expect(() => compileWorkflow(personLookupWorkflow, { manifest: { ...BUILD_MANIFEST } })).toThrow(
      /workflow person-lookup was already compiled under a different build manifest; one definition compiles under exactly one manifest/u,
    );
    expect(compileWorkflow(personLookupWorkflow)).toBe(compiled);
  });

  it("refuses duplicate entry membership and duplicate entry ids by name", () => {
    expect(() => fixtureWorkflow("dup-member", ({ task, result }) => {
      const first = task({ id: "first", contract: SearchPersonOrg, replay: "checkpoint" }, [], lookupInput);
      return {
        steps: [
          [{ key: "first", label: "First" }, [first]],
          [{ key: "second", label: "Second" }, [first]],
        ],
        result: result(z.string(), [], () => "done"),
      };
    })).toThrow(/workflow entry "first" appears in more than one timeline tuple/u);

    expect(() => fixtureWorkflow("dup-id", ({ task, result }) => {
      const first = task({ id: "same-id", contract: SearchPersonOrg, replay: "checkpoint" }, [], lookupInput);
      const second = task({ id: "same-id", contract: SearchPersonOrg, replay: "checkpoint" }, [], lookupInput);
      return {
        steps: [[{ key: "group", label: "Group" }, [first, second]]],
        result: result(z.string(), [], () => "done"),
      };
    })).toThrow(/workflow dup-id declares entry id "same-id" more than once/u);
  });

  it("refuses duplicate or unstable timeline groups", () => {
    expect(() => fixtureWorkflow("dup-group", ({ task, result }) => {
      const first = task({ id: "first", contract: SearchPersonOrg, replay: "checkpoint" }, [], lookupInput);
      const second = task({ id: "second", contract: SearchPersonOrg, replay: "checkpoint" }, [], lookupInput);
      return {
        steps: [
          [{ key: "duplicate", label: "First" }, [first]],
          [{ key: "duplicate", label: "Second" }, [second]],
        ],
        result: result(z.string(), [], () => "done"),
      };
    })).toThrow(/workflow dup-group repeats timeline group key "duplicate"/u);

    expect(() => fixtureWorkflow("unstable", ({ task, result }) => {
      const first = task({ id: "first", contract: SearchPersonOrg, replay: "checkpoint" }, [], lookupInput);
      return {
        steps: [[{ key: "Not Stable", label: "First" }, [first]]],
        result: result(z.string(), [], () => "done"),
      };
    })).toThrow(/kebab-case slug/u);
  });

  it("keeps a step-owned identity bound to its exact owning step object", () => {
    expect(() => fixtureWorkflow("foreign-step", ({ task, result }) => {
      const action = task(actionNode, [], () => ({ documentNumber: "4510" }));
      return {
        steps: [[{ key: "kuali-extraction", label: "Kuali extraction" }, [action]]],
        result: result(z.string(), [], () => "done"),
      };
    })).toThrow(/same key but distinct step objects/u);
  });

  it("refuses unresolved references and dependency cycles by entry name", () => {
    expect(() => fixtureWorkflow("unresolved", ({ task, result }) => {
      const missing = task({ id: "missing", contract: SearchPersonOrg, replay: "checkpoint" }, [], lookupInput);
      const consumer = task({ id: "consumer", contract: SearchPersonOrg, replay: "checkpoint" }, [missing], lookupInput);
      return {
        steps: [[{ key: "consumer", label: "Consumer" }, [consumer]]],
        result: result(z.string(), [], () => "done"),
      };
    })).toThrow(/workflow entry "consumer" references unresolved entry "missing"/u);

    expect(() => fixtureWorkflow("unresolved-result", ({ task, result }) => {
      const missing = task({ id: "missing", contract: SearchPersonOrg, replay: "checkpoint" }, [], lookupInput);
      const declared = task({ id: "declared", contract: SearchPersonOrg, replay: "checkpoint" }, [], lookupInput);
      return {
        steps: [[{ key: "declared", label: "Declared" }, [declared]]],
        result: result(z.string(), [missing], () => "done"),
      };
    })).toThrow(/workflow unresolved-result result references unresolved entry "missing"/u);

    expect(() => fixtureWorkflow("cycle", ({ task, result }) => {
      const firstReferences: AnyWorkflowEntry[] = [];
      const first = task({ id: "first", contract: SearchPersonOrg, replay: "checkpoint" }, firstReferences, lookupInput);
      const second = task({ id: "second", contract: SearchPersonOrg, replay: "checkpoint" }, [first], lookupInput);
      firstReferences.push(second);
      return {
        steps: [[{ key: "cycle", label: "Cycle" }, [first, second]]],
        result: result(z.string(), [], () => "done"),
      };
    })).toThrow(/workflow cycle dependency cycle: first -> second -> first/u);
  });

  it("derives exact module stores at the composition root and refuses an incomplete inventory", () => {
    const compiled = compileWorkflow(personLookupWorkflow);
    const withoutCrm = taskStoreRegistry.stores.filter(({ namespace }) => namespace !== "crm");
    const crm = taskStoreRegistry.stores.find(({ namespace }) => namespace === "crm");
    expect(crm).toBeDefined();
    if (crm === undefined) throw new Error("fixture registry is missing the crm store");

    expect(() => composeWorkflowModule(compiled, withoutCrm))
      .toThrow(/workflow person-lookup requires missing store crm/u);
    expect(() => composeWorkflowModule(compiled, [...taskStoreRegistry.stores, crm]))
      .toThrow(/workflow person-lookup found duplicate stores for crm/u);

    const wrongContractCrm = {
      ...crm,
      tasks: Object.fromEntries(Object.entries(crm.tasks).map(([key, task]) => [
        key,
        { ...task, contract: SearchPersonOrg },
      ])),
    } as RegisteredTaskStore;
    expect(() => composeWorkflowModule(
      compiled,
      taskStoreRegistry.stores.map((store) => store === crm ? wrongContractCrm : store),
    )).toThrow(/workflow person-lookup cannot resolve exact contract crm\/read-onboarding-record/u);

    const module = composeWorkflowModule(compiled, taskStoreRegistry.stores);
    expect(module.stores.map(({ namespace }) => String(namespace))).toEqual(["ucpath", "crm", "workflow:person-lookup"]);
    expect(module.role).toEqual({ kind: "standalone" });
    expect(module.definition).toBe(personLookupWorkflow);

    const foreign = { ...compiled, definition: personLookupWorkflow };
    expect(() => composeWorkflowModule(foreign, taskStoreRegistry.stores))
      .toThrow(/workflow person-lookup module does not use the compiled workflow of its own definition/u);
  });

  it("keeps definition-authored workflow ids visible to the build-manifest guard", () => {
    expect(declaredWorkflowId(resolve("src/workflows/person-lookup/workflow.ts"))).toBe("person-lookup");
    expect(declaredWorkflowId(resolve("src/workflows/separations/workflow.ts"))).toBe("separations");
  });
});

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

  it("does not offer any fragment adapter or recipe-named authoring path", () => {
    const authored: string[] = [];
    fixtureWorkflow("author-surface", (author) => {
      authored.push(...Object.keys(author).toSorted());
      const only = author.task({ id: "only", contract: SearchPersonOrg, replay: "checkpoint" }, [], lookupInput);
      return { steps: [[{ key: "only", label: "Only" }, [only]]], result: author.result(z.string(), [], () => "done") };
    });
    expect(authored).toEqual(["delegate", "gate", "group", "parallel", "result", "task", "transaction"]);
  });
});
