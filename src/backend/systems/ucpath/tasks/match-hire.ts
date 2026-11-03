import { defineTask } from "../../../../workflow-kit/task.js";
import { ucpathDriver } from "../driver-declaration.js";
import { runHireOperation } from "../hire-task-error.js";
import { UcpathMatchHire } from "../../../../models/systems/ucpath/match-hire.js";
import { ucpathHireVerdict } from "../../../../rules/ucpath/hire-verdict.js";

export const matchHireTask = defineTask(ucpathDriver, UcpathMatchHire, {
  sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }],
  run: ({ input, ctx }) => runHireOperation(ctx, async () => {
    const output = ucpathHireVerdict(input, await ctx.driver.scanHireTransactions(input));
    ctx.recordData([{ direction: "read", field: "state", value: output.state }]);
    return output;
  }),
});
