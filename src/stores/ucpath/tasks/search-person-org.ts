import { defineTask } from "../../../base/task.js";
import {
  SearchPersonOrg,
  SearchPersonOrgOutputSchema,
} from "../../../domain/contracts/ucpath/search-person-org.js";
import { ucpathDriver } from "../driver-declaration.js";

/** Ported semantic operation: legacy 793abe1, src/workflows/person-lookup/lookup.ts. */
export const searchPersonOrgTask = defineTask(ucpathDriver, SearchPersonOrg, {
  sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }],
  retry: { attempts: 2, backoffMs: 2_000, retryOn: "transient" },
  async run({ input, ctx }) {
    return SearchPersonOrgOutputSchema.parse(await ctx.driver.searchPersonOrg(input));
  },
});
