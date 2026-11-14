import { z } from "zod";
import { EidSchema, taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { OnboardingRosterBindingSchema } from "./roster.js";
import { HirePlanSchema, OnboardingReadHirePlan } from "./read-hire-plan.js";
import { HireSubjectSchema } from "./match-hire-subject.js";
import { SearchPersonMatchOutputSchema } from "../../systems/ucpath/search-person-match.js";
import { OnboardingI9LookupSchema } from "./read-i9-lookup.js";
import { I9ProfileTargetSchema, I9_PROFILE_EXAMPLE } from "../../ui/i9-creation.js";
import { UcpathHireQuerySchema, UcpathHireScanSchema } from "../../ui/ucpath-hire.js";
import { containsDryRunSample } from "../../workflow/dry-run.js";

export const ONBOARDING_WRITE_REVIEW_GATE = "hire-review";
export const OnboardingWriteApprovalSchema = z.discriminatedUnion("decision", [
  z.strictObject({ decision: z.literal("new-hire"), ruledOut: z.array(EidSchema) }),
  z.strictObject({ decision: z.literal("existing-person"), emplId: EidSchema, confirmedBy: z.enum(["person-org", "operator"]) }),
]);
export const OnboardingWritePlanSchema = z.strictObject({
  roster: OnboardingRosterBindingSchema, hire: UcpathHireQuerySchema, subject: HireSubjectSchema, i9: I9ProfileTargetSchema.nullable(), comments: z.string().min(1),
}).refine(value => value.subject.state !== "review-required" && (value.hire.mode === "new-hire" ? value.i9 !== null : value.i9 === null))
  .refine(value => !containsDryRunSample(value), "Preview samples cannot become a write plan");
export const OnboardingReadWritePlan = defineTaskContract({
  id: taskId("workflow:onboarding/read-write-plan"), title: "Verify the reviewed hire path", effect: "read",
  input: z.strictObject({ mode: z.enum(["new-hire", "rehire"]), plan: HirePlanSchema, subject: HireSubjectSchema, match: SearchPersonMatchOutputSchema,
    lookup: OnboardingI9LookupSchema, findings: UcpathHireScanSchema, approval: OnboardingWriteApprovalSchema }), output: OnboardingWritePlanSchema,
  errorCodes: ["ONBOARDING_WRITE_REVIEW_REFUSED"], subject: { kind: "none", reason: "Validates an operator's run-bound choice against independent UCPath Match and complete transaction findings" },
  freshness: { defaultMaxAgeMs: 0, defaultOverride: "forbidden" }, provenance: { default: "derived" }, scenarios: ["onboarding/write-transactions"],
  example: { roster: OnboardingReadHirePlan.example.roster, hire: { mode: "new-hire", employee: OnboardingReadHirePlan.example.employee, expectedName: "Fixture Hire", emplId: null },
    subject: { state: "new-hire", candidateEids: [] }, i9: I9_PROFILE_EXAMPLE,
    comments: "New Dining Student Hire Effective 09/11/2026. Job number #R123. EE does not have an SSN yet, we will add it as soon as it is provided." },
});
