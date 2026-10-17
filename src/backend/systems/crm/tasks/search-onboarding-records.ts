import { defineTask } from "../../../../workflow-kit/task.js";
import { CrmSearchOnboardingRecords, CrmDiscoveryOutputSchema, PersonLookupCrmCheckError } from "../../../../models/systems/crm/search-onboarding-records.js";
import { crmDriver } from "../driver-declaration.js";

const RECORD_FIELDS = ["Employee First Name", "Employee Last Name", "UCPath Employee ID", "First Day of Service (Effective Date)", "Department", "Date Signed"] as const;
const ERROR_NAMES = new Set(["Error", "TimeoutError", "TypeError", "RangeError", "ZodError", "CrmRecordIdentityDriftError"]);

function crmCauseDiagnostic(error: unknown): Readonly<{ errorName: string; errorMessage: string }> {
  if (!(error instanceof Error)) return { errorName: "NonError", errorMessage: "Non-Error driver detail withheld" };
  const errorName = ERROR_NAMES.has(error.name) ? error.name : "Error";
  const message = error.message;
  const dynamicFailures = [
    [/^CRM navigation expected record [\s\S]+ but landed on a different record id$/u, "CRM navigation landed on a different record id"],
    [/^CRM navigation expected https:\/\/act-crm\.my\.site\.com\/hr\/(?:ONB_ViewOnboarding|ONB_SearchOnboardings) but landed on [\s\S]+$/u, "CRM navigation left the expected host or path"],
    [/^CRM search expected query [\s\S]+ but the rendered page used a different query$/u, "CRM rendered page used a different search query"],
    [/^CRM onboarding record link [\s\S]+ is missing its record id$/u, "CRM onboarding record link is missing its record id"],
    [/^CRM UI registry has no element crm\.onboarding\.(?:search-result-rows|search-result-row-cells|search-result-name-link|record-field-value)$/u, "CRM UI registry is missing a required element"],
  ] as const;
  for (const [pattern, errorMessage] of dynamicFailures) {
    if (pattern.test(message)) return { errorName, errorMessage };
  }
  if (errorName === "ZodError") return { errorName, errorMessage: "CRM driver data failed schema validation; issue details withheld" };
  const field = RECORD_FIELDS.find(label => [
    `CRM record field "${label}"`, `hasText: '${label}'`, `hasText: "${label}"`,
    `hasText: /^\\s*${label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\s*$/u`,
  ].some(fragment => message.includes(fragment)));
  if (field !== undefined) {
    const prefix = `CRM record field "${field}"`;
    const suffix = message.slice(prefix.length);
    if (message.startsWith(prefix) && /^(?: resolved \d+ values; expected exactly one| rendered without text| was blank)$/u.test(suffix)) {
      return { errorName, errorMessage: message };
    }
  }
  const date = /^CRM (First Day of Service|Date Signed) date "[\s\S]*" is (not M\/D\/YYYY with an optional time|not a real calendar date)$/u.exec(message);
  if (date !== null) return { errorName, errorMessage: `CRM ${date[1]} date "[withheld]" is ${date[2]}` };
  const timeout = /^(locator\.(?:waitFor|textContent|count|getAttribute)|page\.goto): Timeout (\d+)ms exceeded\./u.exec(message);
  if (timeout !== null) return { errorName, errorMessage: `${timeout[1]}: Timeout ${timeout[2]}ms exceeded.${field === undefined ? "" : ` CRM record field "${field}"`}` };
  if (/^CRM (?:discovery results changed before capture|search rendered data rows and the no-results state simultaneously|search rendered more than one auxiliary two-cell row|expected exactly one heading "Search Results" but found \d+|(?:search-result (?:row|cells|link)|record-field) recipe changed kind unexpectedly|onboarding search query cannot be blank|search row \d+ (?:name|process stage) (?:rendered without text|was blank)|search row \d+ (?:had \d+ direct cells; expected exactly 5|had \d+ record links; expected exactly one|record link had no href)|zero-result search expected one verified empty-state heading but found \d+)$/u.test(message)) {
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
