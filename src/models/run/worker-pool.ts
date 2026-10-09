/** The worker POOL — the operator's declared worker count for ONE workflow, and the CAS basis the spawn control needs. */
import { z } from "zod";
import { ActorIdSchema, IsoInstantSchema, PositiveIntSchema, WorkflowIdSchema } from "../../rules/identity/ids.js";

export const WorkerPoolRecordSchema = z.strictObject({
  workflow: WorkflowIdSchema,
  desiredWorkers: PositiveIntSchema,
  /** Who last planned this count, and when — the declaration's provenance. */
  plannedBy: ActorIdSchema,
  plannedAt: IsoInstantSchema,
  /** The CAS basis `plan-worker-count` / `spawn-worker` cite; +1 per plan. */
  version: PositiveIntSchema,
  createdAt: IsoInstantSchema,
  updatedAt: IsoInstantSchema,
}).superRefine((record, context) => {
  if (Date.parse(record.updatedAt) < Date.parse(record.createdAt)) {
    context.addIssue({ code: "custom", path: ["updatedAt"], message: "worker pool updatedAt precedes createdAt" });
  }
  if (record.updatedAt !== record.plannedAt) {
    context.addIssue({
      code: "custom",
      path: ["plannedAt"],
      message: "a worker pool row changes only when it is planned; plannedAt and updatedAt are one instant",
    });
  }
});
export type WorkerPoolRecord = z.infer<typeof WorkerPoolRecordSchema>;

/** The version a `plan-worker-count` / `spawn-worker` must cite: the row's, or 0 when no row exists. */
export function workerPoolVersion(record: WorkerPoolRecord | undefined): number {
  return record === undefined ? 0 : record.version;
}
