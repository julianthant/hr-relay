import { z } from "zod";
import { DateOnlySchema, taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { I9RecordIdsSchema } from "../../systems/i9/read-section2-signer.js";
import { HirePlanSchema, HireEmployeeSchema, OnboardingReadHirePlan } from "./read-hire-plan.js";
import { OnboardingI9LookupSchema, OnboardingI9NotRequiredSchema } from "./read-i9-lookup.js";

export const OnboardingI9CreateRequestSchema = z.strictObject({
  firstName: HireEmployeeSchema.shape.firstName, lastName: HireEmployeeSchema.shape.lastName,
  middleName: HireEmployeeSchema.shape.middleName, ssn: HireEmployeeSchema.shape.ssn,
  dob: DateOnlySchema, email: HireEmployeeSchema.shape.email,
  departmentNumber: HireEmployeeSchema.shape.departmentNumber, startDate: HireEmployeeSchema.shape.effectiveDate,
});
export const OnboardingI9ProfileSchema = z.discriminatedUnion("state", [
  OnboardingI9NotRequiredSchema,
  z.strictObject({ state: z.literal("existing-profile"), profileId: I9RecordIdsSchema.shape.profileId,
    i9Status: z.enum(["signed", "unsigned", "historical"]) }),
  z.strictObject({ state: z.literal("review-required"), reason: z.enum(["lookup-restricted", "profile-id-unavailable"]) }),
  z.strictObject({ state: z.literal("creation-required"), request: OnboardingI9CreateRequestSchema,
    write: z.strictObject({ state: z.literal("unimplemented"), owner: z.literal("write-safety") }) }),
]);

export const OnboardingReadI9ProfilePlan = defineTaskContract({
  id: taskId("workflow:onboarding/read-i9-profile-plan"), title: "Plan I-9 profile creation", effect: "read",
  input: z.strictObject({ plan: HirePlanSchema, lookup: OnboardingI9LookupSchema }), output: OnboardingI9ProfileSchema,
  errorCodes: ["INCONSISTENT_INPUTS"], subject: { kind: "none", reason: "declares creation inputs only after a successful delegated no-match; it performs no write" },
  freshness: { defaultMaxAgeMs: Infinity, defaultOverride: "forbidden" }, provenance: { default: "derived" }, scenarios: [],
  example: {
    state: "creation-required", write: { state: "unimplemented", owner: "write-safety" },
    request: {
      firstName: OnboardingReadHirePlan.example.employee.firstName, lastName: OnboardingReadHirePlan.example.employee.lastName,
      middleName: "", ssn: null, dob: "2000-01-14", email: "hire@example.test", departmentNumber: "000412", startDate: "09/11/2026",
    },
  },
});
