import { defineTask } from "../../../../workflow-kit/task.js";
import { CrmSearchOnboardingRecords, CrmDiscoveryOutputSchema, PersonLookupCrmCheckError } from "../../../../models/systems/crm/search-onboarding-records.js";
import { crmDriver } from "../driver-declaration.js";

const RECORD_FIELDS = ["Employee First Name", "Employee Last Name", "UCPath Employee ID", "First Day of Service (Effective Date)", "Department", "Date Signed"] as const;
const ERROR_NAMES = new Set(["Error", "TimeoutError", "TypeError", "RangeError", "ZodError", "CrmRecordIdentityDriftError"]);

function crmCauseDiagnostic(error: unknown): Readonly<{ errorName: string; errorMessage: string }> {
  if (!(error instanceof Error)) return { errorName: "NonError", errorMessage: "Non-Error driver detail withheld" };
  const errorName = ERROR_NAMES.has(error.name) ? error.name : "Error";
  const message = error.message;
  const field = RECORD_FIELDS.find(label => [
    `CRM record field "${label}"`, `hasText: '${label}'`, `hasText: "${label}"`,
  ].some(fragment => message.includes(fragment)));
  if (field !== undefined) {
    const prefix = `CRM record field "${field}"`;
    const suffix = message.slice(prefix.length);
    if (message.startsWith(prefix) && /^(?: resolved \d+ values; expected exactly one| rendered without text| was blank)$/u.test(suffix)) {
      return { errorName, errorMessage: message };
    }
  }
  const timeout = /^(locator\.(?:waitFor|textContent|count|getAttribute)|page\.goto): Timeout (\d+)ms exceeded\./u.exec(message);
  if (timeout !== null) return { errorName, errorMessage: `${timeout[1]}: Timeout ${timeout[2]}ms exceeded.${field === undefined ? "" : ` CRM record field "${field}"`}` };
  if (/^CRM (?:discovery results changed before capture|search rendered data rows and the no-results state simultaneously|search rendered more than one auxiliary two-cell row)$/u.test(message)) {
    return { errorName, errorMessage: message };
  }
  return { errorName, errorMessage: "Unrecognized driver error detail withheld" };
}

export const searchOnboardingRecordsTask = defineTask(crmDriver, CrmSearchOnboardingRecords, {
  sessions: [{ system: "crm", access: "read", session: "reuse-worker" }],
  async run({ input, ctx }) {
    let output: import("zod").z.output<typeof CrmDiscoveryOutputSchema>;
    try { output = { state: "checked" as const, records: await ctx.driver.searchOnboardingRecords(input) }; }
    catch (error) {
      if (ctx.signal.aborted) throw error;
      ctx.log.debug("CRM check cause", crmCauseDiagnostic(error));
      const failure = new PersonLookupCrmCheckError(error);
      output = { state: "check-failed" as const, code: failure.code, reason: failure.message };
    }
    ctx.recordData(Object.entries<unknown>(output).map(([field, value]) => ({ direction: "read" as const, field, value })));
    return output;
  },
});
