import { z } from "zod";
import { HirePlanSchema } from "./read-hire-plan.js";
import { HireSubjectSchema } from "./match-hire-subject.js";
import { I9RemoteProofSchema } from "../../ui/i9-creation.js";
import { UcpathHireProofSchema } from "../../ui/ucpath-hire.js";
import { WorkflowWorkbookResultSchema } from "../../processing/workbooks/read-result.js";
export const OnboardingResultSchema = z.strictObject({
  state: z.enum(["filed", "master-review-required"]), plan: HirePlanSchema, subject: HireSubjectSchema,
  i9: z.union([z.strictObject({ state: z.literal("not-required") }), I9RemoteProofSchema.safeExtend({ state: z.literal("verified") })]),
  hireWrite: z.strictObject({ state: z.literal("verified"), disposition: z.enum(["committed", "already-present"]), receipt: UcpathHireProofSchema }),
  rosterAccess: WorkflowWorkbookResultSchema,
});
