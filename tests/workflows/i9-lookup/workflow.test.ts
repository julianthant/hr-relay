import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { CHILD_ONLY_WORKFLOW_MODULES, childWorkflowModuleOf, i9LookupModule, workflowModuleOf, WORKFLOW_MODULES } from "../../../src/backend/app/registries/workflow-registry.js";
import { BROWSER_SYSTEM_BINDINGS } from "../../../src/backend/runtime/browser/system-bindings.js";
import { i9Store } from "../../../src/backend/systems/i9/task-registry.js";
import { I9LookupInputSchema, I9ReadSection2Signer, I9SignerOutputSchema } from "../../../src/models/systems/i9/read-section2-signer.js";
import { WORKFLOW_DESCRIPTORS } from "../../../src/workflows/descriptor-registry.js";
import { i9LookupWorkflow } from "../../../src/workflows/i9-lookup/workflow.js";
import { compileWorkflow } from "../../../src/workflow-kit/workflow-definition.js";

describe("I-9 Lookup child-only workflow", () => {
  it("binds the actual driver task and session without adding a public start surface or parent", () => {
    assert.ok(CHILD_ONLY_WORKFLOW_MODULES.includes(i9LookupModule));
    assert.equal(WORKFLOW_MODULES.some(module => String(module.descriptor.id) === "i9-lookup"), false);
    assert.equal(WORKFLOW_DESCRIPTORS.some(descriptor => String(descriptor.id) === "i9-lookup"), false);
    assert.throws(() => workflowModuleOf("i9-lookup"), /not registered/u);
    assert.throws(() => childWorkflowModuleOf("person-lookup", "i9-lookup"), /does not declare delegation/u);
    assert.deepEqual(i9LookupModule.descriptor.surfaces, {});
    assert.equal(i9LookupModule.stores[0], i9Store);
    assert.equal(i9Store.tasks.readSection2Signer.contract, I9ReadSection2Signer);
    assert.equal(BROWSER_SYSTEM_BINDINGS.i9?.system, "i9");
    assert.equal(compileWorkflow(i9LookupWorkflow).descriptor, i9LookupModule.descriptor);
    assert.deepEqual(i9LookupModule.descriptor.timeline.map(step => step.key), ["lookup"]);
  });

  it("accepts names rather than EIDs and prevents a signed output without a signer", () => {
    assert.deepEqual(I9LookupInputSchema.parse({ lastName: " Example ", firstName: " Person " }), { lastName: "Example", firstName: "Person" });
    assert.equal(I9LookupInputSchema.safeParse({ emplId: "10000001" }).success, false);
    assert.equal(I9LookupInputSchema.safeParse({ lastName: " ", firstName: "Person" }).success, false);
    assert.equal(I9SignerOutputSchema.safeParse({ i9Status: "signed", signerName: "", profileId: "900001", i9Id: "900002" }).success, false);
    assert.equal(I9SignerOutputSchema.safeParse({ i9Status: "not-found", signerName: "Someone" }).success, false);
  });
});
