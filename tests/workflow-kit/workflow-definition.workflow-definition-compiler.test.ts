import { describe,expect,it } from "vitest";
import { z } from "zod";
import { taskStoreRegistry } from "../../src/backend/app/registries/task-registry.js";
import { SearchPersonOrg } from "../../src/models/systems/ucpath/search-person-org.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../src/models/workflow/presentation.js";
import type { RegisteredTaskStore } from "../../src/workflow-kit/task-registry.js";
import { BUILD_MANIFEST } from "../../src/workflow-kit/validation/build-manifest.js";
import { defineWorkflowRole } from "../../src/workflow-kit/validation/module-role.js";
import type { AnyWorkflowEntry,WorkflowAuthor,WorkflowDefinitionSpec } from "../../src/workflow-kit/workflow-definition.js";
import {
compileWorkflow,
composeWorkflowModule,
defineWorkflow,
workflowDefinitionOf,
workflowExplorerDeclaration
} from "../../src/workflow-kit/workflow-definition.js";
import { descriptorRuntimeNodes } from "../../src/workflow-kit/workflow.js";
import {
PersonLookupCanonicalInput,
PersonLookupInput,
personLookupWorkflow,
} from "../../src/workflows/person-lookup/workflow.js";
import { personLookupDescriptor } from "../support/helpers/registered-workflows.js";

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
});
