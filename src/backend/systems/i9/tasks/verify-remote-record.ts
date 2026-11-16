import { TaskError } from "../../../../workflow-kit/errors.js";
import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
import { i9CreationObservations } from "../creation-observations.js";
import { defineTask } from "../../../../workflow-kit/task.js";
import { I9VerifyRemoteRecord } from "../../../../models/systems/i9/verify-remote-record.js";
import { I9RemoteVerdictSchema } from "../../../../models/ui/i9-creation.js";
import { i9Driver } from "../driver-declaration.js";

export const verifyRemoteRecordTask = defineTask(i9Driver, I9VerifyRemoteRecord, {
  sessions: [{ system: "i9", access: "read", session: "reuse-worker" }],
  async run({ input, ctx }) {
    try {
      const output = I9RemoteVerdictSchema.parse(await ctx.driver.probeRemote(input));
      ctx.recordData(i9CreationObservations(output));
      return output;
    } catch (cause) {
      if (ctx.signal.aborted || cause instanceof TaskError) throw cause;
      return ctx.fail("I9_WRITE_REFUSED", ERROR_CATALOG.I9_WRITE_REFUSED.text, { cause });
    }
  },
});
