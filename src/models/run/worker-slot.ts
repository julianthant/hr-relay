import { z } from "zod";
import { CommandIdSchema, IsoInstantSchema, PositiveIntSchema, WorkerIdSchema, WorkflowIdSchema } from "../../rules/identity/ids.js";

export const WorkerSlotRecordSchema = z.strictObject({
  workerId: WorkerIdSchema, workflow: WorkflowIdSchema, ordinal: PositiveIntSchema,
  poolIndex: z.number().int().min(1), membershipRevision: PositiveIntSchema,
  phase: z.enum(["starting", "running", "idle", "waiting", "paused", "failed"]),
  retiredAt: IsoInstantSchema.nullable(), retirementCommandId: CommandIdSchema.nullable(), reservationCommandId: CommandIdSchema.nullable(),
  createdAt: IsoInstantSchema, updatedAt: IsoInstantSchema,
}).refine(record => (record.retiredAt === null) === (record.retirementCommandId === null)
  && record.workerId === `${record.workflow}-worker-${record.ordinal}`, "worker slot identity and retirement must remain exact");
export type WorkerSlotRecord = z.infer<typeof WorkerSlotRecordSchema>;

export const WorkerPoolMemberSchema = z.strictObject({
  workflowId: WorkflowIdSchema, workerId: WorkerIdSchema, ordinal: PositiveIntSchema,
  poolIndex: z.number().int().min(1), membershipRevision: PositiveIntSchema,
}).refine(member => member.workerId === `${member.workflowId}-worker-${member.ordinal}`, "worker member identity must bind its global ordinal");
export type WorkerPoolMember = z.infer<typeof WorkerPoolMemberSchema>;
export function workerPoolMember(slot: WorkerSlotRecord): WorkerPoolMember {
  if (slot.retiredAt !== null) throw new Error("worker-slot-retired");
  return WorkerPoolMemberSchema.parse({ workflowId: slot.workflow, workerId: slot.workerId,
    ordinal: slot.ordinal, poolIndex: slot.poolIndex, membershipRevision: slot.membershipRevision });
}
export const WorkerPoolRosterAdmissionSchema = z.strictObject({
  selected: z.array(WorkerSlotRecordSchema), excess: z.array(WorkerSlotRecordSchema),
  beforeVersion: z.number().int().nonnegative(), admittedVersion: z.number().int().nonnegative(),
  afterVersion: PositiveIntSchema,
}).superRefine((roster, context) => {
  const all = [...roster.selected, ...roster.excess];
  if (all.some(slot => slot.retiredAt !== null)
    || new Set(all.map(slot => slot.workerId)).size !== all.length
    || new Set(all.map(slot => slot.poolIndex)).size !== all.length
    || new Set(all.map(slot => slot.workflow)).size > 1
    || roster.afterVersion !== roster.beforeVersion + 1
    || ![roster.beforeVersion, roster.afterVersion].includes(roster.admittedVersion)
    || roster.excess.length > 0 && roster.admittedVersion !== roster.beforeVersion) {
    context.addIssue({ code: "custom", message: "worker-roster-admission-invalid" });
  }
});
export type WorkerPoolRosterAdmission = z.infer<typeof WorkerPoolRosterAdmissionSchema>;

export const WorkerRetirementProofSchema = z.strictObject({
  workerId: WorkerIdSchema, membershipRevision: PositiveIntSchema, checkedAt: IsoInstantSchema,
  processStopped: z.literal(true), browsersClosed: z.literal(true), exclusive: z.literal(true),
});
export type WorkerRetirementProof = z.infer<typeof WorkerRetirementProofSchema>;
