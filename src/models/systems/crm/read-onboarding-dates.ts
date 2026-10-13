import { z } from "zod";
import { DateOnlySchema, EidSchema, ObservationIdSchema, taskId } from "../../../rules/identity/ids.js";
import { ContractFieldPathSchema, defineTaskContract } from "../../task/task-contract.js";

export class PersonLookupCrmDatesCheckError extends Error {
  readonly code = "person-lookup-crm-dates-check-failed" as const;
  constructor(cause: unknown) { super("CRM dates check failed.", { cause }); this.name = "PersonLookupCrmDatesCheckError"; }
}

const datesFields = {
  emplId: EidSchema,
  employmentDate: DateOnlySchema.nullable(), oathDate: DateOnlySchema.nullable(),
  reason: z.string(),
};
export const ReadOnboardingDatesOutputSchema = z.discriminatedUnion("state", [
  z.strictObject({ ...datesFields, state: z.literal("read") }),
  z.strictObject({ ...datesFields, state: z.literal("no-confident-record") }),
  z.strictObject({ ...datesFields, state: z.literal("check-failed"), code: z.literal("person-lookup-crm-dates-check-failed") }),
]);
export type ReadOnboardingDatesOutput = z.infer<typeof ReadOnboardingDatesOutputSchema>;

export const CrmReadOnboardingDates = defineTaskContract({
  id: taskId("crm/read-onboarding-dates"),
  title: "CRM Dates",
  effect: "read",
  input: z.strictObject({ eid: EidSchema, name: z.string().min(1) }),
  output: ReadOnboardingDatesOutputSchema,
  errorCodes: ["person-lookup-crm-dates-check-failed", "crm-unavailable", "unexpected-page-state", "subject-mismatch"],
  subject: {
    kind: "person",
    expected: { fromInput: ContractFieldPathSchema.parse("eid"), identity: "eid" },
    observe: ObservationIdSchema.parse("crm.onboarding.displayed-eid"),
    match: "normalized-exact-eid",
    requiredAt: "before-subject-read",
  },
  freshness: { defaultMaxAgeMs: 60 * 60 * 1000, defaultOverride: "audited" },
  provenance: { default: "live" },
  scenarios: [
    "person-lookup/s16",
  ],
  example: { emplId: "10000001", state: "no-confident-record", employmentDate: null, oathDate: null, reason: "No confident CRM record" },
});
