import { runtimeLifetimeLock } from "../../../support/helpers/backend/runtime-lifetime.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { composeWorkerRuntime, parseWorkerArguments, type WorkerComposeInput } from "../../../../src/backend/app/composition/worker-compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { composeWorkflowModule } from "../../../../src/workflow-kit/workflow-definition.js";
import { defineTaskStoreRegistry } from "../../../../src/workflow-kit/task-registry.js";
import { createWorkflowRegistry } from "../../../../src/backend/app/registries/workflow-registry.js";
import { plan1Child, plan1Leaf, plan1Parent, plan1Stores, plan1Workflows } from "../../../support/fixtures/plan1-operation-workflows.js";

import { childExecutionBuildManifest as manifest } from "../../../support/fixtures/child-execution-build-manifest.js";

const modules = plan1Workflows.map(compiled => composeWorkflowModule(compiled, plan1Stores.stores));
const resolve = (id: string) => modules.find(module => module.descriptor.id === id);
const parent = resolve(plan1Parent.descriptor.id);
assert.ok(parent);
const qualified = createWorkflowRegistry([parent], modules.filter(module => module !== parent));
async function input(workflowId: string, executionRegistry?: WorkerComposeInput["executionRegistry"]) {
  let effects = 0;
  const value: WorkerComposeInput = { lifetimeLock: await runtimeLifetimeLock(), isolation: rebuildRuntimeIsolation,
    args: [workflowId, "--pool-index", "1", "--drain"],
    ...(executionRegistry === undefined ? {} : { executionRegistry }),
    get admission(): never { effects++; throw new Error("unrequested-admission-effect"); } };
  return { value, effects: () => effects };
}

describe("private child execution registry qualification before authority effects", () => {
  it("admits private children through every parent edge with a public-only root resolver", async () => {
    const edges: string[] = [];
    const world = await input(plan1Parent.descriptor.id, {
      resolve: id => qualified.publicRegistry[id],
      resolveChild: (parentId, id) => {
        edges.push(`${parentId}:${id}`);
        return qualified.childModuleOf(parentId, id);
      }, stores: plan1Stores, manifest,
    });
    await assert.rejects(composeWorkerRuntime(world.value), /unrequested-admission-effect/u);
    assert.equal(world.effects(), 1);
    assert.ok(edges.includes(`${plan1Parent.descriptor.id}:${plan1Leaf.descriptor.id}`));
    assert.ok(edges.includes(`${plan1Parent.descriptor.id}:${plan1Child.descriptor.id}`));
    assert.ok(edges.includes(`${plan1Child.descriptor.id}:${plan1Leaf.descriptor.id}`));
    for (const id of [plan1Child.descriptor.id, plan1Leaf.descriptor.id]) {
      const privateRoot = await input(id, { resolve: key => qualified.publicRegistry[key],
        resolveChild: qualified.childModuleOf, stores: plan1Stores, manifest });
      await assert.rejects(composeWorkerRuntime(privateRoot.value), /not registered/u);
      assert.equal(privateRoot.effects(), 0);
    }
  });

  it("refuses missing and foreign child modules before authority effects", async () => {
    for (const child of [undefined, parent]) {
      const world = await input(plan1Parent.descriptor.id, {
        resolve: id => qualified.publicRegistry[id], resolveChild: () => child,
        stores: plan1Stores, manifest,
      });
      await assert.rejects(composeWorkerRuntime(world.value), /delegation-target-descriptor-unavailable|worker-execution-registry-mismatch/u);
      assert.equal(world.effects(), 0);
    }
  });

  it("keeps the real production default strict and does not expose private graph selection through CLI syntax", async () => {
    assert.throws(() => parseWorkerArguments([plan1Leaf.descriptor.id, "--pool-index", "1"]), /not registered/u);
    const world = await input(plan1Leaf.descriptor.id);
    await assert.rejects(composeWorkerRuntime(world.value), /not registered/u);
    assert.equal(world.effects(), 0);
  });

  it("refuses an unknown root or descendant instead of falling back to production modules", async () => {
    for (const workflowId of ["unregistered-child-root", plan1Child.descriptor.id]) {
      const world = await input(workflowId, { resolve: id => id === plan1Child.descriptor.id ? resolve(id) : undefined, stores: plan1Stores, manifest });
      await assert.rejects(composeWorkerRuntime(world.value), /not registered|delegation-target-descriptor-unavailable/u);
      assert.equal(world.effects(), 0);
    }
  });

  it("refuses a foreign module and a genuine module whose stores are outside the selected owner", async () => {
    const empty = defineTaskStoreRegistry([], { scenarioIds: [], tasks: [] });
    for (const registry of [
      { resolve: () => resolve(plan1Child.descriptor.id), stores: plan1Stores, manifest },
      { resolve, stores: empty, manifest },
    ]) {
      const world = await input(plan1Leaf.descriptor.id, registry);
      await assert.rejects(composeWorkerRuntime(world.value), /worker-execution-registry-mismatch/u);
      assert.equal(world.effects(), 0);
    }
  });

  it("refuses replacement of an already qualified module even when its descriptor bytes are identical", async () => {
    let reads = 0;
    const world = await input(plan1Parent.descriptor.id, { resolve: id => {
      const module = resolve(id);
      if (id !== plan1Leaf.descriptor.id || module === undefined) return module;
      return ++reads === 1 ? module : { ...module };
    }, stores: plan1Stores, manifest });
    await assert.rejects(composeWorkerRuntime(world.value), /worker-execution-registry-mismatch/u);
    assert.equal(reads, 2);
    assert.equal(world.effects(), 0);
  });
});
