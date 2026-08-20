/**
 * `crm/read-onboarding-record` — ref workflow-model §8's cross-verification step.
 *
 * Ref workflow-model §8 sketches this as `crm/find-onboarding-record`. The verb is `read`
 * here because ref task-contract's contract factory (landed in 1d) pins the effect→verb
 * vocabulary — `read | search | list | extract | match | verify` for a read —
 * and a name that disagrees with its effect is exactly the drift that check
 * exists to catch. The contract object is imported by value, so the rename is a
 * compile error at every consumer rather than a silent mismatch.
 *
 * "No CRM record for this person" is a real, expected outcome of a correct
 * search, so it is an `absent` arm rather than a throw — and it carries the
 * queried EID, so an absence can never be confused with a lookup that never ran.
 */
import { z } from "zod";
import { EidSchema, ObservationIdSchema, taskId } from "../../ids.js";
import { ContractFieldPathSchema, defineTaskContract } from "../base.js";

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
