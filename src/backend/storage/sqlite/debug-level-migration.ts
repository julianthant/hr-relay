import { z } from "zod";
import { DebugEventSchema, TimelineEventRecordSchema } from "../../../models/events/timeline.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";

export const DEBUG_LEVEL_MIGRATION = { version: 18, statements: [
  "DROP TRIGGER timeline_events_immutable",
  `UPDATE timeline_events SET payload_json=json_set(payload_json,'$.payload.event.level',
    CASE json_extract(payload_json,'$.payload.event.phase')
      WHEN 'failed' THEN 'error' WHEN 'expired' THEN 'warn' WHEN 'reset' THEN 'warn' ELSE 'info' END)
    WHERE kind='debug'`,
  `CREATE TRIGGER timeline_events_immutable BEFORE UPDATE ON timeline_events
    BEGIN SELECT RAISE(ABORT,'timeline-history-immutable'); END`,
] };

export function upgradeDebugEventLevel(input: unknown) {
  const document = z.object({ payload: z.object({ kind: z.literal("debug"), event: z.unknown() }) }).loose()
    .parse(input);
  const event = DebugEventSchema.omit({ level: true, area: true, reason: true }).parse(document.payload.event);
  document.payload.event = { ...event, level: event.phase === "failed" ? "error" : event.phase === "expired" || event.phase === "reset" ? "warn" : "info" };
  return document;
}

export function upgradeDebugLevelRow(input: unknown): Record<string, unknown> {
  const row = z.record(z.string(), z.unknown()).parse(input);
  if (row.kind !== "debug") return row;
  const document = upgradeDebugEventLevel(JSON.parse(z.string().parse(row.payload_json)));
  return { ...row, payload_json: canonicalJsonStringify(TimelineEventRecordSchema.parse(document)) };
}
