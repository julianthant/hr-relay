import { WorkStudyPlanTransaction } from "../../../models/workflows/work-study/plan-transaction.js";
import { defineTask } from "../../../workflow-kit/task.js";

export const PLAN_TRANSACTION_NODE = "plan-transaction";

export const planWorkStudyTransactionTask = defineTask(WorkStudyPlanTransaction, {
  sessions: [],
  async run({ input, ctx }) {
    throw new Error(`not implemented: planWorkStudyTransactionTask(${input.input.emplId}, ${String(ctx.signal.aborted)})`);
  },
});
