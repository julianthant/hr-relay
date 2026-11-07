import { defineTask } from "../../../../workflow-kit/task.js";
import { CrmVerifyOnboardingRecord } from "../../../../models/systems/crm/verify-onboarding-record.js";
import { CrmDiscoveryOutputSchema, CrmRecordIdentityDriftError, PersonLookupCrmCheckError } from "../../../../models/systems/crm/search-onboarding-records.js";
import { crmDriver } from "../driver-declaration.js";

export const verifyOnboardingRecordTask = defineTask(crmDriver, CrmVerifyOnboardingRecord, {
  screenshots: "task",
  sessions: [{ system: "crm", access: "read", session: "reuse-worker" }],
  async run({ input, ctx }) {
    let output: import("zod").z.output<typeof CrmDiscoveryOutputSchema>;
    try { output = { state: "checked", records: [await ctx.driver.verifyOnboardingRecord(input)] }; }
    catch (error) {
      if (ctx.signal.aborted) throw error;
      if (error instanceof CrmRecordIdentityDriftError) return ctx.fail(error.code, error.message, { cause: error });
      const failure = new PersonLookupCrmCheckError(error);
      output = { state: "check-failed", code: failure.code, reason: failure.message };
    }
    if (output.state === "checked") await ctx.captureScreenshot();
    ctx.recordData(Object.entries<unknown>(output).map(([field, value]) => ({ direction: "read" as const, field, value })));
    return output;
  },
});
