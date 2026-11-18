import { describe, expect, it } from "vitest";
import { explorerRecoveryWorkflow, explorerWorkflowOptions } from "../../../../src/dashboard/surfaces/explorer/explorer-workflow-model.js";
import type { WorkflowCatalogEntry } from "../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
import { defineWorkflowRole } from "../../../../src/workflow-kit/validation/module-role.js";

const entry = (id: string, label: string): WorkflowCatalogEntry => ({
  id, label, categoryId: "Lookup", role: defineWorkflowRole({ kind: "standalone" }), source: "served", launch: { state: "served" },
});

describe("Explorer workflow list", () => {
  it("offers each catalog workflow under its own id and label", () => {
    expect(explorerWorkflowOptions([entry("person-lookup", "Person Lookup"), entry("separations", "Separations")]))
      .toEqual([{ id: "person-lookup", title: "Person Lookup", count: 0 }, { id: "separations", title: "Separations", count: 0 }]);
  });
  it("recovers to the first workflow the catalog lists, and to none when it lists none", () => {
    expect(explorerRecoveryWorkflow([entry("person-lookup", "Person Lookup"), entry("separations", "Separations")])).toBe("person-lookup");
    expect(explorerRecoveryWorkflow([])).toBe("");
    expect(explorerWorkflowOptions([])).toEqual([]);
  });
});
