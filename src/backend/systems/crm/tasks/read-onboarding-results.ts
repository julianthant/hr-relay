import { defineTask } from "../../../../workflow-kit/task.js";
import { CrmReadOnboardingResults } from "../../../../models/systems/crm/read-onboarding-results.js";
import { CrmDiscoveredRecordSchema, PersonLookupCrmCheckError } from "../../../../models/systems/crm/search-onboarding-records.js";
import { canonicalJsonStringify } from "../../../../rules/validation/canonical-json.js";
import { crmDriver } from "../driver-declaration.js";

export const readOnboardingResultsTask = defineTask(crmDriver, CrmReadOnboardingResults, {
  sessions: [{ system: "crm", access: "read", session: "reuse-worker" }], screenshots: "task",
  async run({ input, ctx }) {
    let records;
    try { records = CrmDiscoveredRecordSchema.array().parse(await ctx.driver.searchOnboardingRecords(input.query)); }
    catch (cause) {
      if (ctx.signal.aborted) throw cause;
      const failure = new PersonLookupCrmCheckError(cause);
      return ctx.fail(failure.code, failure.message, { cause: failure });
    }
    if (canonicalJsonStringify(records) !== canonicalJsonStringify(input.records)) {
      return ctx.fail("PERSON_LOOKUP_CRM_RESULTS_CHANGED", "CRM results changed before capture.");
    }
    await ctx.captureScreenshot();
    ctx.recordData({ direction: "read", field: "records", value: records });
    return { records };
  },
});
