import { appendFileSync, existsSync, mkdirSync, readFileSync, lstatSync, unlinkSync, openSync, closeSync, fstatSync, readSync, constants } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { localDatePart } from "../../../rules/time/clock.js";
import { DebugEventSchema, debugEventLevel, TimelineAppendSchema, timelineAppendContent, type DebugEvent, type TimelineAppend, type TimelineRepository } from "../../../models/events/timeline.js";
import { PROFILE_SELECTION_CHANGE_CALLERS, ProfileSelectionChangeSchema, type ProfileSelectionChangeReason } from "../../../models/profiles/profile.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { developmentDebugMirrorEnabled } from "../../../models/config/secrets.js";
import { diagnosticRequestRoute } from "../../../models/events/debug-report.js";

const MAX_BYTES = 5 * 1024 * 1024;
function faultPath(root: string): string {
  const directory = join(root, "logs");
  const path = join(directory, "boot.jsonl");
  for (const target of [directory, path]) {
    if (lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error("boot-log-path-unsafe");
  }
  return path;
}

export function mirrorDebugEvent(record: Pick<TimelineAppend, "recordedAt" | "scope" | "workflow"> & { event: DebugEvent },
  options: { development?: boolean; writeStderr?: (line: string) => void } = {}): void {
  if (process.versions.electron !== undefined || process.argv.includes("--prod")
    || !(options.development ?? (developmentDebugMirrorEnabled() || process.execArgv.includes("--conditions=development")))) return;
  const { category, phase, code, area, reason, correlationId, chatGptInference } = DebugEventSchema.parse(record.event);
  const http = category === "http" ? { method: record.event.method, route: record.event.route, status: record.event.status }
    // A client report's route is mirrored only in its closed root form.
    : category === "client" && record.event.route !== undefined && diagnosticRequestRoute(record.event.route) === record.event.route ? { route: record.event.route } : {};
  (options.writeStderr ?? (line => { process.stderr.write(line); }))(JSON.stringify({ time: record.recordedAt,
    level: debugEventLevel(record.event), category, phase, code, area, reason, correlationId, chatGptInference, ...http, scope: record.scope, workflow: record.workflow }) + "\n");
}

export function appendLocalDebug(input: { stateRoot: string; build: string; now: Date; event: Omit<DebugEvent, "build" | "pid" | "correlationId"> }) {
  const path = faultPath(input.stateRoot);
  const eventId = randomUUID();
  const event = DebugEventSchema.parse({ ...input.event, correlationId: eventId, build: input.build, pid: process.pid });
  const record = TimelineAppendSchema.parse({ schemaVersion: 1, eventId,
    scope: { kind: "transport", connectionId: event.category === "session" ? "profile-registry" : "database-unavailable" },
    occurredAt: input.now.toISOString(), recordedAt: input.now.toISOString(), retentionDate: localDatePart(input.now),
    payload: { kind: "debug", event }, source: { kind: "native" } });
  const line = `${canonicalJsonStringify(record)}\n`;
  const size = existsSync(path) ? lstatSync(path).size : 0;
  if (size + Buffer.byteLength(line) > MAX_BYTES) throw new Error("boot-log-cap-exceeded");
  mkdirSync(join(input.stateRoot, "logs"), { recursive: true, mode: 0o700 });
  appendFileSync(path, line, { mode: 0o600, flush: true });
  mirrorDebugEvent({ ...record, event });
}

export class ProfileSessionLogUnavailableError extends Error {
  readonly code = "PROFILE_SESSION_LOG_UNAVAILABLE";
  constructor(cause: unknown) { super(ERROR_CATALOG.PROFILE_SESSION_LOG_UNAVAILABLE.text, { cause }); this.name = "ProfileSessionLogUnavailableError"; }
}

export function appendProfileSelectionChange(input: { stateRoot: string; now: Date; phase: "started" | "settled";
  reason: ProfileSelectionChangeReason; oldGeneration: number; newGeneration: number }): void {
  try {
    const change = ProfileSelectionChangeSchema.parse({ reason: input.reason, caller: PROFILE_SELECTION_CHANGE_CALLERS[input.reason],
      oldGeneration: input.oldGeneration, newGeneration: input.newGeneration });
    const build = z.object({ version: z.string().min(1) }).parse(JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../package.json"), "utf8"))).version;
    appendLocalDebug({ stateRoot: input.stateRoot, now: input.now, build,
      event: { category: "session", phase: input.phase, code: "PROFILE_SELECTION_CHANGED", area: "profile-selection",
        reason: change.reason, message: canonicalJsonStringify(change), pinned: true } });
  } catch (cause) { throw new ProfileSessionLogUnavailableError(cause); }
}

function parseLocalDebugLog(content: string) {
  if (!content.endsWith("\n")) throw new Error("boot-log-incomplete");
  const lines = content.trimEnd().split("\n");
  return lines.map(line => {
    let input: unknown;
    try { input = JSON.parse(line); } catch { throw new Error("boot-log-invalid"); }
    const parsed = TimelineAppendSchema.safeParse(input);
    if (!parsed.success || parsed.data.payload.kind !== "debug" || parsed.data.scope.kind !== "transport") throw new Error("boot-log-invalid");
    const event = parsed.data.payload.event;
    if (event.category === "session" && event.code === "PROFILE_SELECTION_CHANGED" && parsed.data.scope.connectionId === "profile-registry") {
      if (event.message === undefined) throw new Error("boot-log-invalid");
      const change = ProfileSelectionChangeSchema.parse(JSON.parse(event.message));
      if (event.reason !== change.reason || event.area !== "profile-selection" || event.phase !== "started" && event.phase !== "settled") throw new Error("boot-log-invalid");
    } else if (event.category !== "boot" || parsed.data.scope.connectionId !== "database-unavailable") throw new Error("boot-log-invalid");
    return parsed.data;
  });
}

export function readLocalDebugLog(stateRoot: string) {
  const path = faultPath(stateRoot);
  if (!existsSync(path)) return { state: "absent" as const, reason: "boot-log-missing" as const };
  const directory = lstatSync(join(stateRoot, "logs"));
  if (!directory.isDirectory() || directory.uid !== process.getuid?.() || (directory.mode & 0o077) !== 0) throw new Error("boot-log-path-unsafe");
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  const identity = (stats: ReturnType<typeof fstatSync>) => [stats.dev, stats.ino, stats.size, stats.mtimeMs, stats.ctimeMs].join(":");
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.nlink !== 1 || before.uid !== process.getuid?.() || (before.mode & 0o077) !== 0) throw new Error("boot-log-path-unsafe");
    if (before.size > MAX_BYTES) throw new Error("boot-log-cap-exceeded");
    const bytes = Buffer.alloc(before.size + 1);
    let count = 0;
    while (count < bytes.length) {
      const read = readSync(descriptor, bytes, count, bytes.length - count, count);
      if (read === 0) break;
      count += read;
    }
    if (count !== before.size) throw new Error("boot-log-concurrent-write");
    let content: string;
    try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, count)); }
    catch { throw new Error("boot-log-invalid"); }
    const records = parseLocalDebugLog(content);
    if (identity(before) !== identity(fstatSync(descriptor)) || identity(before) !== identity(lstatSync(path))
      || identity(directory) !== identity(lstatSync(join(stateRoot, "logs")))) throw new Error("boot-log-concurrent-write");
    return { state: "present" as const, records };
  } finally { closeSync(descriptor); }
}

export function importLocalDebugLog(stateRoot: string, repository: TimelineRepository): number {
  const path = faultPath(stateRoot);
  if (!existsSync(path)) return 0;
  if (lstatSync(path).size > MAX_BYTES) throw new Error("boot-log-cap-exceeded");
  const content = readFileSync(path, "utf8");
  const records = parseLocalDebugLog(content);
  for (const record of records) {
    repository.append(record);
    const stored = repository.get(record.eventId);
    if (stored === undefined || timelineAppendContent(stored) !== canonicalJsonStringify(record)) throw new Error("boot-log-import-verification-failed");
  }
  if (readFileSync(path, "utf8") !== content) throw new Error("boot-log-import-concurrent-write");
  unlinkSync(path);
  return records.length;
}
