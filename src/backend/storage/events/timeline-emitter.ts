import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Clock } from "../../../domain/clock.js";
import { localDatePart } from "../../../domain/clock.js";
import { SpanEventWireSchema } from "../../../events/types.js";
import type { TimelineRepository } from "../../../events/timeline.js";

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
      const event = parsed.data;
      const now = deps.clock.now();
      deps.repository.append({
        schemaVersion: 1,
        eventId: (deps.uuid ?? randomUUID)(),
        workflow: event.workflow,
        scope: "runId" in event ? { kind: "run", runId: event.runId } : { kind: "worker", workerId: event.workerId },
        occurredAt: event.ts,
        recordedAt: now.toISOString(),
        retentionDate: localDatePart(now),
        payload: { kind: "span", event },
        source: { kind: "native" },
      });
    },
  });
}
