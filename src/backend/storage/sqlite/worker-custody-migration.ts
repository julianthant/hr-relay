import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { RunDeleteInputSchema } from "../../../models/run/deleted-run.js";
import type { PredecessorRunRecord } from "../../../models/run/record.js";
import { CanonicalDeleteRequestSchema } from "./run-store-contracts.js";
import { insertNativeCommand } from "./command-record-row.js";
import { BUILD_ID_ENVELOPE_SCHEMA_VERSION, WORKER_CUSTODY_SLOT_REBUILD_ID } from "./migrations.js";
import { executeNativeRunDeletion, prepareNativeRunDeletion, RunDeletionRefusedError } from "./native-run-deletion.js";
import { childrenFirst, lifecycleCommand, recordAudit, requireSettledPreBuildRun } from "./pre-build-run-deletion.js";
import { readRestoreWriteFences } from "./restore-write-fences.js";
import { confirmationPublicationFromRow } from "../../../models/events/confirmed-operation.js";
import { authenticateParkedWriteResolution } from "../../../rules/write-safety/parked-resolution.js";
import { WriteAttemptRecordSchema, WriteIntentRecordSchema, type WriteIntentRecord } from "../../../rules/write-safety/write-safety.js";
import { nativeOrdinaryRecordFromRow } from "./native-record-row.js";
import { isPredecessorWorkerHistory, predecessorCommandFromRow, predecessorCustodyRunFromRow } from "./worker-custody-predecessor.js";

const SLIM_WORKER_SLOTS = [
  `CREATE TABLE worker_slots (
 id TEXT PRIMARY KEY, workflow TEXT NOT NULL REFERENCES worker_pools(workflow), ordinal INTEGER NOT NULL UNIQUE CHECK(ordinal>0),
 pool_index INTEGER NOT NULL CHECK(pool_index>0), paused INTEGER NOT NULL CHECK(paused IN (0,1)),
 retired_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT`,
  `INSERT INTO worker_slots SELECT slot.id, slot.workflow, slot.ordinal, json_extract(slot.payload_json,'$.poolIndex'),
    COALESCE(pause.paused,0), slot.retired_at, slot.created_at, slot.updated_at
    FROM worker_slots_prior slot LEFT JOIN worker_pause_capture pause ON pause.worker_id=slot.id`,
] as const;
const SLIM_WORKER_SLOT_TRIGGERS = [
  `CREATE TRIGGER worker_slots_retained BEFORE DELETE ON worker_slots
BEGIN SELECT RAISE(ABORT,'worker-slot-retirement-retained'); END`,
  `CREATE TRIGGER worker_slots_identity BEFORE UPDATE ON worker_slots
WHEN NEW.id IS NOT OLD.id OR NEW.workflow IS NOT OLD.workflow OR NEW.ordinal IS NOT OLD.ordinal OR NEW.pool_index IS NOT OLD.pool_index
 OR NEW.created_at IS NOT OLD.created_at OR (OLD.retired_at IS NOT NULL AND NEW.retired_at IS NOT OLD.retired_at)
BEGIN SELECT RAISE(ABORT,'worker-slot-identity-immutable'); END`,
  `CREATE TRIGGER worker_slots_no_replace BEFORE INSERT ON worker_slots
WHEN EXISTS(SELECT 1 FROM worker_slots WHERE id=NEW.id OR ordinal=NEW.ordinal)
BEGIN SELECT RAISE(ABORT,'worker-slot-identity-conflict'); END`,
] as const;
/** Tables whose foreign keys name worker_slots; a rename rewrites those keys, so each is rebuilt from its own stored DDL. */
const WORKER_SLOT_CHILDREN = ["auth_leases", "exclusive_session_leases"] as const;

const REMOVED_KEYS = new Set(["workerLifetime", "membershipRevision", "leaseGeneration", "controlBasis"]);
const DELETE_BLOCKING_TRIGGERS = ["command_audits_retained", "commands_bulk_retained", "run_batches_retained", "ocr_review_revisions_retained", "ocr_approved_snapshots_retained"];
/** Native run deletion retains these by design; they may still name a deleted run. */
const DELETION_RETAINED_TABLES = new Set(["write_intents", "write_attempts", "deleted_runs", "artifacts", "database_upgrades"]);
const EVIDENCE_TABLES = ["run_results", "run_receipts", "run_failures", "run_checkpoints", "gate_results"] as const;
// Read at call time: migrations.ts imports this module for its statements.
const storedShapeVersion = (): number => BUILD_ID_ENVELOPE_SCHEMA_VERSION - 1;

type CaptureFile = Parameters<typeof prepareNativeRunDeletion>[3];
type SettleEvidence = Parameters<typeof requireSettledPreBuildRun>[3];
type Row = Record<string, unknown>;

const RowSchema = z.record(z.string(), z.unknown());

function json(value: unknown): unknown { return typeof value === "string" ? JSON.parse(value) as unknown : null; }
function jsonColumns(row: Row): unknown[] {
  return Object.entries(row).flatMap(([column, value]) => column.endsWith("_json") && typeof value === "string" ? [JSON.parse(value) as unknown] : []);
}
function strings(value: unknown, into = new Set<string>()): Set<string> {
  if (typeof value === "string") into.add(value);
  else if (Array.isArray(value)) for (const item of value) strings(item, into);
  else if (value !== null && typeof value === "object") for (const item of Object.values(value)) strings(item, into);
  return into;
}
function hasKey(value: unknown, keys: ReadonlySet<string>): boolean {
  if (Array.isArray(value)) return value.some(item => hasKey(item, keys));
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(([key, item]) => keys.has(key) || hasKey(item, keys));
}
function rows(database: DatabaseSync, sql: string, ...parameters: string[]): Row[] {
  return database.prepare(sql).all(...parameters).map(row => RowSchema.parse(row));
}
function text(row: Row, column: string): string { return z.string().parse(row[column]); }

/** Runs and journals whose evidence binds a removed worker-lifetime request, grown through every run that references them. */
function workerLifetimeClosure(database: DatabaseSync): { runs: Set<string>; seeds: Set<string> } {
  const lifetime = new Set(["workerLifetime"]);
  const seeds = new Set<string>(), seedStrings = new Set<string>();
  for (const row of rows(database, "SELECT * FROM commands WHERE family='run-lifecycle'")) {
    if (!hasKey(json(row.request_json), lifetime) && !hasKey(json(row.outcome_json), lifetime)) continue;
    seeds.add(text(row, "id"));
    strings([row.target_id, json(row.request_json), json(row.outcome_json)], seedStrings);
  }
  for (const row of rows(database, "SELECT * FROM command_audits")) {
    const payload = json(row.payload_json);
    if (!hasKey(payload, lifetime)) continue;
    seeds.add(text(row, "command_id"));
    strings(payload, seedStrings);
  }
  const owned = new Map<string, Set<string>>(), owner = new Map<string, string>();
  const runs = new Set<string>();
  for (const row of rows(database, "SELECT * FROM runs")) {
    const id = text(row, "id"), lifecycle = json(row.lifecycle_json);
    owned.set(id, strings([row.parent_id, json(row.envelope_json), lifecycle]));
    owner.set(id, id);
    if (seedStrings.has(id) || hasKey(z.object({ lifecycle: z.unknown() }).parse(lifecycle).lifecycle, lifetime)) runs.add(id);
  }
  for (const table of EVIDENCE_TABLES) for (const row of rows(database, `SELECT * FROM ${table}`)) {
    const id = text(row, "run_id");
    strings(jsonColumns(row), owned.get(id));
    if (table === "run_results") owner.set(text(row, "result_digest"), id);
  }
  for (const row of rows(database, "SELECT delegation.parent_run_id, delegation.payload_json, dependency.payload_json AS dependency_json FROM run_delegations delegation LEFT JOIN delegation_dependencies dependency ON dependency.delegation_id=delegation.id")) {
    strings(jsonColumns(row), owned.get(text(row, "parent_run_id")));
  }
  const edges = new Map<string, Set<string>>([...owned.keys()].map(id => [id, new Set<string>()]));
  for (const [id, values] of owned) for (const value of values) {
    const other = owner.get(value);
    if (other !== undefined && other !== id) { edges.get(id)?.add(other); edges.get(other)?.add(id); }
  }
  const pending = [...runs];
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    for (const next of edges.get(id) ?? []) if (!runs.has(next)) { runs.add(next); pending.push(next); }
  }
  return { runs, seeds };
}

/**
 * A closure run may go only when each write it touched is committed with authenticated proof: a committed attempt, or the
 * original parked attempt settled by its authenticated recheck. Every durable fence must bind to its own settled attempt by
 * run, attempt, task and fence time. Missing, inconsistent or unsettled evidence refuses.
 */
function refuseUnresolvedWrites(database: DatabaseSync, closure: ReadonlySet<string>): void {
  const refuse = (): never => { throw new Error("authority-upgrade-unresolved-writes"); };
  try { readRestoreWriteFences(database); } catch { refuse(); }
  const settled = new Map<string, SettledWrite>();
  for (const row of rows(database, "SELECT * FROM write_intents")) {
    const runId = z.string().nullable().parse(row.run_id);
    if (runId === null && row.status !== "committed") refuse();
    if (runId === null || !closure.has(runId)) continue;
    try { settled.set(text(row, "id"), settledIntent(database, row)); } catch { refuse(); }
  }
  for (const row of rows(database, "SELECT attempt.run_id FROM write_attempts attempt LEFT JOIN write_intents intent ON intent.id=attempt.intent_id WHERE intent.id IS NULL OR intent.run_id IS NOT attempt.run_id")) {
    if (closure.has(text(row, "run_id"))) refuse();
  }
  for (const id of closure) {
    if (z.object({ state: z.string() }).parse(database.prepare("SELECT state FROM runs WHERE id=?").get(id)).state === "parked-write") refuse();
    for (const event of rows(database, "SELECT operation_id, payload_json FROM timeline_events WHERE run_id=?", id)) {
      if (event.operation_id !== null && !settled.has(text(event, "operation_id"))) refuse();
      const fence = TransactionFenceSchema.safeParse(json(event.payload_json));
      if (!fence.success) continue;
      const { runId, attempt, taskId, ts } = fence.data.event;
      const owner = [...settled.values()].find(write => write.intent.runId === runId && write.intent.runAttempt === attempt
        && write.intent.taskId === taskId && write.unmatchedFences.has(ts));
      if (owner === undefined) refuse();
      else owner.unmatchedFences.delete(ts);
    }
  }
}

/** The durable pre-click fence; `transaction.previewed` is a dry run and never a possible submit. */
const TransactionFenceSchema = z.object({ kind: z.literal("span"),
  event: z.object({ t: z.literal("transaction.fenced"), runId: z.string(), attempt: z.number(), taskId: z.string(), ts: z.string() }) });

/** A committed intent and the fence times of its attempts that no span has claimed yet; each span binds to one attempt. */
type SettledWrite = Readonly<{ intent: Extract<WriteIntentRecord, { status: "committed" }>; unmatchedFences: Set<string> }>;

function settledIntent(database: DatabaseSync, row: Row): SettledWrite {
  const intent = WriteIntentRecordSchema.parse(json(row.payload_json));
  if (intent.status !== "committed") throw new Error("write-intent-unsettled");
  const unmatchedFences = new Set<string>();
  for (const raw of rows(database, "SELECT payload_json FROM write_attempts WHERE intent_id=?", intent.writeIntentId)) {
    const attempt = WriteAttemptRecordSchema.parse(json(raw.payload_json));
    if (attempt.runId !== intent.runId) throw new Error("write-attempt-run-mismatch");
    unmatchedFences.add(attempt.fencedAt);
    if (attempt.outcome.state === "committed") continue;
    const resolution = intent.resolution;
    if (attempt.outcome.state !== "parked" || resolution?.writeAttemptId !== attempt.writeAttemptId) throw new Error("write-attempt-unsettled");
    authenticateParkedWriteResolution(intent, attempt, predecessorCommandFromRow(database.prepare("SELECT * FROM commands WHERE id=?").get(resolution.commandId)),
      nativeOrdinaryRecordFromRow("command_audits", database.prepare("SELECT * FROM command_audits WHERE id=?").get(resolution.auditId)));
  }
  confirmationPublicationFromRow(intent, row.publication_json);
  return { intent, unmatchedFences };
}

/** Resolution journals that authenticate kept write intents; they stay with the write evidence. */
function writeResolutionCommands(database: DatabaseSync): Set<string> {
  return new Set(rows(database, "SELECT json_extract(payload_json,'$.resolution.commandId') AS command_id FROM write_intents WHERE json_type(payload_json,'$.resolution')='object'")
    .map(row => text(row, "command_id")));
}

function mentions(values: Iterable<unknown>, ids: ReadonlySet<string>): boolean {
  for (const value of strings([...values])) if (ids.has(value)) return true;
  return false;
}

/** Worker history and every journal naming a closure run; kept rows that still need them refuse the upgrade. */
function doomedJournals(database: DatabaseSync, closure: ReadonlySet<string>, seeds: ReadonlySet<string>, kept: ReadonlySet<string>): Set<string> {
  const history = new Set(seeds), named = new Set<string>();
  for (const row of rows(database, "SELECT * FROM commands")) {
    const request = json(row.request_json);
    if (isPredecessorWorkerHistory(row)) history.add(text(row, "id"));
    else if (mentions([row.target_id, request, json(row.outcome_json)], closure)) named.add(text(row, "id"));
  }
  for (const row of rows(database, "SELECT * FROM command_audits")) {
    const payload = json(row.payload_json);
    const lifecycle = z.object({ kind: z.literal("run-lifecycle"), result: z.object({ kind: z.string() }) }).safeParse(payload);
    if (lifecycle.success && (lifecycle.data.result.kind === "worker" || lifecycle.data.result.kind === "worker-recovery")) history.add(text(row, "command_id"));
    else if (mentions([payload], closure)) named.add(text(row, "command_id"));
  }
  for (const id of kept) if (history.has(id)) throw new Error("authority-upgrade-retained-run-reference");
  const doomed = new Set([...history, ...[...named].filter(id => !kept.has(id))]);
  for (const row of rows(database, "SELECT * FROM commands WHERE parent_id IS NOT NULL")) {
    if (doomed.has(z.string().parse(row.parent_id)) !== doomed.has(text(row, "id"))) throw new Error("authority-upgrade-retained-run-reference");
  }
  return doomed;
}

function deleteJournals(database: DatabaseSync, closure: ReadonlySet<string>, seeds: ReadonlySet<string>, kept: ReadonlySet<string>): void {
  const doomed = doomedJournals(database, closure, seeds, kept);
  const assistantActions = rows(database, "SELECT id, command_id, payload_json FROM assistant_actions")
    .filter(row => doomed.has(text(row, "command_id")) || hasWorkerCommand(json(row.payload_json))).map(row => text(row, "id"));
  for (const id of assistantActions) database.prepare("DELETE FROM assistant_actions WHERE id=?").run(id);
  for (const table of ["ocr_review_revisions", "ocr_approved_snapshots", "notifications"] as const) {
    for (const row of rows(database, `SELECT * FROM ${table}`)) {
      if (!closure.has(z.string().nullable().parse(row.run_id) ?? "") && !(table === "ocr_review_revisions" && doomed.has(text(row, "command_id")))) continue;
      database.prepare(`DELETE FROM ${table} WHERE id=?`).run(text(row, "id"));
      if (table === "notifications") database.prepare("DELETE FROM notification_states WHERE id=?").run(text(row, "id"));
    }
  }
  for (const row of rows(database, "SELECT id, consumed_by, payload_json FROM run_requests")) {
    if (doomed.has(z.string().nullable().parse(row.consumed_by) ?? "") || mentions([json(row.payload_json)], closure)) database.prepare("DELETE FROM run_requests WHERE id=?").run(text(row, "id"));
  }
  for (const [table, column] of [["settings", "command_id"], ["settings", "audit_id"], ["assistant_grants", "command_id"], ["assistant_model_preference", "command_id"], ["deleted_runs", "command_id"]] as const) {
    for (const row of rows(database, `SELECT ${column} AS reference FROM ${table}`)) if (doomed.has(String(row.reference))) throw new Error("authority-upgrade-retained-run-reference");
  }
  for (const id of doomed) database.prepare("DELETE FROM command_audits WHERE command_id=?").run(id);
  for (const id of doomed) database.prepare("DELETE FROM commands WHERE parent_id=?").run(id);
  for (const id of doomed) database.prepare("DELETE FROM commands WHERE id=?").run(id);
}

function hasWorkerCommand(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasWorkerCommand);
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(([key, item]) => key === "family" && item === "worker-browser" || hasWorkerCommand(item));
}

function readRun(database: DatabaseSync, id: string): PredecessorRunRecord {
  return predecessorCustodyRunFromRow(database.prepare("SELECT * FROM runs WHERE id=?").get(id));
}

/** Deletes each closure tree through native run deletion; a tree whose checkpoints another tree still references waits for it. */
function deleteTrees(database: DatabaseSync, closure: ReadonlySet<string>, now: string, captureFile: CaptureFile): Set<string> {
  const commands = new Set<string>();
  const trees = new Map<string, PredecessorRunRecord[]>();
  for (const id of closure) {
    let run = readRun(database, id);
    const member = run;
    while (run.envelope.parent !== undefined) run = readRun(database, run.envelope.parent.runId);
    trees.set(run.envelope.runId, [...(trees.get(run.envelope.runId) ?? []), member]);
  }
  let waiting = [...trees.entries()];
  while (waiting.length > 0) {
    const blocked = waiting.filter(([rootId, members]) => {
      const commandId = deleteTree(database, readRun(database, rootId), members, now, captureFile);
      if (commandId !== undefined) commands.add(commandId);
      return commandId === undefined;
    });
    if (blocked.length === waiting.length) throw new RunDeletionRefusedError("shared-checkpoint");
    waiting = blocked;
  }
  return commands;
}

/** Returns the deletion command id, or undefined when another tree must go first. */
function deleteTree(database: DatabaseSync, root: PredecessorRunRecord, members: readonly PredecessorRunRecord[], now: string, captureFile: CaptureFile): string | undefined {
  const request = CanonicalDeleteRequestSchema.parse({ commandId: randomUUID(), runId: root.envelope.runId, expectedVersion: root.version });
  const command = lifecycleCommand("delete", request, { kind: "version", expectedVersion: root.version }, now);
  insertNativeCommand(database, command);
  const cascadeRunIds = childrenFirst(members).map(run => run.envelope.runId);
  const deletion = (runId: string) => RunDeleteInputSchema.parse({ runId, origin: "queue", commandId: command.commandId, now, cascadeRunIds });
  try {
    for (const runId of cascadeRunIds) prepareNativeRunDeletion(database, readRun(database, runId), deletion(runId), captureFile, "preflight", storedShapeVersion());
  } catch (error) {
    if (!(error instanceof RunDeletionRefusedError) || error.reason !== "shared-checkpoint") throw error;
    database.prepare("DELETE FROM commands WHERE id=?").run(command.commandId);
    return undefined;
  }
  for (const runId of cascadeRunIds) {
    executeNativeRunDeletion(database, prepareNativeRunDeletion(database, readRun(database, runId), deletion(runId), captureFile, "execution", storedShapeVersion()));
  }
  recordAudit(database, command, { kind: "deletion", runIds: cascadeRunIds }, now);
  return command.commandId;
}

/** `journals` are the conversion's own deletion commands and the kept write-resolution commands; both name closure runs by design. */
function assertNoRetainedReference(database: DatabaseSync, closure: ReadonlySet<string>, journals: ReadonlySet<string>): void {
  for (const table of rows(database, "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").map(row => text(row, "name"))) {
    if (DELETION_RETAINED_TABLES.has(table)) continue;
    for (const row of database.prepare(`SELECT * FROM ${table}`).iterate()) {
      if (table === "commands" && journals.has(text(RowSchema.parse(row), "id"))) continue;
      if (table === "command_audits" && journals.has(text(RowSchema.parse(row), "command_id"))) continue;
      if (mentions([...Object.values(RowSchema.parse(row)).filter(value => typeof value === "string"), ...jsonColumns(RowSchema.parse(row))], closure)) {
        throw new Error("authority-upgrade-retained-run-reference");
      }
    }
  }
}

function schemaSql(database: DatabaseSync, type: "table" | "trigger", table: string): string[] {
  return rows(database, "SELECT sql FROM sqlite_schema WHERE type=? AND tbl_name=? ORDER BY name", type, table).map(row => text(row, "sql"));
}

/** Runs at the slot rebuild marker, after the pause capture and the drops of every other table that references slots. */
export function rebuildWorkerSlots(database: DatabaseSync): void {
  const children = WORKER_SLOT_CHILDREN.map(table => ({ table, ddl: schemaSql(database, "table", table), triggers: schemaSql(database, "trigger", table) }));
  for (const { table } of children) database.exec(`ALTER TABLE ${table} RENAME TO ${table}_prior`);
  database.exec("ALTER TABLE worker_slots RENAME TO worker_slots_prior");
  for (const sql of SLIM_WORKER_SLOTS) database.exec(sql);
  for (const { table, ddl } of children) {
    for (const sql of ddl) database.exec(sql);
    database.exec(`INSERT INTO ${table} SELECT * FROM ${table}_prior`);
    database.exec(`DROP TABLE ${table}_prior`);
  }
  database.exec("DROP TABLE worker_slots_prior");
  for (const sql of [...SLIM_WORKER_SLOT_TRIGGERS, ...children.flatMap(child => child.triggers)]) database.exec(sql);
}

/** Runs at the conversion marker inside the stopped upgrade transaction; any refusal rolls the whole upgrade back. */
export function convertWorkerCustody(database: DatabaseSync, now: string, captureFile: CaptureFile, settleEvidence: SettleEvidence): void {
  const { runs: closure, seeds } = workerLifetimeClosure(database);
  refuseUnresolvedWrites(database, closure);
  const triggers = DELETE_BLOCKING_TRIGGERS.map(name => z.object({ sql: z.string() })
    .parse(database.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name=?").get(name)).sql);
  for (const name of DELETE_BLOCKING_TRIGGERS) database.exec(`DROP TRIGGER ${name}`);
  const members = childrenFirst([...closure].map(id => readRun(database, id)));
  for (const run of members) requireSettledPreBuildRun(database, run.envelope.runId, now, settleEvidence);
  const batches = new Set([...closure].flatMap(id => rows(database, "SELECT batch_id FROM runs WHERE id=? AND batch_id IS NOT NULL", id).map(row => text(row, "batch_id"))));
  const resolutions = writeResolutionCommands(database);
  deleteJournals(database, closure, seeds, resolutions);
  const deletions = deleteTrees(database, closure, now, captureFile);
  for (const id of batches) database.prepare("DELETE FROM run_batches WHERE id=? AND NOT EXISTS(SELECT 1 FROM runs WHERE batch_id=?)").run(id, id);
  assertNoRetainedReference(database, closure, new Set([...deletions, ...resolutions]));
  for (const sql of triggers) database.exec(sql);
}

/** Runs after the custody statements: nothing may still dangle or carry the removed worker grammar. */
export function assertWorkerCustodyConverted(database: DatabaseSync): void {
  if (database.prepare("PRAGMA foreign_key_check").all().length !== 0) throw new Error("authority-upgrade-foreign-key-check-failed");
  for (const table of rows(database, "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").map(row => text(row, "name"))) {
    for (const row of database.prepare(`SELECT * FROM ${table}`).iterate()) {
      if (hasKey(jsonColumns(RowSchema.parse(row)), REMOVED_KEYS)) throw new Error(`authority-upgrade-worker-grammar-retained:${table}`);
    }
  }
}

/** Runs one migration statement. The custody slot rebuild is DDL, so it runs on every path: fresh, expected layout and upgrade. */
export function execMigrationStatement(database: DatabaseSync, statement: string): void {
  if (statement === `SELECT '${WORKER_CUSTODY_SLOT_REBUILD_ID}'`) rebuildWorkerSlots(database);
  database.exec(statement);
}
