import { CrmDiscoveredRecordSchema, CrmDiscoveryOutputSchema } from "./search-onboarding-records.js";
import { ObservationIdSchema, taskId } from "../../../rules/identity/ids.js";
import { ContractFieldPathSchema, defineTaskContract } from "../../task/task-contract.js";

export const CrmVerifyOnboardingRecord = defineTaskContract({
  id: taskId("crm/verify-onboarding-record"), title: "Verify selected CRM record", effect: "read",
  input: CrmDiscoveredRecordSchema, output: CrmDiscoveryOutputSchema,
  errorCodes: ["BROWSER_SCREENSHOT_CAPTURE_FAILED", "PERSON_LOOKUP_CRM_CHECK_FAILED", "PERSON_LOOKUP_CRM_RECORD_IDENTITY_DRIFT"],
  subject: { kind: "person", expected: { fromInput: ContractFieldPathSchema.parse("emplId"), identity: "eid" }, observe: ObservationIdSchema.parse("crm.onboarding.displayed-eid"), match: "normalized-exact-eid", requiredAt: "before-subject-read" },
  freshness: { defaultMaxAgeMs: 3600000, defaultOverride: "forbidden" }, provenance: { default: "live" },
  scenarios: ["person-lookup/f2"], example: { state: "checked", records: [] },
});
