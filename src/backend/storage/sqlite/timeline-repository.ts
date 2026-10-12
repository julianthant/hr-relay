import type { DatabaseSync, StatementSync } from "node:sqlite";
import { SpanEventWireSchema } from "../../../models/events/types.js";
import { z } from "zod";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { TimelineAppendSchema, TimelineEventRecordSchema, TimelinePageRequestSchema,
  timelineAppendContent, type TimelineEventRecord, type TimelineRepository } from "../../../models/events/timeline.js";

interface TimelineRepositoryPorts {
  database: DatabaseSync;
  /** Must use the owning connection's authority transaction and generation accounting. */
  mutate<T>(work: () => Readonly<{ result: T; changes: number }>): T;
  read<T>(work: () => T): T;
  assertOwner(record: TimelineEventRecord | z.infer<typeof TimelineAppendSchema>, appending: boolean): void;
}

const RowSchema = z.strictObject({
  cursor: z.number().int().positive(), id: z.string(), workflow: z.string().nullable(),
  run_id: z.string().nullable(), worker_id: z.string().nullable(), retention_date: z.string(),
  retention_class: z.enum(["ordinary", "confirmed-operation", "protected"]), payload_json: z.string(),
  kind: z.string(), occurred_at: z.string(), recorded_at: z.string(), operation_id: z.string().nullable(),
  operation_generation: z.number().int().positive().nullable(), confirmed_at: z.string().nullable(), system: z.string().nullable(),
});
const EventIdSchema = z.uuid();
const DataVersionSchema = z.object({ data_version: z.number().int() });
const OrdinaryBytesRowSchema = z.object({ bytes: z.number().int(), data_version: z.number().int() }).optional();
const OrdinaryBytesSchema = z.number().int().nonnegative();
const OrdinaryBytesSumSchema = z.object({ bytes: OrdinaryBytesSchema });
const HighWaterMarkSchema = z.strictObject({ cursor: z.number().int().nonnegative() });

/** Safe diagnostics contain schema-owned field names, never observed keys or values. */
export class TimelineRecordError extends Error {}
const SPAN_FIELDS = new Set(SpanEventWireSchema.options.flatMap((schema) => Object.keys(schema.shape)));

function invalidTimelineRecord(value: unknown): TimelineRecordError {
  const span = z.object({ payload: z.object({ kind: z.literal("span"), event: z.unknown() }) }).safeParse(value);
  if (span.success) {
    const parsed = SpanEventWireSchema.safeParse(span.data.payload.event);
    if (!parsed.success) {
      const fields = [...new Set(parsed.error.issues.map((issue) => {
        const field = issue.path[0];
        return typeof field === "string" && SPAN_FIELDS.has(field) ? field : "$";
      }))].slice(0, 8);
      return new TimelineRecordError(`timeline-record-invalid: strict span schema at ${fields.join(", ")}`);
    }
  }
  return new TimelineRecordError("timeline-record-invalid");
}

// Validate mirrored columns on reads; external writes can bypass SQLite checks.
export function timelineEventFromRow(raw: unknown): TimelineEventRecord {
  const parsedRow = RowSchema.safeParse(raw);
  if (!parsedRow.success) throw new TimelineRecordError("timeline-record-invalid");
  const row = parsedRow.data;
  let value: unknown;
  try { value = JSON.parse(row.payload_json); } catch { throw new TimelineRecordError("timeline-record-invalid"); }
  const parsedRecord = TimelineEventRecordSchema.safeParse(value);
  if (!parsedRecord.success) throw invalidTimelineRecord(value);
  const record = parsedRecord.data;
  if (row.cursor !== record.cursor || row.id !== record.eventId || row.workflow !== (record.workflow ?? null)
    || row.run_id !== (record.scope.kind === "run" ? record.scope.runId : null)
    || row.worker_id !== (record.scope.kind === "worker" ? record.scope.workerId : null)
    || row.retention_date !== record.retentionDate || row.recorded_at !== record.recordedAt || row.occurred_at !== record.occurredAt
    || row.kind !== (record.payload.kind === "span" ? record.payload.event.t : record.payload.kind)
    || row.retention_class !== timelineRetentionClass(record)
    || row.operation_id !== (record.payload.kind === "operation-confirmed" ? record.payload.facts.writeIntentId : null)
    || row.operation_generation !== (record.payload.kind === "operation-confirmed" ? record.payload.facts.intentGeneration : null)
    || row.confirmed_at !== (record.payload.kind === "operation-confirmed" ? record.payload.facts.confirmedAt : null)
    || row.system !== (record.payload.kind === "operation-confirmed" ? record.payload.facts.system : null)
    || (row.retention_class === "confirmed-operation") !== (record.payload.kind === "operation-confirmed")) {
    throw new Error("timeline-event-column-mismatch");
  }
  return record;
}

function timelineRetentionClass(record: z.infer<typeof TimelineAppendSchema>) {
  if (record.payload.kind === "operation-confirmed") return "confirmed-operation";
  if (record.payload.kind === "debug" && record.payload.event.pinned) return "protected";
  if (record.payload.kind === "span" && record.payload.event.t === "span.ended" && ["failed", "interrupted"].includes(record.payload.event.outcome)) return "protected";
  if (record.payload.kind === "checkpoint-recorded" || record.payload.kind === "checkpoint-replayed"
    || (record.payload.kind === "note" && record.payload.note.confirmedAction?.kind === "fact")) return "protected";
  return "ordinary";
}

function ordinaryTimelineBytes(database: DatabaseSync, prepare: (sql: string) => StatementSync): number {
  database.exec(`CREATE TEMP TABLE IF NOT EXISTS timeline_ordinary_bytes(
    id INTEGER PRIMARY KEY CHECK(id=1), bytes INTEGER NOT NULL, data_version INTEGER NOT NULL);
    CREATE TEMP TRIGGER IF NOT EXISTS timeline_ordinary_bytes_insert AFTER INSERT ON main.timeline_events
      WHEN NEW.retention_class='ordinary' BEGIN
        UPDATE timeline_ordinary_bytes SET bytes=bytes+length(CAST(NEW.payload_json AS BLOB)) WHERE id=1; END;
    CREATE TEMP TRIGGER IF NOT EXISTS timeline_ordinary_bytes_delete AFTER DELETE ON main.timeline_events
      WHEN OLD.retention_class='ordinary' BEGIN
        UPDATE timeline_ordinary_bytes SET bytes=bytes-length(CAST(OLD.payload_json AS BLOB)) WHERE id=1; END;
    CREATE TEMP TRIGGER IF NOT EXISTS timeline_ordinary_bytes_update AFTER UPDATE ON main.timeline_events BEGIN
      UPDATE timeline_ordinary_bytes SET bytes=bytes
        -CASE WHEN OLD.retention_class='ordinary' THEN length(CAST(OLD.payload_json AS BLOB)) ELSE 0 END
        +CASE WHEN NEW.retention_class='ordinary' THEN length(CAST(NEW.payload_json AS BLOB)) ELSE 0 END WHERE id=1; END;`);
  const version = DataVersionSchema.parse(prepare("PRAGMA data_version").get()).data_version;
  const row = OrdinaryBytesRowSchema.parse(prepare("SELECT bytes,data_version FROM timeline_ordinary_bytes WHERE id=1").get());
  if (row !== undefined && row.data_version === version) return OrdinaryBytesSchema.parse(row.bytes);
  const bytes = OrdinaryBytesSumSchema.parse(prepare(
    "SELECT COALESCE(SUM(length(CAST(payload_json AS BLOB))),0) AS bytes FROM timeline_events WHERE retention_class = 'ordinary'").get()).bytes;
  prepare("INSERT INTO timeline_ordinary_bytes(id,bytes,data_version) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET bytes=excluded.bytes,data_version=excluded.data_version").run(bytes,version);
  return bytes;
}

export function createTimelineRepository(ports: TimelineRepositoryPorts): TimelineRepository {
  const { database } = ports;
  const statements = new Map<string, StatementSync>();
  const prepare = (sql: string): StatementSync => {
    const existing = statements.get(sql);
    if (existing !== undefined) return existing;
    const statement = database.prepare(sql);
    statements.set(sql, statement);
    return statement;
  };
  const get = (eventId: string): TimelineEventRecord | undefined => ports.read(() => {
    const row = prepare("SELECT * FROM timeline_events WHERE id = ?").get(EventIdSchema.parse(eventId));
    return row === undefined ? undefined : timelineEventFromRow(row);
  });
  return Object.freeze({
    withReadSnapshot: <T>(read: () => T): T => ports.read(read),
    get,
    append(input: unknown) {
      const parsed = TimelineAppendSchema.safeParse(input);
      if (!parsed.success) throw new Error("timeline-event-invalid");
      const record = parsed.data;
      const content = canonicalJsonStringify(record);
      if (Buffer.byteLength(content, "utf8") > 256 * 1024) throw new Error("timeline-event-size-exceeded");
      return ports.mutate<ReturnType<TimelineRepository["append"]>>(() => {
        const existing = get(record.eventId);
        if (existing !== undefined) {
          if (timelineAppendContent(existing) !== content) throw new Error("timeline-event-identity-conflict");
          ports.assertOwner(existing, false);
          return { result: { state: "existing" as const, record: existing }, changes: 0 };
        }
        ports.assertOwner(record, true);
        if (timelineRetentionClass(record) === "ordinary") {
          const bytes = ordinaryTimelineBytes(database, prepare);
          if (bytes + Buffer.byteLength(canonicalJsonStringify({ ...record, cursor: Number((prepare("SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name='timeline_events'),0) + 1 AS cursor").get() as { cursor: number }).cursor) }), "utf8") > 250 * 1024 * 1024) throw new Error("timeline-ordinary-cap-exceeded");
        }
        // SQLite assigns both the cursor and its authenticated JSON mirror from
        // its AUTOINCREMENT sequence under the same owning write transaction.
        const raw = prepare(`
          INSERT INTO timeline_events(id,workflow,run_id,worker_id,kind,occurred_at,recorded_at,retention_date,
            retention_class,operation_id,operation_generation,confirmed_at,system,payload_json)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,json_set(?,'$.cursor',
            COALESCE((SELECT seq FROM sqlite_sequence WHERE name='timeline_events'),0)+1)) RETURNING *
        `).get(record.eventId,record.workflow ?? null,
          record.scope.kind === "run" ? record.scope.runId : null,record.scope.kind === "worker" ? record.scope.workerId : null,
          record.payload.kind === "span" ? record.payload.event.t : record.payload.kind,record.occurredAt,record.recordedAt,record.retentionDate,
          timelineRetentionClass(record),record.payload.kind === "operation-confirmed" ? record.payload.facts.writeIntentId : null,
          record.payload.kind === "operation-confirmed" ? record.payload.facts.intentGeneration : null,
          record.payload.kind === "operation-confirmed" ? record.payload.facts.confirmedAt : null,
          record.payload.kind === "operation-confirmed" ? record.payload.facts.system : null,content);
        return { result: { state: "inserted" as const, record: timelineEventFromRow(raw) }, changes: 1 };
      });
    },
    page(input: z.input<typeof TimelinePageRequestSchema>) {
      const request = TimelinePageRequestSchema.parse(input);
      return ports.read(() => {
        const predicates = ["cursor > ?"];
        const bindings: (string | number)[] = [request.after];
        if (request.through !== undefined) { predicates.push("cursor <= ?"); bindings.push(request.through); }
        if (request.runId !== undefined) { predicates.push("run_id = ?"); bindings.push(request.runId); }
        if (request.workflow !== undefined) { predicates.push("workflow = ?"); bindings.push(request.workflow); }
        const rows = prepare(`SELECT * FROM timeline_events WHERE ${predicates.join(" AND ")} ORDER BY cursor LIMIT ?`)
          .all(...bindings, request.limit);
        return Object.freeze(rows.map(timelineEventFromRow));
      });
    },
    confirmedActionHeads(input: Parameters<TimelineRepository["confirmedActionHeads"]>[0]) {
      const request = z.strictObject({ workerStreamIds: z.array(z.string().min(1)).max(200), before: z.number().int().positive() }).parse(input);
      if (request.workerStreamIds.length === 0) return [];
      return ports.read(() => {
        const rows = prepare(`SELECT * FROM timeline_events WHERE cursor IN (
          SELECT max(cursor) FROM timeline_events WHERE cursor<?
          AND json_extract(payload_json,'$.payload.note.confirmedAction.workerStreamId') IN (${request.workerStreamIds.map(() => "?").join(",")})
          GROUP BY json_extract(payload_json,'$.payload.note.confirmedAction.workerStreamId'))`)
          .all(request.before, ...request.workerStreamIds);
        return Object.freeze(rows.map(timelineEventFromRow));
      });
    },
    highWaterMark() {
      return ports.read(() => HighWaterMarkSchema.parse(prepare(
        "SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'timeline_events'), 0) AS cursor",
      ).get()).cursor);
    },
    pruneBefore(retentionDate: string) {
      const cutoff = z.iso.date().parse(retentionDate);
      return ports.mutate(() => {
        const result = prepare(
          `DELETE FROM timeline_events WHERE retention_class = 'ordinary'
            AND retention_date < CASE WHEN json_extract(payload_json,'$.payload.event.category')='sse'
              AND json_extract(payload_json,'$.payload.event.phase')='settled' THEN date(?,'+23 days') ELSE ? END
            AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.id=timeline_events.run_id AND r.state<>'terminal')
            AND NOT (kind='span.started' AND (
              NOT EXISTS (SELECT 1 FROM timeline_events ended WHERE ended.kind='span.ended' AND ended.cursor>timeline_events.cursor
                AND ended.run_id IS timeline_events.run_id AND ended.worker_id IS timeline_events.worker_id
                AND ended.workflow IS timeline_events.workflow
                AND json_extract(ended.payload_json,'$.payload.event.kind') IS json_extract(timeline_events.payload_json,'$.payload.event.kind')
                AND json_extract(ended.payload_json,'$.payload.event.pid') IS json_extract(timeline_events.payload_json,'$.payload.event.pid')
                AND json_extract(ended.payload_json,'$.payload.event.attempt') IS json_extract(timeline_events.payload_json,'$.payload.event.attempt')
                AND json_extract(ended.payload_json,'$.payload.event.traceId') IS json_extract(timeline_events.payload_json,'$.payload.event.traceId')
                AND json_extract(ended.payload_json,'$.payload.event.spanPath') IS json_extract(timeline_events.payload_json,'$.payload.event.spanPath'))
              OR EXISTS (SELECT 1 FROM timeline_events ended WHERE ended.kind='span.ended' AND ended.retention_class='protected' AND ended.cursor>timeline_events.cursor
                AND ended.run_id IS timeline_events.run_id AND ended.worker_id IS timeline_events.worker_id
                AND ended.workflow IS timeline_events.workflow
                AND json_extract(ended.payload_json,'$.payload.event.kind') IS json_extract(timeline_events.payload_json,'$.payload.event.kind')
                AND json_extract(ended.payload_json,'$.payload.event.pid') IS json_extract(timeline_events.payload_json,'$.payload.event.pid')
                AND json_extract(ended.payload_json,'$.payload.event.attempt') IS json_extract(timeline_events.payload_json,'$.payload.event.attempt')
                AND json_extract(ended.payload_json,'$.payload.event.traceId') IS json_extract(timeline_events.payload_json,'$.payload.event.traceId')
                AND json_extract(ended.payload_json,'$.payload.event.spanPath') IS json_extract(timeline_events.payload_json,'$.payload.event.spanPath'))))
            AND NOT (kind='run.claimed' AND (
              NOT EXISTS (SELECT 1 FROM timeline_events ended WHERE ended.kind='span.ended'
                AND json_extract(ended.payload_json,'$.payload.event.kind')='run' AND ended.cursor>timeline_events.cursor
                AND json_extract(ended.payload_json,'$.payload.event.spanPath') IS json_extract(timeline_events.payload_json,'$.payload.event.spanPath')
                AND ended.run_id IS timeline_events.run_id AND ended.worker_id IS timeline_events.worker_id
                AND ended.workflow IS timeline_events.workflow
                AND json_extract(ended.payload_json,'$.payload.event.pid') IS json_extract(timeline_events.payload_json,'$.payload.event.pid')
                AND json_extract(ended.payload_json,'$.payload.event.attempt') IS json_extract(timeline_events.payload_json,'$.payload.event.attempt')
                AND json_extract(ended.payload_json,'$.payload.event.traceId') IS json_extract(timeline_events.payload_json,'$.payload.event.traceId')
                AND json_extract(ended.payload_json,'$.payload.event.workerId') IS json_extract(timeline_events.payload_json,'$.payload.event.workerId')
                AND json_extract(ended.payload_json,'$.payload.event.claimGeneration') IS json_extract(timeline_events.payload_json,'$.payload.event.claimGeneration'))
              OR EXISTS (SELECT 1 FROM timeline_events ended WHERE ended.kind='span.ended' AND ended.retention_class='protected' AND ended.cursor>timeline_events.cursor
                AND json_extract(ended.payload_json,'$.payload.event.kind')='run' AND ended.cursor>timeline_events.cursor
                AND json_extract(ended.payload_json,'$.payload.event.spanPath') IS json_extract(timeline_events.payload_json,'$.payload.event.spanPath')
                AND ended.run_id IS timeline_events.run_id AND ended.worker_id IS timeline_events.worker_id
                AND ended.workflow IS timeline_events.workflow
                AND json_extract(ended.payload_json,'$.payload.event.pid') IS json_extract(timeline_events.payload_json,'$.payload.event.pid')
                AND json_extract(ended.payload_json,'$.payload.event.attempt') IS json_extract(timeline_events.payload_json,'$.payload.event.attempt')
                AND json_extract(ended.payload_json,'$.payload.event.traceId') IS json_extract(timeline_events.payload_json,'$.payload.event.traceId')
                AND json_extract(ended.payload_json,'$.payload.event.workerId') IS json_extract(timeline_events.payload_json,'$.payload.event.workerId')
                AND json_extract(ended.payload_json,'$.payload.event.claimGeneration') IS json_extract(timeline_events.payload_json,'$.payload.event.claimGeneration'))))
            AND NOT EXISTS (SELECT 1 FROM run_search AS search_row JOIN runs AS run_owner ON run_owner.id=search_row.run_id,
              json_each(search_row.actor_source_json) actor_source
              WHERE search_row.run_id=timeline_events.run_id
                AND json_extract(actor_source.value,'$.kind')='queued'
                AND json_extract(actor_source.value,'$.event.eventId')=timeline_events.id)`,
        ).run(cutoff, cutoff);
        const changes = z.number().int().nonnegative().parse(Number(result.changes));
        return { result: changes, changes };
      });
    },
  });
}
