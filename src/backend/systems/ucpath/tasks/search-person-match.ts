import { PersonLookupUcpathSearchError } from "../../../../models/systems/ucpath/search-person-match.js";
import { defineTask } from "../../../../workflow-kit/task.js";
import { SearchPersonMatch } from "../../../../models/systems/ucpath/search-person-match.js";
import { ucpathDriver } from "../driver-declaration.js";

export const searchPersonMatchTask = defineTask(ucpathDriver, SearchPersonMatch, {
  screenshots: "task",
  sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }],
  async run({ input, ctx }) {
    let output;
    try { output = await ctx.driver.searchPersonMatch(input); } catch (error) {
      if (ctx.signal.aborted) throw error;
      const failure = new PersonLookupUcpathSearchError(error);
      return ctx.fail(failure.code, failure.message, { cause: failure });
    }
    await ctx.captureScreenshot();
    ctx.recordData(Object.entries(output).map(([field, value]) => ({ direction: "read" as const, field, value })));
    return output;
  },
});
