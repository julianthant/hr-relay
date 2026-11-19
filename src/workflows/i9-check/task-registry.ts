import { defineWorkflowStore } from "../../workflow-kit/task-registry.js";
import { readMatchOutcomeTask } from "./tasks/read-match-outcome.js";
import { readRetentionRowTask } from "./tasks/read-retention-row.js";
import { readEmploymentCandidatesTask } from "./tasks/read-employment-candidates.js";

export const i9CheckStore = defineWorkflowStore("i9-check", {
  readMatchOutcome: readMatchOutcomeTask, readEmploymentCandidates: readEmploymentCandidatesTask, readRetentionRow: readRetentionRowTask,
});
