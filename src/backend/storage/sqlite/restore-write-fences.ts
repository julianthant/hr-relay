import { z } from "zod";
import { WriteAttemptRecordSchema, WriteIntentRecordSchema } from "../../../rules/write-safety/write-safety.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";

const Tables = ["deleted_runs", "settings_snapshots", "run_batches", "run_requests", "run_delegations", "delegation_dependencies", "diagnostic_snapshots", "diagnostic_files", "write_intents", "write_attempts", "runs", "run_checkpoints", "gate_results", "run_results", "run_failures", "run_receipts", "artifacts", "timeline_events", "commands", "command_audits"] as const;
export type RestoreWriteFences = Readonly<{ unresolved: readonly string[]; tables: readonly Readonly<{ name: typeof Tables[number]; rows: readonly string[] }>[] }>;

type FenceReader = Readonly<{ prepare(sql: string): Readonly<{ all(): readonly unknown[] }> }>;

export function readRestoreWriteFences(database: FenceReader): RestoreWriteFences {
  const intents = database.prepare("SELECT id, status, generation, run_id, payload_json FROM write_intents ORDER BY id").all().map(raw => {
    const row = z.strictObject({ id: z.string(), status: z.string(), generation: z.number().int(), run_id: z.string().nullable(), payload_json: z.string() }).parse(raw);
    const intent = WriteIntentRecordSchema.parse(JSON.parse(row.payload_json));
    if (row.id !== intent.writeIntentId || row.status !== intent.status || row.generation !== intent.generation || row.run_id !== ("runId" in intent ? intent.runId : null)) throw new Error("restore-write-fence-record-invalid");
    return intent;
  });
  const attempts = database.prepare("SELECT id, intent_id, generation, run_id, payload_json FROM write_attempts ORDER BY id").all().map(raw => {
    const row = z.strictObject({ id: z.string(), intent_id: z.string(), generation: z.number().int(), run_id: z.string(), payload_json: z.string() }).parse(raw);
    const attempt = WriteAttemptRecordSchema.parse(JSON.parse(row.payload_json));
    if (row.id !== attempt.writeAttemptId || row.intent_id !== attempt.writeIntentId || row.generation !== attempt.generation || row.run_id !== attempt.runId) throw new Error("restore-write-attempt-record-invalid");
    return attempt;
  });
  const unresolved = new Set(intents.filter(row => row.status !== "committed" && row.status !== "observed-present").map(row => String(row.writeIntentId)));
  for (const attempt of attempts) if (!intents.some(intent => intent.writeIntentId === attempt.writeIntentId)) unresolved.add(attempt.writeIntentId);
  const parked = database.prepare("SELECT state, lifecycle_json FROM runs ORDER BY id").all().flatMap(raw => {
    const row = z.strictObject({ state: z.string(), lifecycle_json: z.string() }).parse(raw);
    const { lifecycle } = z.object({ lifecycle: z.object({ state: z.string(), writeIntentId: z.uuid().optional() }) }).parse(JSON.parse(row.lifecycle_json));
    if (row.state !== lifecycle.state) throw new Error("restore-run-fence-record-invalid");
    return row.state === "parked-write" ? [z.uuid().parse(lifecycle.writeIntentId)] : [];
  });
  for (const id of parked) unresolved.add(id);
  const hasFence = (value: unknown): boolean => {
    if (value === null || typeof value !== "object") return false;
    if (Array.isArray(value)) return value.some(hasFence);
    const object = z.record(z.string(), z.unknown()).parse(value);
    return typeof object.t === "string" && object.t.startsWith("transaction.") || Object.values(object).some(hasFence);
  };
  const spanFence = database.prepare("SELECT operation_id, payload_json FROM timeline_events ORDER BY cursor").all().some(raw => {
    const row = z.strictObject({ operation_id: z.string().nullable(), payload_json: z.string() }).parse(raw);
    return row.operation_id !== null || hasFence(JSON.parse(row.payload_json));
  });
  const tombstones = database.prepare("SELECT * FROM deleted_runs").all();
  const outputs = database.prepare("SELECT * FROM artifacts WHERE kind='generated'").all();
  const preserve = tombstones.length !== 0 || outputs.length !== 0 || intents.length !== 0 || attempts.length !== 0 || parked.length !== 0 || spanFence;
  return { unresolved: [...unresolved].sort(), tables: !preserve ? [] : Tables.map(name => ({ name,
    rows: database.prepare(`SELECT * FROM ${name}`).all().map(row => canonicalJsonStringify(row)).sort() })) };
}

export function restoreWriteFenceDigest(fences: RestoreWriteFences): string { return sha256Hex(canonicalJsonStringify(fences)); }

export function assertRestorePreservesWriteFences(source: RestoreWriteFences, restored: RestoreWriteFences): void {
  if (source.unresolved.some(id => !restored.unresolved.includes(id))) throw new Error("restore-would-lose-unresolved-write");
  for (const table of source.tables) {
    const rows = new Set(restored.tables.find(row => row.name === table.name)?.rows ?? []);
    if (table.rows.some(row => !rows.has(row))) throw new Error(`restore-would-weaken-write-evidence:${table.name}`);
  }
}
