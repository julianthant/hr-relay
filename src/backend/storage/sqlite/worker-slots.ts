import { CanonicalWorkerAdmissionRequestSchema } from "./run-store-contracts.js";
import { RunLifecycleCommandRecordSchema, RunLifecycleCommandAuditRecordSchema } from "../../../rules/commands/commands.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { WorkerPoolMemberSchema, WorkerPoolRosterAdmissionSchema, WorkerSlotRecordSchema } from "../../../models/run/worker-slot.js";
import { CommandIdSchema, IsoInstantSchema, WorkerIdSchema, WorkflowIdSchema } from "../../../rules/identity/ids.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";

interface WorkerSlotPorts {
  database: DatabaseSync;
  mutate<T>(this: void, work: () => { result: T; changes: number }): T;
}
const RowSchema = z.strictObject({ id: z.string(), workflow: z.string(), ordinal: z.number().int().positive(),
  membership_revision: z.number().int().positive(), phase: z.string(), retired_at: z.string().nullable(),
  retirement_command_id: z.string().nullable(), reservation_command_id: z.string().nullable(),
  payload_json: z.string(), created_at: z.string(), updated_at: z.string() });
export function workerSlotFromRow(input: unknown) {
  const row = RowSchema.parse(input), record = WorkerSlotRecordSchema.parse(JSON.parse(row.payload_json));
  if (row.id !== record.workerId || row.workflow !== record.workflow || row.ordinal !== record.ordinal
    || row.membership_revision !== record.membershipRevision || row.phase !== record.phase
    || row.retired_at !== record.retiredAt || row.retirement_command_id !== record.retirementCommandId
    || row.reservation_command_id !== record.reservationCommandId || row.created_at !== record.createdAt || row.updated_at !== record.updatedAt) {
    throw new Error("worker-slot-row-identity-mismatch");
  }
  return record;
}
export function createWorkerSlotRepository({ database, mutate }: WorkerSlotPorts) {
  const get = (workerId: string) => { const row = database.prepare("SELECT * FROM worker_slots WHERE id=?").get(WorkerIdSchema.parse(workerId)); return row === undefined ? undefined : workerSlotFromRow(row); };
  const list = (workflow?: string) => (workflow === undefined ? database.prepare("SELECT * FROM worker_slots ORDER BY ordinal").all()
    : database.prepare("SELECT * FROM worker_slots WHERE workflow=? ORDER BY ordinal").all(WorkflowIdSchema.parse(workflow))).map(workerSlotFromRow);
  return Object.freeze({ get, list,
    allocate(input: unknown) {
      const request = z.strictObject({ workflow: WorkflowIdSchema, poolIndex: z.number().int().min(1).max(3), commandId: CommandIdSchema.nullable(), now: IsoInstantSchema }).parse(input);
      return mutate(() => {
        if (database.prepare("SELECT 1 FROM worker_pools WHERE workflow=?").get(request.workflow) === undefined) throw new Error("worker-slot-pool-not-admitted");
        const active = list(request.workflow).filter(slot => slot.retiredAt === null);
        const existing = active.find(slot => slot.poolIndex === request.poolIndex);
        if (existing !== undefined) return { result: existing, changes: 0 };
        if (active.length >= 3) throw new Error("worker-slot-pool-capacity-exceeded");
        const ordinal = z.strictObject({ ordinal: z.number().int().positive() }).parse(database.prepare("SELECT COALESCE(MAX(ordinal),0)+1 AS ordinal FROM worker_slots").get()).ordinal;
        const record = WorkerSlotRecordSchema.parse({ workerId: `${request.workflow}-worker-${ordinal}`, workflow: request.workflow, ordinal,
          poolIndex: request.poolIndex, membershipRevision: 1, phase: "starting", retiredAt: null, retirementCommandId: null,
          reservationCommandId: request.commandId, createdAt: request.now, updatedAt: request.now });
        database.prepare("INSERT INTO worker_slots(id,workflow,ordinal,membership_revision,phase,retired_at,retirement_command_id,reservation_command_id,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,NULL,NULL,?,?,?,?)")
          .run(record.workerId,record.workflow,record.ordinal,record.membershipRevision,record.phase,record.reservationCommandId,canonicalJsonStringify(record),record.createdAt,record.updatedAt);
        return { result: record, changes: 1 };
      });
    },
    retire(input: unknown) {
      const request = z.strictObject({ workerId: WorkerIdSchema, commandId: CommandIdSchema, expectedRevision: z.number().int().positive(), now: IsoInstantSchema }).parse(input);
      return mutate(() => {
        const current = get(request.workerId);
        if (current === undefined) throw new Error("worker-slot-not-found");
        if (current.retiredAt !== null) {
          if (current.retirementCommandId !== request.commandId) throw new Error("worker-slot-retirement-conflict");
          return { result: current, changes: 0 };
        }
        if (current.membershipRevision !== request.expectedRevision) throw new Error("worker-slot-revision-conflict");
        if (database.prepare("SELECT 1 FROM worker_leases WHERE worker_id=? AND state<>'stopped' LIMIT 1").get(current.workerId) !== undefined) throw new Error("worker-slot-live-lease");
        const record = WorkerSlotRecordSchema.parse({ ...current, membershipRevision: current.membershipRevision+1,
          retiredAt: request.now, retirementCommandId: request.commandId, updatedAt: request.now });
        const changes = Number(database.prepare("UPDATE worker_slots SET membership_revision=?,retired_at=?,retirement_command_id=?,payload_json=?,updated_at=? WHERE id=? AND membership_revision=? AND retired_at IS NULL")
          .run(record.membershipRevision,record.retiredAt,record.retirementCommandId,canonicalJsonStringify(record),record.updatedAt,record.workerId,current.membershipRevision).changes);
        if (changes !== 1) throw new Error("worker-slot-revision-conflict");
        return { result: record, changes };
      });
    },
  });
}

export function admitWorkerPoolRoster(
  repositories: Pick<import("./authority-database.js").AuthorityRepositories, "workerPools" | "workerSlots">,
  request: Extract<import("../../../rules/commands/commands.js").CommandRequest, { type: "plan-worker-count" }>,
  now: string,
) {
  const before = repositories.workerPools.get(request.target.workflowId);
  const beforeVersion = before?.version ?? 0;
  if (beforeVersion !== request.target.expectedVersion) throw new Error("worker-pool-version-conflict");
  const active = repositories.workerSlots.list(request.target.workflowId).filter(slot => slot.retiredAt === null);
  const desired = request.payload.desiredWorkers;
  // A shrink keeps its count until every excess owner has proved closure.
  const early = before === undefined || desired >= before.desiredWorkers && desired >= active.length;
  if (early) {
    const outcome = repositories.workerPools.plan({ workflow: request.target.workflowId, expectedVersion: beforeVersion,
      desiredWorkers: desired, requestedBy: request.requestedBy, now });
    if (outcome.state !== "applied") throw new Error("worker-pool-version-conflict");
  }
  const selected = active.slice(0, desired), excess = active.slice(desired);
  for (let poolIndex = 1; selected.length < desired && poolIndex <= 3; poolIndex += 1) {
    if (active.some(slot => slot.poolIndex === poolIndex)) continue;
    selected.push(repositories.workerSlots.allocate({ workflow: request.target.workflowId, poolIndex,
      commandId: request.commandId, now }));
  }
  return WorkerPoolRosterAdmissionSchema.parse({ selected, excess, beforeVersion,
    admittedVersion: early ? beforeVersion + 1 : beforeVersion, afterVersion: beforeVersion + 1 });
}

export function admitDirectWorker(
  repositories: Pick<import("./authority-database.js").AuthorityRepositories, "workerPools" | "workerSlots" | "workerControls" | "lifecycleJournal" | "runtimeConfig">,
  input: unknown, auditId: string,
) {
  const request = CanonicalWorkerAdmissionRequestSchema.parse(input);
  const command = RunLifecycleCommandRecordSchema.parse({ kind: "run-lifecycle", commandId: request.commandId,
    operation: "worker-admission", request, fence: { kind: "none" }, recordedAt: request.now,
    requestFingerprint: sha256Hex(`hrauto:run-lifecycle-command:v1\0worker-admission\0${canonicalJsonStringify(request)}`) });
  const prior = repositories.lifecycleJournal.findAuditByCommand(request.commandId);
  if (prior !== undefined) {
    if (!("kind" in prior) || prior.kind !== "run-lifecycle" || prior.result.kind !== "worker"
      || canonicalJsonStringify(prior.request) !== canonicalJsonStringify(command)) throw new Error("worker-admission-command-divergent");
    return prior.result.slot;
  }
  repositories.runtimeConfig.requireSettingsCurrent();
  if (repositories.workerControls.pending(`worker-pool:${request.workflow}`).length !== 0) throw new Error("worker-control-unresolved-effect");
  const before = repositories.workerPools.get(request.workflow);
  if ((before?.version ?? 0) !== request.expectedPoolVersion) throw new Error("worker-pool-version-conflict");
  repositories.lifecycleJournal.insertCommand(command);
  const active = repositories.workerSlots.list(request.workflow).filter(slot => slot.retiredAt === null);
  const existing = active.find(slot => slot.poolIndex === request.poolIndex);
  let afterPoolVersion: number = request.expectedPoolVersion;
  if (before === undefined || existing === undefined && before.desiredWorkers < active.length + 1) {
    const outcome = repositories.workerPools.plan({ workflow: request.workflow, expectedVersion: request.expectedPoolVersion,
      desiredWorkers: Math.max(before?.desiredWorkers ?? 0, active.length + (existing === undefined ? 1 : 0)),
      requestedBy: "local-operator", now: request.now });
    if (outcome.state !== "applied") throw new Error("worker-pool-version-conflict");
    afterPoolVersion = outcome.pool.version;
  }
  const slot = repositories.workerSlots.allocate({ workflow: request.workflow, poolIndex: request.poolIndex,
    commandId: request.commandId, now: request.now });
  repositories.lifecycleJournal.insertAudit(RunLifecycleCommandAuditRecordSchema.parse({ kind: "run-lifecycle", auditId,
    request: command, result: { kind: "worker", slot, beforePoolVersion: request.expectedPoolVersion, afterPoolVersion }, completedAt: request.now }));
  return slot;
}

export function admitSupervisedWorker(
  repositories: Pick<import("./authority-database.js").AuthorityRepositories, "workerSlots" | "workerControls" | "workerPools">,
  input: unknown,
) {
  const request = z.strictObject({ member: WorkerPoolMemberSchema, commandId: CommandIdSchema, now: IsoInstantSchema }).parse(input);
  const { member } = request, slot = repositories.workerSlots.get(member.workerId);
  const control = repositories.workerControls.get(request.commandId);
  if (slot === undefined || slot.retiredAt !== null || slot.workflow !== member.workflowId || slot.poolIndex !== member.poolIndex
    || slot.ordinal !== member.ordinal || slot.membershipRevision !== member.membershipRevision
    || control?.phase.state !== "executing" || control.request.type !== "spawn-worker"
    || control.request.payload.workerId !== member.workerId || control.request.target.workflowId !== member.workflowId
    || repositories.workerPools.get(member.workflowId)?.version !== Number(control.request.target.expectedVersion)
    || Date.parse(control.expiresAt) <= Date.parse(request.now)) throw new Error("worker-launch-reservation-not-admitted");
  return slot.workerId;
}
