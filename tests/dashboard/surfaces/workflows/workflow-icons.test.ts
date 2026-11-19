import { describe, expect, it } from "vitest";
import { WORKFLOW_SOURCES } from "../../../../src/dashboard/app/workflow-sources.js";
import { workflowIcon } from "../../../../src/dashboard/surfaces/workflows/workflow-icons.js";

describe("workflow icons", () => {
  it("gives every served workflow its own icon", () => {
    const served = Object.entries(WORKFLOW_SOURCES).filter(([, source]) => source === "served").map(([id]) => id);
    expect(new Set(served.map(workflowIcon)).size).toBe(served.length);
  });
});
