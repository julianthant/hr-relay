/** The optional dates step behind person-lookup's `includeCrmDates` flag; each date is an explicit present/absent arm, because a blank and an unrecorded date look identical once flattened. */
import { z } from "zod";
import { DateOnlySchema, EidSchema, ObservationIdSchema, taskId } from "../../../rules/identity/ids.js";
import { ContractFieldPathSchema, defineTaskContract } from "../../task/task-contract.js";

const OptionalDateSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("present"), value: DateOnlySchema }),
  z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
]);

export const ReadOnboardingDatesOutputSchema = z.strictObject({
  emplId: EidSchema,
  /** Onboarding History transition whose New Value is Offer Letter Sent. */
  invitedOn: OptionalDateSchema,
  /** Onboarding record's First Day of Service. */
  startsOn: OptionalDateSchema,
  /** Onboarding History transition whose New Value is Completed. Date Signed is not this field. */
  completedOn: OptionalDateSchema,
});
export type ReadOnboardingDatesOutput = z.infer<typeof ReadOnboardingDatesOutputSchema>;

export const CrmReadOnboardingDates = defineTaskContract({
  id: taskId("crm/read-onboarding-dates"),
  title: "CRM Dates",
  effect: "read",
  input: z.strictObject({ eid: EidSchema }),
  output: ReadOnboardingDatesOutputSchema,
  errorCodes: ["crm-unavailable", "unexpected-page-state", "subject-mismatch"],
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
    "person-lookup/happy-by-eid-with-dates",
    "person-lookup/crm-subject-mismatch",
  ],
  example: {
    emplId: "10873698",
    invitedOn: { state: "present", value: "2026-06-01" },
    startsOn: { state: "present", value: "2026-07-15" },
    completedOn: { state: "absent", reason: "CRM history has no Completed transition" },
  },
});
