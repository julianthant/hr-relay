import { commandFromRow } from "./command-record-row.js";
import { workerSlotFromRow } from "./worker-slots.js";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { CommandIdentityConflictError } from "../../../rules/commands/commands.js";
import { WorkerBrowserObservationSchema, WorkerControlRecordSchema, WorkerControlPhaseSchema, type WorkerControlPhase } from "../../../models/run/worker-control.js";
import { CommandIdSchema, IsoInstantSchema, WorkerIdSchema } from "../../../rules/identity/ids.js";

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
    list: () => database.prepare("SELECT * FROM worker_controls ORDER BY rowid").all().map(workerControlFromRow),
    admit: (input: unknown) => deps.mutate("worker_controls", () => {
      const record = WorkerControlRecordSchema.parse(input);
      const prior = get(record.commandId);
      if (prior !== undefined) {
        if (canonicalJsonStringify(prior.request) !== canonicalJsonStringify(record.request)) throw new CommandIdentityConflictError();
        return { result: prior, changes: 0 };
      }
      const command = database.prepare("SELECT * FROM commands WHERE id=?").get(record.commandId);
      if (command === undefined || canonicalJsonStringify(commandFromRow(command)) !== canonicalJsonStringify(record.request)) throw new Error("worker-control-command-binding-mismatch");
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
    transition: (id: string, expected: WorkerControlPhase["state"], input: unknown) => deps.mutate("worker_controls", () => {
      const current = get(id);
      if (current === undefined) throw new Error("worker-control-not-found");
      if (current.phase.state !== expected || current.auditedAt !== undefined) throw new Error("worker-control-phase-conflict");
      const phase = WorkerControlPhaseSchema.parse(input);
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
