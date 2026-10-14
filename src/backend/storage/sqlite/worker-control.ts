import { RunRecordSchema, runClaim, type RunRecord } from "../../../models/run/record.js";
import { WorkerLeaseRecordSchema } from "../../../models/run/worker.js";
import { runRecordFromRow } from "./run-record-row.js";
import { DependencyRecordSchema } from "../../../rules/workflow/dependencies.js";
import { workerPoolMember } from "../../../models/run/worker-slot.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import type { AuthorityRepositories } from "./authority-database.js";
import { commandFromRow } from "./command-record-row.js";
import { workerSlotFromRow, verificationFromSlot } from "./worker-slots.js";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { CommandIdentityConflictError, LiveWorkerResetRequestSchema } from "../../../rules/commands/commands.js";
import { WorkerResetBindingSchema, WorkerBrowserObservationSchema, WorkerControlRecordSchema, WorkerControlPhaseSchema, type WorkerControlPhase, type WorkerResetBinding } from "../../../models/run/worker-control.js";
import { CommandIdSchema, IsoInstantSchema, WorkerIdSchema } from "../../../rules/identity/ids.js";

const resetClosures = new WeakMap<object, Readonly<{ binding: WorkerResetBinding; sessions: readonly string[]; valid: () => boolean }>>();
export type WorkerResetClosure = Readonly<{ readonly kind: "worker-reset-owner-closure" }>;
export function authenticateWorkerResetClosure(proof: WorkerResetClosure, binding: WorkerResetBinding): readonly string[] {
  const owned = resetClosures.get(proof);
  if (owned === undefined || !owned.valid() || canonicalJsonStringify(owned.binding) !== canonicalJsonStringify(binding)) throw new Error("worker-reset-closure-authority-unavailable");
  return owned.sessions;
}

export function mintWorkerResetClosure(binding: WorkerResetBinding, sessions: readonly string[], valid: () => boolean): WorkerResetClosure {
  const proof: WorkerResetClosure = Object.freeze({ kind: "worker-reset-owner-closure" });
  resetClosures.set(proof, { binding, sessions, valid });
  return proof;
}
export function consumeWorkerResetClosure(proof: WorkerResetClosure): void {
  if (!resetClosures.delete(proof)) throw new Error("worker-reset-closure-already-consumed");
}

const ControlRowSchema = z.strictObject({ command_id: z.string(), scope: z.string(), worker_id: z.string().nullable(),
  phase: z.string(), audited_at: z.string().nullable(), payload_json: z.string(), created_at: z.string() });
export function workerControlFromRow(input: unknown) {
  const row = ControlRowSchema.parse(input), record = WorkerControlRecordSchema.parse(JSON.parse(row.payload_json));
  const workerId = "workerId" in record.request.target ? record.request.target.workerId
    : record.request.type === "spawn-worker" ? record.request.payload.workerId : null;
  if (row.command_id !== record.commandId || row.scope !== record.scope || row.worker_id !== workerId
    || row.phase !== record.phase.state || row.audited_at !== (record.auditedAt ?? null)
    || row.created_at !== record.admittedAt) throw new Error("worker-control-storage-identity-mismatch");
  return record;
}
const BrowserRowSchema = z.strictObject({ id: z.string(), worker_id: z.string(), lease_generation: z.number().int().positive(),
  system: z.string(), state: z.string(), auth_fingerprint: z.string(), presentation: z.string(), profile_revision: z.number().int().positive(),
  payload_json: z.string(), opened_at: z.string(), observed_at: z.string() });
export function workerBrowserFromRow(input: unknown) {
  const row = BrowserRowSchema.parse(input), record = WorkerBrowserObservationSchema.parse(JSON.parse(row.payload_json));
  if (row.id !== record.sessionId || row.worker_id !== record.workerId || row.lease_generation !== record.leaseGeneration
    || row.system !== record.system || row.state !== record.health || row.auth_fingerprint !== record.configFingerprint
    || row.presentation !== record.browserMode || row.profile_revision !== record.profileRevision
    || row.opened_at !== record.openedAt || row.observed_at !== record.observedAt) throw new Error("worker-browser-storage-identity-mismatch");
  return record;
}
export function createWorkerControlRepository(deps: {
  database: DatabaseSync;
  mutate<T>(table: "worker_controls" | "browser_sessions", work: () => { result: T; changes: number }): T;
}) {
  const { database } = deps;
  const get = (id: string) => {
    const row = database.prepare("SELECT * FROM worker_controls WHERE command_id=?").get(CommandIdSchema.parse(id));
    if (row === undefined) return undefined;
    const record = workerControlFromRow(row);
    const command = database.prepare("SELECT * FROM commands WHERE id=?").get(record.commandId);
    if (command === undefined || canonicalJsonStringify(commandFromRow(command)) !== canonicalJsonStringify(record.request)) throw new Error("worker-control-command-binding-mismatch");
    return record;
  };
  const pending = (scope: string) => database.prepare("SELECT * FROM worker_controls WHERE scope=? AND audited_at IS NULL ORDER BY rowid").all(scope).map(workerControlFromRow);
  return Object.freeze({
    get,
    pending,
    resetForRun: (runId: string) => database.prepare("SELECT command_id FROM worker_controls WHERE audited_at IS NULL").all().map(row => get(z.object({ command_id: z.string() }).parse(row).command_id)).find(record =>
      record?.reset?.work.kind === "current" && [record.reset.work.current, ...record.reset.work.cascade].some(run => run.runId === runId)),
    resetForWorker: (workerId: string, leaseGeneration?: number) => {
      const records = database.prepare("SELECT command_id FROM worker_controls WHERE worker_id=? AND audited_at IS NULL ORDER BY rowid").all(workerId).map(row => get(z.object({ command_id: z.string() }).parse(row).command_id));
      const reset = records.find(record => record?.request.type === "stop-worker");
      if (reset === undefined) return undefined;
      if (reset.reset === undefined) throw new Error("worker-reset-authority-unavailable");
      if (leaseGeneration !== undefined && reset.reset.lifetime.leaseGeneration !== leaseGeneration) throw new Error("worker-reset-lifetime-conflict");
      return reset;
    },
    list: () => database.prepare("SELECT * FROM worker_controls ORDER BY rowid").all().map(workerControlFromRow),
    admit: (input: unknown) => deps.mutate("worker_controls", () => {
      const record = WorkerControlRecordSchema.parse(input);
      if (record.request.type === "stop-worker") {
        LiveWorkerResetRequestSchema.parse(record.request);
        if (record.reset === undefined) throw new Error("worker-reset-authority-unavailable");
        const lease = database.prepare("SELECT payload_json FROM worker_leases WHERE id=?").get(record.reset.member.workerId);
        const reserved = WorkerLeaseRecordSchema.parse(lease === undefined ? undefined : JSON.parse(z.object({ payload_json: z.string() }).parse(lease).payload_json));
        if (reserved.leaseGeneration !== record.reset.lifetime.leaseGeneration || reserved.controlRevision !== record.reset.reservedControlRevision
          || reserved.controlCommandId !== record.commandId || reserved.processId !== record.reset.lifetime.processId
          || reserved.lifecycle.startedAt !== record.reset.lifetime.startedAt || reserved.version !== record.basisVersion + 1) throw new Error("worker-reset-lifetime-conflict");
      }
      const prior = get(record.commandId);
      if (prior !== undefined) {
        if (canonicalJsonStringify(prior.request) !== canonicalJsonStringify(record.request)) throw new CommandIdentityConflictError();
        return { result: prior, changes: 0 };
      }
      const target = record.request.target;
      const memberRow = "workerId" in target ? database.prepare("SELECT * FROM worker_slots WHERE id=?").get(target.workerId) : undefined;
      const workflow = "workflowId" in target ? target.workflowId : memberRow === undefined ? undefined : workerSlotFromRow(memberRow).workflow;
      if (workflow !== undefined && database.prepare("SELECT * FROM worker_slots WHERE workflow=?").all(workflow)
        .some(row => verificationFromSlot(database, workerSlotFromRow(row)) !== undefined)) throw new Error("worker-verification-reserved");
      const command = database.prepare("SELECT * FROM commands WHERE id=?").get(record.commandId);
      if (command === undefined || canonicalJsonStringify(commandFromRow(command)) !== canonicalJsonStringify(record.request)) throw new Error("worker-control-command-binding-mismatch");
      if (record.reset !== undefined) {
        if (memberRow === undefined || canonicalJsonStringify(workerPoolMember(workerSlotFromRow(memberRow))) !== canonicalJsonStringify(record.reset.member)
          || record.scope !== `worker-pool:${record.reset.member.workflowId}`) throw new Error("worker-reset-member-conflict");
        const bound = record.reset.work.kind === "absent" ? [] : [record.reset.work.current, ...record.reset.work.cascade];
        const owned = database.prepare("SELECT * FROM runs WHERE owner_worker_id=?").all(record.reset.member.workerId).map(runRecordFromRow).filter(run => runClaim(run) !== undefined);
        if (owned.some(run => !bound.some(member => member.state === "claimed" && member.runId === run.envelope.runId))) throw new Error("worker-reset-current-run-conflict");
        for (const parent of bound) {
          const children = database.prepare("SELECT * FROM runs WHERE parent_id=?").all(parent.runId).map(runRecordFromRow);
          for (const child of children) {
            if (child.lifecycle.state === "terminal") continue;
            const edges = database.prepare("SELECT payload_json FROM delegation_dependencies WHERE json_extract(payload_json,'$.parentRunId')=? AND json_extract(payload_json,'$.childRunId')=?").all(parent.runId, child.envelope.runId)
              .map(row => DependencyRecordSchema.parse(JSON.parse(z.object({ payload_json: z.string() }).parse(row).payload_json)));
            if (edges.length !== 1) throw new Error("worker-reset-cascade-authority-unavailable");
            if (edges[0]?.policy.cascadeCancel !== "independent" && !bound.some(member => member.runId === child.envelope.runId)) throw new Error("worker-reset-cascade-binding-conflict");
          }
        }
        for (const member of bound) {
          const row = database.prepare("SELECT * FROM runs WHERE id=?").get(member.runId);
          if (row === undefined) throw new Error("worker-reset-run-unavailable");
          const run = RunRecordSchema.parse(runRecordFromRow(row)), claim = runClaim(run);
          if (run.version !== member.version || run.envelope.attempt !== member.attempt
            || (member.state === "queued" ? run.lifecycle.state !== "queued" : claim?.workerId !== member.workerId || claim?.claimGeneration !== member.claimGeneration)) throw new Error("worker-reset-run-conflict");
          if (member.state === "queued") {
            const edges = database.prepare("SELECT payload_json FROM delegation_dependencies WHERE json_extract(payload_json,'$.childRunId')=?").all(member.runId)
              .map(row => DependencyRecordSchema.parse(JSON.parse(z.object({ payload_json: z.string() }).parse(row).payload_json)));
            if (edges.length !== 1 || !edges.some(edge => sha256Hex(canonicalJsonStringify(edge)) === member.dependencyFingerprint)) throw new Error("worker-reset-cascade-binding-conflict");
          }
        }
      }
      if (record.roster !== undefined) {
        for (const original of [...record.roster.selected, ...record.roster.excess]) {
          const row = database.prepare("SELECT * FROM worker_slots WHERE id=?").get(original.workerId);
          if (row === undefined || canonicalJsonStringify(workerSlotFromRow(row)) !== canonicalJsonStringify(original)) throw new Error("worker-control-roster-binding-mismatch");
        }
      }
      if (record.phase.state !== "admitted" || record.auditedAt !== undefined) throw new Error("worker-control-invalid-admission");
      if (pending(record.scope).length !== 0) throw new Error("worker-control-unresolved-effect");
      const workerId = "workerId" in record.request.target ? record.request.target.workerId
        : record.request.type === "spawn-worker" ? record.request.payload.workerId : null;
      database.prepare("INSERT INTO worker_controls(command_id,scope,worker_id,phase,audited_at,payload_json,created_at) VALUES (?,?,?,'admitted',NULL,?,?)")
        .run(record.commandId,record.scope,workerId,canonicalJsonStringify(record),record.admittedAt);
      return { result: record, changes: 1 };
    }),
    assertResetGraph: (input: unknown) => {
      const reset = WorkerResetBindingSchema.parse(input), current = get(reset.commandId);
      if (current?.reset === undefined || canonicalJsonStringify(current.reset) !== canonicalJsonStringify(reset)) throw new Error("worker-reset-graph-authority-unavailable");
      const bound = reset.work.kind === "absent" ? [] : [reset.work.current, ...reset.work.cascade];
      for (const member of bound) {
        const row = database.prepare("SELECT * FROM runs WHERE id=?").get(member.runId);
        if (row === undefined) throw new Error("worker-reset-graph-run-missing");
        const run = runRecordFromRow(row);
        if (run.envelope.attempt !== member.attempt) throw new Error("worker-reset-graph-attempt-changed");
        const children = database.prepare("SELECT * FROM runs WHERE parent_id=?").all(member.runId).map(runRecordFromRow);
        for (const child of children) {
          const edges = database.prepare("SELECT payload_json FROM delegation_dependencies WHERE json_extract(payload_json,'$.parentRunId')=? AND json_extract(payload_json,'$.childRunId')=?").all(member.runId, child.envelope.runId)
            .map(row => DependencyRecordSchema.parse(JSON.parse(z.object({ payload_json: z.string() }).parse(row).payload_json)));
          if (edges.length !== 1) throw new Error("worker-reset-cascade-authority-unavailable");
          const edge = edges[0];
          if (edge?.policy.cascadeCancel === "independent") continue;
          const selected = bound.find(value => value.runId === child.envelope.runId);
          if (selected === undefined) {
            if (child.lifecycle.state !== "terminal") throw new Error("worker-reset-cascade-changed");
          } else if (selected.state !== "queued" || selected.dependencyFingerprint !== sha256Hex(canonicalJsonStringify(edge))) throw new Error("worker-reset-cascade-changed");
        }
      }
    },
    transition: (id: string, expected: WorkerControlPhase["state"], input: unknown) => deps.mutate("worker_controls", () => {
      const current = get(id);
      if (current === undefined) throw new Error("worker-control-not-found");
      if (current.phase.state !== expected || current.auditedAt !== undefined) throw new Error("worker-control-phase-conflict");
      const phase = WorkerControlPhaseSchema.parse(input);
      if (current.request.type === "stop-worker" && (phase.state === "refused" || phase.state === "succeeded")) throw new Error("worker-reset-settlement-unavailable");
      const allowed: Readonly<Record<WorkerControlPhase["state"], readonly WorkerControlPhase["state"][]>> = {
        admitted: ["ready", "executing", "refused"], ready: ["executing", "refused"], executing: ["succeeded", "refused", "uncertain"], succeeded: [], refused: [], uncertain: [],
      };
      if (!allowed[expected].includes(phase.state)) throw new Error("worker-control-invalid-transition");
      const record = WorkerControlRecordSchema.parse({ ...current, phase });
      if (database.prepare("UPDATE worker_controls SET phase=?,audited_at=?,payload_json=? WHERE command_id=? AND payload_json=?")
        .run(record.phase.state,record.auditedAt ?? null,canonicalJsonStringify(record),id,canonicalJsonStringify(current)).changes !== 1) throw new Error("worker-control-phase-conflict");
      return { result: record, changes: 1 };
    }),
    audit: (id: string, now: string) => deps.mutate("worker_controls", () => {
      const current = get(id);
      if (current === undefined) throw new Error("worker-control-not-found");
      if (current.request.type === "stop-worker") throw new Error("worker-reset-settlement-unavailable");
      const record = WorkerControlRecordSchema.parse({ ...current, auditedAt: IsoInstantSchema.parse(now) });
      if (database.prepare("UPDATE worker_controls SET phase=?,audited_at=?,payload_json=? WHERE command_id=? AND payload_json=?")
        .run(record.phase.state,record.auditedAt ?? null,canonicalJsonStringify(record),id,canonicalJsonStringify(current)).changes !== 1) throw new Error("worker-control-phase-conflict");
      return { result: record, changes: 1 };
    }),
    observe: (input: unknown) => deps.mutate("browser_sessions", () => {
      const record = WorkerBrowserObservationSchema.parse(input);
      const priorRow = database.prepare("SELECT * FROM browser_sessions WHERE id=?").get(record.sessionId);
      if (priorRow !== undefined) {
        const prior = workerBrowserFromRow(priorRow);
        const identity = (value: typeof record) => { const { health: _health, observedAt: _observedAt, ...fields } = value; return canonicalJsonStringify(fields); };
        if (identity(prior) !== identity(record)) throw new Error("worker-browser-observation-identity-conflict");
        if (prior.health === "closed" && record.health !== "closed") throw new Error("worker-browser-closed-session-cannot-reopen");
      }
      const json = canonicalJsonStringify(record);
      const changes = priorRow === undefined
        ? database.prepare(`INSERT INTO browser_sessions(id,worker_id,lease_generation,system,state,auth_fingerprint,presentation,profile_revision,payload_json,opened_at,observed_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(record.sessionId,record.workerId,record.leaseGeneration,record.system,record.health,record.configFingerprint,
            record.browserMode,record.profileRevision,json,record.openedAt,record.observedAt).changes
        : database.prepare("UPDATE browser_sessions SET state=?,payload_json=?,observed_at=? WHERE id=? AND payload_json=?")
          .run(record.health,json,record.observedAt,record.sessionId,canonicalJsonStringify(workerBrowserFromRow(priorRow))).changes;
      if (changes !== 1) throw new Error("worker-browser-observation-state-conflict");
      return { result: record, changes: 1 };
    }),
    browsers: (workerId: string) => database.prepare("SELECT * FROM browser_sessions WHERE worker_id=? ORDER BY rowid").all(WorkerIdSchema.parse(workerId)).map(workerBrowserFromRow),
  });
}
export type WorkerControlRepository = ReturnType<typeof createWorkerControlRepository>;

export function validateWorkerControls(database: DatabaseSync): void {
  for (const row of database.prepare("SELECT * FROM worker_controls").all()) {
    const record = workerControlFromRow(row);
    const command = database.prepare("SELECT * FROM commands WHERE id=?").get(record.commandId);
    if (command === undefined || canonicalJsonStringify(commandFromRow(command)) !== canonicalJsonStringify(record.request)) throw new Error("worker-control-command-binding-mismatch");
  }
  for (const row of database.prepare("SELECT * FROM browser_sessions").all()) workerBrowserFromRow(row);
}

export function assertWorkerResetParkedWrite(repositories: AuthorityRepositories, run: RunRecord): void {
  if (run.lifecycle.state !== "parked-write") throw new Error("worker-reset-parked-write-authority-unavailable");
  const intent = repositories.writeIntents.get(run.lifecycle.writeIntentId);
  if (intent?.status !== "parked" || intent.generation !== run.lifecycle.intentGeneration
    || intent.runId !== run.envelope.runId || intent.runAttempt !== run.envelope.attempt
    || intent.workflowId !== run.envelope.workflow || intent.itemId !== run.envelope.itemId) throw new Error("worker-reset-parked-write-authority-unavailable");
  const attempt = repositories.writeAttempts.get(intent.currentAttemptId);
  if (attempt?.outcome.state !== "parked" || attempt.writeIntentId !== intent.writeIntentId
    || attempt.generation !== intent.generation || attempt.runId !== intent.runId || attempt.runAttempt !== intent.runAttempt
    || attempt.bindingProofDigest !== intent.bindingProofDigest) throw new Error("worker-reset-parked-write-authority-unavailable");
}

export function admitWorkerReset(repositories: AuthorityRepositories, input: unknown, executorId: string, now: string) {
  const request = LiveWorkerResetRequestSchema.parse(input);
  repositories.commands.assertIdentity(request);
  const slot = repositories.workerSlots.get(request.target.workerId);
  const lease = repositories.workerLeases.get(request.target.workerId);
  if (slot === undefined || slot.retiredAt !== null || slot.membershipRevision !== request.target.membershipRevision
    || lease === undefined || lease.lifecycle.state === "stopped" || lease.lifecycle.state === "stopping"
    || lease.leaseGeneration !== request.target.controlBasis.leaseGeneration || lease.controlRevision !== request.target.controlBasis.controlRevision
) throw new Error("worker-reset-target-conflict");
  const scope = `worker-pool:${slot.workflow}`;
  if (repositories.workerControls.pending(scope).length !== 0 || repositories.workerSlots.verifications(slot.workflow).length !== 0) throw new Error("worker-control-unresolved-effect");
  const held = repositories.runs.listByWorker(slot.workerId).filter(run => runClaim(run) !== undefined);
  const current = held.length === 1 ? held[0] : undefined;
  if (held.length > 1 || lease.lifecycle.state === "busy" && current?.envelope.runId !== lease.lifecycle.runId) throw new Error("worker-reset-current-run-unavailable");
  const claimed = (run: NonNullable<typeof current>) => {
    const claim = runClaim(run);
    if (claim === undefined || claim.workerId !== slot.workerId) throw new Error("worker-reset-foreign-cascade-owner");
    return { state: "claimed", runId: run.envelope.runId, version: run.version, attempt: run.envelope.attempt,
      workerId: claim.workerId, claimGeneration: claim.claimGeneration };
  };
  const cascade: unknown[] = [], seen = new Set<string>();
  const collect = (run: NonNullable<typeof current>) => {
    if (seen.has(run.envelope.runId)) throw new Error("worker-reset-cascade-cycle");
    seen.add(run.envelope.runId);
    for (const child of repositories.runs.listChildren(run.envelope.runId)) {
      const edges = repositories.dependencies.listByParentRun(run.envelope.runId).filter(edge => edge.childRunId === child.envelope.runId);
      if (edges.length !== 1) throw new Error("worker-reset-cascade-authority-unavailable");
      const edge = edges[0];
      if (edge === undefined) throw new Error("worker-reset-cascade-authority-unavailable");
      if (edge.policy.cascadeCancel === "independent" || child.lifecycle.state === "terminal") continue;
      const dependencyFingerprint = sha256Hex(canonicalJsonStringify(edge));
      if (runClaim(child) !== undefined) throw new Error("worker-reset-foreign-cascade-owner");
      if (child.lifecycle.state !== "queued") throw new Error("worker-reset-cascade-custody-unavailable");
      cascade.push({ state: "queued", runId: child.envelope.runId,
        version: child.version, attempt: child.envelope.attempt, dependencyFingerprint });
      collect(child);
    }
  };
  if (current !== undefined) collect(current);
  const reset = WorkerResetBindingSchema.parse({ commandId: request.commandId, member: workerPoolMember(slot),
    lifetime: { leaseGeneration: lease.leaseGeneration, processId: lease.processId, startedAt: lease.lifecycle.startedAt },
    basis: request.target.controlBasis, reservedControlRevision: lease.controlRevision + 1,
    work: current === undefined ? { kind: "absent" } : { kind: "current", current: claimed(current), cascade } });
  repositories.workerLeases.reserveControl(slot.workerId, request.target.controlBasis, request.commandId, now);
  repositories.commands.insert(request);
  return repositories.workerControls.admit({ commandId: request.commandId, request, reset, scope, executorId,
    admittedAt: now, expiresAt: new Date(Date.parse(now) + 180_000).toISOString(), basisVersion: lease.version, phase: { state: "admitted" } });
}
