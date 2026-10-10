import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { TransactionHistorySelectionSchema, TransactionSelectionRecordSchema } from "../../../rules/write-safety/transaction-selection.js";
import { TimelineEventRecordSchema } from "../../../models/events/timeline.js";
import { LifecycleSourceSnapshotSchema, lifecycleSourceDigest } from "../../../models/archive/lifecycle-source.js";
import { ArchiveTransferIdentitySchema } from "./run-evidence-ownership.js";
import type { ArchiveDatabase } from "./archive-database.js";

export const TRANSACTION_SELECTION_DDL = `CREATE TABLE transaction_selection (
 record_key TEXT PRIMARY KEY, run_id TEXT NOT NULL, confirmed_at TEXT NOT NULL, system TEXT NOT NULL,
 record_json TEXT NOT NULL CHECK(json_valid(record_json)), created_at TEXT NOT NULL,
 CHECK(record_key IS json_extract(record_json,'$.eventId')),
 CHECK(run_id IS json_extract(record_json,'$.runId')),
 CHECK(confirmed_at IS json_extract(record_json,'$.confirmedAt')),
 CHECK(system IS json_extract(record_json,'$.system'))
) STRICT`;
const insertedSelection = `json_object('eventId',json_extract(NEW.record_json,'$.eventId'),
 'runId',NEW.run_id,'confirmedAt',json_extract(NEW.record_json,'$.payload.facts.confirmedAt'),
 'system',json_extract(NEW.record_json,'$.payload.facts.system'),
 'operationId',json_extract(NEW.record_json,'$.payload.facts.writeIntentId'),'generation',json_extract(NEW.record_json,'$.payload.facts.intentGeneration'))`;
export const TRANSACTION_SELECTION_CONSTRAINTS = [
  "CREATE INDEX transaction_source_range_idx ON timeline_operation_sources(json_extract(record_json,'$.ledgerOutbox.payload.entry.confirmedAt'),record_key)",
  "CREATE INDEX transaction_source_run_idx ON timeline_operation_sources(json_extract(record_json,'$.runId'),record_key)",
  "CREATE INDEX transaction_selection_range_idx ON transaction_selection(confirmed_at,record_key)",
  "CREATE INDEX transaction_selection_run_idx ON transaction_selection(run_id,confirmed_at,record_key)",
  `CREATE TRIGGER transaction_selection_append AFTER INSERT ON timeline_events
   WHEN NEW.retention_class='confirmed-operation' BEGIN
   INSERT INTO transaction_selection VALUES(NEW.record_key,NEW.run_id,
    json_extract(NEW.record_json,'$.payload.facts.confirmedAt'),json_extract(NEW.record_json,'$.payload.facts.system'),${insertedSelection},NEW.created_at); END`,
  `CREATE TRIGGER transaction_selection_immutable BEFORE UPDATE ON transaction_selection
   BEGIN SELECT RAISE(ABORT,'transaction selection is immutable'); END`,
  `CREATE TRIGGER transaction_selection_retained BEFORE DELETE ON transaction_selection
   WHEN NOT EXISTS(SELECT 1 FROM deleted_runs WHERE record_key=OLD.run_id)
   BEGIN SELECT RAISE(ABORT,'transaction selection requires explicit owner deletion'); END`,
  `CREATE TRIGGER transaction_selection_deleted AFTER INSERT ON deleted_runs BEGIN
   DELETE FROM transaction_selection WHERE run_id=NEW.record_key; END`,
  `INSERT INTO transaction_selection SELECT record_key,run_id,
   json_extract(record_json,'$.payload.facts.confirmedAt'),json_extract(record_json,'$.payload.facts.system'),
   json_object('eventId',record_key,'runId',run_id,'confirmedAt',json_extract(record_json,'$.payload.facts.confirmedAt'),
    'system',json_extract(record_json,'$.payload.facts.system'),'operationId',json_extract(record_json,'$.payload.facts.writeIntentId'),
    'generation',json_extract(record_json,'$.payload.facts.intentGeneration')),created_at
   FROM timeline_events WHERE retention_class='confirmed-operation' AND run_id NOT IN(SELECT record_key FROM deleted_runs)`,
] as const;

/** Reject the entire selection before loading evidence if it exceeds the admitted bound. */
export function selectTransactions(database: DatabaseSync, input: unknown) {
  const selection = TransactionHistorySelectionSchema.parse(input);
  const where: string[] = [], params: string[] = [];
  if (selection.from !== "0001-01-01") {
    where.push("confirmed_at >= ?"); params.push(new Date(`${selection.from}T00:00:00`).toISOString());
  }
  if (selection.to !== "9999-12-31") {
    const end = new Date(`${selection.to}T00:00:00`); end.setDate(end.getDate() + 1);
    where.push("confirmed_at < ?"); params.push(end.toISOString());
  }
  if (selection.runId !== undefined) { where.push("run_id = ?"); params.push(selection.runId); }
  if (selection.system !== undefined) { where.push("system = ?"); params.push(selection.system); }
  const rows = database.prepare(`SELECT record_key,run_id,confirmed_at,system,record_json FROM transaction_selection
    ${where.length === 0 ? "" : `WHERE ${where.join(" AND ")}`} ORDER BY confirmed_at,record_key LIMIT 10001`).all(...params);
  if (rows.length > 10000) throw new Error("transaction-history-selection-too-broad");
  return rows.map(raw => {
    const row = z.strictObject({ record_key:z.string(),run_id:z.string(),confirmed_at:z.string(),system:z.string(),record_json:z.string() }).parse(raw);
    const record = TransactionSelectionRecordSchema.parse(JSON.parse(row.record_json));
    if (record.eventId !== row.record_key || record.runId !== row.run_id || record.confirmedAt !== row.confirmed_at || record.system !== row.system) throw new Error("transaction-selection-column-mismatch");
    return record;
  });
}

/** Explicit stopped upgrade only. Each verified archive is loaded once, in bounded key batches. */
export function backfillArchivedTransactionSelection(database: DatabaseSync, archive: () => ArchiveDatabase): void {
  let after = "";
  for (;;) {
    const rows = database.prepare(`SELECT record_key,record_json FROM archive_transfers WHERE record_key > ?
      AND record_key NOT IN(SELECT record_key FROM deleted_runs) ORDER BY record_key LIMIT 100`).all(after);
    if (rows.length === 0) return;
    for (const raw of rows) {
      const row = z.strictObject({record_key:z.string(),record_json:z.string()}).parse(raw);
      const identity = ArchiveTransferIdentitySchema.parse(JSON.parse(row.record_json));
      const report = archive().verifiedReport(row.record_key, identity.reportDigest);
      const source = report.content.sources.find(value => value.kind === "authority-snapshot");
      if (source === undefined) throw new Error("transaction-history-archive-source-missing");
      const snapshot = LifecycleSourceSnapshotSchema.parse(JSON.parse(source.json));
      if (lifecycleSourceDigest(snapshot) !== identity.sourceDigest || canonicalJsonStringify(snapshot.run) !== canonicalJsonStringify(identity.run)) throw new Error("transaction-history-archive-source-mismatch");
      indexArchivedTransactionSnapshot(database, snapshot);
      after = row.record_key;
    }
  }
}

export function indexArchivedTransactionSnapshot(database: DatabaseSync, snapshot: z.infer<typeof LifecycleSourceSnapshotSchema>): void {
      const groups = snapshot.records.filter(group => group.table === "timeline_events");
      if (groups.length !== 1) throw new Error("transaction-history-archive-group-missing-or-duplicate");
      for (const sourceRow of groups[0]?.rows ?? []) {
        const event = TimelineEventRecordSchema.parse(JSON.parse(sourceRow.json));
        if (event.payload.kind !== "operation-confirmed") continue;
        const record = TransactionSelectionRecordSchema.parse({eventId:event.eventId,runId:event.payload.facts.runId,
          confirmedAt:event.payload.facts.confirmedAt,system:event.payload.facts.system,
          operationId:event.payload.facts.writeIntentId,generation:event.payload.facts.intentGeneration});
        if (record.runId !== snapshot.run.envelope.runId || event.eventId !== sourceRow.key) throw new Error("transaction-history-archive-source-mismatch");
        const json = canonicalJsonStringify(record);
        const old = database.prepare("SELECT record_json FROM transaction_selection WHERE record_key=?").get(record.eventId);
        if (old !== undefined) {
          if (canonicalJsonStringify(JSON.parse(z.object({record_json:z.string()}).parse(old).record_json)) !== json) throw new Error("transaction-history-selection-conflict");
        } else database.prepare("INSERT INTO transaction_selection VALUES(?,?,?,?,?,?)").run(record.eventId,record.runId,record.confirmedAt,record.system,json,event.recordedAt);
      }
}

// Shared proofs remain checked in-range even when their first owner is deleted.
export function selectedHistoricalTransactionRows(database: DatabaseSync, input: unknown) {
  const range = TransactionHistorySelectionSchema.parse(input), where: string[] = [], args: string[] = [];
  if (range.from !== "0001-01-01") { where.push("json_extract(record_json,'$.ledgerOutbox.payload.entry.confirmedAt') >= ?"); args.push(new Date(`${range.from}T00:00:00`).toISOString()); }
  if (range.to !== "9999-12-31") { const end=new Date(`${range.to}T00:00:00`);end.setDate(end.getDate()+1);where.push("json_extract(record_json,'$.ledgerOutbox.payload.entry.confirmedAt') < ?");args.push(end.toISOString()); }
  if (range.runId !== undefined) { where.push("json_extract(record_json,'$.runId') = ?"); args.push(range.runId); }
  if (range.system !== undefined) { where.push("json_extract(record_json,'$.ledgerOutbox.payload.entry.system') = ?"); args.push(range.system); }
  const keys = database.prepare(`SELECT record_key FROM timeline_operation_sources ${where.length===0?"":`WHERE ${where.join(" AND ")}`} ORDER BY record_key LIMIT 10001`).all(...args);
  if (keys.length>10000) throw new Error("transaction-history-selection-too-broad");
  return keys.map(raw => {
    const key=z.strictObject({record_key:z.string()}).parse(raw).record_key;
    return z.strictObject({record_json:z.string()}).parse(database.prepare("SELECT record_json FROM timeline_operation_sources WHERE record_key=?").get(key)).record_json;
  });
}

/** The explicit stopped pre-54 converter has no selection table yet. Interactive reads never use this path. */
export function selectStoppedConversionTransactions(database: DatabaseSync, input: unknown) {
  if (!database.isTransaction) throw new Error("transaction-selection-conversion-requires-stopped-transaction");
  const version = z.object({user_version:z.number().int()}).parse(database.prepare("PRAGMA user_version").get()).user_version;
  if (version >= 54) throw new Error("transaction-selection-conversion-requires-historical-schema");
  const range = TransactionHistorySelectionSchema.parse(input), where = ["retention_class='confirmed-operation'"], args: string[] = [];
  if (range.from !== "0001-01-01") { where.push("json_extract(record_json,'$.payload.facts.confirmedAt') >= ?"); args.push(new Date(`${range.from}T00:00:00`).toISOString()); }
  if (range.to !== "9999-12-31") { const end=new Date(`${range.to}T00:00:00`);end.setDate(end.getDate()+1);where.push("json_extract(record_json,'$.payload.facts.confirmedAt') < ?");args.push(end.toISOString()); }
  if (range.runId !== undefined) { where.push("run_id = ?"); args.push(range.runId); }
  if (range.system !== undefined) { where.push("json_extract(record_json,'$.payload.facts.system') = ?"); args.push(range.system); }
  return database.prepare(`SELECT record_json FROM timeline_events WHERE ${where.join(" AND ")} ORDER BY record_key`).all(...args).map(raw => {
    const event=TimelineEventRecordSchema.parse(JSON.parse(z.object({record_json:z.string()}).parse(raw).record_json));
    if (event.payload.kind !== "operation-confirmed") throw new Error("transaction-selection-conversion-kind-mismatch");
    return TransactionSelectionRecordSchema.parse({eventId:event.eventId,runId:event.payload.facts.runId,
      confirmedAt:event.payload.facts.confirmedAt,system:event.payload.facts.system,
      operationId:event.payload.facts.writeIntentId,generation:event.payload.facts.intentGeneration});
  });
}
