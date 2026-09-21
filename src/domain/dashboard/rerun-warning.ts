import { z } from "zod";
import { WorkflowIdSchema } from "../ids.js";
import { PublicRerunPlanSchema, RerunSourceSchema } from "../run/rerun.js";

/** Steps preview has no new values, omission facts, or execution authority. */
export const RerunWarningRequestSchema = z.strictObject({
  workflowId: WorkflowIdSchema,
  source: RerunSourceSchema.omit({ copiedFrom: true }),
});
export const RerunWarningWireSchema = z.strictObject({
  workflowId: WorkflowIdSchema,
  rerun: PublicRerunPlanSchema,
});
export type RerunWarningWire = z.infer<typeof RerunWarningWireSchema>;
