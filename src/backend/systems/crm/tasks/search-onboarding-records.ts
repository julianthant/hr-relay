import { defineTask } from "../../../../workflow-kit/task.js";
import { CrmSearchOnboardingRecords, CrmDiscoveryOutputSchema, PersonLookupCrmCheckError } from "../../../../models/systems/crm/search-onboarding-records.js";
import { crmDriver } from "../driver-declaration.js";

export const searchOnboardingRecordsTask = defineTask(crmDriver, CrmSearchOnboardingRecords, {
  sessions: [{ system: "crm", access: "read", session: "reuse-worker" }],
  async run({ input, ctx }) {
    let output: import("zod").z.output<typeof CrmDiscoveryOutputSchema>;
    try { output = { state: "checked" as const, records: await ctx.driver.searchOnboardingRecords(input) }; }
    catch (error) {
      if (ctx.signal.aborted) throw error;
      const failure = new PersonLookupCrmCheckError(error);
      output = { state: "check-failed" as const, code: failure.code, reason: failure.message };
    }
    ctx.recordData(Object.entries<unknown>(output).map(([field, value]) => ({ direction: "read" as const, field, value })));
    return output;
  },
});
