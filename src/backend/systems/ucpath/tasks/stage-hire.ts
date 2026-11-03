import { defineTask } from "../../../../workflow-kit/task.js";
import { ucpathDriver } from "../driver-declaration.js";
import { runHireOperation } from "../hire-task-error.js";
import { UcpathStageHire } from "../../../../models/systems/ucpath/stage-hire.js";

export const stageHireTask = defineTask(ucpathDriver, UcpathStageHire, {
  sessions: [{ system: "ucpath", access: "transaction", session: "reuse-worker" }],
  run: ({ input, ctx }) => runHireOperation(ctx, async () => {
    const output = UcpathStageHire.output.parse(await ctx.driver.stageHire(input, ctx.captureScreenshot));
    ctx.recordData([{ direction: "read", field: "observedName", value: output.observedName },
      { direction: "read", field: "stagedPageState", value: output.stagedPageState },
      { direction: "read", field: "transactionIdDisplay", value: output.transactionIdDisplay },
      { direction: "read", field: "template", value: output.template }, { direction: "read", field: "reason", value: output.reason }]);
    return output;
  }),
});
