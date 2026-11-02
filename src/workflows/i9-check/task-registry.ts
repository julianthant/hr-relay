import { defineWorkflowStore } from "../../workflow-kit/task-registry.js";
import { readSearchPlanTask, readMatchOutcomeTask, readRetentionRowTask } from "./tasks/read-check.js";

export const i9CheckStore = defineWorkflowStore("i9-check", {
  readSearchPlan: readSearchPlanTask, readMatchOutcome: readMatchOutcomeTask, readRetentionRow: readRetentionRowTask,
});
