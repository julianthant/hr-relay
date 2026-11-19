import { createHash } from "node:crypto";
import { createRestoreFenceIndex } from "./readonly-authority-snapshot.js";
import { exclusiveSessionLeaseFromRow } from "./exclusive-session-leases.js";
import { z } from "zod";
import { WriteAttemptRecordSchema, WriteIntentRecordSchema } from "../../../rules/write-safety/write-safety.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";

const Tables = ["deleted_runs", "settings_snapshots", "run_batches", "run_requests", "run_delegations", "delegation_dependencies", "diagnostic_snapshots", "diagnostic_files", "write_intents", "write_attempts", "runs", "run_checkpoints", "gate_results", "run_results", "run_failures", "run_receipts", "artifacts", "timeline_events", "commands", "command_audits"] as const;
type FenceTable = typeof Tables[number] | "exclusive_session_leases";
export type RestoreWriteFences = Readonly<{ unresolved: readonly string[]; tables: readonly Readonly<{ name: FenceTable; rows: readonly string[] }>[] }>;

type FenceReader = Readonly<{ prepare(sql: string): Readonly<{ all(): readonly unknown[] }> }>;
type FenceRow = Readonly<Record<string, unknown>>;
type FenceStatement = Readonly<{
  all(...values: (string | number)[]): readonly FenceRow[];
  get(...values: (string | number)[]): FenceRow | undefined;
  iterate(...values: (string | number)[]): Iterable<FenceRow>;
  columns(): readonly Readonly<{ name: string }>[];
}>;
type FenceSource = Readonly<{ prepare(sql: string): FenceStatement }>;
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

export function readUnresolvedRestoreWrites(database: FenceSource): readonly string[] {
  const { unresolved, tables } = readFenceSummary(sql => database.prepare(sql).iterate());
  validateReadableFenceRows(database, tables);
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
const RowKey = z.union([z.string(), z.number()]);
const quoteColumn = (column: string) => `"${column.replaceAll('"', '""')}"`;

type WitnessTable = {
  readonly name: FenceTable;
  readonly key: string;
  readonly columns: readonly string[];
  readonly rowCount: number;
};

type ReadAuthority = <Result>(read: (database: FenceSource) => Result) => Result;

export type RestoreWriteFenceProof = Readonly<{
  digest: string;
  assertPreservedBy(database: FenceSource): void;
  assertCurrent(database: FenceSource): void;
  [Symbol.dispose](): void;
}>;

function validateReadableFenceRows(database: FenceSource, tables: readonly FenceTable[]): void {
  for (const table of tables) {
    for (const row of database.prepare(`SELECT * FROM ${table}${fenceTableSelection(table)}`).iterate()) {
      for (const field of Object.values(row)) {
        if (field !== null && typeof field !== "string" && (typeof field !== "number" || !Number.isFinite(field))) {
          throw new Error("canonical-json-invalid");
        }
      }
    }
  }
}

type FenceIndex = ReturnType<typeof createRestoreFenceIndex>;

function indexFenceRows(source: FenceSource, index: FenceIndex, tables: readonly FenceTable[]): readonly WitnessTable[] {
  const keyOf = source.prepare("SELECT name FROM pragma_table_info(?) WHERE pk > 0");
  const indexed = tables.map((name, tableId) => {
    const key = PrimaryKey.parse(keyOf.all(name))[0].name;
    const rows = source.prepare(`SELECT * FROM ${name}${fenceTableSelection(name)}`);
    const columns = rows.columns().map(column => column.name);
    let rowCount = 0;
    for (const row of rows.iterate()) {
      index.append(tableId, RowKey.parse(row[key]), canonicalJsonStringify(row));
      rowCount++;
    }
    return { name, key, columns, rowCount };
  });
  index.seal();
  return indexed;
}

function digestFenceProof(tables: readonly WitnessTable[], unresolved: readonly string[], rows: FenceIndex["orderedRows"]): string {
  const hash = createHash("sha256").update('{"tables":[');
  for (const [index, table] of tables.entries()) {
    if (index !== 0) hash.update(",");
    hash.update(`{"name":${JSON.stringify(table.name)},"rows":[`);
    let first = true;
    for (const row of rows(index)) {
      if (!first) hash.update(",");
      first = false;
      hash.update(JSON.stringify(row.canonical));
    }
    hash.update("]}");
  }
  return hash.update(`],"unresolved":${canonicalJsonStringify(unresolved)}}`).digest("hex");
}

function compareFenceRows(
  database: FenceSource, witnesses: readonly WitnessTable[], current: FenceSummary,
  rows: FenceIndex["orderedRows"], changed?: string,
): void {
  for (const [index, { name, key, columns, rowCount }] of witnesses.entries()) {
    const refusal = changed ?? `restore-would-weaken-write-evidence:${name}`;
    if (changed !== undefined) {
      const count = database.prepare(`SELECT count(*) AS n FROM ${name}${fenceTableSelection(name)}`).get()?.n;
      if (count !== rowCount) throw new Error(refusal);
    }
    if (rowCount === 0) continue;
    if (!current.tables.includes(name)) throw new Error(refusal);
    const candidateColumns = database.prepare(`SELECT * FROM ${name} LIMIT 0`).columns().map(column => column.name);
    if (candidateColumns.length !== columns.length || columns.some(column => !candidateColumns.includes(column))) {
      throw new Error(refusal);
    }
    const lookup = database.prepare(`SELECT * FROM ${name} WHERE ${quoteColumn(key)}=?`);
    for (const row of rows(index)) {
      const candidate = lookup.get(row.key);
      if (candidate === undefined || canonicalJsonStringify(candidate) !== row.canonical) throw new Error(refusal);
    }
  }
}

export function captureRestoreWriteFenceProof(readAuthority: ReadAuthority): RestoreWriteFenceProof {
  let owned: FenceIndex | undefined;
  try {
    return readAuthority(source => {
      const summary = readFenceSummary(sql => source.prepare(sql).iterate());
      const index = createRestoreFenceIndex();
      owned = index;
      const witnesses = indexFenceRows(source, index, summary.tables);
      const rows = index.orderedRows;
      let digest: string | undefined;
      return Object.freeze({
        get digest() { return digest ??= digestFenceProof(witnesses, summary.unresolved, rows); },
        assertPreservedBy(database: FenceSource) {
          const restored = readFenceSummary(sql => database.prepare(sql).iterate());
          validateReadableFenceRows(database, restored.tables);
          const unresolved = new Set(restored.unresolved);
          if (summary.unresolved.some(id => !unresolved.has(id))) throw new Error("restore-would-lose-unresolved-write");
          compareFenceRows(database, witnesses, restored, rows);
        },
        assertCurrent(database: FenceSource) {
          const errorCode = "restore-write-fences-changed";
          const current = readFenceSummary(sql => database.prepare(sql).iterate());
          if (current.tables.length !== summary.tables.length || summary.tables.some((table, position) => current.tables[position] !== table)
            || current.unresolved.length !== summary.unresolved.length || summary.unresolved.some((id, position) => current.unresolved[position] !== id)) {
            throw new Error(errorCode);
          }
          compareFenceRows(database, witnesses, current, rows, errorCode);
        },
        [Symbol.dispose]: index.dispose,
      });
    });
  } catch (error) {
    try { owned?.dispose(); }
    catch (cleanup) { throw new AggregateError([error, cleanup], "restore-fence-proof-capture-failed"); }
    throw error;
  }
}
