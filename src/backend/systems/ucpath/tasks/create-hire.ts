import { defineTask } from "../../../../workflow-kit/task.js";
import { ucpathDriver } from "../driver-declaration.js";
import { runHireOperation } from "../hire-task-error.js";
import { UcpathCreateHire } from "../../../../models/systems/ucpath/hire-tasks.js";

export const createHireTask = defineTask(ucpathDriver, UcpathCreateHire, {
  sessions: [{ system: "ucpath", access: "transaction", session: "reuse-worker" }],
  run: ({ ctx }) => runHireOperation(ctx, async () => {
    const output = UcpathCreateHire.output.parse({ receipt: await ctx.driver.submitHire(ctx.mutation) });
    ctx.recordData([{ direction: "read", field: "receipt", value: output.receipt }]);
    return output;
  }),
});

