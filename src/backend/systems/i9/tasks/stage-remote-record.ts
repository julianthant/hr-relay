import { TaskError } from "../../../../workflow-kit/errors.js";
import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
import { defineTask } from "../../../../workflow-kit/task.js";
import { I9StageRemoteRecord } from "../../../../models/systems/i9/stage-remote-record.js";
import { i9Driver } from "../driver-declaration.js";

export const stageRemoteRecordTask = defineTask(i9Driver, I9StageRemoteRecord, {
  sessions: [{ system: "i9", access: "transaction", session: "reuse-worker" }],
  async run({ input, ctx }) {
    try {
      const output = I9StageRemoteRecord.output.parse(await ctx.driver.prepareRemote(input, ctx.captureScreenshot));
      ctx.recordData(Object.entries(output).map(([field, value]) => ({ direction: "read" as const, field, value })));
      return output;
    } catch (cause) {
      if (ctx.signal.aborted || cause instanceof TaskError) throw cause;
      return ctx.fail("I9_WRITE_REFUSED", ERROR_CATALOG.I9_WRITE_REFUSED.text, { cause });
    }
  },
});
