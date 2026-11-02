import { defineWorkflowStore } from "../../workflow-kit/task-registry.js";
import { readSearchPlanTask } from "./tasks/read-search-plan.js";
import { readMatchOutcomeTask } from "./tasks/read-match-outcome.js";
import { readRetentionRowTask } from "./tasks/read-retention-row.js";

export const i9CheckStore = defineWorkflowStore("i9-check", {
  readSearchPlan: readSearchPlanTask, readMatchOutcome: readMatchOutcomeTask, readRetentionRow: readRetentionRowTask,
});
