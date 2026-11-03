import { TaskError } from "../../../../workflow-kit/errors.js";
import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
import { defineTask } from "../../../../workflow-kit/task.js";
import { I9CreateRemoteRecord } from "../../../../models/systems/i9/create-remote-record.js";
import { I9RemoteProofSchema } from "../../../../models/ui/i9-creation.js";
import { i9Driver } from "../driver-declaration.js";

export const createRemoteRecordTask = defineTask(i9Driver, I9CreateRemoteRecord, {
  sessions: [{ system: "i9", access: "transaction", session: "reuse-worker" }],
  async run({ ctx }) {
    try {
      const receipt = I9RemoteProofSchema.parse(await ctx.driver.createRemote(ctx.mutation));
      ctx.recordData({ direction: "read", field: "receipt", value: receipt });
      return { receipt };
    } catch (cause) {
      if (ctx.signal.aborted || cause instanceof TaskError) throw cause;
      return ctx.fail("I9_WRITE_REFUSED", ERROR_CATALOG.I9_WRITE_REFUSED.text, { cause });
    }
  },
});
