import { I9LookupError, I9ReadSection2Signer, I9SignerOutputSchema } from "../../../../models/systems/i9/read-section2-signer.js";
import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
import { defineTask } from "../../../../workflow-kit/task.js";
import { i9Driver } from "../driver-declaration.js";

export const readSection2SignerTask = defineTask(i9Driver, I9ReadSection2Signer, {
  screenshots: "task",
  sessions: [{ system: "i9", access: "read", session: "reuse-worker" }],
  async run({ input, ctx }) {
    let output;
    try {
      output = I9SignerOutputSchema.parse(await ctx.driver.readSection2Signer(input));
    } catch (error) {
      if (ctx.signal.aborted) throw error;
      const code = error instanceof I9LookupError ? error.code : "I9_LOOKUP_FAILED";
      return ctx.fail(code, ERROR_CATALOG[code].text, { cause: error });
    }
    ctx.recordData(Object.entries(output).map(([field, value]) => ({ direction: "read" as const, field, value })));
    await ctx.captureScreenshot();
    return output;
  },
});
