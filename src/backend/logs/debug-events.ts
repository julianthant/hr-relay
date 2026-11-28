import { sanitizeDebugText } from "../../rules/redaction/redaction.js";
import { deriveStableUuid } from "../../rules/identity/identifiers.js";
import { IsoInstantSchema } from "../../rules/identity/ids.js";
import { randomUUID } from "node:crypto";
import { DebugEventSchema, TimelineDiagnosticBudgetError, type TimelineRepository, type TimelineAppend } from "../../models/events/timeline.js";
import type { Clock } from "../../rules/time/clock.js";
import { localDatePart } from "../../rules/time/clock.js";
import { mirrorDebugEvent } from "../storage/events/local-debug-log.js";
import { assertSameClientDebugReport, type DebugTimelineAppend } from "../storage/events/log-mutations.js";
import { serializeErrorCauses } from "../../models/failures/error-origins.js";

/** Optional producers can skip a full diagnostic budget. Required writers keep their durable receipt contract. */
export function emitOptionalDiagnostic(emit: () => unknown, onQueuedBudgetFull?: () => void): "emitted" | "budget-full" {
  try {
    const result = emit();
    if (onQueuedBudgetFull !== undefined && result instanceof Promise) {
      void result.catch((error: unknown) => { if (error instanceof TimelineDiagnosticBudgetError) onQueuedBudgetFull(); });
    }
    return "emitted";
  }
  catch (error) {
    if (error instanceof TimelineDiagnosticBudgetError) return "budget-full";
    throw error;
  }
}

export type DebugEventEmitter<Result = unknown> = Readonly<{
  emit(input: unknown, scope?: TimelineAppend["scope"], workflow?: TimelineAppend["workflow"]): Result;
}>;
type DebugEventWriterOptions = { clock: Clock; build: string; development?: boolean; writeStderr?: (line: string) => void };
type QueuedDebugEvents = { enqueue(record: DebugTimelineAppend): Promise<"inserted" | "existing"> };
type StoredDebugEvents = { repository: Pick<TimelineRepository, "append" | "get"> };

export function createDebugEventWriter(deps: DebugEventWriterOptions & QueuedDebugEvents): DebugEventEmitter<Promise<void>>;
export function createDebugEventWriter(deps: DebugEventWriterOptions & StoredDebugEvents): DebugEventEmitter<ReturnType<TimelineRepository["append"]>>;
export function createDebugEventWriter(deps: DebugEventWriterOptions & (QueuedDebugEvents | StoredDebugEvents)): DebugEventEmitter {
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
      const at = IsoInstantSchema.parse(now.toISOString());
      const record: DebugTimelineAppend = { schemaVersion: 1, eventId, scope,
        ...(workflow === undefined ? {} : { workflow }),
        occurredAt: at, recordedAt: at, retentionDate: localDatePart(now),
        payload: { kind: "debug", event: safe }, source: { kind: "native" } };
      if ("enqueue" in deps) {
        const committed = deps.enqueue(record).then(state => {
          if (state === "inserted") mirrorDebugEvent({ ...record, event: safe }, deps);
        });
        // Optional diagnostics do not wait for a receipt. Required reports await this same promise.
        void committed.catch(() => {});
        return committed;
      }
      const existing = safe.category === "client" ? deps.repository.get(eventId) : undefined;
      if (existing !== undefined) {
        assertSameClientDebugReport(record, existing);
        return { state: "existing" as const, record: existing };
      }
      const result = deps.repository.append(record);
      if (result.state === "inserted") mirrorDebugEvent({ ...result.record, event: safe }, deps);
      return result;
    },
  });
}

/** Emits one fault event plus one closed cause row per cause (its closed reason), sharing its correlation; stderr gets the same value-free rows. */
export function emitFaultWithCauses(debugEvents: Readonly<{ emit(input: unknown, scope?: TimelineAppend["scope"]): unknown }>, faultSink: ((line: string) => void) | undefined, error: unknown,
  fault: Readonly<{ category: "worker" | "http"; area: string; code: string; reason: string; message?: string }>, scope?: TimelineAppend["scope"]): void {
  const correlationId = randomUUID(), causes = serializeErrorCauses(error);
  const event = { ...fault, phase: "failed", correlationId };
  debugEvents.emit(event, scope);
  for (const cause of causes) debugEvents.emit({ category: fault.category, phase: "failed", correlationId, area: fault.area,
    reason: cause.reason, code: cause.code, message: cause.name, stack: cause.stack }, scope);
  faultSink?.(JSON.stringify({ ...event, causes: causes.map(({ name, code, reason }) => ({ name, code, reason })) }));
}
