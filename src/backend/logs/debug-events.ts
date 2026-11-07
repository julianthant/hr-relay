import { sanitizeDebugText } from "../../rules/redaction/redaction.js";
import { deriveStableUuid } from "../../rules/identity/identifiers.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { randomUUID } from "node:crypto";
import { DebugEventSchema, type TimelineRepository, type TimelineAppend } from "../../models/events/timeline.js";
import type { Clock } from "../../rules/time/clock.js";
import { localDatePart } from "../../rules/time/clock.js";
import { mirrorDebugEvent } from "../storage/events/local-debug-log.js";
import { serializeErrorCauses } from "../../models/failures/error-origins.js";

export function createDebugEventWriter(deps: { repository: TimelineRepository; clock: Clock; build: string;
  development?: boolean; writeStderr?: (line: string) => void }) {
  return Object.freeze({
    emit(input: unknown, scope: TimelineAppend["scope"] = { kind: "transport", connectionId: "local" }, workflow?: TimelineAppend["workflow"]) {
      if (scope.kind === "run" && workflow === undefined) throw new Error("debug-run-workflow-required");
      const fields = Object.fromEntries(Object.entries(input as Record<string, unknown>).filter(([, value]) => value !== undefined));
      const event = DebugEventSchema.parse({ ...fields, build: deps.build, pid: process.pid });
      for (const identity of [event.correlationId, event.cursor, scope.kind === "client" ? scope.clientId : scope.kind === "transport" ? scope.connectionId : undefined]) {
        if (identity !== undefined && sanitizeDebugText(identity) !== identity) throw new Error("debug-identity-contains-credential-material");
      }
      const safe = DebugEventSchema.parse(Object.fromEntries(Object.entries(event).map(([key, value]) => {
        if (typeof value !== "string" || key === "correlationId" || key === "cursor") return [key, value];
        const text = sanitizeDebugText(value);
        return [key, key === "route" ? text.split(/[?#]/u)[0] : text];
      })));
      const limits = { session: 32, duo: 16, worker: 32, http: 64, sse: 8, client: 64, boot: 64 };
      if (Buffer.byteLength(JSON.stringify(safe)) > limits[safe.category] * 1024) throw new Error("debug-event-size-exceeded");
      const now = deps.clock.now();
      const eventId = safe.category === "client" ? deriveStableUuid("dashboard-report", safe.correlationId) : randomUUID();
      const existing = safe.category === "client" ? deps.repository.get(eventId) : undefined;
      if (existing !== undefined) {
        if (existing.workflow !== workflow || canonicalJsonStringify(existing.scope) !== canonicalJsonStringify(scope) || canonicalJsonStringify(existing.payload) !== canonicalJsonStringify({ kind: "debug", event: safe })) throw new Error("debug-report-identity-conflict");
        return { state: "existing" as const, record: existing };
      }
      const result = deps.repository.append({ schemaVersion: 1, eventId, scope,
        ...(workflow === undefined ? {} : { workflow }),
        occurredAt: now.toISOString(), recordedAt: now.toISOString(), retentionDate: localDatePart(now),
        payload: { kind: "debug", event: safe }, source: { kind: "native" } });
      if (result.state === "inserted") mirrorDebugEvent({ ...result.record, event: safe }, deps);
      return result;
    },
  });
}

/** Emits one fault event plus one closed cause row per cause (its closed reason), sharing its correlation; stderr gets the same value-free rows. */
export function emitFaultWithCauses(debugEvents: Readonly<{ emit(input: unknown): unknown }>, faultSink: ((line: string) => void) | undefined, error: unknown,
  fault: Readonly<{ category: "worker" | "http"; area: string; code: string; reason: string }>): void {
  const correlationId = randomUUID(), causes = serializeErrorCauses(error);
  const event = { ...fault, phase: "failed", correlationId };
  debugEvents.emit(event);
  for (const cause of causes) debugEvents.emit({ category: fault.category, phase: "failed", correlationId, area: fault.area,
    reason: cause.reason, code: cause.code, message: cause.name, stack: cause.stack });
  faultSink?.(JSON.stringify({ ...event, causes: causes.map(({ name, code, reason }) => ({ name, code, reason })) }));
}
