import { z } from "zod";
import { EidSchema, taskId } from "../../../rules/identity/ids.js";
import { SearchPersonMatchOutputSchema, UcpathMatchHitSchema } from "../../systems/ucpath/search-person-match.js";
import { defineTaskContract } from "../../task/task-contract.js";

export const HireSubjectSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("new-hire"), candidateEids: z.array(EidSchema).length(0) }),
  z.strictObject({ state: z.literal("existing-person"), person: UcpathMatchHitSchema }),
  z.strictObject({ state: z.literal("review-required"), candidates: z.array(UcpathMatchHitSchema).min(1) }),
]);

export const OnboardingMatchHireSubject = defineTaskContract({
  id: taskId("workflow:onboarding/match-hire-subject"), title: "Check UCPath duplicate identity", effect: "read",
  input: z.strictObject({
    mode: z.enum(["new-hire", "rehire"]), firstName: z.string().min(1), lastName: z.string().min(1),
    match: SearchPersonMatchOutputSchema,
  }), output: HireSubjectSchema,
  errorCodes: ["ONBOARDING_MATCH_INVALID", "ONBOARDING_EXISTING_PERSON_REQUIRED"],
  subject: { kind: "none", reason: "pure classification of UCPath Search/Match and Person Org confirmation against the roster-snapshot legal name" },
  freshness: { defaultMaxAgeMs: Number.POSITIVE_INFINITY, defaultOverride: "forbidden" },
  provenance: { default: "derived" }, scenarios: [],
  example: { state: "new-hire", candidateEids: [] },
});
