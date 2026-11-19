import { defineWorkflowStore } from "../../workflow-kit/task-registry.js";
import { readWorkStudyReferenceStopTask } from "./tasks/read-reference-stop.js";
import { readWorkStudyTransactionPlanTask } from "./tasks/read-transaction-plan.js";

export const workStudyStore = defineWorkflowStore("work-study", { readTransactionPlan: readWorkStudyTransactionPlanTask, readReferenceStop: readWorkStudyReferenceStopTask });
