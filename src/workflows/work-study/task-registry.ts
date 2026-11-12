import { defineWorkflowStore } from "../../workflow-kit/task-registry.js";
import { planWorkStudyTransactionTask } from "./tasks/plan-transaction.js";

export const workStudyStore = defineWorkflowStore("work-study", { planTransaction: planWorkStudyTransactionTask });
