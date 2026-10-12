import { describe,expect,it } from "vitest";
import { DESCRIPTORS } from "../../../../src/backend/app/registries/workflow-registry.js";
import { WORKFLOW_DESCRIPTORS } from "../../../../src/workflows/descriptor-registry.js";


describe("workflow descriptor registry", () => {

  it("mirrors the composition root exactly, by object identity and order", () => {
    expect(WORKFLOW_DESCRIPTORS.length).toBe(DESCRIPTORS.length);
    for (const [index, descriptor] of DESCRIPTORS.entries()) {
      expect(WORKFLOW_DESCRIPTORS[index]).toBe(descriptor);
    }
  });
});
