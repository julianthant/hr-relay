import { expect, it } from "vitest";
import { WorkStudyInput } from "../../../src/models/workflows/work-study/input.js";
import { descriptorRuntimeNodes, workflowDryRunSupport } from "../../../src/workflow-kit/workflow.js";
import { compileWorkflow } from "../../../src/workflow-kit/workflow-definition.js";
import { WorkflowStartWireSchema } from "../../../src/models/dashboard/bootstrap.js";
import { workStudyWorkflow } from "../../../src/workflows/work-study/workflow.js";

const ingress = WorkStudyInput;
const OUTSIDE_EID_RANGE = "20000001";
const descriptor = compileWorkflow(workStudyWorkflow).descriptor;

it("accepts an Empl ID with an ISO effective date", () => {
  expect(ingress.safeParse({ emplId: "10000001", effectiveDate: "2026-08-03" }).success).toBe(true);
});

it.each([
  ["a short Empl ID", { emplId: "12345", effectiveDate: "2026-08-03" }],
  ["an Empl ID outside the EID range", { emplId: OUTSIDE_EID_RANGE, effectiveDate: "2026-08-03" }],
  ["a US-format date", { emplId: "10000001", effectiveDate: "08/03/2026" }],
  ["an impossible date", { emplId: "10000001", effectiveDate: "2026-02-30" }],
  ["an unknown key", { emplId: "10000001", effectiveDate: "2026-08-03", extra: "x" }],
])("refuses %s", (_name, value) => {
  expect(ingress.safeParse(value).success).toBe(false);
});

it("compiles the sign-in and transaction steps with one stop-after-prepare Save, so Dry run is offered", () => {
  expect(descriptor.timeline.map(step => [step.key, step.label])).toEqual([["ucpath-auth", "Sign in to UCPath"], ["transaction", "Submit work-study transaction"]]);
  expect(descriptorRuntimeNodes(descriptor).filter(node => node.kind === "transaction").map(node => String(node.id))).toEqual(["save-transaction"]);
  expect(workflowDryRunSupport(descriptor).state).toBe("supported");
});

it("declares one required effective date for the whole start, served as declared", () => {
  const served = WorkflowStartWireSchema.shape.inputRun.parse(descriptor.surfaces.inputRun);
  expect(served?.typedInput?.submitsMode).toBe(false);
  expect(served?.typedInput?.modes.map(mode => mode.value)).toEqual(["employee-ids"]);
  expect(served?.typedInput?.controls).toEqual([{ kind: "date", field: "effectiveDate", label: "Effective date", placement: "input",
    modes: ["employee-ids"], requires: [], required: true, refusal: "Choose a valid effective date." }]);
});
