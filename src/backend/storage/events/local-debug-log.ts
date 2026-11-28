import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, openSync, closeSync, readSync, fsyncSync, constants } from "node:fs";
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
import { descriptorStatus, fileChanged, fileModified, fileStatus, privateFileNumber } from "../file-identity.js";
import { fsyncPath, privatePathRejects, replacePrivateFile } from "../private-path.js";
import { DebugTimelineAppendSchema, type DebugTimelineAppend } from "./log-mutations.js";

const MAX_BYTES = 5 * 1024 * 1024;
const BOOT_LOG = "boot.jsonl";
function bootLogPaths(root: string) {
  const directory = join(root, "logs"), current = join(directory, BOOT_LOG);
  for (const target of [directory, current]) {
    if (fileStatus(target, true)?.isSymbolicLink()) throw new Error("boot-log-path-unsafe");
  }
  return { directory, current };
}

function bootLogSegments(directory: string): string[] {
  if (fileStatus(directory, true) === undefined) return [];
  return readdirSync(directory)
    .filter(name => /^boot\.jsonl\.[1-9]\d*$/u.test(name))
    .sort((left, right) => left.length - right.length || left.localeCompare(right));
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
  const { directory, current: path } = bootLogPaths(input.stateRoot);
  const eventId = randomUUID();
  const event = DebugEventSchema.parse({ ...input.event, correlationId: eventId, build: input.build, pid: process.pid });
  const record = TimelineAppendSchema.parse({ schemaVersion: 1, eventId,
    scope: { kind: "transport", connectionId: event.category === "session" ? "profile-registry" : "database-unavailable" },
    occurredAt: input.now.toISOString(), recordedAt: input.now.toISOString(), retentionDate: localDatePart(input.now),
    payload: { kind: "debug", event }, source: { kind: "native" } });
  const line = `${canonicalJsonStringify(record)}\n`;
  const current = fileStatus(path, true), lineBytes = Buffer.byteLength(line);
  if (lineBytes > MAX_BYTES) throw new Error("boot-log-cap-exceeded");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const logs = fileStatus(directory);
  if (!logs.isDirectory() || privatePathRejects(directory, logs, "private")) throw new Error("boot-log-path-unsafe");
  const assertAppendTarget = (file: ReturnType<typeof descriptorStatus>): void => {
    if (!file.isFile() || privateFileNumber(file.nlink) !== 1 || privatePathRejects(path, file, "private")) throw new Error("boot-log-path-unsafe");
  };
  if (current !== undefined) assertAppendTarget(current);
  const rotate = current !== undefined && privateFileNumber(current.size) + lineBytes > MAX_BYTES;
  if (rotate) {
    // Profile-local maintenance owns one spool path. Selection writes only to the machine spool.
    if (event.category !== "session" || current.size > MAX_BYTES) throw new Error("boot-log-cap-exceeded");
    const last = bootLogSegments(directory).at(-1);
    const generation = BigInt(last?.slice(BOOT_LOG.length + 1) ?? "0") + 1n;
    const archive = `${path}.${generation}`;
    if (fileStatus(archive, true) !== undefined) throw new Error("boot-log-path-unsafe");
    replacePrivateFile(path, archive);
    fsyncPath(directory);
  }
  const create = current === undefined || rotate ? constants.O_CREAT : 0;
  const fd = openSync(path, constants.O_WRONLY | constants.O_APPEND | constants.O_NONBLOCK | constants.O_NOFOLLOW | create, 0o600);
  try {
    const opened = descriptorStatus(fd), named = fileStatus(path), parent = fileStatus(directory);
    assertAppendTarget(opened);
    if (opened.dev !== named.dev || opened.ino !== named.ino || parent.dev !== logs.dev || parent.ino !== logs.ino
      || (!rotate && current !== undefined && (opened.dev !== current.dev || opened.ino !== current.ino))) throw new Error("boot-log-path-unsafe");
    if (privateFileNumber(opened.size) + lineBytes > MAX_BYTES) throw new Error("boot-log-cap-exceeded");
    appendFileSync(fd, line);
    fsyncSync(fd);
  } finally { closeSync(fd); }
  if (rotate) fsyncPath(directory);
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
    const parsed = DebugTimelineAppendSchema.safeParse(input);
    if (!parsed.success || parsed.data.scope.kind !== "transport") throw new Error("boot-log-invalid");
    const event = parsed.data.payload.event;
    if (event.category === "session" && event.code === "PROFILE_SELECTION_CHANGED" && parsed.data.scope.connectionId === "profile-registry") {
      if (event.message === undefined) throw new Error("boot-log-invalid");
      const change = ProfileSelectionChangeSchema.parse(JSON.parse(event.message));
      if (event.reason !== change.reason || event.area !== "profile-selection" || event.phase !== "started" && event.phase !== "settled") throw new Error("boot-log-invalid");
    } else if (event.category !== "boot" || parsed.data.scope.connectionId !== "database-unavailable") throw new Error("boot-log-invalid");
    return parsed.data;
  });
}

const fileIdentity = (stats: ReturnType<typeof descriptorStatus>) => [stats.dev, stats.ino, stats.size, fileModified(stats), fileChanged(stats)].join(":");

function readLocalDebugFile(path: string) {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = descriptorStatus(descriptor);
    if (!before.isFile() || privateFileNumber(before.nlink) !== 1 || privatePathRejects(path, before, "private")) throw new Error("boot-log-path-unsafe");
    if (before.size > MAX_BYTES) throw new Error("boot-log-cap-exceeded");
    const size = privateFileNumber(before.size);
    const bytes = Buffer.alloc(size + 1);
    let count = 0;
    while (count < bytes.length) {
      const read = readSync(descriptor, bytes, count, bytes.length - count, count);
      if (read === 0) break;
      count += read;
    }
    if (count !== size) throw new Error("boot-log-concurrent-write");
    let content: string;
    try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, count)); }
    catch { throw new Error("boot-log-invalid"); }
    const records = parseLocalDebugLog(content);
    if (fileIdentity(before) !== fileIdentity(descriptorStatus(descriptor)) || fileIdentity(before) !== fileIdentity(fileStatus(path))) throw new Error("boot-log-concurrent-write");
    return records;
  } finally { closeSync(descriptor); }
}

export function readLocalDebugLog(stateRoot: string) {
  const { current, directory } = bootLogPaths(stateRoot);
  const before = fileStatus(directory, true);
  const files = bootLogSegments(directory).map(name => join(directory, name));
  if (existsSync(current)) files.push(current);
  if (files.length === 0) return { state: "absent" as const, reason: "boot-log-missing" as const };
  if (before === undefined || !before.isDirectory() || privatePathRejects(directory, before, "private")) throw new Error("boot-log-path-unsafe");
  const records = files.flatMap(readLocalDebugFile);
  if (fileIdentity(before) !== fileIdentity(fileStatus(directory))) throw new Error("boot-log-concurrent-write");
  return { state: "present" as const, records };
}

function captureLocalDebugLog(stateRoot: string) {
  const { current, directory } = bootLogPaths(stateRoot);
  const paths = () => [...bootLogSegments(directory).map(name => join(directory, name)), current];
  const read = (path: string) => {
    const file = fileStatus(path, true);
    if (file === undefined) return undefined;
    if (!file.isFile() || (path !== current && (privateFileNumber(file.nlink) !== 1 || privatePathRejects(path, file, "private")))) throw new Error("boot-log-path-unsafe");
    if (file.size > MAX_BYTES) throw new Error("boot-log-cap-exceeded");
    return readFileSync(path, "utf8");
  };
  const files = paths().map(path => ({ path, content: read(path) }));
  const records = files.flatMap(file => file.content === undefined ? [] : parseLocalDebugLog(file.content));
  const remove = () => {
    const remaining = paths();
    if (remaining.length !== files.length || files.some((file, index) => remaining[index] !== file.path || read(file.path) !== file.content)) {
      throw new Error("boot-log-import-concurrent-write");
    }
    for (const file of files) if (file.content !== undefined) unlinkSync(file.path);
    return records.length;
  };
  return { records, remove };
}

export function importLocalDebugLog(stateRoot: string, repository: TimelineRepository): number {
  const { records, remove } = captureLocalDebugLog(stateRoot);
  for (const record of records) {
    repository.append(record);
    const stored = repository.get(record.eventId);
    if (stored === undefined || timelineAppendContent(stored) !== canonicalJsonStringify(record)) throw new Error("boot-log-import-verification-failed");
  }
  return remove();
}

export async function importLocalDebugLogViaWriter(stateRoot: string, append: (record: DebugTimelineAppend) => Promise<"inserted" | "existing">): Promise<number> {
  const { records, remove } = captureLocalDebugLog(stateRoot);
  await Promise.all(records.map(append));
  return remove();
}
