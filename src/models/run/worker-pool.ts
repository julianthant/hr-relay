/**
 * The worker POOL — the operator's declared worker count for ONE workflow, and
 * the CAS basis the spawn control needs (ref execution-and-sessions §11.5,
 * D269).
 *
 * `plan-worker-count` and `spawn-worker` target `{workflowId, expectedVersion}`
 * and, until this row existed, nothing in authority carried a version for that
 * target: `WorkerLeaseRecord.version` is ONE worker's row, so a frontend that
 * sent an `expectedVersion` would have been inventing the exact fact the CAS
 * exists to check — which is why there is no `+ Add workers` control. This
 * record is that fact. One row per workflow, keyed on the workflow id,
 * UPDATED under a version CAS (the design, not a weakened ledger — a pool is a
 * standing declaration, not a history), never deleted.
 *
 * A workflow with NO row is at version 0 and has declared nothing. That is a
 * legitimate CAS basis rather than a gap: the control sends `expectedVersion:
 * 0` and the first plan creates the row at version 1. Nothing seeds rows at
 * boot — a `desiredWorkers` nobody planned would be a fabricated operator
 * intent, and the runtime's composed single worker is a fact about the
 * PROCESS (P3's reconciliation), not about this table.
 *
 * `desiredWorkers` is a declaration; what is actually running is read from
 * the worker leases (§3). The two are kept apart for the reason the lease
 * separates `control` from `lifecycle`: a command writes what the operator
 * asked for, and only a worker writes what is true.
 */
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
