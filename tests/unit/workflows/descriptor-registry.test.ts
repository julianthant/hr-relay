import { describe, expect, it } from "vitest";
import { DESCRIPTORS, SERVER_REGISTRY, WORKFLOW_MODULES, workflowModuleOf } from "../../../src/control/workflow-registry.js";
import { HISTORICAL_STEP_PROOF_DESCRIPTORS } from "../../../src/control/step-proof-modules.js";
import { WORKFLOW_DESCRIPTORS } from "../../../src/workflows/descriptor-registry.js";

/**
 * The bundle-safe descriptor tuple is a VIEW of the composition root, not a
 * second registry: same descriptors, same identity, same order. A workflow
 * added to `WORKFLOW_MODULES` without its descriptor-registry entry (or vice
 * versa) fails here rather than drifting into a dashboard that cannot see it.
 */
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
    for (const descriptor of HISTORICAL_STEP_PROOF_DESCRIPTORS) {
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

  it("mirrors the composition root exactly, by object identity and order", () => {
    expect(WORKFLOW_DESCRIPTORS.length).toBe(DESCRIPTORS.length);
    for (const [index, descriptor] of DESCRIPTORS.entries()) {
      expect(WORKFLOW_DESCRIPTORS[index]).toBe(descriptor);
    }
  });
});
