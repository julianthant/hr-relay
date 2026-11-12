import { z } from "zod";
import { WorkStudyPlanSchema } from "./plan-transaction.js";

export const WorkStudyResultSchema = z.strictObject({ state: z.literal("planned"), plan: WorkStudyPlanSchema });
export type WorkStudyResult = z.infer<typeof WorkStudyResultSchema>;
