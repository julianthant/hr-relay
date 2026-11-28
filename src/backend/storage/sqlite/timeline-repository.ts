import type { DatabaseSync, StatementSync } from "node:sqlite";
import { SpanEventWireSchema } from "../../../models/events/types.js";
import { z } from "zod";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { deepFreeze } from "../../../rules/validation/immutability.js";
import { changeLogTriggers } from "./authority-change-log.js";
import type { LogMutation } from "../events/log-mutations.js";
import { TimelineAppendSchema, TimelineDiagnosticBudgetError, TimelineEventRecordSchema, TimelinePageRequestSchema,
  timelineAppendContent, type TimelineEventRecord, type TimelineRepository } from "../../../models/events/timeline.js";

interface TimelineRepositoryPorts {
  cursorOffset?(): number;
  database: DatabaseSync;
  publishCommitted?: (mutation: LogMutation) => void;
  assertDebugAppend?: () => void;
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
const DebugRowSchema = z.strictObject({
  cursor: z.number().int().positive(), id: z.string(), workflow: z.string().nullable(), run_id: z.string().nullable(),
  worker_id: z.string().nullable(), occurred_at: z.string(), recorded_at: z.string(), retention_date: z.string(),
  pinned: z.union([z.literal(0), z.literal(1)]), payload_json: z.string(),
});
const EventIdSchema = z.uuid();
const CursorRowSchema = z.strictObject({ cursor: z.number().int().positive() });
const DataVersionSchema = z.object({ data_version: z.number().int() });
const DiagnosticBytesRowSchema = z.object({ bytes: z.number().int(), data_version: z.number().int() }).optional();
const DiagnosticBytesSchema = z.number().int().nonnegative();
const DiagnosticBytesSumSchema = z.object({ bytes: DiagnosticBytesSchema });
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

function recordFromJson(json: string): TimelineEventRecord {
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new TimelineRecordError("timeline-record-invalid"); }
  const parsedRecord = TimelineEventRecordSchema.safeParse(value);
  if (!parsedRecord.success) throw invalidTimelineRecord(value);
  return parsedRecord.data;
}

// Validate mirrored columns on reads; external writes can bypass SQLite checks.
export const timelineEventFromRow = (raw: unknown): TimelineEventRecord => storedTimelineEvent(raw, false);
/** A predecessor store (before migration 39) still holds its debug rows in the timeline, pinned ones as protected. */
export const predecessorTimelineEventFromRow = (raw: unknown): TimelineEventRecord => storedTimelineEvent(raw, true);

function storedTimelineEvent(raw: unknown, predecessorDebug: boolean): TimelineEventRecord {
  const parsedRow = RowSchema.safeParse(raw);
  if (!parsedRow.success) throw new TimelineRecordError("timeline-record-invalid");
  const row = parsedRow.data;
  const record = recordFromJson(row.payload_json);
  if (record.payload.kind === "debug" && !predecessorDebug) throw new TimelineRecordError("timeline-record-invalid");
  const retentionClass = record.payload.kind === "debug" ? (record.payload.event.pinned ? "protected" : "ordinary") : timelineRetentionClass(record);
  if (row.cursor !== record.cursor || row.id !== record.eventId || row.workflow !== (record.workflow ?? null)
    || row.run_id !== (record.scope.kind === "run" ? record.scope.runId : null)
    || row.worker_id !== (record.scope.kind === "worker" ? record.scope.workerId : null)
    || row.retention_date !== record.retentionDate || row.recorded_at !== record.recordedAt || row.occurred_at !== record.occurredAt
    || row.kind !== (record.payload.kind === "span" ? record.payload.event.t : record.payload.kind)
    || row.retention_class !== retentionClass
    || row.operation_id !== (record.payload.kind === "operation-confirmed" ? record.payload.facts.writeIntentId : null)
    || row.operation_generation !== (record.payload.kind === "operation-confirmed" ? record.payload.facts.intentGeneration : null)
    || row.confirmed_at !== (record.payload.kind === "operation-confirmed" ? record.payload.facts.confirmedAt : null)
    || row.system !== (record.payload.kind === "operation-confirmed" ? record.payload.facts.system : null)
    || (row.retention_class === "confirmed-operation") !== (record.payload.kind === "operation-confirmed")) {
    throw new Error("timeline-event-column-mismatch");
  }
  return record;
}

export function debugEventFromRow(raw: unknown): TimelineEventRecord {
  const parsedRow = DebugRowSchema.safeParse(raw);
  if (!parsedRow.success) throw new TimelineRecordError("timeline-record-invalid");
  const row = parsedRow.data;
  const record = recordFromJson(row.payload_json);
  if (record.payload.kind !== "debug" || row.cursor !== record.cursor || row.id !== record.eventId
    || row.workflow !== (record.workflow ?? null) || row.run_id !== (record.scope.kind === "run" ? record.scope.runId : null)
    || row.worker_id !== (record.scope.kind === "worker" ? record.scope.workerId : null)
    || row.retention_date !== record.retentionDate || row.recorded_at !== record.recordedAt || row.occurred_at !== record.occurredAt
    || (row.pinned === 1) !== record.payload.event.pinned) {
    throw new Error("debug-event-column-mismatch");
  }
  return record;
}

/** Migration 39 moves debug entries out of the timeline into their own table; the change log does not capture it. */
export const DEBUG_EVENTS_MIGRATION = deepFreeze({ version: 39, statements: [
  `CREATE TABLE debug_events (
    cursor INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
    workflow TEXT, run_id TEXT, worker_id TEXT, occurred_at TEXT NOT NULL, recorded_at TEXT NOT NULL,
    retention_date TEXT NOT NULL, pinned INTEGER NOT NULL CHECK(pinned IN (0,1)),
    payload_json TEXT NOT NULL CHECK(json_valid(payload_json))
  ) STRICT`,
  "CREATE INDEX debug_events_retention_idx ON debug_events(retention_date) WHERE pinned=0",
  `CREATE TRIGGER debug_events_immutable BEFORE UPDATE ON debug_events
    BEGIN SELECT RAISE(ABORT,'debug-event-immutable'); END`,
  `INSERT INTO debug_events(cursor,id,workflow,run_id,worker_id,occurred_at,recorded_at,retention_date,pinned,payload_json)
    SELECT cursor,id,workflow,run_id,worker_id,occurred_at,recorded_at,retention_date,retention_class='protected',payload_json
    FROM timeline_events WHERE kind='debug' ORDER BY cursor`,
  // Debug cursors continue past every cursor the timeline issued, so a diagnostics cursor from before the upgrade still resumes.
  `UPDATE sqlite_sequence SET seq=(SELECT MAX(seq) FROM sqlite_sequence WHERE name IN ('timeline_events','debug_events')) WHERE name='debug_events'`,
  `INSERT INTO sqlite_sequence(name,seq) SELECT 'debug_events',seq FROM sqlite_sequence
    WHERE name='timeline_events' AND NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name='debug_events')`,
  // The moved rows leave no change entries: no reader re-validates a row that is no longer in the timeline.
  "DELETE FROM authority_changes WHERE table_name='timeline_events' AND json_extract(row_key,'$[0]') IN (SELECT cursor FROM debug_events)",
  "DROP TRIGGER timeline_events_change_delete",
  "DROP TRIGGER timeline_events_confirmed_retained",
  "DELETE FROM timeline_events WHERE kind='debug'",
  // Same text as the original trigger, so an upgraded store's schema matches a fresh one.
  `CREATE TRIGGER timeline_events_confirmed_retained BEFORE DELETE ON timeline_events
WHEN OLD.retention_class IN ('confirmed-operation','protected') AND NOT EXISTS(SELECT 1 FROM deleted_runs WHERE run_id=OLD.run_id)
BEGIN SELECT RAISE(ABORT,'protected-timeline-owner-deletion-required'); END`,
  ...changeLogTriggers("timeline_events").filter(trigger => trigger.startsWith("CREATE TRIGGER timeline_events_change_delete ")),
] });

function timelineRetentionClass(record: z.infer<typeof TimelineAppendSchema>) {
  if (record.payload.kind === "recovery-activity-started" || record.payload.kind === "recovery-activity-ended") return "protected";
  if (record.payload.kind === "operation-confirmed") return "confirmed-operation";
  if (record.payload.kind === "span" && record.payload.event.t === "span.ended" && ["failed", "interrupted"].includes(record.payload.event.outcome)) return "protected";
  if (record.payload.kind === "checkpoint-recorded" || record.payload.kind === "checkpoint-replayed"
    || (record.payload.kind === "note" && record.payload.note.confirmedAction?.kind === "fact")) return "protected";
  return "ordinary";
}

function timelineBaseColumns(record: z.infer<typeof TimelineAppendSchema>) {
  const operation = record.payload.kind === "operation-confirmed" ? record.payload.facts : undefined;
  return { id: record.eventId, workflow: record.workflow ?? null,
    run_id: record.scope.kind === "run" ? record.scope.runId : null,
    worker_id: record.scope.kind === "worker" ? record.scope.workerId : null,
    kind: record.payload.kind === "span" ? record.payload.event.t : record.payload.kind,
    occurred_at: record.occurredAt, recorded_at: record.recordedAt, retention_date: record.retentionDate,
    retention_class: timelineRetentionClass(record), operation_id: operation?.writeIntentId ?? null,
    operation_generation: operation?.intentGeneration ?? null, confirmed_at: operation?.confirmedAt ?? null, system: operation?.system ?? null };
}

export function timelineEventColumns(record: TimelineEventRecord) {
  return { ...timelineBaseColumns(record), cursor: record.cursor, payload_json: canonicalJsonStringify(record) };
}

function unpinnedDebugBytes(database: DatabaseSync, prepare: (sql: string) => StatementSync): number {
  database.exec(`CREATE TEMP TABLE IF NOT EXISTS debug_event_bytes(
    id INTEGER PRIMARY KEY CHECK(id=1), bytes INTEGER NOT NULL, data_version INTEGER NOT NULL);
    CREATE TEMP TRIGGER IF NOT EXISTS debug_event_bytes_insert AFTER INSERT ON main.debug_events WHEN NEW.pinned=0 BEGIN
      UPDATE debug_event_bytes SET bytes=bytes+length(CAST(NEW.payload_json AS BLOB)) WHERE id=1; END;
    CREATE TEMP TRIGGER IF NOT EXISTS debug_event_bytes_delete AFTER DELETE ON main.debug_events WHEN OLD.pinned=0 BEGIN
      UPDATE debug_event_bytes SET bytes=bytes-length(CAST(OLD.payload_json AS BLOB)) WHERE id=1; END;`);
  const version = DataVersionSchema.parse(prepare("PRAGMA data_version").get()).data_version;
  const row = DiagnosticBytesRowSchema.parse(prepare("SELECT bytes,data_version FROM debug_event_bytes WHERE id=1").get());
  if (row !== undefined && row.data_version === version) return DiagnosticBytesSchema.parse(row.bytes);
  const bytes = DiagnosticBytesSumSchema.parse(prepare(
    "SELECT COALESCE(SUM(length(CAST(payload_json AS BLOB))),0) AS bytes FROM debug_events WHERE pinned=0").get()).bytes;
  prepare("INSERT INTO debug_event_bytes(id,bytes,data_version) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET bytes=excluded.bytes,data_version=excluded.data_version").run(bytes,version);
  return bytes;
}

const sequenceCursor = (table: "timeline_events" | "debug_events") =>
  `COALESCE((SELECT seq FROM sqlite_sequence WHERE name='${table}'),0)`;

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
  const timelineRow = (id: string) => {
    const row = prepare("SELECT * FROM timeline_events WHERE id = ?").get(id);
    return row === undefined ? undefined : timelineEventFromRow(row);
  };
  const debugRow = (id: string) => {
    const row = prepare("SELECT * FROM debug_events WHERE id = ?").get(id);
    return row === undefined ? undefined : debugEventFromRow(row);
  };
  const get = (eventId: string): TimelineEventRecord | undefined => ports.read(() => {
    const id = EventIdSchema.parse(eventId);
    return timelineRow(id) ?? debugRow(id);
  });
  const pageRequest = (input: z.input<typeof TimelinePageRequestSchema>) => {
    const request = TimelinePageRequestSchema.parse(input);
    const predicates = ["cursor > ?"];
    const bindings: (string | number)[] = [request.after];
    if (request.through !== undefined) { predicates.push("cursor <= ?"); bindings.push(request.through); }
    if (request.runId !== undefined) { predicates.push("run_id = ?"); bindings.push(request.runId); }
    if (request.workflow !== undefined) { predicates.push("workflow = ?"); bindings.push(request.workflow); }
    return { request, predicates, bindings };
  };
  return Object.freeze({
    withReadSnapshot: <T>(read: () => T): T => ports.read(read),
    get,
    append(input: unknown) {
      const parsed = TimelineAppendSchema.safeParse(input);
      if (!parsed.success) throw new Error("timeline-event-invalid");
      const record = parsed.data;
      if (record.payload.kind === "debug") ports.assertDebugAppend?.();
      const content = canonicalJsonStringify(record);
      if (Buffer.byteLength(content, "utf8") > 256 * 1024) throw new Error("timeline-event-size-exceeded");
      const result = ports.mutate<ReturnType<TimelineRepository["append"]> | "budget-full">(() => {
        // One event ID spans both tables; a predecessor store written offline has no debug table yet.
        const hasDebugTable = prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='debug_events'").get() !== undefined;
        const existing = timelineRow(record.eventId) ?? (hasDebugTable ? debugRow(record.eventId) : undefined);
        if (existing !== undefined) {
          if (timelineAppendContent(existing) !== content) throw new Error("timeline-event-identity-conflict");
          ports.assertOwner(existing, false);
          return { result: { state: "existing" as const, record: existing }, changes: 0 };
        }
        ports.assertOwner(record, true);
        // SQLite assigns both the cursor and its authenticated JSON mirror from
        // its AUTOINCREMENT sequence under the same owning write transaction.
        if (record.payload.kind === "debug") {
          if (!record.payload.event.pinned) {
            const bytes = unpinnedDebugBytes(database, prepare);
            const next = HighWaterMarkSchema.parse(prepare(`SELECT ${sequenceCursor("debug_events")}+1 AS cursor`).get());
            const recordBytes = Buffer.byteLength(canonicalJsonStringify({ ...record, cursor: next.cursor }), "utf8");
            if (bytes + recordBytes > 250 * 1024 * 1024) return { result: "budget-full", changes: 0 };
          }
          const raw = prepare(`
            INSERT INTO debug_events(id,workflow,run_id,worker_id,occurred_at,recorded_at,retention_date,pinned,payload_json)
            VALUES (?,?,?,?,?,?,?,?,json_set(?,'$.cursor',${sequenceCursor("debug_events")}+1)) RETURNING *
          `).get(record.eventId,record.workflow ?? null,
            record.scope.kind === "run" ? record.scope.runId : null,record.scope.kind === "worker" ? record.scope.workerId : null,
            record.occurredAt,record.recordedAt,record.retentionDate,record.payload.event.pinned ? 1 : 0,content);
          const stored = debugEventFromRow(raw);
          ports.publishCommitted?.({ kind: "append", row: stored });
          // Debug rows are no authority change: no generation bump, search invalidation or run publication.
          return { result: { state: "inserted" as const, record: stored }, changes: 0 };
        }
        const raw = prepare(`
          INSERT INTO timeline_events(id,workflow,run_id,worker_id,kind,occurred_at,recorded_at,retention_date,
            retention_class,operation_id,operation_generation,confirmed_at,system,payload_json)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,json_set(?,'$.cursor',${sequenceCursor("timeline_events")}+1)) RETURNING *
        `).get(...Object.values(timelineBaseColumns(record)), content);
        const stored = timelineEventFromRow(raw);
        if (stored.payload.kind !== "operation-confirmed") ports.publishCommitted?.({ kind: "append", row: stored });
        return { result: { state: "inserted" as const, record: stored }, changes: 1 };
      });
      // Keep the transaction's refreshed byte count when the event itself cannot fit.
      if (result === "budget-full") throw new TimelineDiagnosticBudgetError();
      return result;
    },
    page(input: z.input<typeof TimelinePageRequestSchema>) {
      const { request, predicates, bindings } = pageRequest(input);
      return ports.read(() => {
        if (request.spanTypes !== undefined) {
          predicates.push(`kind IN (${request.spanTypes.map(() => "?").join(",")})`);
          bindings.push(...request.spanTypes);
        }
        const rows = prepare(`SELECT * FROM timeline_events WHERE ${predicates.join(" AND ")} ORDER BY cursor LIMIT ?`)
          .all(...bindings, request.limit);
        return Object.freeze(rows.map(timelineEventFromRow));
      });
    },
    debugPage(input: z.input<typeof TimelinePageRequestSchema>) {
      const { request, predicates, bindings } = pageRequest(input);
      if (request.spanTypes !== undefined) throw new Error("debug-page-span-types-unsupported");
      return ports.read(() => Object.freeze(prepare(`SELECT * FROM debug_events WHERE ${predicates.join(" AND ")} ORDER BY cursor LIMIT ?`)
        .all(...bindings, request.limit).map(debugEventFromRow)));
    },
    debugHighWaterMark() {
      return ports.read(() => HighWaterMarkSchema.parse(prepare(`SELECT ${sequenceCursor("debug_events")} AS cursor`).get()).cursor);
    },
    confirmedActionHeads(input: Parameters<TimelineRepository["confirmedActionHeads"]>[0]) {
      const request = z.strictObject({ workerStreamIds: z.array(z.string().min(1)).max(200), before: z.number().int().positive() }).parse(input);
      if (request.workerStreamIds.length === 0) return [];
      return ports.read(() => {
        const statement = prepare(`SELECT * FROM timeline_events
          WHERE json_extract(payload_json,'$.payload.note.confirmedAction.workerStreamId')=? AND cursor<?
          ORDER BY cursor DESC LIMIT 1`);
        const rows = [...new Set(request.workerStreamIds)].flatMap(stream => {
          const row = statement.get(stream, request.before);
          return row === undefined ? [] : [row];
        });
        return Object.freeze(rows.map(timelineEventFromRow));
      });
    },
    lastWorkerClaim(workerId: string) {
      return ports.read(() => {
        const row = prepare(`SELECT * FROM timeline_events WHERE kind='run.claimed'
          AND json_extract(payload_json,'$.payload.event.workerId')=? ORDER BY cursor DESC LIMIT 1`).get(z.string().min(1).parse(workerId));
        return row === undefined ? undefined : timelineEventFromRow(row);
      });
    },
    highWaterMark() {
      return ports.read(() => HighWaterMarkSchema.parse(prepare(`SELECT ${sequenceCursor("timeline_events")} AS cursor`).get()).cursor
        + (ports.cursorOffset?.() ?? 0));
    },
    pruneBefore(retentionDate: string) {
      const cutoff = z.iso.date().parse(retentionDate);
      return ports.mutate(() => {
        // Pair adjacent span boundaries at their native identity before deleting either side.
        const result = prepare(
          `WITH span_peers AS MATERIALIZED (
            SELECT cursor, CASE WHEN kind = 'span.ended'
              THEN lag(kind = 'span.ended' OR expires, 1, 1) OVER span
              ELSE lead(kind = 'span.ended' AND expires, 1, 0) OVER span
              END AS peer_expires
            FROM (
              SELECT cursor, kind, run_id, worker_id, workflow, payload_json,
                retention_class = 'ordinary' AND retention_date < ?1 AS expires
              FROM timeline_events WHERE kind IN ('span.started', 'span.ended', 'run.claimed')
            )
            WINDOW span AS (PARTITION BY run_id, worker_id, workflow,
              CASE WHEN kind = 'run.claimed' THEN 'run' ELSE json_extract(payload_json,'$.payload.event.kind') END,
              json_extract(payload_json,'$.payload.event.pid'),
              json_extract(payload_json,'$.payload.event.attempt'),
              json_extract(payload_json,'$.payload.event.traceId'),
              json_extract(payload_json,'$.payload.event.spanPath'),
              json_extract(payload_json,'$.payload.event.workerId'),
              json_extract(payload_json,'$.payload.event.claimGeneration')
              ORDER BY cursor)
          )
          DELETE FROM timeline_events WHERE retention_class = 'ordinary' AND retention_date < ?1
            AND kind <> 'gate.resolved'
            AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.id=timeline_events.run_id AND r.state<>'terminal')
            AND cursor NOT IN (SELECT cursor FROM span_peers WHERE NOT peer_expires)
            AND NOT EXISTS (SELECT 1 FROM run_search AS search_row JOIN runs AS run_owner ON run_owner.id=search_row.run_id,
              json_each(search_row.actor_source_json) actor_source
              WHERE search_row.run_id=timeline_events.run_id
                AND json_extract(actor_source.value,'$.kind')='queued'
                AND json_extract(actor_source.value,'$.event.eventId')=timeline_events.id)
            RETURNING cursor`,
        ).all(cutoff);
        const changes = result.length;
        if (changes > 0 && ports.publishCommitted !== undefined) {
          const cursors = result.map(row => CursorRowSchema.parse(row).cursor);
          ports.publishCommitted({ kind: "remove", table: "timeline_events", cursors });
        }
        return { result: changes, changes };
      });
    },
    pruneDebugBefore(retentionDate: string) {
      const cutoff = z.iso.date().parse(retentionDate);
      return ports.mutate(() => {
        // An SSE start and its settle expire together, when the later of the two does.
        const result = prepare(
          `WITH sse_expiry AS MATERIALIZED (
            SELECT cursor, min(pinned = 0) OVER stream AND max(retention_date) OVER stream < ?1 AS expires
            FROM debug_events WHERE json_extract(payload_json,'$.payload.event.category') = 'sse'
              AND json_extract(payload_json,'$.payload.event.phase') IN ('started', 'settled')
            WINDOW stream AS (PARTITION BY json_extract(payload_json,'$.scope'),
              json_extract(payload_json,'$.payload.event.correlationId'))
          )
          DELETE FROM debug_events WHERE pinned = 0 AND retention_date < ?1
            AND COALESCE((SELECT expires FROM sse_expiry WHERE cursor = debug_events.cursor), 1)
            AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.id=debug_events.run_id AND r.state<>'terminal')
            RETURNING cursor`,
        ).all(cutoff);
        if (result.length > 0 && ports.publishCommitted !== undefined) {
          const cursors = result.map(row => CursorRowSchema.parse(row).cursor);
          ports.publishCommitted({ kind: "remove", table: "debug_events", cursors });
        }
        return { result: result.length, changes: 0 };
      });
    },
  });
}
