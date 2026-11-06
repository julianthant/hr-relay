import { ocrModule, ocrPageModule, personLookupModule } from "../../../support/helpers/registered-workflows.js";
import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import { composeWorkerRuntime, parseWorkerArguments } from "../../../../src/backend/app/composition/worker-compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { DESCRIPTORS, CHILD_ONLY_WORKFLOW_MODULES, childWorkflowModuleOf, createWorkflowRegistry, SERVER_REGISTRY, workflowModuleOf } from "../../../../src/backend/app/registries/workflow-registry.js";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { compileWorkflow, composeWorkflowModule } from "../../../../src/workflow-kit/workflow-definition.js";
import { unregisteredOcrParentWorkflow } from "../../../support/fixtures/ocr/parent-workflow.js";
import { runtimeLifetimeLock } from "../../../support/helpers/backend/runtime-lifetime.js";

vi.mock("../../../../src/workflows/registry.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../../../../src/workflows/registry.js")>();
  const { ocrParentWorkflow } = await import("../../../support/fixtures/ocr/parent-workflow.js");
  return { ...actual, PUBLIC_WORKFLOWS: Object.freeze([...actual.PUBLIC_WORKFLOWS, { definition: ocrParentWorkflow, proofs: [] }]) };
});

describe("production OCR child admission from a PDF parent", () => {
  it("resolves the generated OCR graph and reaches runtime admission through the default worker registry", async () => {
    assert.equal(childWorkflowModuleOf("fixture-ocr-parent", "ocr"), ocrModule);
    assert.equal(childWorkflowModuleOf("ocr", "ocr-page"), ocrPageModule);
    assert.equal(childWorkflowModuleOf("ocr", "person-lookup"), personLookupModule);
    let admissions = 0;
    await assert.rejects(composeWorkerRuntime({ lifetimeLock: await runtimeLifetimeLock(), isolation: rebuildRuntimeIsolation,
      env: {}, args: ["fixture-ocr-parent", "--pool-index", "1", "--drain"],
      get admission(): never { admissions++; throw new Error("fixture-runtime-admission-reached"); },
    }), /fixture-runtime-admission-reached/u);
    assert.equal(admissions, 1);
  });

  it.each(["ocr", "ocr-page"])("refuses a public start of %s before admission", async id => {
    assert.equal(SERVER_REGISTRY[id], undefined);
    assert.equal(DESCRIPTORS.some(descriptor => descriptor.id === id), false);
    assert.throws(() => workflowModuleOf(id), /not registered/u);
    assert.throws(() => parseWorkerArguments([id, "--pool-index", "1"]), /not registered/u);
    let admissions = 0;
    await assert.rejects(composeWorkerRuntime({ lifetimeLock: await runtimeLifetimeLock(), isolation: rebuildRuntimeIsolation,
      env: {}, args: [id, "--pool-index", "1", "--drain"],
      get admission(): never { admissions++; throw new Error("unrequested-admission-effect"); },
    }), /not registered/u);
    assert.equal(admissions, 0);
    assert.throws(() => childWorkflowModuleOf("person-lookup", id), /does not declare delegation/u);
  });

  it("refuses an unregistered target even when a parent declares the edge", () => {
    const parent = composeWorkflowModule(compileWorkflow(unregisteredOcrParentWorkflow), taskStoreRegistry.stores);
    assert.throws(() => createWorkflowRegistry([parent], CHILD_ONLY_WORKFLOW_MODULES), /target fixture-unregistered-ocr is not registered/u);
    assert.throws(() => childWorkflowModuleOf(parent.descriptor.id, "fixture-unregistered-ocr"), /is not registered/u);
  });
});
