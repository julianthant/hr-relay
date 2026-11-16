import { z } from "zod";
import { RunIdSchema, WorkflowIdSchema, PositiveIntSchema, TraceIdSchema, NodeIdSchema,
  WriteIntentIdSchema, WriteAttemptIdSchema, IsoInstantSchema } from "../../rules/identity/ids.js";

export const RecoveryActivitySchema = z.strictObject({
  activityId: z.uuid(),
  operation: z.enum(["diagnostic-recovery", "parked-write-check"]),
  runId: RunIdSchema,
  workflow: WorkflowIdSchema,
  attempt: PositiveIntSchema,
  traceId: TraceIdSchema,
  nodeId: NodeIdSchema,
  writeIntentId: WriteIntentIdSchema,
  generation: PositiveIntSchema,
  writeAttemptId: WriteAttemptIdSchema,
  openedAt: IsoInstantSchema,
});
export type RecoveryActivity = z.infer<typeof RecoveryActivitySchema>;

export function recoveryActivitySpanPath(activity: RecoveryActivity): string {
  return `${activity.traceId}/recovery/${activity.activityId}/${activity.nodeId}#1`;
}
