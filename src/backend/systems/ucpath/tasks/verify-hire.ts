import { defineTask } from "../../../../workflow-kit/task.js";
import { ucpathDriver } from "../driver-declaration.js";
import { runHireOperation } from "../hire-task-error.js";
import { UcpathVerifyHire } from "../../../../models/systems/ucpath/hire-tasks.js";
import { ucpathHireVerdict } from "../hire-verdict.js";

export const verifyHireTask = defineTask(ucpathDriver, UcpathVerifyHire, {
  sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }],
  run: ({ input, ctx }) => runHireOperation(ctx, async () => {
    const output = ucpathHireVerdict(input, await ctx.driver.scanHireTransactions(input));
    ctx.recordData([{ direction: "read", field: "state", value: output.state }]);
    return output;
  }),
});
