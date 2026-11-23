import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { createDebugEventWriter } from "../../../../src/backend/logs/debug-events.js";
import type { TimelineRepository } from "../../../../src/models/events/timeline.js";
import type { Clock } from "../../../../src/rules/time/clock.js";

export function fillDiagnosticBudget(Database: typeof DatabaseSync, path: string, repository: TimelineRepository, clock: Clock): void {
  const { record } = createDebugEventWriter({ repository, clock, build: "test" })
    .emit({ category: "boot", phase: "settled", area: "storage", correlationId: randomUUID(), message: "m".repeat(60_000) });
  const raw = new Database(path);
  try {
    // Each copy has its own valid ID and cursor in both the columns and the payload.
    raw.prepare(`WITH RECURSIVE copies(cursor) AS (VALUES(?+1) UNION ALL SELECT cursor+1 FROM copies WHERE cursor<?+4399)
      INSERT INTO debug_events(cursor,id,workflow,run_id,worker_id,occurred_at,recorded_at,retention_date,pinned,payload_json)
      SELECT copies.cursor,printf('00000000-0000-4000-8000-%012x', copies.cursor),workflow,run_id,worker_id,occurred_at,recorded_at,
        retention_date,pinned,json_set(payload_json,'$.cursor',copies.cursor,
          '$.eventId',printf('00000000-0000-4000-8000-%012x', copies.cursor))
      FROM copies JOIN debug_events original ON original.cursor=?`).run(record.cursor, record.cursor, record.cursor);
    const bytes = raw.prepare("SELECT sum(length(CAST(payload_json AS BLOB))) AS bytes FROM debug_events WHERE pinned=0").get()?.bytes;
    assert.ok(typeof bytes === "number" && bytes > 250 * 1024 * 1024);
  } finally { raw.close(); }
}
