import { z } from "zod";
import { IsoInstantSchema, PositiveIntSchema, WorkerIdSchema, WorkflowIdSchema } from "../../rules/identity/ids.js";

/** A durable worker ordinal; `paused` is the operator's directive and survives a restart. */
export const WorkerSlotRecordSchema = z.strictObject({
  workerId: WorkerIdSchema, workflow: WorkflowIdSchema, ordinal: PositiveIntSchema, poolIndex: PositiveIntSchema,
  paused: z.boolean(), retiredAt: IsoInstantSchema.nullable(), createdAt: IsoInstantSchema, updatedAt: IsoInstantSchema,
}).refine(record => record.workerId === `${record.workflow}-worker-${record.ordinal}`, "worker slot identity must bind its global ordinal");
export type WorkerSlotRecord = z.infer<typeof WorkerSlotRecordSchema>;

export const WorkerPoolMemberSchema = z.strictObject({
  workflowId: WorkflowIdSchema, workerId: WorkerIdSchema, ordinal: PositiveIntSchema, poolIndex: PositiveIntSchema,
}).refine(member => member.workerId === `${member.workflowId}-worker-${member.ordinal}`, "worker member identity must bind its global ordinal");
export type WorkerPoolMember = z.infer<typeof WorkerPoolMemberSchema>;
export function workerPoolMember(slot: WorkerSlotRecord): WorkerPoolMember {
  if (slot.retiredAt !== null) throw new Error("worker-slot-retired");
  return WorkerPoolMemberSchema.parse({ workflowId: slot.workflow, workerId: slot.workerId, ordinal: slot.ordinal, poolIndex: slot.poolIndex });
}
