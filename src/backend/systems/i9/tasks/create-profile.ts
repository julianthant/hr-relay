import { TaskError } from "../../../../workflow-kit/errors.js";
import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
import { defineTask } from "../../../../workflow-kit/task.js";
import { I9CreateProfile } from "../../../../models/systems/i9/create-profile.js";
import { I9ProfileProofSchema } from "../../../../models/ui/i9-creation.js";
import { i9Driver } from "../driver-declaration.js";

export const createProfileTask = defineTask(i9Driver, I9CreateProfile, {
  sessions: [{ system: "i9", access: "transaction", session: "reuse-worker" }],
  async run({ ctx }) {
    try {
      const receipt = I9ProfileProofSchema.parse(await ctx.driver.saveProfile(ctx.mutation));
      ctx.recordData({ direction: "read", field: "receipt", value: receipt });
      return { receipt };
    } catch (cause) {
      if (ctx.signal.aborted || cause instanceof TaskError) throw cause;
      return ctx.fail("I9_WRITE_REFUSED", ERROR_CATALOG.I9_WRITE_REFUSED.text, { cause });
    }
  },
});
