import { defineTask } from "../../../../workflow-kit/task.js";
import {
  SearchPersonOrg,
  SearchPersonOrgOutputSchema,
} from "../../../../models/systems/ucpath/search-person-org.js";
import { PersonLookupUcpathSearchError } from "../../../../models/systems/ucpath/search-person-match.js";
import { ucpathDriver } from "../driver-declaration.js";


export const searchPersonOrgTask = defineTask(ucpathDriver, SearchPersonOrg, {
  screenshots: "task",
  sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }],
  retry: { attempts: 2, backoffMs: 2_000, retryOn: "transient" },
  async run({ input, ctx }) {
    let output;
    try { output = SearchPersonOrgOutputSchema.parse(await ctx.driver.searchPersonOrg(input)); }
    catch (error) {
      if (ctx.signal.aborted) throw error;
      const failure = new PersonLookupUcpathSearchError(error);
      return ctx.fail(failure.code, failure.message, { cause: failure });
    }
    await ctx.captureScreenshot();
    ctx.recordData([
      { direction: "read", field: "results", value: output.results },
      { direction: "read", field: "selection", value: output.selection },
    ]);
    return output;
  },
});
