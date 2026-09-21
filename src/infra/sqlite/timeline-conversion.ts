import { localDatePart } from "../../domain/clock.js";
import { hasHistoricalArchiveTables } from "./archive-compatibility.js";
import { createTransactionHistory } from "./transaction-history.js";
import { ArchivedRunRecordSchema, ArchivedTransactionsSchema } from "../../domain/archive/model.js";
import { sha256Hex } from "../../domain/sha256.js";
import { AtomicOutboxRecordSchema } from "../../domain/outbox.js";
import { LedgerPartitionRecordSchema, LedgerProjectionRecordSchema, deriveLedgerLineDigest } from "../../domain/ledger-projection.js";
import { WriteAttemptRecordSchema, WriteIntentRecordSchema } from "../../domain/write-safety.js";
import { RunCheckpointRecordSchema } from "../../domain/workflow/checkpoint.js";
import { lifecycleCommandId } from "../../domain/identifiers.js";
import { HistoricalOperationSourceSchema } from "../../events/timeline.js";
import { confirmedOperationTimeline, reconstructConfirmedOperation } from "../../events/confirmed-operation.js";
import { historicalLedgerSources } from "../events/timeline-import.js";
import { AtomicWriteCommitInputSchema } from "./write-commit-contracts.js";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { HistoricalRunRecordV40Schema, RunRecordSchema } from "../../domain/run/record.js";
import { DeletedRunRecordSchema } from "../../domain/run/deleted-run.js";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import { timelineImportRecords, type TimelineSourceSnapshot } from "../events/timeline-import.js";
import { createTimelineRepository, timelineEventFromRow } from "./timeline-repository.js";

export const TimelineImportCountsSchema = z.strictObject({
  imported: z.number().int().nonnegative(),
  replayed: z.number().int().nonnegative(),
  excludedDeleted: z.number().int().nonnegative(),
});

function sourceAuthorityRecord<T>(schema: z.ZodType<T>, raw: unknown): T {
  try { return schema.parse(JSON.parse(z.object({ record_json: z.string() }).parse(raw).record_json)); }
  catch { throw new Error("timeline-import-authority-record-invalid"); }
}

/** Called only inside the stopped converter's exclusive authority transaction. */
export function importTimelineSources(database: DatabaseSync, source: TimelineSourceSnapshot, recordedAt: string) {
  if (!database.isTransaction) throw new Error("timeline-import-requires-authority-transaction");
  const records = timelineImportRecords(source, recordedAt);
  const counts = { imported: 0, replayed: 0, excludedDeleted: 0 };
  const roots = new Map<string, string>();
  const admitted = records.filter((record) => {
    if (record.scope.kind === "worker") return true;
    const runId = record.scope.runId;
    const raw = database.prepare("SELECT record_json FROM workflow_runs WHERE record_key = ?").get(runId);
    if (raw === undefined) {
      const deleted = database.prepare("SELECT record_json FROM deleted_runs WHERE record_key = ?").get(runId);
      if (deleted === undefined) throw new Error("timeline-import-owner-missing");
      const tombstone = sourceAuthorityRecord(DeletedRunRecordSchema, deleted);
      if (tombstone.runId !== runId || tombstone.workflow !== record.workflow
        || (record.payload.kind === "span" && "traceId" in record.payload.event
          && (tombstone.traceId !== record.payload.event.traceId
            || (tombstone.attempt !== null && record.payload.event.attempt > tombstone.attempt)
            || (record.payload.event.t === "run.queued" && tombstone.itemId !== null
              && record.payload.event.itemId !== tombstone.itemId)))) throw new Error("timeline-import-tombstone-mismatch");
      counts.excludedDeleted += 1;
      return false;
    }
    const run = sourceAuthorityRecord(RunRecordSchema, raw);
    if (run.envelope.runId !== runId || run.envelope.workflow !== record.workflow) throw new Error("timeline-import-owner-mismatch");
    if (record.payload.kind !== "span" || !("runId" in record.payload.event)) throw new Error("timeline-import-scope-mismatch");
    const event = record.payload.event;
    if (event.traceId !== run.envelope.traceId || event.attempt > run.envelope.attempt
      || (event.t === "run.queued" && (event.itemId !== run.envelope.itemId
        || event.configFingerprint !== run.envelope.configFingerprint
        || event.configSnapshotId !== run.envelope.configSnapshotId
        || event.contractFingerprint !== run.envelope.contractFingerprint
        || event.descriptorVersion !== run.envelope.descriptorVersion
        || event.shape !== run.envelope.shape
        || (event.parentRunId ?? null) !== (run.envelope.parent?.runId ?? null)
        || (event.retryOf ?? null) !== (run.envelope.retryOf ?? null)
        || canonicalJsonStringify(event.resolvedInstance) !== canonicalJsonStringify(run.envelope.resolvedInstance)
        || event.ts !== run.envelope.enqueuedAt
        || event.dryRun !== run.envelope.dryRun))) throw new Error("timeline-import-owner-mismatch");
    if (event.t === "run.queued") {
      const identity = runId;
      const content = canonicalJsonStringify(event);
      const prior = roots.get(identity);
      if (prior !== undefined) throw new Error(prior === content ? "timeline-import-duplicate-root" : "timeline-import-divergent-root");
      roots.set(identity, content);
    }
    return true;
  });
  const repository = createTimelineRepository({ database, read: (read) => read(),
    mutate: (work) => work().result, assertOwner: () => {} });
  for (const record of admitted) {
    const result = repository.append(record);
    if (result.state === "inserted") counts.imported += 1;
    else counts.replayed += 1;
  }
  return TimelineImportCountsSchema.parse(counts);
}

/** Preserve exact retired representations before the first DROP in migration 40. */
export function convertOperationHistory(database: DatabaseSync, source: TimelineSourceSnapshot, recordedAt: string) {
  if (!database.isTransaction) throw new Error("operation-history-conversion-requires-transaction");
  const read = <T>(schema: z.ZodType<T>, table: string): T[] => database.prepare(`SELECT record_json FROM ${table}`).all().map((row) => sourceAuthorityRecord(schema, row));
  const outboxes = read(AtomicOutboxRecordSchema, "operation_outbox");
  const projections = read(LedgerProjectionRecordSchema, "ledger_projections");
  const partitions = read(LedgerPartitionRecordSchema, "ledger_partitions");
  const attempts = read(WriteAttemptRecordSchema, "run_operation_attempts");
  const operations = read(WriteIntentRecordSchema, "run_operations");
  const checkpoints = read(RunCheckpointRecordSchema, "run_checkpoints");
  // Migration 40 precedes the completion enrichment in migration 41.
  const runs = read(HistoricalRunRecordV40Schema, "workflow_runs");
  const deleted = read(DeletedRunRecordSchema, "deleted_runs");
  const files = historicalLedgerSources(source);
  const repository = createTimelineRepository({ database, read: (work) => work(), mutate: (work) => work().result, assertOwner: () => {} });
  const evidence = { writeAttempts: { get: (id: string) => attempts.find((attempt) => attempt.writeAttemptId === id) },
    runCheckpoints: { get: (workflowId: string, itemId: string, nodeId: string, attempt: number, claimGeneration?: number) =>
      checkpoints.find((row) => row.workflowId === workflowId && row.itemId === itemId && row.nodeId === nodeId && row.attempt === attempt && row.claimGeneration === claimGeneration) } };
  const consumed = new Set<string>();
  for (const outbox of outboxes) {
    if (outbox.payload.kind !== "ledger-entry") continue;
    const ledger = outbox.payload.entry;
    const same = outboxes.filter((row) => row.aggregate.writeIntentId === ledger.writeIntentId && row.aggregate.generation === ledger.intentGeneration);
    const span = same.find((row) => row.payload.kind === "write-committed-span");
    if (same.length !== 2 || span?.payload.kind !== "write-committed-span"
      || outbox.aggregate.writeIntentId !== ledger.writeIntentId || outbox.aggregate.generation !== ledger.intentGeneration) throw new Error("operation-history-outbox-pair-invalid");
    AtomicWriteCommitInputSchema.parse({ writeIntentId: ledger.writeIntentId, generation: ledger.intentGeneration,
      completionProof: ledger.proof, confirmedAt: ledger.confirmedAt, outcome: span.payload.outcome,
      transaction: ledger, committedSpan: span.payload });
    const operation = operations.find((row) => row.writeIntentId === ledger.writeIntentId);
    const matchingAttempts = attempts.filter((row) => row.writeIntentId === ledger.writeIntentId && row.generation === ledger.intentGeneration);
    if (operation === undefined || operation.status === "observed-present" || operation.workflowId !== ledger.workflowId
      || operation.itemId !== ledger.itemId || operation.system !== ledger.system || operation.idempotencyKey !== ledger.idempotencyKey
      || matchingAttempts.length !== 1) throw new Error("operation-history-operation-mismatch");
    const attempt = matchingAttempts[0];
    if (attempt === undefined) throw new Error("operation-history-attempt-missing");
    const matches = checkpoints.filter((row) => row.runId === ledger.runId && row.workflowId === ledger.workflowId
      && row.itemId === ledger.itemId && row.attempt === ledger.attempt && row.writtenAt === ledger.confirmedAt
      && canonicalJsonStringify(row.output.value) === canonicalJsonStringify(span.payload.kind === "write-committed-span" ? span.payload.outcome : null));
    const eventId = lifecycleCommandId("timeline-operation-confirmed", { writeIntentId: ledger.writeIntentId, generation: ledger.intentGeneration });
    const existing = repository.get(eventId);
    const checkpoint = existing?.payload.kind === "operation-confirmed"
      ? evidence.runCheckpoints.get(existing.payload.checkpoint.workflowId, existing.payload.checkpoint.itemId,
        existing.payload.checkpoint.nodeId, existing.payload.checkpoint.attempt, existing.payload.checkpoint.claimGeneration)
      : matches.length === 1 ? matches[0] : undefined;
    if (checkpoint === undefined) throw new Error("operation-history-checkpoint-missing-or-ambiguous");
    const event = existing ?? confirmedOperationTimeline({ ledger, span: span.payload, checkpoint,
      writeAttemptId: attempt.writeAttemptId, recordedAt });
    const reconstructed = reconstructConfirmedOperation(evidence, event);
    if (canonicalJsonStringify(reconstructed.ledger) !== canonicalJsonStringify(ledger)
      || canonicalJsonStringify(reconstructed.span) !== canonicalJsonStringify(span.payload)) throw new Error("operation-history-source-disagreement");
    const run = runs.find((row) => row.envelope.runId === ledger.runId);
    if (run === undefined) {
      const tombstone = deleted.find((row) => row.runId === ledger.runId);
      if (tombstone === undefined || tombstone.workflow !== ledger.workflowId || tombstone.itemId !== ledger.itemId || tombstone.traceId !== ledger.traceId) throw new Error("operation-history-owner-missing");
    } else {
      if (run.envelope.workflow !== ledger.workflowId || run.envelope.itemId !== ledger.itemId
        || run.envelope.traceId !== ledger.traceId || run.envelope.configFingerprint !== ledger.configFingerprint
        || run.envelope.resolvedInstance[ledger.system] !== ledger.instance || run.envelope.dryRun
        || ledger.attempt > run.envelope.attempt) throw new Error("operation-history-owner-mismatch");
      if (existing === undefined) repository.append(event);
    }
    const assigned = projections.filter((row) => row.outboxId === outbox.outboxId);
    if (assigned.length > 1) throw new Error("operation-history-projection-ambiguous");
    const projection = assigned[0] ?? null;
    const partition = projection === null ? null : partitions.find((row) => row.system === projection.system && row.date === projection.date) ?? null;
    if (projection !== null && (partition === null || projection.system !== ledger.system)) throw new Error("operation-history-partition-mismatch");
    const matchingFiles = files.filter((row) => row.entry.outboxId === outbox.outboxId);
    if (matchingFiles.length > 1) throw new Error("operation-history-file-duplicate");
    const file = matchingFiles[0];
    const expectedLine = projection === null ? undefined : canonicalJsonStringify({ outboxId: outbox.outboxId, seq: projection.seq, payload: ledger });
    if (projection !== null && (expectedLine === undefined || deriveLedgerLineDigest(expectedLine) !== projection.lineDigest)) throw new Error("operation-history-assignment-disagreement");
    if (file !== undefined && (projection === null || file.entry.seq !== projection.seq
      || file.relativePath !== `ledger/${projection.system}-${projection.date}.jsonl`
      || canonicalJsonStringify(file.entry.payload) !== canonicalJsonStringify(ledger)
      || deriveLedgerLineDigest(file.line) !== projection.lineDigest)) throw new Error("operation-history-file-disagreement");
    const record = HistoricalOperationSourceSchema.parse({ version: 1, recordKey: `${ledger.writeIntentId}:${String(ledger.intentGeneration)}`,
      operationId: ledger.writeIntentId, generation: ledger.intentGeneration, runId: ledger.runId,
      manifestDigest: source.digest, backupSha256: source.manifest.backupSha256, ledgerOutbox: outbox, spanOutbox: span,
      projection, partition, file: file === undefined ? null : { relativePath: file.relativePath, sha256: file.sha256, line: file.lineNumber } });
    database.prepare("INSERT INTO timeline_operation_sources(record_key,record_json,created_at) VALUES (?,?,?)").run(record.recordKey, canonicalJsonStringify(record), recordedAt);
    consumed.add(outbox.outboxId); consumed.add(span.outboxId);
  }
  if (outboxes.some((row) => !consumed.has(row.outboxId)) || projections.some((row) => !consumed.has(row.outboxId))) throw new Error("operation-history-orphan-outbox");
  for (const file of files.filter((row) => !consumed.has(row.entry.outboxId))) {
    const owner = deleted.find((row) => row.runId === file.entry.payload.runId);
    if (owner === undefined || owner.workflow !== file.entry.payload.workflowId || owner.itemId !== file.entry.payload.itemId
      || owner.traceId !== file.entry.payload.traceId) throw new Error("operation-history-orphan-file");
  }
  for (const attempt of attempts.filter((row) => row.outcome.state === "committed")) {
    const eventId = lifecycleCommandId("timeline-operation-confirmed", { writeIntentId: attempt.writeIntentId, generation: attempt.generation });
    const retained = repository.get(eventId);
    const paired = outboxes.some((row) => row.aggregate.writeIntentId === attempt.writeIntentId && row.aggregate.generation === attempt.generation && consumed.has(row.outboxId));
    if (retained === undefined && !paired) throw new Error("operation-history-committed-source-missing");
    if (retained !== undefined) reconstructConfirmedOperation(evidence, retained);
  }
  return { convertedOperations: consumed.size / 2 };
}

export function freezeConvertedArchiveTransactions(database: DatabaseSync, recordedAt: string): void {
  if (!database.isTransaction) throw new Error("archive-history-conversion-requires-transaction");
  if (!hasHistoricalArchiveTables(database)) return;
  const read = <T>(schema: z.ZodType<T>, table: string): T[] => database.prepare(`SELECT record_json FROM ${table}`).all().map((row) => sourceAuthorityRecord(schema, row));
  const runs = read(RunRecordSchema, "workflow_runs");
  const deleted = read(DeletedRunRecordSchema, "deleted_runs");
  const attempts = read(WriteAttemptRecordSchema, "run_operation_attempts");
  const operations = read(WriteIntentRecordSchema, "run_operations");
  const checkpoints = read(RunCheckpointRecordSchema, "run_checkpoints");
  const sources = read(HistoricalOperationSourceSchema, "timeline_operation_sources");
  const history = createTransactionHistory({
    timelineEvents: createTimelineRepository({ database, read: (work) => work(), mutate: (work) => work().result, assertOwner: () => {} }),
    confirmedTransactionSources: { select: range => {
      // Explicit stopped conversion owns the full legacy source scan.
      const events = database.prepare("SELECT * FROM timeline_events WHERE retention_class='confirmed-operation'").all()
        .map(timelineEventFromRow).filter(event => {
          if (event.payload.kind !== "operation-confirmed") return false;
          const facts = event.payload.facts, day = localDatePart(new Date(facts.confirmedAt));
          return day >= range.from && day <= range.to && (range.runId === undefined || facts.runId === range.runId)
            && (range.system === undefined || facts.system === range.system);
        });
      return {events,archived:[],historical:sources,eventIds:events.map(event=>event.eventId)};
    } },
    runs: { get: (id) => runs.find((row) => row.envelope.runId === id) },
    deletedRuns: { get: (id) => deleted.find((row) => row.runId === id) },
    writeIntents: { get: (id) => operations.find((row) => row.writeIntentId === id) },
    writeAttempts: { get: (id) => attempts.find((row) => row.writeAttemptId === id) },
    runCheckpoints: { get: (workflow, item, node, attempt, claim) => checkpoints.find((row) => row.workflowId === workflow && row.itemId === item && row.nodeId === node && row.attempt === attempt && row.claimGeneration === claim) },
  });
  for (const archive of read(ArchivedRunRecordSchema, "archived_runs")) {
    const section = ArchivedTransactionsSchema.parse(history.capture(archive.runId, archive.contentDigest, recordedAt, archive.evidence.ledgerPartitions));
    const json = canonicalJsonStringify(section);
    database.prepare("UPDATE archived_runs SET transactions_json=?, transactions_digest=? WHERE record_key=? AND transactions_json IS NULL").run(json, sha256Hex(json), archive.runId);
  }
}
