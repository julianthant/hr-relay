import { appendFileSync, existsSync, mkdirSync, readFileSync, lstatSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { TimelineAppendSchema, timelineAppendContent, type TimelineRepository } from "../../models/events/timeline.js";
import { sanitizeDebugText } from "./debug-events.js";
import { localDatePart } from "../../rules/time/clock.js";

const MAX_BYTES = 5 * 1024 * 1024;
function faultPath(root: string): string {
  const directory = join(root, "logs");
  const path = join(directory, "boot.jsonl");
  for (const target of [directory, path]) {
    if (existsSync(target) && lstatSync(target).isSymbolicLink()) throw new Error("boot-log-path-unsafe");
  }
  return path;
}

/** Call only when database admission or the authoritative writer failed. */
export function appendEmergencyFault(input: { stateRoot: string; build: string; code: string; error: Error; now: Date }) {
  const path = faultPath(input.stateRoot);
  const eventId = randomUUID();
  const record = TimelineAppendSchema.parse({ schemaVersion: 1, eventId,
    scope: { kind: "transport", connectionId: "database-unavailable" },
    occurredAt: input.now.toISOString(), recordedAt: input.now.toISOString(), retentionDate: localDatePart(input.now),
    payload: { kind: "debug", event: { category: "boot", phase: "failed", correlationId: eventId,
      code: input.code, message: sanitizeDebugText(input.error.message),
      ...(input.error.stack === undefined ? {} : { stack: sanitizeDebugText(input.error.stack) }),
      build: input.build, pid: process.pid, pinned: true } }, source: { kind: "native" } });
  const line = `${canonicalJsonStringify(record)}\n`;
  const size = existsSync(path) ? lstatSync(path).size : 0;
  if (size + Buffer.byteLength(line) > MAX_BYTES) throw new Error("boot-log-cap-exceeded");
  mkdirSync(join(input.stateRoot, "logs"), { recursive: true, mode: 0o700 });
  appendFileSync(path, line, { mode: 0o600, flush: true });
}

export function importEmergencyFaults(stateRoot: string, repository: TimelineRepository): number {
  const path = faultPath(stateRoot);
  if (!existsSync(path)) return 0;
  if (lstatSync(path).size > MAX_BYTES) throw new Error("boot-log-cap-exceeded");
  const content = readFileSync(path, "utf8");
  if (!content.endsWith("\n")) throw new Error("boot-log-incomplete");
  const lines = content.trimEnd().split("\n");
  const records = lines.map(line => {
    let input: unknown;
    try { input = JSON.parse(line); } catch { throw new Error("boot-log-invalid"); }
    const parsed = TimelineAppendSchema.safeParse(input);
    if (!parsed.success || parsed.data.payload.kind !== "debug" || parsed.data.payload.event.category !== "boot"
      || parsed.data.scope.kind !== "transport" || parsed.data.scope.connectionId !== "database-unavailable") throw new Error("boot-log-invalid");
    return parsed.data;
  });
  for (const record of records) {
    repository.append(record);
    const stored = repository.get(record.eventId);
    if (stored === undefined || timelineAppendContent(stored) !== canonicalJsonStringify(record)) throw new Error("boot-log-import-verification-failed");
  }
  if (readFileSync(path, "utf8") !== content) throw new Error("boot-log-import-concurrent-write");
  unlinkSync(path);
  return records.length;
}

export function withEmergencyTimelineWriter(repository: TimelineRepository, input: { stateRoot: string; build: string; clock: import("../../rules/time/clock.js").Clock }): TimelineRepository {
  return Object.freeze({ ...repository, append(value: unknown) {
    try { return repository.append(value); }
    catch (error) {
      if (error instanceof Error && "code" in error && typeof error.code === "string" && (error.code.startsWith("ERR_SQLITE") || error.code === "ERR_INVALID_STATE")) {
        appendEmergencyFault({ ...input, now: input.clock.now(), code: "DATABASE_WRITER_UNAVAILABLE", error });
      }
      throw error;
    }
  } });
}
