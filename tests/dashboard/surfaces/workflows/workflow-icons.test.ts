import { describe, expect, it } from "vitest";
import { ICON_NAMES } from "../../../../src/models/workflow/presentation.js";
import { workflowIcon } from "../../../../src/dashboard/surfaces/workflows/workflow-icons.js";

describe("workflow icons", () => {
  it("draws every icon name a workflow definition can declare, each its own", () => {
    expect(new Set(ICON_NAMES.map(workflowIcon)).size).toBe(ICON_NAMES.length);
  });
});
