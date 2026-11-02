import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import { STEP_PROOF_DESCRIPTORS } from "../../src/backend/app/registries/step-proof-modules.js";
import { SERVER_REGISTRY, WORKFLOW_MODULES, workflowModuleOf } from "../../src/backend/app/registries/workflow-registry.js";
import { createWorkflowDescriptorRegistry, WORKFLOW_DESCRIPTORS } from "../../src/workflows/descriptor-registry.js";
import { plan1Child, plan1Leaf, plan1Parent } from "../support/fixtures/plan1-operation-workflows.js";

describe("the declared active-run policy, as the modal states it", () => {

  it("no registered workflow declares supersede-active", () => {

    assert.deepEqual(
      WORKFLOW_DESCRIPTORS.filter((descriptor) => descriptor.enqueue === "supersede-active").map((d) => d.id),
      [],
    );
  });
});

describe("the descriptor prose the modal draws", () => {
  it("finds a summary on every registered workflow, and treats absence as legal anyway", () => {

    for (const descriptor of WORKFLOW_DESCRIPTORS) {
      assert.equal(typeof descriptor.summary, "string", `${descriptor.id} declares no summary`);
      assert.ok((descriptor.summary ?? "").trim().length > 0);
    }
  });

  it("has exactly one start method kind, which is why no method tabs are drawn", () => {

    assert.deepEqual(
      WORKFLOW_DESCRIPTORS.filter((descriptor) => descriptor.surfaces.uploadRun !== undefined).map((d) => d.id),
      [],
    );
  });
});

describe("workflow descriptor registry", () => {
  it("resolves declared children without listing or publicly resolving them", () => {
    const registry = createWorkflowDescriptorRegistry(
      [...WORKFLOW_DESCRIPTORS, plan1Parent.descriptor],
      [plan1Child.descriptor, plan1Leaf.descriptor],
    );
    expect(registry.descriptors).toEqual([...WORKFLOW_DESCRIPTORS, plan1Parent.descriptor]);
    for (const descriptor of registry.descriptors) expect(registry.resolve(descriptor.id)).toBe(descriptor);
    for (const child of [plan1Child, plan1Leaf]) expect(registry.resolve(child.descriptor.id)).toBeUndefined();
    expect(registry.resolveChild(plan1Parent.descriptor.id, plan1Child.descriptor.id)).toBe(plan1Child.descriptor);
    expect(registry.resolveChild(plan1Child.descriptor.id, plan1Leaf.descriptor.id)).toBe(plan1Leaf.descriptor);
    expect(registry.resolveChild(plan1Parent.descriptor.id, plan1Leaf.descriptor.id)).toBe(plan1Leaf.descriptor);
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.descriptors)).toBe(true);
  });

  it("refuses unknown targets and undeclared or unknown parents", () => {
    expect(() => createWorkflowDescriptorRegistry([plan1Parent.descriptor], [plan1Child.descriptor]))
      .toThrow(`workflow delegation target ${plan1Leaf.descriptor.id} is not registered`);
    const registry = createWorkflowDescriptorRegistry([plan1Child.descriptor], [plan1Leaf.descriptor]);
    expect(() => registry.resolveChild("unknown-parent", plan1Leaf.descriptor.id)).toThrow(/does not declare delegation/u);
    expect(() => registry.resolveChild(plan1Leaf.descriptor.id, plan1Child.descriptor.id)).toThrow(/does not declare delegation/u);
    for (const id of ["unknown-child", "constructor", "toString", "__proto__"]) {
      expect(registry.resolve(id)).toBeUndefined();
      expect(() => registry.resolveChild(plan1Child.descriptor.id, id)).toThrow(/is not registered/u);
    }
  });

  it("registers only operator workflows", () => {
    expect(WORKFLOW_DESCRIPTORS.map(({ id }) => String(id))).toEqual([
      "person-lookup",
      "separations",
    ]);
    expect(WORKFLOW_MODULES.map(({ descriptor }) => String(descriptor.id))).toEqual([
      "person-lookup",
      "separations",
    ]);
    expect(Object.keys(SERVER_REGISTRY)).toEqual(["person-lookup", "separations"]);
    for (const descriptor of STEP_PROOF_DESCRIPTORS) {
      expect(() => workflowModuleOf(descriptor.id)).toThrow(/not registered/u);
    }
  });

  it("keeps separations steps inside its one timeline", () => {
    const separations = WORKFLOW_DESCRIPTORS[1];
    expect(separations?.timeline.map(({ key, label }) => [key, label])).toEqual([
      ["kuali-extraction", "Kuali extraction"],
      ["identity-check", "Identity check"],
      ["job-summary", "Job summary"],
      ["kronos-timecard", "Kronos timecard"],
      ["ucpath-transaction", "UCPath transaction"],
      ["kuali-finalization", "Kuali finalization"],
    ]);
  });
});
