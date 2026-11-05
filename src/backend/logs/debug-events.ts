import { sanitizeDebugText } from "../../rules/redaction/redaction.js";
import { deriveStableUuid } from "../../rules/identity/identifiers.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { randomUUID } from "node:crypto";
import { DebugEventSchema, type TimelineRepository, type TimelineAppend } from "../../models/events/timeline.js";
import type { Clock } from "../../rules/time/clock.js";
import { localDatePart } from "../../rules/time/clock.js";
import { mirrorDebugEvent } from "../storage/events/local-debug-log.js";

export function valueFreeErrorCauses(error: Error): readonly Readonly<{ name: string; code: string; stack: string }>[] {
  const pending: unknown[] = [error], seen = new Set<unknown>();
  const details: { name: string; code: string; stack: string }[] = [];
  while (pending.length > 0 && details.length < 16) {
    const cause = pending.pop();
    if (!(cause instanceof Error) || seen.has(cause)) continue;
    seen.add(cause);
    const name = /^[A-Za-z][A-Za-z0-9]{0,79}$/u.test(cause.name) ? cause.name : "Error";
    const code = "code" in cause && typeof cause.code === "string" && /^[A-Z][A-Z0-9_]{0,127}$/u.test(cause.code) ? cause.code : "INTERNAL_FAILURE";
    const frames = cause.stack?.split("\n").slice(1).flatMap(line => {
      if (!/^\s+at /u.test(line)) return [];
      const frame = /(?:^|\/)((?:src|scripts|node_modules)\/[A-Za-z0-9_./-]+\.[cm]?[jt]sx?:\d+:\d+)\)?$/u.exec(line)?.[1];
      return frame === undefined ? [] : [`    at ${frame}`];
    }).slice(0, 40) ?? [];
    details.push({ name, code, stack: [name, ...frames].join("\n") });
    pending.push(cause.cause);
    if (cause instanceof AggregateError) { const nested: readonly unknown[] = cause.errors; pending.push(...nested); }
  }
  return details;
}

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
