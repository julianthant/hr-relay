import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { composeWorkerRuntime, parseWorkerArguments, type WorkerComposeInput } from "../../../../src/backend/app/composition/worker-compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { composeWorkflowModule } from "../../../../src/workflow-kit/workflow-definition.js";
import { defineTaskStoreRegistry } from "../../../../src/workflow-kit/task-registry.js";
import { plan1Child, plan1Leaf, plan1Parent, plan1Stores, plan1Workflows } from "../../../support/fixtures/plan1-operation-workflows.js";

const modules = plan1Workflows.map(compiled => composeWorkflowModule(compiled, plan1Stores.stores));
const resolve = (id: string) => modules.find(module => module.descriptor.id === id);
function input(workflowId: string, executionRegistry?: WorkerComposeInput["executionRegistry"]) {
  let effects = 0;
  const value: WorkerComposeInput = { isolation: rebuildRuntimeIsolation,
    args: [workflowId, "--pool-index", "1", "--drain"],
    ...(executionRegistry === undefined ? {} : { executionRegistry }),
    get admission(): never { effects++; throw new Error("unrequested-admission-effect"); } };
  return { value, effects: () => effects };
}

describe("private child execution registry qualification before authority effects", () => {
  it("keeps the real production default strict and does not expose private graph selection through CLI syntax", async () => {
    assert.throws(() => parseWorkerArguments([plan1Leaf.descriptor.id, "--pool-index", "1"]), /not registered/u);
    const world = input(plan1Leaf.descriptor.id);
    await assert.rejects(composeWorkerRuntime(world.value), /not registered/u);
    assert.equal(world.effects(), 0);
  });

  it("refuses an unknown root or descendant instead of falling back to production modules", async () => {
    for (const workflowId of ["unregistered-child-root", plan1Child.descriptor.id]) {
      const world = input(workflowId, { resolve: id => id === plan1Child.descriptor.id ? resolve(id) : undefined, stores: plan1Stores });
      await assert.rejects(composeWorkerRuntime(world.value), /not registered|delegation-target-descriptor-unavailable/u);
      assert.equal(world.effects(), 0);
    }
  });

  it("refuses a foreign module and a genuine module whose stores are outside the selected owner", async () => {
    const empty = defineTaskStoreRegistry([], { scenarioIds: [], tasks: [] });
    for (const registry of [
      { resolve: () => resolve(plan1Child.descriptor.id), stores: plan1Stores },
      { resolve, stores: empty },
    ]) {
      const world = input(plan1Leaf.descriptor.id, registry);
      await assert.rejects(composeWorkerRuntime(world.value), /worker-execution-registry-mismatch/u);
      assert.equal(world.effects(), 0);
    }
  });

  it("refuses replacement of an already qualified module even when its descriptor bytes are identical", async () => {
    let reads = 0;
    const world = input(plan1Parent.descriptor.id, { resolve: id => {
      const module = resolve(id);
      if (id !== plan1Leaf.descriptor.id || module === undefined) return module;
      return ++reads === 1 ? module : { ...module };
    }, stores: plan1Stores });
    await assert.rejects(composeWorkerRuntime(world.value), /worker-execution-registry-mismatch/u);
    assert.equal(reads, 2);
    assert.equal(world.effects(), 0);
  });
});
