import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import { STEP_PROOF_DESCRIPTORS } from "../../src/backend/app/registries/step-proof-modules.js";
import { SERVER_REGISTRY, WORKFLOW_MODULES, workflowModuleOf } from "../../src/backend/app/registries/workflow-registry.js";
import { WORKFLOW_DESCRIPTORS } from "../../src/workflows/descriptor-registry.js";

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
