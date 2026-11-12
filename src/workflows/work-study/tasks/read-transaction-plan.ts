import { WorkStudyReadTransactionPlan } from "../../../models/workflows/work-study/read-transaction-plan.js";
import { defineTask } from "../../../workflow-kit/task.js";

export const TRANSACTION_PLAN_NODE = "transaction-plan";

export const readWorkStudyTransactionPlanTask = defineTask(WorkStudyReadTransactionPlan, {
  sessions: [],
  async run({ input, ctx }) {
    throw new Error(`not implemented: readWorkStudyTransactionPlanTask(${input.input.emplId}, ${String(ctx.signal.aborted)})`);
  },
});
