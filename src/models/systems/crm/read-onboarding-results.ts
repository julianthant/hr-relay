import { z } from "zod";
import { taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { CrmDiscoveredRecordSchema, CrmSearchOnboardingRecords } from "./search-onboarding-records.js";

export const CrmReadOnboardingResults = defineTaskContract({
  id: taskId("crm/read-onboarding-results"), title: "Read unresolved CRM results", effect: "read",
  input: z.strictObject({ query: CrmSearchOnboardingRecords.input, records: z.array(CrmDiscoveredRecordSchema) }),
  output: z.strictObject({ records: z.array(CrmDiscoveredRecordSchema) }),
  errorCodes: ["PERSON_LOOKUP_CRM_CHECK_FAILED", "PERSON_LOOKUP_CRM_RESULTS_CHANGED", "BROWSER_SCREENSHOT_CAPTURE_FAILED"],
  subject: { kind: "none", reason: "revalidates unresolved discovery results without selecting a person" },
  freshness: { defaultMaxAgeMs: 3600000, defaultOverride: "forbidden" }, provenance: { default: "live" },
  scenarios: ["person-lookup/s8", "person-lookup/s11"], example: { records: [] },
});
