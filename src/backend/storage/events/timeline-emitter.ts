import { deriveStableUuid } from "../../../rules/identity/identifiers.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sanitizeDebugText } from "../../logs/debug-events.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Clock } from "../../../rules/time/clock.js";
import { localDatePart } from "../../../rules/time/clock.js";
import { SpanEventWireSchema } from "../../../models/events/types.js";
import type { TimelineRepository } from "../../../models/events/timeline.js";

export interface TimelineEmitter { emit(event: unknown): void; }

/** Synchronous append joins the authority connection's enclosing transaction. */
export function createTimelineEmitter(deps: Readonly<{
  repository: TimelineRepository;
  clock: Clock;
  pid?: number;
  uuid?: () => string;
}>): Readonly<TimelineEmitter> {
  const pid = z.number().int().positive().parse(deps.pid ?? process.pid);
  return Object.freeze({
    emit(input: unknown): void {
      const object = z.record(z.string(), z.unknown()).safeParse(input);
      if (!object.success) throw new Error("timeline-span-invalid");
      const parsed = SpanEventWireSchema.safeParse({ ...Object.fromEntries(Object.entries(object.data).filter(([, value]) => value !== undefined)), pid });
      if (!parsed.success) throw new Error("timeline-span-invalid");
      const raw = parsed.data;
      const event = raw.t === "data.observed" ? { ...raw, points: raw.points.map(point => ({ ...point,
        values: point.values.map(value => value.classification === "secret" || value.classification === "credential-file"
          ? { key: value.key, state: "redacted" as const, classification: value.classification, transform: "drop" as const } : value) })) }
        : "errorSummary" in raw && raw.errorSummary !== undefined ? { ...raw, errorSummary: sanitizeDebugText(raw.errorSummary) } : raw;
      const now = deps.clock.now();
      const singleton = event.t === "run.queued" || event.t === "span.started" || event.t === "span.ended";
      const scope = "runId" in event ? { kind: "run" as const, runId: event.runId } : { kind: "worker" as const, workerId: event.workerId };
      const result = deps.repository.append({
        schemaVersion: 1,
        eventId: singleton ? deriveStableUuid("timeline-span-singleton", canonicalJsonStringify({ scope, attempt: "attempt" in event ? event.attempt : null, spanPath: event.spanPath, type: event.t,
          ...(event.t === "run.queued" ? {} : { pid: event.pid }) })) : (deps.uuid ?? randomUUID)(),
        workflow: event.workflow,
        scope,
        occurredAt: event.ts,
        recordedAt: now.toISOString(),
        retentionDate: localDatePart(now),
        payload: { kind: "span", event },
        source: { kind: "native" },
      });
      if (singleton && result.state === "existing") throw new Error(event.t === "run.queued" ? "run.queued write-once" : event.t === "span.started" ? "span opens exactly once" : "span closes exactly once");
    },
  });
}
