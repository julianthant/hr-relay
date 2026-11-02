import { z } from "zod";
import { HirePlanSchema } from "./read-hire-plan.js";
import { HireSubjectSchema } from "./match-hire-subject.js";
import { OnboardingI9ProfileSchema } from "./i9-profile.js";

export const OnboardingResultSchema = z.strictObject({
  state: z.literal("implementation-incomplete"), plan: HirePlanSchema, subject: HireSubjectSchema,
  i9: OnboardingI9ProfileSchema,
  hireWrite: z.strictObject({ state: z.literal("unimplemented"), owner: z.literal("write-safety") }),
  rosterAccess: z.strictObject({ state: z.literal("unimplemented"), owner: z.literal("spreadsheets") }),
});
