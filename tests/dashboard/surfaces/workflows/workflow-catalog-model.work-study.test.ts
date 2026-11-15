import { describe, expect, it } from "vitest";
import { DESCRIPTORS } from "../../../../src/backend/app/registries/workflow-registry.js";
import { WORKFLOW_SOURCES } from "../../../../src/dashboard/app/workflow-sources.js";
import { changeTypedInput, previewRunInput, restoreTypedInput, typedInputDefaults } from "../../../../src/dashboard/surfaces/run-start/run-start-model.js";
import { MOCK_WORKFLOW_CATALOG } from "../../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-catalog.js";
import { InputRunSurfaceSchema } from "../../../../src/models/workflow/ingress.js";
import { WORK_STUDY_INPUT_PARSER, WORK_STUDY_TYPED_INPUT } from "../../../../src/models/workflows/work-study/input.js";

const surface = InputRunSurfaceSchema.parse({ placeholder: "10000001, 10000002", parser: WORK_STUDY_INPUT_PARSER, typedInput: WORK_STUDY_TYPED_INPUT });
const typed = WORK_STUDY_TYPED_INPUT;
const REFUSAL = "Choose a valid effective date.";

describe("Work Study in the dashboard", () => {
  it("is served, and the mock catalog no longer carries it", () => {
    expect(WORKFLOW_SOURCES["work-study"]).toBe("served");
    expect(MOCK_WORKFLOW_CATALOG.workflows.map(flow => flow.id)).not.toContain("work-study");
  });

  it("shows the mock's step labels in Logs", () => {
    const served = DESCRIPTORS.find(descriptor => descriptor.id === "work-study");
    expect(served?.timeline.map(step => step.label)).toEqual(["Sign in to UCPath", "Submit work-study transaction"]);
  });

  it("starts one run per Employee ID, each with the typed date and no mode", () => {
    const draft = { ...typedInputDefaults(typed), effectiveDate: "08/03/2026" };
    const preview = previewRunInput(surface, "10000001, 10000002", draft);
    expect(preview.problem).toBeNull();
    expect(preview.submissions).toEqual([
      { emplId: "10000001", effectiveDate: "08/03/2026" },
      { emplId: "10000002", effectiveDate: "08/03/2026" },
    ]);
  });

  it.each([["no date", ""], ["a non-date", "soon"], ["an impossible day", "02/30/2026"], ["an ISO date", "2026-08-03"]])(
    "refuses %s with the mock's wording", (_name, date) => {
      const preview = previewRunInput(surface, "10000001", { ...typedInputDefaults(typed), effectiveDate: date });
      expect(preview.problem).toBe(REFUSAL);
      expect(preview.submissions).toEqual([]);
    });

  it("keeps the date control's text when another control changes", () => {
    const next = changeTypedInput(typed, { ...typedInputDefaults(typed), effectiveDate: "08/03/2026" }, "effectiveDate", "08/04/2026");
    expect(next.effectiveDate).toBe("08/04/2026");
  });

  it("restores a rerun's stored ISO date as MM/DD/YYYY", () => {
    expect(restoreTypedInput(typed, { emplId: "10000001", effectiveDate: "2026-08-03" }).effectiveDate).toBe("08/03/2026");
  });
});
