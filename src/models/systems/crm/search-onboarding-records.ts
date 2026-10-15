import { ERROR_CATALOG, type ErrorCatalogCode } from "../../failures/error-catalog.js";
import { z } from "zod";
import { EidSchema, taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";

export const CrmDiscoveredRecordSchema = z.strictObject({
  recordId: z.string().min(1), recordUrl: z.url(), emplId: EidSchema,
  name: z.string().min(1), department: z.string(), firstDayOfService: z.string(), dateSigned: z.string(),
});
export type CrmDiscoveredRecord = z.infer<typeof CrmDiscoveredRecordSchema>;
export const CrmDiscoveryOutputSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("checked"), records: z.array(CrmDiscoveredRecordSchema) }),
  z.strictObject({ state: z.literal("check-failed"), code: z.literal("PERSON_LOOKUP_CRM_CHECK_FAILED"), reason: z.string().min(1) }),
]);
export const CrmSearchOnboardingRecords = defineTaskContract({
  id: taskId("crm/search-onboarding-records"), title: "Cross-check identity", effect: "read",
  input: z.strictObject({ name: z.string().min(1).optional(), eid: EidSchema.optional() }).refine(input => input.name !== undefined || input.eid !== undefined), output: CrmDiscoveryOutputSchema,
  errorCodes: ["PERSON_LOOKUP_CRM_CHECK_FAILED"],
  subject: { kind: "none", reason: "discovery reads exact displayed identities before the workflow resolves one" },
  freshness: { defaultMaxAgeMs: 3600000, defaultOverride: "forbidden" }, provenance: { default: "live" },
  scenarios: ["person-lookup/s7", "person-lookup/s11", "person-lookup/f2"],
  example: { state: "checked", records: [] },
});

export class CrmRecordIdentityDriftError extends Error {
  constructor(readonly code: Extract<ErrorCatalogCode, "PERSON_LOOKUP_CRM_RECORD_IDENTITY_DRIFT"> = "PERSON_LOOKUP_CRM_RECORD_IDENTITY_DRIFT") { super(ERROR_CATALOG[code].text); this.name = "CrmRecordIdentityDriftError"; }
}

export class PersonLookupCrmCheckError extends Error {
  constructor(cause: unknown, readonly code: Extract<ErrorCatalogCode, "PERSON_LOOKUP_CRM_CHECK_FAILED"> = "PERSON_LOOKUP_CRM_CHECK_FAILED") { super(ERROR_CATALOG[code].text, { cause }); this.name = "PersonLookupCrmCheckError"; }
}
