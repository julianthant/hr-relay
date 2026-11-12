import { expect, it } from "vitest";
import { WorkStudyInput } from "../../../src/models/workflows/work-study/input.js";
import { descriptorRuntimeNodes, workflowDryRunSupport } from "../../../src/workflow-kit/workflow.js";
import { compileWorkflow } from "../../../src/workflow-kit/workflow-definition.js";
import { workStudyWorkflow } from "../../../src/workflows/work-study/workflow.js";

const ingress = WorkStudyInput;
const descriptor = compileWorkflow(workStudyWorkflow).descriptor;

it("accepts an Empl ID with an ISO effective date", () => {
  expect(ingress.safeParse({ emplId: "10000001", effectiveDate: "2026-08-03" }).success).toBe(true);
});

it.each([
  ["a short Empl ID", { emplId: "12345", effectiveDate: "2026-08-03" }],
  ["an Empl ID outside the EID range", { emplId: "20000001", effectiveDate: "2026-08-03" }],
  ["a US-format date", { emplId: "10000001", effectiveDate: "08/03/2026" }],
  ["an impossible date", { emplId: "10000001", effectiveDate: "2026-02-30" }],
  ["an unknown key", { emplId: "10000001", effectiveDate: "2026-08-03", extra: "x" }],
])("refuses %s", (_name, value) => {
  expect(ingress.safeParse(value).success).toBe(false);
});

it("compiles the sign-in and plan steps with no write node and no dry-run support", () => {
  expect(descriptor.timeline.map(step => [step.key, step.label])).toEqual([["ucpath-auth", "Sign in to UCPath"], ["transaction", "Submit work-study transaction"]]);
  expect(descriptorRuntimeNodes(descriptor).some(node => node.kind === "transaction")).toBe(false);
  expect(workflowDryRunSupport(descriptor).state).not.toBe("supported");
});
