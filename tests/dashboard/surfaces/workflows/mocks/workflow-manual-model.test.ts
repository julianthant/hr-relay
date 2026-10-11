import { describe,expect,it } from "vitest";
import { manualReadFields,mockStepIsDependency,mockStepIsLocked } from "../../../../../src/dashboard/surfaces/workflows/mocks/workflow-manual-model.js";
import { MOCK_WORKFLOWS,mockWorkflow } from "../../../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-catalog.js";

describe("manual OCR and reading inputs", () => {
  it("keeps the dependency gates automatic, locks all form actions and permits manual reads inside mixed steps", () => {
    for (const flow of MOCK_WORKFLOWS) for (const step of flow.steps) {
      if (step.write || ["fill-form", "fill-keywords"].includes(step.key)) expect(mockStepIsLocked(flow.id, step)).toBe(true);
      if (mockStepIsDependency(step)) expect(manualReadFields(flow.id, step.key)).toEqual([]);
    }
    const job = mockWorkflow("separations").steps.find(step => step.key === "ucpath-job-summary")!;
    expect(mockStepIsLocked("separations", job)).toBe(true);
    expect(manualReadFields("separations", job.key).map(field => field.label)).toContain("Position number");
    expect(mockStepIsLocked("oath-signature", mockWorkflow("oath-signature").steps[0])).toBe(false);
  });
});
