import { compileWorkflow, composeWorkflowModule, defineWorkflow } from "../../../src/workflow-kit/workflow-definition.js";
import { defineWorkflowRole } from "../../../src/workflow-kit/validation/module-role.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../src/models/workflow/presentation.js";
import { childExecutionBuildManifest as manifest } from "./child-execution-build-manifest.js";
import { Plan1Input, Plan1CanonicalInput, Plan1Output, plan1Leaf, plan1Stores } from "./plan1-operation-workflows.js";

const ids = ["fixture-child-runtime-nested", "fixture-child-runtime-root"];
const common = { version: 1, label: "Synthetic child execution", icon: "Search" as const, category: "operations" as const,
  input: Plan1Input, canonicalInput: Plan1CanonicalInput, inputSubject: "eid" as const, surface: { shape: "single" as const },
  enqueue: "reject-active" as const, actions: STANDARD_WORKFLOW_ACTIONS, surfaces: {}, details: [],
  identity: { matchKey: (input: { emplId: string }) => input.emplId }, presentation: { title: () => "Synthetic child execution" },
  scenarios: ["fixture-plan1/happy"] as const, role: defineWorkflowRole({ kind: "standalone" }) };
const policy = { onChildFailed: "fail-parent" as const, cascadeCancel: "cascade" as const,
  afterChildRetry: "resume-parent" as const, visibility: "inline" as const };
const leaf = { id: plan1Leaf.descriptor.id, input: Plan1Input, result: Plan1Output };
export const childExecutionNested = compileWorkflow(defineWorkflow({ ...common, id: ids[0], code: "fcn",
  steps: ({ delegate, result }) => {
    const nested = delegate({ id: "nested", target: leaf, edgeId: "nested", cardinality: "one", await: "terminal", join: "one", policy }, [],
      { bind: ({ input }) => input, deriveChildItemId: (_input, identity) => identity.canonicalItemId });
    return { steps: [[{ key: "nested", label: "Nested" }, [nested]]], result: result(Plan1Output, [nested], ({ outputs }) => {
      if (outputs.nested.state !== "done") throw new Error("child-not-done");
      return outputs.nested.output;
    }, [
      { path: "eid", source: { kind: "child-output", entryId: "nested", path: "eid" } },
      { path: "providerState", source: { kind: "child-output", entryId: "nested", path: "providerState" } },
      { path: "disposition", source: { kind: "child-output", entryId: "nested", path: "disposition" } },
    ]) };
  } }), { manifest });
export const childExecutionRoot = compileWorkflow(defineWorkflow({ ...common, id: ids[1], code: "fcr",
  steps: ({ delegate, result }) => {
    const left = delegate({ id: "left", target: { id: childExecutionNested.descriptor.id, input: Plan1Input, result: Plan1Output },
      edgeId: "left", cardinality: "one", await: "terminal", join: "one", policy }, [],
      { bind: ({ input }) => input, deriveChildItemId: (_input, identity) => identity.canonicalItemId });
    const right = delegate({ id: "right", target: leaf, edgeId: "right", cardinality: "one", await: "terminal", join: "one", policy }, [left],
      { bind: ({ input }) => input, deriveChildItemId: (_input, identity) => identity.canonicalItemId });
    return { steps: [[{ key: "left", label: "Left" }, [left]], [{ key: "right", label: "Right" }, [right]]],
      result: result(Plan1Output, [left, right], ({ outputs }) => {
        if (outputs.left.state !== "done" || outputs.right.state !== "done") throw new Error("child-not-done");
        return { eid: outputs.left.output.eid, disposition: `${outputs.left.output.disposition}/${outputs.right.output.disposition}`,
          providerState: outputs.right.output.providerState };
      }, [
        { path: "eid", source: { kind: "child-output", entryId: "left", path: "eid" } },
        { path: "providerState", source: { kind: "child-output", entryId: "right", path: "providerState" } },
        { path: "disposition", source: { kind: "derived", inputs: [
          { id: "left", source: { kind: "child-output", entryId: "left", path: "disposition" } },
          { id: "right", source: { kind: "child-output", entryId: "right", path: "disposition" } },
        ] } },
      ]) };
  } }), { manifest });
export const childExecutionModules = [plan1Leaf, childExecutionNested, childExecutionRoot]
  .map(compiled => composeWorkflowModule(compiled, plan1Stores.stores));
export const childExecutionStores = plan1Stores;

export function childUnawaitedIndependentModules() {
  const compiled = compileWorkflow(defineWorkflow({ ...common, id: "fixture-child-unawaited-independent", code: "fcu",
    steps: ({ delegate, result }) => {
      const child = delegate({ id: "child", target: leaf, edgeId: "child", cardinality: "one", await: "none", join: "none",
        policy: { ...policy, cascadeCancel: "independent" } }, [],
      { bind: ({ input }) => input, deriveChildItemId: (_input, identity) => identity.canonicalItemId });
      return { steps: [[{ key: "child", label: "Child" }, [child]]], result: result(Plan1Input, [], ({ input }) => input) };
    } }), { manifest });
  return { root: compiled, modules: [composeWorkflowModule(plan1Leaf, plan1Stores.stores), composeWorkflowModule(compiled, plan1Stores.stores)] };
}


export function childPolicyModules(cascadeCancel: "cascade" | "independent") {
  const id = `fixture-child-policy-${cascadeCancel}`;
  const compiled = compileWorkflow(defineWorkflow({ ...common, id, code: "fcp",
    steps: ({ delegate, result }) => {
      const child = delegate({ id: "child", target: leaf, edgeId: "child", cardinality: "one", await: "terminal", join: "one",
        policy: { ...policy, cascadeCancel } }, [],
        { bind: ({ input }) => input, deriveChildItemId: (_input, identity) => identity.canonicalItemId });
      return { steps: [[{ key: "child", label: "Child" }, [child]]], result: result(Plan1Output, [child], ({ outputs }) => {
        if (outputs.child.state !== "done") throw new Error("child-not-done");
        return outputs.child.output;
      }, [
        { path: "eid", source: { kind: "child-output", entryId: "child", path: "eid" } },
        { path: "providerState", source: { kind: "child-output", entryId: "child", path: "providerState" } },
        { path: "disposition", source: { kind: "child-output", entryId: "child", path: "disposition" } },
      ]) };
    } }), { manifest });
  return { root: compiled, modules: [composeWorkflowModule(plan1Leaf, plan1Stores.stores), composeWorkflowModule(compiled, plan1Stores.stores)] };
}
