import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { CommandIdentityConflictError } from "../../../rules/commands/commands.js";
import { WorkerBrowserObservationSchema, WorkerControlRecordSchema, WorkerControlPhaseSchema, type WorkerControlPhase, type WorkerControlRecord } from "../../../models/run/worker-control.js";
import { CommandIdSchema, IsoInstantSchema, WorkerIdSchema } from "../../../rules/identity/ids.js";

export const WORKER_CONTROL_DDL = `CREATE TABLE worker_controls (
  record_key TEXT PRIMARY KEY, scope TEXT NOT NULL, record_json TEXT NOT NULL CHECK(json_valid(record_json)), created_at TEXT NOT NULL
) STRICT`;
export const WORKER_BROWSER_DDL = `CREATE TABLE worker_browsers (
  record_key TEXT PRIMARY KEY, worker_id TEXT NOT NULL, record_json TEXT NOT NULL CHECK(json_valid(record_json)), created_at TEXT NOT NULL
) STRICT`;
const JsonRow = z.object({ record_json: z.string() });
const parseControl = (row: unknown) => WorkerControlRecordSchema.parse(JSON.parse(JsonRow.parse(row).record_json));
const parseBrowser = (row: unknown) => WorkerBrowserObservationSchema.parse(JSON.parse(JsonRow.parse(row).record_json));
export function createWorkerControlRepository(deps: {
  database: DatabaseSync;
  mutate<T>(table: "worker_controls" | "worker_browsers", work: () => { result: T; changes: number }): T;
}) {
  const { database } = deps;
  const get = (id: string) => {
    const row = database.prepare("SELECT record_json FROM worker_controls WHERE record_key=?").get(CommandIdSchema.parse(id));
    return row === undefined ? undefined : parseControl(row);
  };
  const pending = (scope: string) => database.prepare("SELECT record_json FROM worker_controls WHERE scope=? AND json_extract(record_json,'$.auditedAt') IS NULL ORDER BY rowid").all(scope).map(parseControl);
  return Object.freeze({
    get,
    pending,
    list: () => database.prepare("SELECT record_json FROM worker_controls ORDER BY rowid").all().map(parseControl),
    admit: (input: unknown) => deps.mutate("worker_controls", () => {
      const record = WorkerControlRecordSchema.parse(input);
      const prior = get(record.commandId);
      if (prior !== undefined) {
        if (canonicalJsonStringify(prior.request) !== canonicalJsonStringify(record.request)) throw new CommandIdentityConflictError();
        return { result: prior, changes: 0 };
      }
      if (record.phase.state !== "admitted" || record.auditedAt !== undefined) throw new Error("worker-control-invalid-admission");
      if (pending(record.scope).length !== 0) throw new Error("worker-control-unresolved-effect");
      database.prepare("INSERT INTO worker_controls(record_key,scope,record_json,created_at) VALUES (?,?,?,?)").run(record.commandId,record.scope,canonicalJsonStringify(record),record.admittedAt);
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
      database.prepare("UPDATE worker_controls SET record_json=? WHERE record_key=?").run(canonicalJsonStringify(record),id);
      return { result: record, changes: 1 };
    }),
    audit: (id: string, now: string) => deps.mutate("worker_controls", () => {
      const current = get(id);
      if (current === undefined) throw new Error("worker-control-not-found");
      const record = WorkerControlRecordSchema.parse({ ...current, auditedAt: IsoInstantSchema.parse(now) });
      database.prepare("UPDATE worker_controls SET record_json=? WHERE record_key=?").run(canonicalJsonStringify(record),id);
      return { result: record, changes: 1 };
    }),
    observe: (input: unknown) => deps.mutate("worker_browsers", () => {
      const record = WorkerBrowserObservationSchema.parse(input);
      const priorRow = database.prepare("SELECT record_json FROM worker_browsers WHERE record_key=?").get(record.sessionId);
      if (priorRow !== undefined) {
        const prior = parseBrowser(priorRow);
        const identity = (value: typeof record) => { const { health: _health, observedAt: _observedAt, ...fields } = value; return canonicalJsonStringify(fields); };
        if (identity(prior) !== identity(record)) throw new Error("worker-browser-observation-identity-conflict");
        if (prior.health === "closed" && record.health !== "closed") throw new Error("worker-browser-closed-session-cannot-reopen");
      }
      database.prepare("INSERT INTO worker_browsers(record_key,worker_id,record_json,created_at) VALUES (?,?,?,?) ON CONFLICT(record_key) DO UPDATE SET record_json=excluded.record_json").run(record.sessionId,record.workerId,canonicalJsonStringify(record),record.observedAt);
      return { result: record, changes: 1 };
    }),
    browsers: (workerId: string) => database.prepare("SELECT record_json FROM worker_browsers WHERE worker_id=? ORDER BY rowid").all(WorkerIdSchema.parse(workerId)).map(parseBrowser),
  });
}
export type WorkerControlRepository = ReturnType<typeof createWorkerControlRepository>;

export function validateWorkerControls(database: DatabaseSync): void {
  for (const row of database.prepare("SELECT * FROM worker_controls").all()) {
    const record: WorkerControlRecord = parseControl(row);
    if (row["record_key"] !== record.commandId || row["scope"] !== record.scope || row["created_at"] !== record.admittedAt) throw new Error("worker-control-storage-identity-mismatch");
  }
  for (const row of database.prepare("SELECT * FROM worker_browsers").all()) {
    const record = parseBrowser(row);
    if (row["record_key"] !== record.sessionId || row["worker_id"] !== record.workerId) throw new Error("worker-browser-storage-identity-mismatch");
  }
}
