import { defineWorkflow } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowRole } from "../../../../workflow-kit/validation/module-role.js";
import { i9CheckWorkflow } from "../../workflow.js";

export const i9CheckRosterMatchWorkflow = defineWorkflow({
  ...i9CheckWorkflow,
  id: "i9-check-roster-match", code: "icr", label: "I-9 retention roster proof",
  summary: "Proves the I-9 roster/retention result with its prerequisite UCPath reads.",
  surface: { shape: "single" },
  role: defineWorkflowRole({ kind: "chunk-harness", of: "i9-check", step: "roster-match" }),
  steps: () => ({ steps: i9CheckWorkflow.steps, result: i9CheckWorkflow.result }),
});
