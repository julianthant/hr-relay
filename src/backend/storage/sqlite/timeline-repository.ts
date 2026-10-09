import type { DatabaseSync } from "node:sqlite";
import { SpanEventWireSchema } from "../../../models/events/types.js";
import { z } from "zod";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { TimelineAppendSchema, TimelineEventRecordSchema, TimelinePageRequestSchema,
  timelineAppendContent, type TimelineEventRecord, type TimelineRepository } from "../../../models/events/timeline.js";

export const TIMELINE_EVENT_TABLE_DDL = `
  CREATE TABLE timeline_events (
    cursor INTEGER PRIMARY KEY AUTOINCREMENT,
    record_key TEXT NOT NULL UNIQUE,
    workflow TEXT NOT NULL,
    run_id TEXT REFERENCES workflow_runs(record_key) ON DELETE RESTRICT,
    worker_id TEXT,
    retention_date TEXT NOT NULL,
    retention_class TEXT NOT NULL CHECK (retention_class IN ('ordinary', 'confirmed-operation')),
    record_json TEXT NOT NULL CHECK (json_valid(record_json)),
    created_at TEXT NOT NULL,
    CHECK ((run_id IS NULL) <> (worker_id IS NULL)),
    CHECK (cursor IS json_extract(record_json, '$.cursor')),
    CHECK (record_key IS json_extract(record_json, '$.eventId')),
    CHECK (workflow IS json_extract(record_json, '$.workflow')),
    CHECK (run_id IS json_extract(record_json, '$.scope.runId')),
    CHECK (worker_id IS json_extract(record_json, '$.scope.workerId')),
    CHECK (retention_date IS json_extract(record_json, '$.retentionDate')),
    CHECK (created_at IS json_extract(record_json, '$.recordedAt')),
    CHECK ((retention_class = 'confirmed-operation') = (json_extract(record_json, '$.payload.kind') = 'operation-confirmed'))
  ) STRICT
`;

export const TIMELINE_EVENT_INDEX_DDL = [
  "CREATE INDEX timeline_events_run_cursor_idx ON timeline_events(run_id, cursor)",
  "CREATE INDEX timeline_events_workflow_cursor_idx ON timeline_events(workflow, cursor)",
  "CREATE INDEX timeline_events_retention_idx ON timeline_events(retention_class, retention_date)",
  `CREATE UNIQUE INDEX timeline_events_confirmed_operation_idx ON timeline_events(
    json_extract(record_json, '$.payload.facts.writeIntentId'),
    json_extract(record_json, '$.payload.facts.intentGeneration')
  ) WHERE retention_class = 'confirmed-operation'`,
  `CREATE TRIGGER timeline_events_never_updated BEFORE UPDATE ON timeline_events
    BEGIN SELECT RAISE(ABORT, 'timeline event history is immutable'); END`,
  `CREATE TRIGGER timeline_events_confirmed_retained BEFORE DELETE ON timeline_events
    WHEN OLD.retention_class = 'confirmed-operation'
      AND NOT EXISTS (SELECT 1 FROM deleted_runs WHERE record_key = OLD.run_id)
    BEGIN SELECT RAISE(ABORT, 'confirmed timeline history requires owner deletion'); END`,
] as const;

interface TimelineRepositoryPorts {
  database: DatabaseSync;
  /** Must use the owning connection's authority transaction and generation accounting. */
  mutate<T>(work: () => Readonly<{ result: T; changes: number }>): T;
  read<T>(work: () => T): T;
  assertOwner(record: TimelineEventRecord | z.infer<typeof TimelineAppendSchema>, appending: boolean): void;
}

const RowSchema = z.strictObject({
  cursor: z.number().int().positive(), record_key: z.string(), workflow: z.string(),
  run_id: z.string().nullable(), worker_id: z.string().nullable(), retention_date: z.string(),
  retention_class: z.enum(["ordinary", "confirmed-operation"]), record_json: z.string(), created_at: z.string(),
});

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

/** Mirrors are checked on reads too, including databases whose checks were bypassed externally. */
export function timelineEventFromRow(raw: unknown): TimelineEventRecord {
  const parsedRow = RowSchema.safeParse(raw);
  if (!parsedRow.success) throw new TimelineRecordError("timeline-record-invalid");
  const row = parsedRow.data;
  let value: unknown;
  try { value = JSON.parse(row.record_json); } catch { throw new TimelineRecordError("timeline-record-invalid"); }
  const parsedRecord = TimelineEventRecordSchema.safeParse(value);
  if (!parsedRecord.success) throw invalidTimelineRecord(value);
  const record = parsedRecord.data;
  if (row.cursor !== record.cursor || row.record_key !== record.eventId || row.workflow !== record.workflow
    || row.run_id !== (record.scope.kind === "run" ? record.scope.runId : null)
    || row.worker_id !== (record.scope.kind === "worker" ? record.scope.workerId : null)
    || row.retention_date !== record.retentionDate || row.created_at !== record.recordedAt
    || (row.retention_class === "confirmed-operation") !== (record.payload.kind === "operation-confirmed")) {
    throw new Error("timeline-event-column-mismatch");
  }
  return record;
}

export function createTimelineRepository(ports: TimelineRepositoryPorts): TimelineRepository {
  const { database } = ports;
  const get = (eventId: string): TimelineEventRecord | undefined => ports.read(() => {
    const row = database.prepare("SELECT * FROM timeline_events WHERE record_key = ?").get(z.uuid().parse(eventId));
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
      return ports.mutate<ReturnType<TimelineRepository["append"]>>(() => {
        const existing = get(record.eventId);
        if (existing !== undefined) {
          if (timelineAppendContent(existing) !== content) throw new Error("timeline-event-identity-conflict");
          ports.assertOwner(existing, false);
          return { result: { state: "existing" as const, record: existing }, changes: 0 };
        }
        ports.assertOwner(record, true);
        // SQLite assigns both the cursor and its authenticated JSON mirror from
        // its AUTOINCREMENT sequence under the same owning write transaction.
        const raw = database.prepare(`
          INSERT INTO timeline_events(record_key, workflow, run_id, worker_id, retention_date,
            retention_class, record_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, json_set(?, '$.cursor',
            COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'timeline_events'), 0) + 1), ?)
          RETURNING *
        `).get(record.eventId, record.workflow,
          record.scope.kind === "run" ? record.scope.runId : null,
          record.scope.kind === "worker" ? record.scope.workerId : null,
          record.retentionDate, record.payload.kind === "operation-confirmed" ? "confirmed-operation" : "ordinary",
          content, record.recordedAt);
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
        const rows = database.prepare(`SELECT * FROM timeline_events WHERE ${predicates.join(" AND ")} ORDER BY cursor LIMIT ?`)
          .all(...bindings, request.limit);
        return Object.freeze(rows.map(timelineEventFromRow));
      });
    },
    highWaterMark() {
      return ports.read(() => z.strictObject({ cursor: z.number().int().nonnegative() }).parse(database.prepare(
        "SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'timeline_events'), 0) AS cursor",
      ).get()).cursor);
    },
    pruneBefore(retentionDate: string) {
      const cutoff = z.iso.date().parse(retentionDate);
      return ports.mutate(() => {
        const result = database.prepare(
          "DELETE FROM timeline_events WHERE retention_class = 'ordinary' AND retention_date < ?",
        ).run(cutoff);
        const changes = z.number().int().nonnegative().parse(Number(result.changes));
        return { result: changes, changes };
      });
    },
  });
}
