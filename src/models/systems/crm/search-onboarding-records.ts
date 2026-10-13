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
  z.strictObject({ state: z.literal("check-failed"), code: z.literal("person-lookup-crm-check-failed"), reason: z.string().min(1) }),
]);
export const CrmSearchOnboardingRecords = defineTaskContract({
  id: taskId("crm/search-onboarding-records"), title: "Cross-check identity", effect: "read",
  input: z.strictObject({ name: z.string().min(1).optional(), eid: EidSchema.optional() }).refine(input => input.name !== undefined || input.eid !== undefined), output: CrmDiscoveryOutputSchema,
  errorCodes: ["person-lookup-crm-check-failed"],
  subject: { kind: "none", reason: "discovery reads exact displayed identities before the workflow resolves one" },
  freshness: { defaultMaxAgeMs: 3600000, defaultOverride: "forbidden" }, provenance: { default: "live" },
  scenarios: ["person-lookup/s7", "person-lookup/s11", "person-lookup/f2"],
  example: { state: "checked", records: [] },
});

export class CrmRecordIdentityDriftError extends Error {
  readonly code = "person-lookup-crm-record-identity-drift";
  constructor() { super("CRM selected record identity changed."); this.name = "CrmRecordIdentityDriftError"; }
}

export class PersonLookupCrmCheckError extends Error {
  readonly code = "person-lookup-crm-check-failed" as const;
  constructor(cause: unknown) { super("CRM check failed.", { cause }); this.name = "PersonLookupCrmCheckError"; }
}
