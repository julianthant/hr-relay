import { sanitizeDebugText } from "../../rules/redaction/redaction.js";
import { deriveStableUuid } from "../../rules/identity/identifiers.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { randomUUID } from "node:crypto";
import { DebugEventSchema, type TimelineRepository, type TimelineAppend } from "../../models/events/timeline.js";
import type { Clock } from "../../rules/time/clock.js";
import { localDatePart } from "../../rules/time/clock.js";

export function createDebugEventWriter(deps: { repository: TimelineRepository; clock: Clock; build: string }) {
  return Object.freeze({
    emit(input: unknown, scope: TimelineAppend["scope"] = { kind: "transport", connectionId: "local" }) {
      const event = DebugEventSchema.parse({ ...Object.fromEntries(Object.entries(input as Record<string, unknown>).filter(([, value]) => value !== undefined)), build: deps.build, pid: process.pid });
      const safe = { ...event, ...(event.message === undefined ? {} : { message: sanitizeDebugText(event.message) }),
        ...(event.stack === undefined ? {} : { stack: sanitizeDebugText(event.stack) }) };
      const limits = { session: 32, duo: 16, worker: 32, http: 64, sse: 8, client: 64, boot: 64 };
      if (Buffer.byteLength(JSON.stringify(safe)) > limits[safe.category] * 1024) throw new Error("debug-event-size-exceeded");
      const now = deps.clock.now();
      const eventId = safe.category === "client" ? deriveStableUuid("dashboard-report", safe.correlationId) : randomUUID();
      const existing = safe.category === "client" ? deps.repository.get(eventId) : undefined;
      if (existing !== undefined) {
        if (canonicalJsonStringify(existing.scope) !== canonicalJsonStringify(scope) || canonicalJsonStringify(existing.payload) !== canonicalJsonStringify({ kind: "debug", event: safe })) throw new Error("debug-report-identity-conflict");
        return { state: "existing" as const, record: existing };
      }
      return deps.repository.append({ schemaVersion: 1, eventId, scope,
        occurredAt: now.toISOString(), recordedAt: now.toISOString(), retentionDate: localDatePart(now),
        payload: { kind: "debug", event: safe }, source: { kind: "native" } });
    },
  });
}
