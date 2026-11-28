import { defineWorkflowStore } from "../../workflow-kit/task-registry.js";
import { readWorkStudyTransactionPlanTask } from "./tasks/read-transaction-plan.js";

export const workStudyStore = defineWorkflowStore("work-study", { readTransactionPlan: readWorkStudyTransactionPlanTask });
