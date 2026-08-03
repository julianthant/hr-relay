import { describe, expect, it } from "vitest";
import { DESCRIPTORS } from "../../../src/control/workflow-registry.js";
import { WORKFLOW_DESCRIPTORS } from "../../../src/workflows/descriptor-registry.js";

/**
 * The bundle-safe descriptor tuple is a VIEW of the composition root, not a
 * second registry: same descriptors, same identity, same order. A workflow
 * added to `WORKFLOW_MODULES` without its descriptor-registry entry (or vice
 * versa) fails here rather than drifting into a dashboard that cannot see it.
 */
describe("workflow descriptor registry", () => {
  it("mirrors the composition root exactly, by object identity and order", () => {
    expect(WORKFLOW_DESCRIPTORS.length).toBe(DESCRIPTORS.length);
    for (const [index, descriptor] of DESCRIPTORS.entries()) {
      expect(WORKFLOW_DESCRIPTORS[index]).toBe(descriptor);
    }
  });
});
