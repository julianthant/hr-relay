import { defineTask } from "../../../../workflow-kit/task.js";
import { ucpathDriver } from "../driver-declaration.js";
import { runHireOperation } from "../hire-task-error.js";
import { UcpathReadHireFindings } from "../../../../models/systems/ucpath/hire-tasks.js";

export const readHireFindingsTask = defineTask(ucpathDriver, UcpathReadHireFindings, {
  sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }],
  run: ({ input, ctx }) => runHireOperation(ctx, async () => {
    const output = UcpathReadHireFindings.output.parse(await ctx.driver.scanHireTransactions(input));
    ctx.recordData([{ direction: "read", field: "state", value: output.state }, { direction: "read", field: "rows", value: output.rows },
      { direction: "read", field: "observedAt", value: output.observedAt }, { direction: "read", field: "source", value: output.source }]);
    return output;
  }),
});
