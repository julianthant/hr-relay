import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { RunRecordSchema } from "../../domain/run/record.js";
import { DeletedRunRecordSchema } from "../../domain/run/deleted-run.js";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import { timelineImportRecords, type TimelineSourceSnapshot } from "../events/timeline-import.js";
import { createTimelineRepository } from "./timeline-repository.js";

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
