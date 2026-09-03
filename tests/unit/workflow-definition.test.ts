import { describe, expect, it } from "vitest";
import { z } from "zod";
import { resolve } from "node:path";
import {
  compileWorkflow,
  composeWorkflowModule,
  defineWorkflow,
  workflowDefinitionOf,
} from "../../src/base/workflow-definition.js";
import type { AnyWorkflowEntry, WorkflowAuthor, WorkflowDefinitionSpec } from "../../src/base/workflow-definition.js";
import { descriptorRuntimeNodes } from "../../src/base/workflow.js";
import { declaredWorkflowId } from "../../src/infra/build/workflow-build-manifest.js";
import { SearchPersonOrg } from "../../src/domain/contracts/ucpath/search-person-org.js";
import { defineWorkflowRole } from "../../src/domain/workflow/module-role.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../src/domain/workflow/presentation.js";
import { taskStoreRegistry } from "../../src/stores/index.js";
import type { RegisteredTaskStore } from "../../src/base/store.js";
import {
  PersonLookupCanonicalInput,
  PersonLookupInput,
  personLookupWorkflow,
} from "../../src/workflows/person-lookup/workflow.js";
import { actionNode } from "../../src/workflows/separations/kuali-extraction/nodes.js";
import { personLookupDescriptor } from "../helpers/registered-workflows.js";

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

  it("keeps a fragment bound to its exact owning step object", () => {
    expect(() => fixtureWorkflow("foreign-step", ({ taskFromFragment, result }) => {
      const action = taskFromFragment(actionNode, [], () => ({ documentNumber: "4510" }));
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
