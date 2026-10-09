/** The cross-verification step: a name that disagrees with its effect is a compile error at every consumer, and "no CRM record for this person" is an `absent` arm carrying the queried EID. */
import { z } from "zod";
import { EidSchema, ObservationIdSchema, taskId } from "../../../rules/identity/ids.js";
import { ContractFieldPathSchema, defineTaskContract } from "../../task/task-contract.js";

export const CrmOnboardingRecordSchema = z.strictObject({
  recordId: z.string().min(1),
  emplId: EidSchema,
  fullName: z.string().min(1),
  /** CRM's exact Process Stage label, retained for source fidelity. */
  rawStage: z.string().min(1),
});
export type CrmOnboardingRecord = z.infer<typeof CrmOnboardingRecordSchema>;

export const ReadOnboardingRecordOutputSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("found"), record: CrmOnboardingRecordSchema }),
  z.strictObject({
    state: z.literal("absent"),
    queriedEid: EidSchema,
    reason: z.string().min(1),
  }),
]);
export type ReadOnboardingRecordOutput = z.infer<typeof ReadOnboardingRecordOutputSchema>;

export const CrmReadOnboardingRecord = defineTaskContract({
  id: taskId("crm/read-onboarding-record"),
  title: "Cross Verification",
  effect: "read",
  input: z.strictObject({
    eid: EidSchema,
    name: z.string().min(1),
  }),
  output: ReadOnboardingRecordOutputSchema,
  errorCodes: ["crm-unavailable", "unexpected-page-state", "subject-mismatch"],
  subject: {
    kind: "person",
    expected: { fromInput: ContractFieldPathSchema.parse("eid"), identity: "eid" },
    observe: ObservationIdSchema.parse("crm.onboarding.displayed-eid"),
    match: "normalized-exact-eid",
    requiredAt: "before-subject-read",
  },
  freshness: { defaultMaxAgeMs: 60 * 60 * 1000, defaultOverride: "forbidden" },
  provenance: { default: "live" },
  scenarios: [
    "person-lookup/happy-by-eid",
    "person-lookup/crm-failure-retry",
    "person-lookup/crm-subject-mismatch",
  ],
  example: {
    state: "found",
    record: {
      recordId: "ONB-40213",
      emplId: "10873698",
      fullName: "Battistessa, Johnnie",
      rawStage: "Completed",
    },
  },
});
