import { z } from "zod";
import { UcpathWorkStudyTransactionProofSchema } from "../../systems/ucpath/match-paypath-work-study.js";
import { WorkStudyPlanSchema } from "./read-transaction-plan.js";

/** One person's outcome: filed by this run, or already filed for this effective date and so not filed again. */
export const WorkStudyResultSchema = z.strictObject({
  state: z.enum(["saved", "already-filed"]),
  plan: WorkStudyPlanSchema,
  receipt: UcpathWorkStudyTransactionProofSchema,
});
export type WorkStudyResult = z.infer<typeof WorkStudyResultSchema>;
