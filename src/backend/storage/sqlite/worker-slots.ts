import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { CommandResultSchema, type CommandRequest } from "../../../rules/commands/commands.js";
import { WorkerSlotRecordSchema, type WorkerSlotRecord } from "../../../models/run/worker-slot.js";
import { IsoInstantSchema, WorkerIdSchema, WorkflowIdSchema } from "../../../rules/identity/ids.js";

interface WorkerSlotPorts {
  database: DatabaseSync;
  mutate(this: void, work: () => { result: WorkerSlotRecord; changes: number }): WorkerSlotRecord;
}
const RowSchema = z.strictObject({ id: z.string(), workflow: z.string(), ordinal: z.number().int().positive(), pool_index: z.number().int().positive(),
  paused: z.union([z.literal(0), z.literal(1)]), retired_at: z.string().nullable(), created_at: z.string(), updated_at: z.string() });
export function workerSlotFromRow(input: unknown): WorkerSlotRecord {
  const row = RowSchema.parse(input);
  return WorkerSlotRecordSchema.parse({ workerId: row.id, workflow: row.workflow, ordinal: row.ordinal, poolIndex: row.pool_index,
    paused: row.paused === 1, retiredAt: row.retired_at, createdAt: row.created_at, updatedAt: row.updated_at });
}

export function createWorkerSlotRepository({ database, mutate }: WorkerSlotPorts) {
  const get = (workerId: string) => { const row = database.prepare("SELECT * FROM worker_slots WHERE id=?").get(WorkerIdSchema.parse(workerId)); return row === undefined ? undefined : workerSlotFromRow(row); };
  const list = (workflow?: string) => (workflow === undefined ? database.prepare("SELECT * FROM worker_slots ORDER BY ordinal").all()
    : database.prepare("SELECT * FROM worker_slots WHERE workflow=? ORDER BY ordinal").all(WorkflowIdSchema.parse(workflow))).map(workerSlotFromRow);
  const active = (workflow: string) => list(workflow).filter(slot => slot.retiredAt === null);
  const current = (workerId: string): WorkerSlotRecord => {
    const slot = get(workerId);
    if (slot === undefined) throw new Error("worker-slot-not-found");
    if (slot.retiredAt !== null) throw new Error("worker-slot-retired");
    return slot;
  };
  return Object.freeze({ get, list, active,
    allocate(input: unknown) {
      const request = z.strictObject({ workflow: WorkflowIdSchema, poolIndex: z.number().int().min(1), now: IsoInstantSchema }).parse(input);
      return mutate(() => {
        if (database.prepare("SELECT 1 FROM worker_pools WHERE workflow=?").get(request.workflow) === undefined) throw new Error("worker-slot-pool-not-admitted");
        const existing = active(request.workflow).find(slot => slot.poolIndex === request.poolIndex);
        if (existing !== undefined) return { result: existing, changes: 0 };
        const ordinal = z.strictObject({ ordinal: z.number().int().positive() }).parse(database.prepare("SELECT COALESCE(MAX(ordinal),0)+1 AS ordinal FROM worker_slots").get()).ordinal;
        const record = WorkerSlotRecordSchema.parse({ workerId: `${request.workflow}-worker-${ordinal}`, workflow: request.workflow, ordinal,
          poolIndex: request.poolIndex, paused: false, retiredAt: null, createdAt: request.now, updatedAt: request.now });
        database.prepare("INSERT INTO worker_slots(id,workflow,ordinal,pool_index,paused,retired_at,created_at,updated_at) VALUES(?,?,?,?,0,NULL,?,?)")
          .run(record.workerId, record.workflow, record.ordinal, record.poolIndex, record.createdAt, record.updatedAt);
        return { result: record, changes: 1 };
      });
    },
    setPaused(input: unknown) {
      const request = z.strictObject({ workerId: WorkerIdSchema, paused: z.boolean(), now: IsoInstantSchema }).parse(input);
      return mutate(() => {
        const slot = current(request.workerId);
        if (slot.paused === request.paused) return { result: slot, changes: 0 };
        const record = WorkerSlotRecordSchema.parse({ ...slot, paused: request.paused, updatedAt: request.now });
        const changes = Number(database.prepare("UPDATE worker_slots SET paused=?,updated_at=? WHERE id=? AND retired_at IS NULL")
          .run(record.paused ? 1 : 0, record.updatedAt, record.workerId).changes);
        if (changes !== 1) throw new Error("worker-slot-conflict");
        return { result: record, changes };
      });
    },
    retire(input: unknown) {
      const request = z.strictObject({ workerId: WorkerIdSchema, now: IsoInstantSchema }).parse(input);
      return mutate(() => {
        const slot = current(request.workerId);
        if (database.prepare("SELECT 1 FROM runs WHERE owner_worker_id=? AND state IN ('claimed','validating','running') LIMIT 1").get(slot.workerId) !== undefined) throw new Error("worker-slot-claimed-run");
        const record = WorkerSlotRecordSchema.parse({ ...slot, retiredAt: request.now, updatedAt: request.now });
        const changes = Number(database.prepare("UPDATE worker_slots SET retired_at=?,updated_at=? WHERE id=? AND retired_at IS NULL")
          .run(record.retiredAt, record.updatedAt, record.workerId).changes);
        if (changes !== 1) throw new Error("worker-slot-conflict");
        return { result: record, changes };
      });
    },
  });
}

export class WorkerPoolPlanVersionConflict extends Error {
  constructor(readonly currentVersion: number) { super("worker-pool-version-conflict"); }
}

/** Plans the count and reconciles slots in the command transaction; the excess members already exited before this runs. */
export function applyWorkerPoolPlan(repositories: import("./authority-database.js").AuthorityRepositories,
  request: Extract<CommandRequest, { type: "plan-worker-count" }>, now: string, basisVersion: number) {
  const workflow = request.target.workflowId, desired = request.payload.desiredWorkers;
  const planned = repositories.workerPools.plan({ workflow, expectedVersion: basisVersion, desiredWorkers: desired, requestedBy: request.requestedBy, now });
  if (planned.state !== "applied") throw new WorkerPoolPlanVersionConflict(repositories.workerPools.get(workflow)?.version ?? 0);
  for (const slot of repositories.workerSlots.active(workflow)) if (slot.poolIndex > desired) repositories.workerSlots.retire({ workerId: slot.workerId, now });
  const members = Array.from({ length: desired }, (_, index) => repositories.workerSlots.allocate({ workflow, poolIndex: index + 1, now }));
  const target = { family: "worker-pool" as const, workflowId: workflow };
  return { members, application: { result: CommandResultSchema.parse({ state: "applied", commandId: request.commandId,
    affectedTargets: [target, ...members.map(slot => ({ family: "worker-browser", workerId: slot.workerId }))] }),
    versionChanges: [{ target, before: basisVersion, after: planned.pool.version }], affectedDependencyIds: [] } };
}
