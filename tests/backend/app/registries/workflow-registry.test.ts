import { describe,expect,it } from "vitest";
import { childWorkflowModuleOf, createWorkflowRegistry, DESCRIPTORS, personLookupModule, separationsModule, SERVER_REGISTRY, WORKFLOW_MODULES, workflowModuleOf } from "../../../../src/backend/app/registries/workflow-registry.js";
import { WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { composeWorkflowModule } from "../../../../src/workflow-kit/workflow-definition.js";
import { WORKFLOW_DESCRIPTORS } from "../../../../src/workflows/descriptor-registry.js";
import { PersonLookupInput } from "../../../../src/workflows/person-lookup/workflow.js";
import { compileFixtureWorkflow } from "../../../support/fixtures/workflow-definition-fixtures.js";
import { createSearchWorkflowDefinitionFixtures } from "../../../support/helpers/search-workflow-definition-fixtures.js";

function syntheticModule(id: string, targets: readonly string[] = []) {
  const { fixtureWorkflow } = createSearchWorkflowDefinitionFixtures();
  return composeWorkflowModule(compileFixtureWorkflow(fixtureWorkflow(id, ({ delegate, gate, result }) => {
    const entries = targets.length === 0
      ? [gate({ id: "review", label: "Review", statusKey: "needsReview", resolvedBy: "operator", result: PersonLookupInput }, [])]
      : targets.map((target, index) => delegate({ id: `child-${index}`,
        target: { id: WorkflowIdSchema.parse(target), input: PersonLookupInput, result: PersonLookupInput },
        edgeId: `child-${index}`, cardinality: "one", await: "none", join: "none",
        policy: { onChildFailed: "fail-parent", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "inline" },
      }, [], { bind: ({ input }) => input, deriveChildItemId: (_input, identity) => identity.canonicalItemId }));
    return { steps: [[{ key: "work", label: "Work" }, entries]], result: result(PersonLookupInput, [], ({ input }) => input) };
  })), []);
}


describe("workflow descriptor registry", () => {

  it("mirrors the composition root exactly, by object identity and order", () => {
    expect(WORKFLOW_DESCRIPTORS.length).toBe(DESCRIPTORS.length);
    for (const [index, descriptor] of DESCRIPTORS.entries()) {
      expect(WORKFLOW_DESCRIPTORS[index]).toBe(descriptor);
    }
  });

  it("preserves the existing public module identities and picker order", () => {
    expect(WORKFLOW_MODULES).toEqual([personLookupModule, separationsModule]);
    expect(Object.keys(SERVER_REGISTRY)).toEqual(["person-lookup", "separations"]);
    for (const module of WORKFLOW_MODULES) {
      expect(workflowModuleOf(module.descriptor.id)).toBe(module);
      expect(SERVER_REGISTRY[module.descriptor.id]).toBe(module);
    }
  });

  it("admits nested child-only modules only through each declared parent edge", () => {
    const root = syntheticModule("registry-root", ["registry-child"]);
    const child = syntheticModule("registry-child", ["registry-leaf"]);
    const leaf = syntheticModule("registry-leaf");
    const registry = createWorkflowRegistry([root], [child, leaf]);
    expect(registry.childModuleOf(root.descriptor.id, child.descriptor.id)).toBe(child);
    expect(registry.childModuleOf(child.descriptor.id, leaf.descriptor.id)).toBe(leaf);
    expect(() => registry.childModuleOf(root.descriptor.id, leaf.descriptor.id)).toThrow(/does not declare delegation/u);
    expect(() => registry.childModuleOf("unknown-parent", child.descriptor.id)).toThrow(/does not declare delegation/u);
    expect(() => registry.childModuleOf(root.descriptor.id, "unknown-target")).toThrow(/is not registered/u);
    expect(registry.publicModules).toEqual([root]);
    expect(registry.descriptors).toEqual([root.descriptor]);
    expect(Object.keys(registry.publicRegistry)).toEqual([root.descriptor.id]);
    expect(registry.moduleOf(root.descriptor.id)).toBe(root);
    for (const module of [child, leaf]) {
      expect(() => registry.moduleOf(module.descriptor.id)).toThrow(/is not registered/u);
      expect(registry.publicRegistry[module.descriptor.id]).toBeUndefined();
    }
  });

  it("allows a declared delegation to another public workflow without changing its public admission", () => {
    const parent = syntheticModule("registry-parent", ["registry-public-target"]);
    const target = syntheticModule("registry-public-target");
    const registry = createWorkflowRegistry([parent, target], []);
    expect(registry.childModuleOf(parent.descriptor.id, target.descriptor.id)).toBe(target);
    expect(registry.moduleOf(target.descriptor.id)).toBe(target);
  });

  it("refuses self delegation and indirect cycles, including a disconnected child-only graph", () => {
    const self = syntheticModule("registry-self", ["registry-self"]);
    expect(() => createWorkflowRegistry([self], [])).toThrow(/delegation cycle at registry-self/u);
    const first = syntheticModule("registry-first", ["registry-second"]);
    const second = syntheticModule("registry-second", ["registry-third"]);
    const third = syntheticModule("registry-third", ["registry-first"]);
    expect(() => createWorkflowRegistry([first], [second, third])).toThrow(/delegation cycle/u);
    expect(() => createWorkflowRegistry(WORKFLOW_MODULES, [first, second, third])).toThrow(/delegation cycle/u);
  });

  it("refuses a missing descendant and duplicate IDs across either admission list", () => {
    const parent = syntheticModule("registry-parent", ["registry-child"]);
    const child = syntheticModule("registry-child", ["registry-missing"]);
    expect(() => createWorkflowRegistry([parent], [child])).toThrow(/target registry-missing is not registered/u);
    const leaf = syntheticModule("registry-leaf");
    expect(() => createWorkflowRegistry([leaf, leaf], [])).toThrow(/registered more than once/u);
    expect(() => createWorkflowRegistry([leaf], [leaf])).toThrow(/registered more than once/u);
    expect(() => createWorkflowRegistry([], [leaf, leaf])).toThrow(/registered more than once/u);
  });

  it("never resolves inherited object keys as public modules, even when admitted as children", () => {
    const parent = syntheticModule("registry-parent", ["constructor"]);
    const child = syntheticModule("constructor");
    const registry = createWorkflowRegistry([parent], [child]);
    expect(registry.childModuleOf(parent.descriptor.id, child.descriptor.id)).toBe(child);
    for (const id of ["constructor", "toString", "__proto__"]) {
      expect(registry.publicRegistry[id]).toBeUndefined();
      expect(SERVER_REGISTRY[id]).toBeUndefined();
      expect(() => registry.moduleOf(id)).toThrow(/is not registered/u);
      expect(() => workflowModuleOf(id)).toThrow(/is not registered/u);
    }
  });

  it("snapshots admission lists and keeps separately constructed registries out of production selection", () => {
    const parent = syntheticModule("registry-parent", ["registry-leaf"]);
    const leaf = syntheticModule("registry-leaf");
    const publicEntries = [parent], childEntries = [leaf];
    const registry = createWorkflowRegistry(publicEntries, childEntries);
    publicEntries.splice(0, 1, leaf);
    childEntries.length = 0;
    expect(registry.moduleOf(parent.descriptor.id)).toBe(parent);
    expect(registry.childModuleOf(parent.descriptor.id, leaf.descriptor.id)).toBe(leaf);
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.publicModules)).toBe(true);
    expect(Object.isFrozen(registry.publicRegistry)).toBe(true);
    expect(Object.isFrozen(registry.descriptors)).toBe(true);
    for (const module of [parent, leaf]) {
      expect(() => workflowModuleOf(module.descriptor.id)).toThrow(/is not registered/u);
      expect(() => childWorkflowModuleOf("person-lookup", module.descriptor.id)).toThrow(/is not registered/u);
      expect(SERVER_REGISTRY[module.descriptor.id]).toBeUndefined();
    }
  });
});
