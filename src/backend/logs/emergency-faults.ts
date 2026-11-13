import { sanitizeDebugText } from "../../rules/redaction/redaction.js";
import type { TimelineRepository } from "../../models/events/timeline.js";
import { appendLocalDebug } from "../storage/events/local-debug-log.js";

export function appendEmergencyFault(input: { stateRoot: string; build: string; code: string; error: Error; now: Date; area: string; reason: string }) {
  appendLocalDebug({ stateRoot: input.stateRoot, build: input.build, now: input.now,
    event: { category: "boot", phase: "failed", area: input.area, reason: input.reason, code: input.code,
      message: sanitizeDebugText(input.error.message),
      ...(input.error.stack === undefined ? {} : { stack: sanitizeDebugText(input.error.stack) }), pinned: true } });
}

export function withEmergencyTimelineWriter(repository: TimelineRepository, input: { stateRoot: string; build: string; clock: import("../../rules/time/clock.js").Clock }): TimelineRepository {
  return Object.freeze({ ...repository, append(value: unknown) {
    try { return repository.append(value); }
    catch (error) {
      if (error instanceof Error && "code" in error && typeof error.code === "string" && (error.code.startsWith("ERR_SQLITE") || error.code === "ERR_INVALID_STATE" || error.code === "DATABASE_WRITER_UNAVAILABLE")) {
        appendEmergencyFault({ ...input, now: input.clock.now(), code: "DATABASE_WRITER_UNAVAILABLE", error,
          area: "timeline-writer", reason: "database-unavailable" });
      }
      throw error;
    }
  } });
}
