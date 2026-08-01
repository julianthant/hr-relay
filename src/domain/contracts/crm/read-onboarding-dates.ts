/**
 * `crm/read-onboarding-dates` — the optional dates step behind
 * person-lookup's `includeCrmDates` flag (doc 02 §8).
 *
 * Each date is an explicit present/absent arm rather than an optional string.
 * A blank start date and an unrecorded start date look identical once flattened,
 * and the difference decides whether an operator chases the record or the
 * person.
 */
import { z } from "zod";
import { DateOnlySchema, EidSchema, ObservationIdSchema, TaskIdSchema } from "../../ids.js";
import { ContractFieldPathSchema, defineTaskContract } from "../base.js";

const OptionalDateSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("present"), value: DateOnlySchema }),
  z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
]);

export const ReadOnboardingDatesOutputSchema = z.strictObject({
  emplId: EidSchema,
  invitedOn: OptionalDateSchema,
  startsOn: OptionalDateSchema,
  completedOn: OptionalDateSchema,
});
export type ReadOnboardingDatesOutput = z.infer<typeof ReadOnboardingDatesOutputSchema>;

export const CrmReadOnboardingDates = defineTaskContract({
  id: TaskIdSchema.parse("crm/read-onboarding-dates"),
  title: "CRM Dates",
  effect: "read",
  input: z.strictObject({ eid: EidSchema }),
  output: ReadOnboardingDatesOutputSchema,
  errorCodes: ["crm-unavailable", "unexpected-page-state"],
  subject: {
    kind: "person",
    expected: { fromInput: ContractFieldPathSchema.parse("eid"), identity: "eid" },
    observe: ObservationIdSchema.parse("crm.onboarding.displayed-eid"),
    match: "normalized-exact-eid",
    requiredAt: "before-subject-read",
  },
  freshness: { defaultMaxAgeMs: 60 * 60 * 1000, defaultOverride: "audited" },
  provenance: { default: "live" },
  scenarios: ["person-lookup/crm-dates-partial"],
  example: {
    emplId: "10873698",
    invitedOn: { state: "present", value: "2026-06-01" },
    startsOn: { state: "present", value: "2026-07-15" },
    completedOn: { state: "absent", reason: "onboarding is still in progress" },
  },
});
