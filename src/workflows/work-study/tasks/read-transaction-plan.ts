import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { evidenceLeaves } from "../../../models/trust/evidence-classification.js";
import { WorkStudyReadTransactionPlan } from "../../../models/workflows/work-study/read-transaction-plan.js";
import { planWorkStudyTransaction, WorkStudyPlanRefusedError } from "../../../rules/work-study/plan.js";
import { defineTask } from "../../../workflow-kit/task.js";

export const TRANSACTION_PLAN_NODE = "transaction-plan";

export const readWorkStudyTransactionPlanTask = defineTask(WorkStudyReadTransactionPlan, {
  sessions: [],
  async run({ input, ctx }) {
    let plan: ReturnType<typeof planWorkStudyTransaction>;
    try { plan = planWorkStudyTransaction(input.input, input.read); }
    catch (cause) {
      if (!(cause instanceof WorkStudyPlanRefusedError)) throw cause;
      return ctx.fail("INCONSISTENT_INPUTS", ERROR_CATALOG.INCONSISTENT_INPUTS.text, { cause });
    }
    ctx.recordData(evidenceLeaves(plan).map(({ path, value }) => ({ direction: "read" as const, field: path, value })));
    return plan;
  },
});
