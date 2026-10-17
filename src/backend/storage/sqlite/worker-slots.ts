import { systemClock, type Clock } from "../../../rules/time/clock.js";
import type { RuntimeAdmission } from "../admission/admission.js";
import { createOrphanRetirementProof } from "./orphan-verification-proof.js";
import { DuoCeremonyLeaseRecordSchema } from "../../../rules/sessions/duo-ceremony-lease.js";
import { lstatSync } from "node:fs";
import { join } from "node:path";
import { commandFromRow } from "./command-record-row.js";
import { RuntimeProcessLockFileSchema, readLiveSmokeRuntimeFile, readRuntimeProcessLock, observeProcessIdentity } from "./runtime-process-locks.js";
import { validateOrphanRetirementProof, WorkerStandingRecoveryRequestSchema, WorkerVerificationClaimSchema, WorkerVerificationClosureProofSchema, WorkerVerificationRecoveryProofSchema, WorkerVerificationAdmissionRequestSchema, WorkerVerificationRetirementRequestSchema, CanonicalWorkerAdmissionRequestSchema } from "./run-store-contracts.js";
import { RunLifecycleCommandRecordSchema, RunLifecycleCommandAuditRecordSchema } from "../../../rules/commands/commands.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { WorkerPoolMemberSchema, WorkerPoolRosterAdmissionSchema, WorkerSlotRecordSchema, type WorkerSlotRecord } from "../../../models/run/worker-slot.js";
import { CommandIdSchema, IsoInstantSchema, WorkerIdSchema, WorkflowIdSchema } from "../../../rules/identity/ids.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";

interface WorkerSlotPorts {
  admission: RuntimeAdmission;
  clock?: Clock;
  database: DatabaseSync;
  mutate(this: void, work: () => { result: WorkerSlotRecord; changes: number }): WorkerSlotRecord;
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
export function verificationFromSlot(database: DatabaseSync, slot: WorkerSlotRecord) {
  if (slot.retiredAt !== null || slot.reservationCommandId === null) return undefined;
  const commandRow = database.prepare("SELECT * FROM commands WHERE id=?").get(slot.reservationCommandId);
  if (commandRow === undefined) throw new Error("worker-slot-reservation-authority-unavailable");
  const command = commandFromRow(commandRow);
  if (!("kind" in command) || command.kind !== "run-lifecycle" || command.operation !== "worker-verification-admission") return undefined;
  const request = WorkerVerificationAdmissionRequestSchema.parse(command.request);
  const rows = database.prepare("SELECT payload_json FROM command_audits WHERE command_id=?").all(command.commandId);
  if (rows.length !== 1) throw new Error("worker-verification-authority-unavailable");
  const audit = RunLifecycleCommandAuditRecordSchema.parse(JSON.parse(z.object({ payload_json: z.string() }).parse(rows[0]).payload_json));
  if (canonicalJsonStringify(audit.request) !== canonicalJsonStringify(command) || audit.result.kind !== "worker"
    || request.workflow !== slot.workflow || audit.result.slot.workerId !== slot.workerId
    || audit.result.slot.ordinal !== slot.ordinal || audit.result.slot.poolIndex !== slot.poolIndex
    || audit.result.slot.membershipRevision !== slot.membershipRevision
    || audit.result.slot.reservationCommandId !== command.commandId) throw new Error("worker-verification-authority-unavailable");
  return { command, request, slot };
}

function requireVerificationCleanup(database: DatabaseSync, hold: NonNullable<ReturnType<typeof verificationFromSlot>>, request: z.infer<typeof WorkerVerificationRetirementRequestSchema>) {
  const { owner, processLockRoot, stateRoot } = hold.request;
  if (request.cleanup.evidence === "orphan-retired") return;
  if (request.cleanup.mode === "live") {
    const current = readRuntimeProcessLock(processLockRoot, "live-smoke");
    const observed = observeProcessIdentity(owner.pid);
    if (current?.pid !== process.pid || canonicalJsonStringify(current) !== canonicalJsonStringify(owner)
      || observed.state !== "alive" || canonicalJsonStringify(observed.identity) !== canonicalJsonStringify(owner.processIdentity)) throw new Error("worker-verification-owner-unavailable");
  } else {
    const original = RuntimeProcessLockFileSchema.parse(JSON.parse(readLiveSmokeRuntimeFile(processLockRoot, `${owner.generation}.claim.json`).text));
    const released = z.strictObject({ generation: z.number().int().positive(), acquisitionId: z.uuid(), releasedAt: IsoInstantSchema })
      .parse(JSON.parse(readLiveSmokeRuntimeFile(processLockRoot, `${owner.generation}-${owner.acquisitionId}.release.json`).text));
    if (canonicalJsonStringify(original) !== canonicalJsonStringify(owner) || released.acquisitionId !== owner.acquisitionId
      || released.generation !== owner.generation || observeProcessIdentity(owner.pid).state !== "gone") throw new Error("worker-verification-owner-unavailable");
  }
  const root = join(processLockRoot, "live-smoke-slots");
  if (request.cleanup.evidence === "browserless") {
    if (hold.slot.phase !== "starting" || request.cleanup.mode !== "live"
      || lstatSync(join(root, "live-smoke-claims", `${owner.acquisitionId}.slot.json`), { throwIfNoEntry: false }) !== undefined) throw new Error("worker-verification-cleanup-unproved");
    return;
  }
  const claim = WorkerVerificationClaimSchema.parse(JSON.parse(readLiveSmokeRuntimeFile(root, `${owner.acquisitionId}.slot.json`).text));
  const profileDirectory = join(stateRoot, "scratch", "live-smoke", claim.profileRunId, "browsers", `w${hold.slot.ordinal}`, claim.system);
  if (request.cleanup.evidence === "recovered") {
    const proof = WorkerVerificationRecoveryProofSchema.parse(JSON.parse(readLiveSmokeRuntimeFile(root,
      `${owner.acquisitionId}-${request.cleanup.recoveryAcquisitionId}.recovered.json`).text));
    const current = readRuntimeProcessLock(processLockRoot, "live-smoke");
    const observed = current === undefined ? undefined : observeProcessIdentity(current.pid);
    const row = database.prepare("SELECT payload_json FROM auth_leases WHERE credential_key=?").get(claim.credentialKey);
    const lease = row === undefined ? undefined : DuoCeremonyLeaseRecordSchema.parse(JSON.parse(z.object({ payload_json: z.string() }).parse(row).payload_json));
    if (claim.profileRunId !== owner.acquisitionId
      || request.cleanup.mode !== "recovery" || current?.pid !== process.pid || current.releasedAt !== null
      || observed?.state !== "alive" || canonicalJsonStringify(observed.identity) !== canonicalJsonStringify(current.processIdentity)
      || canonicalJsonStringify(proof.recoveryOwner) !== canonicalJsonStringify(current)
      || proof.recoveryOwner.acquisitionId !== request.cleanup.recoveryAcquisitionId
      || proof.acquisitionId !== owner.acquisitionId || proof.workerId !== hold.slot.workerId
      || proof.membershipRevision !== hold.slot.membershipRevision || proof.checkedAt !== request.now
      || Date.parse(proof.checkedAt) < Date.parse(hold.request.now) || Date.parse(proof.checkedAt) < Date.parse(current.acquiredAt)
      || proof.claimFingerprint !== sha256Hex(canonicalJsonStringify(claim)) || proof.profileDirectory !== profileDirectory
      || canonicalJsonStringify(claim.process) !== canonicalJsonStringify(owner)
      || canonicalJsonStringify(claim.slot) !== canonicalJsonStringify(hold.slot)
      || lease?.state !== "released" || lease.holder.workerId !== hold.slot.workerId || lease.holder.system !== claim.system
      || lstatSync(profileDirectory, { throwIfNoEntry: false }) !== undefined
      || lstatSync(join(root, "live-smoke-claims", `${owner.acquisitionId}.closed.json`), { throwIfNoEntry: false }) !== undefined) throw new Error("worker-verification-cleanup-unproved");
    return;
  }
  const proof = WorkerVerificationClosureProofSchema.parse(JSON.parse(readLiveSmokeRuntimeFile(root, `${owner.acquisitionId}.closed.json`).text));
  if (canonicalJsonStringify(claim.process) !== canonicalJsonStringify(owner)
    || canonicalJsonStringify(claim.slot) !== canonicalJsonStringify(hold.slot)
    || proof.acquisitionId !== owner.acquisitionId || proof.workerId !== hold.slot.workerId
    || proof.membershipRevision !== hold.slot.membershipRevision || Date.parse(proof.checkedAt) < Date.parse(hold.request.now)
    || lstatSync(join(stateRoot, "scratch", "live-smoke", claim.profileRunId, "browsers", `w${hold.slot.ordinal}`, claim.system), { throwIfNoEntry: false }) !== undefined) throw new Error("worker-verification-cleanup-unproved");
}

export function recoveryFromSlot(database: DatabaseSync, slot: WorkerSlotRecord) {
  if (slot.retiredAt !== null || slot.reservationCommandId === null) return undefined;
  const row = database.prepare("SELECT * FROM commands WHERE id=?").get(slot.reservationCommandId);
  if (row === undefined) throw new Error("worker-slot-reservation-authority-unavailable");
  const command = commandFromRow(row);
  if (!("kind" in command) || command.kind !== "run-lifecycle" || command.operation !== "worker-standing-recovery") return undefined;
  const request = WorkerStandingRecoveryRequestSchema.parse(command.request);
  if (canonicalJsonStringify(request.binding.member) !== canonicalJsonStringify(WorkerPoolMemberSchema.parse({ workerId: slot.workerId,
    workflowId: slot.workflow, ordinal: slot.ordinal, poolIndex: slot.poolIndex, membershipRevision: slot.membershipRevision }))
    || database.prepare("SELECT 1 FROM command_audits WHERE command_id=?").get(command.commandId) !== undefined) throw new Error("worker-standing-recovery-reservation-invalid");
  return { command, request, slot };
}

export function createWorkerSlotRepository({ database, admission, clock = systemClock, mutate }: WorkerSlotPorts) {
  const get = (workerId: string) => { const row = database.prepare("SELECT * FROM worker_slots WHERE id=?").get(WorkerIdSchema.parse(workerId)); return row === undefined ? undefined : workerSlotFromRow(row); };
  const list = (workflow?: string) => (workflow === undefined ? database.prepare("SELECT * FROM worker_slots ORDER BY ordinal").all()
    : database.prepare("SELECT * FROM worker_slots WHERE workflow=? ORDER BY ordinal").all(WorkflowIdSchema.parse(workflow))).map(workerSlotFromRow);
  const verification = (workerId: string) => { const slot = get(workerId); return slot === undefined ? undefined : verificationFromSlot(database, slot); };
  const verifications = (workflow: string) => list(workflow).flatMap(slot => { const hold = verificationFromSlot(database, slot); return hold === undefined ? [] : [hold]; });
  const recovery = (workerId: string) => { const slot = get(workerId); return slot === undefined ? undefined : recoveryFromSlot(database, slot); };
  const recoveries = (workflow: string) => list(workflow).flatMap(slot => { const hold = recoveryFromSlot(database, slot); return hold === undefined ? [] : [hold]; });
  const requireOrphanRetirement = (input: unknown) => {
    const request = WorkerVerificationRetirementRequestSchema.parse(input);
    if (request.cleanup.evidence !== "orphan-retired") return;
    const hold = verification(request.workerId);
    if (hold === undefined) throw new Error("worker-verification-authority-unavailable");
    validateOrphanRetirementProof(request, hold.request, hold.slot);
    const age = clock.nowMs() - Date.parse(request.now);
    if (age < 0 || age > 30_000) throw new Error("orphan-verification-retirement-unproved");
    const fresh = createOrphanRetirementProof(database, admission, hold.request, hold.slot, request.now);
    if (clock.nowMs() - Date.parse(request.now) > 30_000
      || canonicalJsonStringify(fresh) !== canonicalJsonStringify(request.cleanup.proof)) throw new Error("orphan-verification-retirement-unproved");
  };
  return Object.freeze({ get, list, verification, verifications, recovery, recoveries, requireOrphanRetirement,
    planOrphanRetirement(input: unknown) {
      const request = z.strictObject({ acquisitionId: z.uuid(), now: IsoInstantSchema }).parse(input);
      const holds = list().flatMap(slot => { const hold = verificationFromSlot(database, slot); return hold?.request.owner.acquisitionId === request.acquisitionId ? [hold] : []; });
      const hold = holds[0];
      if (holds.length !== 1 || hold === undefined) throw new Error("worker-verification-authority-unavailable");
      const proof = createOrphanRetirementProof(database, admission, hold.request, hold.slot, request.now);
      const pool = z.object({ version: z.number().int().nonnegative() }).parse(database.prepare("SELECT version FROM worker_pools WHERE workflow=?").get(hold.slot.workflow));
      return { hold, proof, poolVersion: pool.version };
    },
    requireVerificationRetirements(workflow: string) {
      for (const slot of list(workflow)) {
        if (slot.retiredAt === null || slot.reservationCommandId === null) continue;
        const grantRow = database.prepare("SELECT * FROM commands WHERE id=?").get(slot.reservationCommandId);
        if (grantRow === undefined) throw new Error("worker-slot-reservation-authority-unavailable");
        const grant = commandFromRow(grantRow);
        if (!("kind" in grant) || grant.kind !== "run-lifecycle" || grant.operation !== "worker-verification-admission") continue;
        const admissionRequest = WorkerVerificationAdmissionRequestSchema.parse(grant.request);
        const owner = admissionRequest.owner;
        const rows = database.prepare("SELECT payload_json FROM command_audits WHERE command_id=?").all(slot.retirementCommandId);
        if (rows.length !== 1) throw new Error("worker-verification-retirement-unproved");
        const audit = RunLifecycleCommandAuditRecordSchema.parse(JSON.parse(z.object({ payload_json: z.string() }).parse(rows[0]).payload_json));
        const retirementRow = database.prepare("SELECT * FROM commands WHERE id=?").get(slot.retirementCommandId);
        if (retirementRow === undefined || canonicalJsonStringify(commandFromRow(retirementRow)) !== canonicalJsonStringify(audit.request)) throw new Error("worker-verification-retirement-unproved");
        const retirement = WorkerVerificationRetirementRequestSchema.parse(audit.request.request);
        if (retirement.cleanup.evidence === "orphan-retired") {
          validateOrphanRetirementProof(retirement, admissionRequest, retirement.cleanup.proof.slot);
          const original = retirement.cleanup.proof.slot;
          if (canonicalJsonStringify({ ...original, membershipRevision: slot.membershipRevision, retiredAt: slot.retiredAt,
            retirementCommandId: slot.retirementCommandId, updatedAt: slot.updatedAt }) !== canonicalJsonStringify(slot)) throw new Error("worker-verification-retirement-unproved");
        }
        if (audit.request.operation !== "worker-verification-retirement" || audit.request.commandId !== slot.retirementCommandId
          || retirement.grantCommandId !== grant.commandId || retirement.workerId !== slot.workerId
          || retirement.expectedRevision + 1 !== slot.membershipRevision || retirement.cleanup.acquisitionId !== owner.acquisitionId
          || audit.result.kind !== "worker" || canonicalJsonStringify(audit.result.slot) !== canonicalJsonStringify(slot)
          || audit.result.beforePoolVersion !== retirement.expectedPoolVersion
          || audit.result.afterPoolVersion !== retirement.expectedPoolVersion + 1) throw new Error("worker-verification-retirement-unproved");
      }
    },
    observeVerificationAcquisition(input: unknown) {
      const request = z.strictObject({ workerId: WorkerIdSchema, grantCommandId: CommandIdSchema, now: IsoInstantSchema }).parse(input);
      return mutate(() => {
        const hold = verification(request.workerId);
        if (hold === undefined || hold.command.commandId !== request.grantCommandId) throw new Error("worker-verification-authority-unavailable");
        const record = WorkerSlotRecordSchema.parse({ ...hold.slot, phase: "waiting", updatedAt: request.now });
        const changes = Number(database.prepare("UPDATE worker_slots SET phase=?,payload_json=?,updated_at=? WHERE id=? AND membership_revision=? AND retired_at IS NULL")
          .run(record.phase, canonicalJsonStringify(record), record.updatedAt, record.workerId, record.membershipRevision).changes);
        if (changes !== 1) throw new Error("worker-slot-revision-conflict");
        return { result: record, changes };
      });
    },
    allocate(input: unknown) {
      const request = z.strictObject({ workflow: WorkflowIdSchema, poolIndex: z.number().int().min(1), commandId: CommandIdSchema.nullable(), now: IsoInstantSchema }).parse(input);
      return mutate(() => {
        if (database.prepare("SELECT 1 FROM worker_pools WHERE workflow=?").get(request.workflow) === undefined) throw new Error("worker-slot-pool-not-admitted");
        if (database.prepare("SELECT 1 FROM worker_controls WHERE scope=? AND audited_at IS NULL AND json_extract(payload_json,'$.request.type') IN ('stop-worker','remove-worker','retry-worker')").get(`worker-pool:${request.workflow}`) !== undefined) throw new Error("worker-reset-reserved");
        if (recoveries(request.workflow).length !== 0) throw new Error("worker-standing-recovery-reserved");
        if (verifications(request.workflow).length !== 0) throw new Error("worker-verification-reserved");
        const active = list(request.workflow).filter(slot => slot.retiredAt === null);
        const existing = active.find(slot => slot.poolIndex === request.poolIndex);
        if (existing !== undefined) return { result: existing, changes: 0 };
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
        if (database.prepare("SELECT 1 FROM worker_controls WHERE scope=? AND audited_at IS NULL AND json_extract(payload_json,'$.request.type') IN ('stop-worker','remove-worker','retry-worker')").get(`worker-pool:${current.workflow}`) !== undefined) throw new Error("worker-reset-reserved");
        if (recoveries(current.workflow).length !== 0) throw new Error("worker-standing-recovery-reserved");
        const hold = verification(request.workerId);
        if (hold === undefined && verifications(current.workflow).length !== 0) throw new Error("worker-verification-reserved");
        if (hold !== undefined) {
          const commandRow = database.prepare("SELECT * FROM commands WHERE id=?").get(request.commandId);
          if (commandRow === undefined) throw new Error("worker-verification-reserved");
          const command = commandFromRow(commandRow);
          if (!("kind" in command) || command.kind !== "run-lifecycle" || command.operation !== "worker-verification-retirement") throw new Error("worker-verification-reserved");
          const retirement = WorkerVerificationRetirementRequestSchema.parse(command.request);
          if (retirement.grantCommandId !== hold.command.commandId || retirement.workerId !== current.workerId
            || retirement.expectedRevision !== current.membershipRevision || retirement.cleanup.acquisitionId !== hold.request.owner.acquisitionId
            || retirement.cleanup.evidence === "browserless" && current.phase !== "starting") throw new Error("worker-verification-retirement-binding-mismatch");
          const pool = z.object({ version: z.number() }).parse(database.prepare("SELECT version FROM worker_pools WHERE workflow=?").get(current.workflow));
          if (retirement.now !== request.now || Number(pool.version) !== retirement.expectedPoolVersion
            || database.prepare("SELECT 1 FROM worker_controls WHERE scope=? AND audited_at IS NULL").get(`worker-pool:${current.workflow}`) !== undefined) throw new Error("worker-verification-retirement-binding-mismatch");
          requireOrphanRetirement(retirement);
          requireVerificationCleanup(database, hold, retirement);
          if (database.prepare("SELECT 1 FROM auth_leases WHERE holder_worker_id=? AND state='held'").get(current.workerId) !== undefined) throw new Error("worker-verification-duo-held");
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

export function requireWorkerPoolRoster(
  repositories: Pick<import("./authority-database.js").AuthorityRepositories, "workerPools" | "workerSlots">,
  workflow: string,
): void {
  repositories.workerSlots.verifications(workflow);
  repositories.workerSlots.requireVerificationRetirements(workflow);
  const pool = repositories.workerPools.get(workflow);
  const active = repositories.workerSlots.list(workflow).filter(slot => slot.retiredAt === null);
  if ((pool?.desiredWorkers ?? 0) !== active.length) {
    throw new Error("worker-pool-roster-authority-unavailable");
  }
}

export function admitWorkerPoolRoster(
  repositories: Pick<import("./authority-database.js").AuthorityRepositories, "workerPools" | "workerSlots">,
  request: Extract<import("../../../rules/commands/commands.js").CommandRequest, { type: "plan-worker-count" }>,
  now: string,
) {
  requireWorkerPoolRoster(repositories, request.target.workflowId);
  const before = repositories.workerPools.get(request.target.workflowId);
  const beforeVersion = before?.version ?? 0;
  if (beforeVersion !== request.target.expectedVersion) throw new Error("worker-pool-version-conflict");
  const active = repositories.workerSlots.list(request.target.workflowId).filter(slot => slot.retiredAt === null);
  const desired = request.payload.desiredWorkers;
  const early = before === undefined || desired >= before.desiredWorkers && desired >= active.length;
  if (early) {
    const outcome = repositories.workerPools.plan({ workflow: request.target.workflowId, expectedVersion: beforeVersion,
      desiredWorkers: desired, requestedBy: request.requestedBy, now });
    if (outcome.state !== "applied") throw new Error("worker-pool-version-conflict");
  }
  const selected = active.slice(0, desired), excess = active.slice(desired);
  for (let poolIndex = 1; selected.length < desired; poolIndex += 1) {
    if (active.some(slot => slot.poolIndex === poolIndex)) continue;
    selected.push(repositories.workerSlots.allocate({ workflow: request.target.workflowId, poolIndex,
      commandId: request.commandId, now }));
  }
  requireWorkerPoolRoster(repositories, request.target.workflowId);
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
  requireWorkerPoolRoster(repositories, request.workflow);
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
  requireWorkerPoolRoster(repositories, request.workflow);
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
  const recovery = repositories.workerSlots.recovery(member.workerId);
  if (recovery !== undefined) {
    if (recovery.command.commandId !== request.commandId || canonicalJsonStringify(recovery.request.binding.member) !== canonicalJsonStringify(member)
      || repositories.workerPools.get(member.workflowId)?.version !== recovery.request.binding.poolVersion) throw new Error("worker-launch-reservation-not-admitted");
    requireWorkerPoolRoster(repositories, member.workflowId);
    return member.workerId;
  }
  if (slot === undefined || slot.retiredAt !== null || canonicalJsonStringify(WorkerPoolMemberSchema.parse({ workflowId: slot.workflow, poolIndex: slot.poolIndex,
    ordinal: slot.ordinal, workerId: slot.workerId, membershipRevision: slot.membershipRevision })) !== canonicalJsonStringify(member)
    || control?.phase.state !== "executing" || Date.parse(control.expiresAt) <= Date.parse(request.now)) throw new Error("worker-launch-reservation-not-admitted");
  if (control.lifecycle?.operation.kind === "retry") {
    if (control.lifecycle?.operation.kind !== "retry" || canonicalJsonStringify(control.lifecycle.member) !== canonicalJsonStringify(member)
      || repositories.workerPools.get(member.workflowId)?.version !== control.lifecycle.poolVersion) throw new Error("worker-retry-launch-not-admitted");
  } else if (control.request.type !== "spawn-worker" || control.request.payload.workerId !== member.workerId
    || control.request.target.workflowId !== member.workflowId || repositories.workerPools.get(member.workflowId)?.version !== Number(control.request.target.expectedVersion)) throw new Error("worker-launch-reservation-not-admitted");
  requireWorkerPoolRoster(repositories, member.workflowId);
  return slot.workerId;
}

export function admitWorkerVerification(
  repositories: Pick<import("./authority-database.js").AuthorityRepositories, "workerPools" | "workerSlots" | "workerControls" | "lifecycleJournal">,
  input: unknown, auditId: string,
) {
  const request = WorkerVerificationAdmissionRequestSchema.parse(input);
  const command = RunLifecycleCommandRecordSchema.parse({ kind: "run-lifecycle", commandId: request.commandId,
    operation: "worker-verification-admission", request, fence: { kind: "none" }, recordedAt: request.now,
    requestFingerprint: sha256Hex(`hrauto:run-lifecycle-command:v1\0worker-verification-admission\0${canonicalJsonStringify(request)}`) });

  const prior = repositories.lifecycleJournal.findAuditByCommand(request.commandId);
  if (prior !== undefined) {
    if (!("kind" in prior) || prior.kind !== "run-lifecycle" || prior.result.kind !== "worker"
      || canonicalJsonStringify(prior.request) !== canonicalJsonStringify(command)) throw new Error("worker-verification-command-divergent");
    return prior.result.slot;
  }

  if (repositories.workerControls.pending(`worker-pool:${request.workflow}`).length !== 0
    || repositories.workerSlots.verifications(request.workflow).length !== 0) throw new Error("worker-control-unresolved-effect");
  requireWorkerPoolRoster(repositories, request.workflow);
  const owner = readRuntimeProcessLock(request.processLockRoot, "live-smoke");
  const observedProcess = observeProcessIdentity(request.owner.pid);
  if (owner?.pid !== process.pid || canonicalJsonStringify(owner) !== canonicalJsonStringify(request.owner)
    || observedProcess.state !== "alive" || canonicalJsonStringify(observedProcess.identity) !== canonicalJsonStringify(request.owner.processIdentity)) throw new Error("worker-verification-owner-unavailable");
  const pool = repositories.workerPools.get(request.workflow);
  if ((pool?.version ?? 0) !== request.expectedPoolVersion) throw new Error("worker-pool-version-conflict");
  repositories.lifecycleJournal.insertCommand(command);
  const active = repositories.workerSlots.list(request.workflow).filter(slot => slot.retiredAt === null);
  let poolIndex = 1;
  while (active.some(slot => slot.poolIndex === poolIndex)) poolIndex += 1;
  const planned = repositories.workerPools.plan({ workflow: request.workflow, expectedVersion: request.expectedPoolVersion,
    desiredWorkers: active.length + 1, requestedBy: "local-operator", now: request.now });
  if (planned.state !== "applied") throw new Error("worker-pool-version-conflict");
  const slot = repositories.workerSlots.allocate({ workflow: request.workflow, poolIndex, commandId: request.commandId, now: request.now });
  repositories.lifecycleJournal.insertAudit({ kind: "run-lifecycle", auditId, request: command,
    result: { kind: "worker", slot, beforePoolVersion: request.expectedPoolVersion, afterPoolVersion: planned.pool.version }, completedAt: request.now });
  return slot;
}

export function retireWorkerVerification(
  repositories: Pick<import("./authority-database.js").AuthorityRepositories, "workerPools" | "workerSlots" | "workerControls" | "lifecycleJournal">,
  input: unknown, auditId: string,
) {
  const request = WorkerVerificationRetirementRequestSchema.parse(input);
  const command = RunLifecycleCommandRecordSchema.parse({ kind: "run-lifecycle", commandId: request.commandId,
    operation: "worker-verification-retirement", request, fence: { kind: "none" }, recordedAt: request.now,
    requestFingerprint: sha256Hex(`hrauto:run-lifecycle-command:v1\0worker-verification-retirement\0${canonicalJsonStringify(request)}`) });

  const prior = repositories.lifecycleJournal.findAuditByCommand(request.commandId);
  if (prior !== undefined) {
    if (!("kind" in prior) || prior.kind !== "run-lifecycle" || prior.result.kind !== "worker"
      || canonicalJsonStringify(prior.request) !== canonicalJsonStringify(command)) throw new Error("worker-verification-command-divergent");
    return prior.result.slot;
  }

  const hold = repositories.workerSlots.verification(request.workerId);
  if (hold === undefined || hold.command.commandId !== request.grantCommandId
    || hold.slot.membershipRevision !== request.expectedRevision || hold.request.owner.acquisitionId !== request.cleanup.acquisitionId) throw new Error("worker-verification-authority-unavailable");
  if (repositories.workerControls.pending(`worker-pool:${hold.slot.workflow}`).length !== 0) throw new Error("worker-control-unresolved-effect");
  requireWorkerPoolRoster(repositories, hold.slot.workflow);
  const pool = repositories.workerPools.get(hold.slot.workflow);
  if (pool === undefined || Number(pool.version) !== request.expectedPoolVersion) throw new Error("worker-pool-version-conflict");
  repositories.workerSlots.requireOrphanRetirement(request);
  repositories.lifecycleJournal.insertCommand(command);
  const slot = repositories.workerSlots.retire({ workerId: request.workerId, commandId: request.commandId,
    expectedRevision: request.expectedRevision, now: request.now });
  const planned = repositories.workerPools.plan({ workflow: slot.workflow, expectedVersion: request.expectedPoolVersion,
    desiredWorkers: pool.desiredWorkers - 1, requestedBy: "local-operator", now: request.now });
  if (planned.state !== "applied") throw new Error("worker-pool-version-conflict");
  repositories.lifecycleJournal.insertAudit({ kind: "run-lifecycle", auditId, request: command,
    result: { kind: "worker", slot, beforePoolVersion: request.expectedPoolVersion, afterPoolVersion: planned.pool.version }, completedAt: request.now });
  return slot;
}
