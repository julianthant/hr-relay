import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { exclusiveSessionLeaseFromRow } from "./exclusive-session-leases.js";
import { z } from "zod";
import { WriteAttemptRecordSchema, WriteIntentRecordSchema } from "../../../rules/write-safety/write-safety.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";

const Tables = ["deleted_runs", "settings_snapshots", "run_batches", "run_requests", "run_delegations", "delegation_dependencies", "diagnostic_snapshots", "diagnostic_files", "write_intents", "write_attempts", "runs", "run_checkpoints", "gate_results", "run_results", "run_failures", "run_receipts", "artifacts", "timeline_events", "commands", "command_audits"] as const;
type FenceTable = typeof Tables[number] | "exclusive_session_leases";
export type RestoreWriteFences = Readonly<{ unresolved: readonly string[]; tables: readonly Readonly<{ name: FenceTable; rows: readonly string[] }>[] }>;

type FenceReader = Readonly<{ prepare(sql: string): Readonly<{ all(): readonly unknown[] }> }>;
type ReadRows = (sql: string) => Iterable<unknown>;
type FenceSummary = Readonly<{ unresolved: readonly string[]; tables: readonly FenceTable[] }>;

const IntentRow = z.strictObject({ id: z.string(), status: z.string(), generation: z.number().int(), run_id: z.string().nullable(), payload_json: z.string() });
const AttemptRow = z.strictObject({ id: z.string(), intent_id: z.string(), generation: z.number().int(), run_id: z.string(), payload_json: z.string() });
const LifecycleRow = z.strictObject({ state: z.string(), lifecycle_json: z.string() });
const StoredLifecycle = z.object({ lifecycle: z.object({ state: z.string(), writeIntentId: z.uuid().optional() }) });
const SpanRow = z.strictObject({ operation_id: z.string().nullable(), payload_json: z.string() });
const SpanObject = z.record(z.string(), z.unknown());

function readWriteState(rows: ReadRows) {
  const unresolved = new Set<string>(), intentIds = new Set<string>();
  let hasWriteEvidence = false;
  for (const raw of rows("SELECT id, status, generation, run_id, payload_json FROM write_intents ORDER BY id")) {
    const row = IntentRow.parse(raw), intent = WriteIntentRecordSchema.parse(JSON.parse(row.payload_json));
    if (row.id !== intent.writeIntentId || row.status !== intent.status || row.generation !== intent.generation || row.run_id !== ("runId" in intent ? intent.runId : null)) throw new Error("restore-write-fence-record-invalid");
    hasWriteEvidence = true;
    intentIds.add(intent.writeIntentId);
    if (intent.status !== "committed" && intent.status !== "observed-present") unresolved.add(intent.writeIntentId);
  }
  for (const raw of rows("SELECT id, intent_id, generation, run_id, payload_json FROM write_attempts ORDER BY id")) {
    const row = AttemptRow.parse(raw), attempt = WriteAttemptRecordSchema.parse(JSON.parse(row.payload_json));
    if (row.id !== attempt.writeAttemptId || row.intent_id !== attempt.writeIntentId || row.generation !== attempt.generation || row.run_id !== attempt.runId) throw new Error("restore-write-attempt-record-invalid");
    hasWriteEvidence = true;
    if (!intentIds.has(attempt.writeIntentId)) unresolved.add(attempt.writeIntentId);
  }
  for (const raw of rows("SELECT state, lifecycle_json FROM runs ORDER BY id")) {
    const row = LifecycleRow.parse(raw), { lifecycle } = StoredLifecycle.parse(JSON.parse(row.lifecycle_json));
    if (row.state !== lifecycle.state) throw new Error("restore-run-fence-record-invalid");
    if (row.state === "parked-write") {
      hasWriteEvidence = true;
      unresolved.add(z.uuid().parse(lifecycle.writeIntentId));
    }
  }
  return { unresolved: [...unresolved].sort(), hasWriteEvidence };
}

export function readUnresolvedRestoreWrites(database: DatabaseSync): readonly string[] {
  const { unresolved, tables } = readFenceSummary(sql => database.prepare(sql).iterate());
  for (const table of tables) database.prepare(`SELECT * FROM ${table} LIMIT 0`);
  return unresolved;
}

function hasTransaction(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasTransaction);
  const object = SpanObject.parse(value);
  return typeof object.t === "string" && object.t.startsWith("transaction.") || Object.values(object).some(hasTransaction);
}

function hasSpanFence(rows: ReadRows): boolean {
  for (const raw of rows("SELECT operation_id, payload_json FROM timeline_events ORDER BY cursor")) {
    const row = SpanRow.parse(raw);
    if (row.operation_id !== null || hasTransaction(JSON.parse(row.payload_json))) return true;
  }
  return false;
}

function readFenceSummary(rows: ReadRows): FenceSummary {
  const { unresolved, hasWriteEvidence } = readWriteState(rows);
  const spanFence = hasSpanFence(rows);
  const hasTombstones = Array.from(rows("SELECT 1 FROM deleted_runs LIMIT 1")).length !== 0;
  const hasOutputs = Array.from(rows("SELECT 1 FROM artifacts WHERE kind='generated' LIMIT 1")).length !== 0;
  const hasSessionLeases = Array.from(rows("SELECT name FROM sqlite_schema WHERE type='table' AND name='exclusive_session_leases'")).length === 1;
  let hasHeldLease = false;
  if (hasSessionLeases) for (const raw of rows("SELECT * FROM exclusive_session_leases")) {
    if (exclusiveSessionLeaseFromRow(raw).releasedAt === null) hasHeldLease = true;
  }
  const preserve = hasWriteEvidence || spanFence || hasTombstones || hasOutputs || hasHeldLease;
  return { unresolved, tables: preserve ? [...Tables, ...(hasHeldLease ? ["exclusive_session_leases" as const] : [])] : [] };
}

function fenceTableSelection(table: FenceTable): string {
  return table === "exclusive_session_leases" ? " WHERE released_at IS NULL" : "";
}

export function readRestoreWriteFences(database: FenceReader): RestoreWriteFences {
  const rows = (sql: string) => database.prepare(sql).all();
  const { unresolved, tables } = readFenceSummary(rows);
  return { unresolved, tables: tables.map(name => ({ name, rows: rows(`SELECT * FROM ${name}`).filter(row =>
    name !== "exclusive_session_leases" || exclusiveSessionLeaseFromRow(row).releasedAt === null).map(row => canonicalJsonStringify(row)).sort() })) };
}

export function restoreWriteFenceDigest(fences: RestoreWriteFences): string { return sha256Hex(canonicalJsonStringify(fences)); }

export function assertRestorePreservesWriteFences(source: RestoreWriteFences, restored: RestoreWriteFences): void {
  if (source.unresolved.some(id => !restored.unresolved.includes(id))) throw new Error("restore-would-lose-unresolved-write");
  for (const table of source.tables) {
    const rows = new Set(restored.tables.find(row => row.name === table.name)?.rows ?? []);
    if (table.rows.some(row => !rows.has(row))) throw new Error(`restore-would-weaken-write-evidence:${table.name}`);
  }
}

const PrimaryKey = z.tuple([z.strictObject({ name: z.string() })]);
const SortedFenceRow = z.strictObject({ fence_key: z.union([z.string(), z.number()]), canonical_row: z.instanceof(Uint8Array) });
const quoteColumn = (column: string) => `"${column.replaceAll('"', '""')}"`;
type InspectTable = (name: FenceTable, key: string, columns: readonly string[]) => ((key: string | number, canonicalRow: string) => void) | undefined;

function streamFenceDigest(database: DatabaseSync, { unresolved, tables }: FenceSummary, inspectTable?: InspectTable): string {
  const hash = createHash("sha256").update('{"tables":[');
  const keyOf = database.prepare("SELECT name FROM pragma_table_info(?) WHERE pk > 0");
  for (const [index, table] of tables.entries()) {
    if (index !== 0) hash.update(",");
    hash.update(`{"name":${JSON.stringify(table)},"rows":[`);
    const key = PrimaryKey.parse(keyOf.all(table))[0].name;
    const columns = database.prepare(`SELECT * FROM ${table} LIMIT 0`).columns().map(column => column.name);
    const inspectRow = inspectTable?.(table, key, columns);
    // Sort in SQLite using JavaScript's UTF-16 order so in-flight journals keep their exact digest.
    database.function("relay_restore_fence_row", { deterministic: true, varargs: true }, (...values) =>
      Buffer.from(canonicalJsonStringify(Object.fromEntries(columns.map((column, index) => [column, values[index]]))), "utf16le").swap16());
    const rows = database.prepare(`SELECT ${quoteColumn(key)} AS fence_key,
      relay_restore_fence_row(${columns.map(quoteColumn).join(",")}) AS canonical_row
      FROM ${table}${fenceTableSelection(table)} ORDER BY canonical_row`).iterate();
    let first = true;
    for (const raw of rows) {
      const row = SortedFenceRow.parse(raw);
      const canonicalRow = Buffer.from(row.canonical_row).swap16().toString("utf16le");
      if (!first) hash.update(",");
      first = false;
      hash.update(JSON.stringify(canonicalRow));
      inspectRow?.(row.fence_key, canonicalRow);
    }
    hash.update("]}");
  }
  return hash.update(`],"unresolved":${canonicalJsonStringify(unresolved)}}`).digest("hex");
}

export function readRestoreWriteFenceDigest(database: DatabaseSync): string {
  return streamFenceDigest(database, readFenceSummary(sql => database.prepare(sql).iterate()));
}

export function assertRestoreDatabasePreservesWriteFences(
  source: DatabaseSync, restored: DatabaseSync, expectedSourceDigest: string, sourceChangedError: string,
): void {
  const sourceSummary = readFenceSummary(sql => source.prepare(sql).iterate());
  const restoredSummary = readFenceSummary(sql => restored.prepare(sql).iterate());
  const unresolved = new Set(restoredSummary.unresolved);
  let refusal = sourceSummary.unresolved.some(id => !unresolved.has(id)) ? "restore-would-lose-unresolved-write" : undefined;
  const sourceDigest = streamFenceDigest(source, sourceSummary, (table, key, columns) => {
    if (refusal !== undefined) return undefined;
    const restoredColumns = restoredSummary.tables.includes(table)
      ? restored.prepare(`SELECT * FROM ${table} LIMIT 0`).columns().map(column => column.name) : [];
    const lookup = restoredColumns.length === columns.length && columns.every(column => restoredColumns.includes(column))
      ? restored.prepare(`SELECT * FROM ${table} WHERE ${quoteColumn(key)}=?`) : undefined;
    return (id, canonicalRow) => {
      if (refusal !== undefined) return;
      const candidate = lookup?.get(id);
      if (candidate === undefined || canonicalJsonStringify(candidate) !== canonicalRow) refusal = `restore-would-weaken-write-evidence:${table}`;
    };
  });
  if (sourceDigest !== expectedSourceDigest) throw new Error(sourceChangedError);
  if (refusal !== undefined) throw new Error(refusal);
}
