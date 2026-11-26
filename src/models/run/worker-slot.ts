import { z } from "zod";
import { IsoInstantSchema, PositiveIntSchema, WorkerIdSchema, WorkflowIdSchema } from "../../rules/identity/ids.js";

/** Real slots are `<workflow>-worker-<n>`; a copy's sample cards are `<workflow>-sample-<n>`, which slot allocation never writes. */
const bindsOrdinal = (workerId: string, workflow: string, ordinal: number) =>
  workerId === `${workflow}-worker-${ordinal}` || workerId === `${workflow}-sample-${ordinal}`;

/** A durable worker ordinal; `paused` is the operator's directive and survives a restart. */
export const WorkerSlotRecordSchema = z.strictObject({
  workerId: WorkerIdSchema, workflow: WorkflowIdSchema, ordinal: PositiveIntSchema, poolIndex: PositiveIntSchema,
  paused: z.boolean(), retiredAt: IsoInstantSchema.nullable(), createdAt: IsoInstantSchema, updatedAt: IsoInstantSchema,
}).refine(record => bindsOrdinal(record.workerId, record.workflow, record.ordinal), "worker slot identity must bind its global ordinal");
export type WorkerSlotRecord = z.infer<typeof WorkerSlotRecordSchema>;

export const WorkerPoolMemberSchema = z.strictObject({
  workflowId: WorkflowIdSchema, workerId: WorkerIdSchema, ordinal: PositiveIntSchema, poolIndex: PositiveIntSchema,
}).refine(member => bindsOrdinal(member.workerId, member.workflowId, member.ordinal), "worker member identity must bind its global ordinal");
export type WorkerPoolMember = z.infer<typeof WorkerPoolMemberSchema>;
export function workerPoolMember(slot: WorkerSlotRecord): WorkerPoolMember {
  if (slot.retiredAt !== null) throw new Error("worker-slot-retired");
  return WorkerPoolMemberSchema.parse({ workflowId: slot.workflow, workerId: slot.workerId, ordinal: slot.ordinal, poolIndex: slot.poolIndex });
}
