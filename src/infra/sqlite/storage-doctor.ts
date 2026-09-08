import { ProtectedSettingsNameSchema } from "../../domain/config/protected-settings.js";
import { createCredentialStore } from "../config/credential-store.js";
import { ProtectedSettingsInspectionSchema } from "./recovery-contracts.js";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  opendirSync,
  openSync,
  readSync,
  readdirSync,
  statSync,
  type Stats,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { constants as systemConstants } from "node:os";
import { z } from "zod";
import type { Clock } from "../../domain/clock.js";
import { systemClock } from "../../domain/clock.js";
import {
  SpanEventWireSchema,
  type RunQueuedWire,
  type SpanEventWire,
} from "../../events/types.js";
import { AuthorityDatabase } from "./authority-database.js";
import { storageHealthCauseFromError } from "./authority-boot.js";
import { parseBackupManifestFile, verifyBackupManifestAtPath } from "./backup-service.js";
import {
  BackupHealthSchema,
  RestoreCandidateSchema,
  SpanAuthorityReconciliationSchema,
  SpanAuthorityRunRootSchema,
  StorageDoctorReportSchema,
  StorageHealthCauseSchema,
  type AuthorityCopyInspection,
  type RestoreCandidate,
  type SpanAuthorityRunRoot,
  type SpanAuthorityReadSnapshot,
  type StorageDoctorReport,
} from "./recovery-contracts.js";

export const StorageDoctorOptionsSchema = z.strictObject({
  stateRootTrustAnchor: z.string().min(1),
  stateRoot: z.string().min(1),
  authorityPath: z.string().min(1),
  backupDirectory: z.string().min(1),
  maxBackupAgeMs: z.number().int().positive().optional(),
  busyTimeoutMs: z.number().int().positive(),
});

const SPAN_DOCTOR_LIMITS = Object.freeze({
  maxFiles: 128,
  maxFileBytes: 8 * 1024 * 1024,
  maxCorpusBytes: 16 * 1024 * 1024,
  maxLineBytes: 256 * 1024,
  maxLines: 100_000,
  maxRunIds: 10_000,
});
const SPAN_READ_CHUNK_BYTES = 64 * 1024;
const SPAN_FILE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*-\d{4}-\d{2}-\d{2}\.jsonl$/u;

function errnoCode(error: unknown): string {
  if (typeof error !== "object" || error === null) return "unknown-error";
  const code: unknown = Reflect.get(error, "code");
  return typeof code === "string" && Object.hasOwn(systemConstants.errno, code) ? code : "unknown-error";
}

/** Only internally authored, value-free/basename-only corpus diagnostics cross the wire verbatim. */
class SafeSpanCorpusError extends Error {}

type DirectoryIdentity = Readonly<{
  device: number;
  inode: number;
}>;

const MISSING_DIRECTORY = Symbol("missing-directory");

function inspectNoFollowDirectory(
  path: string,
  label: string,
  allowMissing = false,
): Stats | typeof MISSING_DIRECTORY {
  let before: Stats;
  try {
    before = lstatSync(path);
  } catch (error) {
    if (allowMissing && errnoCode(error) === "ENOENT") return MISSING_DIRECTORY;
    throw new SafeSpanCorpusError(`${label} could not be inspected (${errnoCode(error)})`, { cause: error });
  }
  if (!before.isDirectory() || before.isSymbolicLink()) {
    throw new SafeSpanCorpusError(`${label} is not a regular no-follow directory`);
  }
  return before;
}

function directoryIdentity(stat: Stats): DirectoryIdentity {
  return { device: stat.dev, inode: stat.ino };
}

function sameDirectoryIdentity(stat: Stats, expected: DirectoryIdentity): boolean {
  return stat.isDirectory() && stat.dev === expected.device && stat.ino === expected.inode;
}

function withNoFollowRelativeDirectory<T>(
  name: string,
  label: string,
  allowMissing: boolean,
  work: (identity: DirectoryIdentity) => T,
): T | undefined {
  if (name === "" || name === "." || name === ".." || name.includes(sep)) {
    throw new SafeSpanCorpusError(`${label} is not one path component`);
  }
  const before = inspectNoFollowDirectory(name, label, allowMissing);
  if (before === MISSING_DIRECTORY) return undefined;
  const expected = directoryIdentity(before);
  try {
    process.chdir(name);
  } catch (error) {
    throw new SafeSpanCorpusError(`${label} could not be entered relative to its held parent (${errnoCode(error)})`, { cause: error });
  }
  try {
    const opened = statSync(".");
    if (!sameDirectoryIdentity(opened, expected)) {
      throw new SafeSpanCorpusError(`${label} changed identity before enumeration`);
    }
    return work(expected);
  } finally {
    process.chdir("..");
  }
}

function withStateRootWorkingDirectory<T>(
  trustAnchor: string,
  stateRoot: string,
  work: () => T,
): T {
  const relativeStateRoot = relative(trustAnchor, stateRoot);
  if (isAbsolute(relativeStateRoot)
    || relativeStateRoot === ".."
    || relativeStateRoot.startsWith(`..${sep}`)) {
    throw new SafeSpanCorpusError("span corpus state root is outside its configured trust anchor");
  }
  const components = relativeStateRoot === "" ? [] : relativeStateRoot.split(sep);
  const originalWorkingDirectory = process.cwd();
  const anchorBefore = inspectNoFollowDirectory(
    trustAnchor,
    `span corpus trust anchor ${basename(trustAnchor)}`,
  );
  if (anchorBefore === MISSING_DIRECTORY) throw new SafeSpanCorpusError("span corpus trust anchor unexpectedly disappeared");
  try {
    process.chdir(trustAnchor);
    if (!sameDirectoryIdentity(statSync("."), directoryIdentity(anchorBefore))) {
      throw new SafeSpanCorpusError(`span corpus trust anchor ${basename(trustAnchor)} changed identity before traversal`);
    }
    const descend = (index: number): T => {
      const component = components[index];
      if (component === undefined) return work();
      const label = index === components.length - 1
        ? `span corpus parent ${component}`
        : `span corpus path component ${String(index + 1)}`;
      const result = withNoFollowRelativeDirectory(
        component,
        label,
        false,
        () => descend(index + 1),
      );
      if (result === undefined) throw new SafeSpanCorpusError(`${label} unexpectedly disappeared`);
      return result;
    };
    return descend(0);
  } finally {
    process.chdir(originalWorkingDirectory);
  }
}

function spanFileLabel(fileName: string): string {
  // A schema-shaped filename can still contain person/secret data. Its digest
  // identifies the offending local file without publishing any supplied text.
  // Four-character groups cannot accidentally form an eight-digit person ID.
  return `sha256:${createHash("sha256").update(fileName).digest("hex").replace(/(.{4})(?=.)/gu, "$1-")}`;
}

const SPAN_SCHEMA_FIELDS = new Set(SpanEventWireSchema.options.flatMap((schema) => Object.keys(schema.shape)));

function strictSpanIssue(error: z.ZodError): string {
  // Zod paths below a known field can contain arbitrary record keys. Retain the
  // schema-owned top-level field only, never observed keys or error messages.
  const paths = [...new Set(error.issues.map((issue) => {
    const field = issue.path[0];
    return typeof field === "string" && SPAN_SCHEMA_FIELDS.has(field) ? field : "$";
  }))];
  return paths.slice(0, 8).join(", ");
}

function parseSpanLine(fileName: string, lineNumber: number, bytes: Buffer): z.infer<typeof SpanEventWireSchema> {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new SafeSpanCorpusError(`span file ${spanFileLabel(fileName)} line ${String(lineNumber)} is not valid UTF-8`, { cause: error });
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new SafeSpanCorpusError(`span file ${spanFileLabel(fileName)} line ${String(lineNumber)} is invalid JSON`, { cause: error });
  }
  const parsed = SpanEventWireSchema.safeParse(value);
  if (!parsed.success) {
    throw new SafeSpanCorpusError(
      `span file ${spanFileLabel(fileName)} line ${String(lineNumber)} fails the strict span schema at ${strictSpanIssue(parsed.error)}`,
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

type MutableSpanAuthorityRoot = {
  readonly queued: RunQueuedWire;
  finalAttempt: number;
  possibleExternalWrite: boolean;
  readonly streamIssues: string[];
  lastTimestampMs: number;
  terminal: boolean;
  readonly taskSpans: Set<string>;
};

type PendingRunEvent = Readonly<{
  event: Exclude<SpanEventWire, RunQueuedWire>;
  fileName: string;
  lineNumber: number;
}>;

function addStreamIssue(root: MutableSpanAuthorityRoot, issue: string): void {
  if (!root.streamIssues.includes(issue)) root.streamIssues.push(issue);
}

function spanFileWorkflow(fileName: string): string {
  return fileName.slice(0, -"-2026-07-31.jsonl".length);
}

function validateSpanFileWorkflow(
  root: MutableSpanAuthorityRoot,
  event: SpanEventWire,
  fileName: string,
  lineNumber: number,
): void {
  if (!("runId" in event) || spanFileWorkflow(fileName) === event.workflow) return;
  addStreamIssue(
    root,
    `${event.t} at ${spanFileLabel(fileName)}:${String(lineNumber)} workflow does not match its stream file`,
  );
}

function isRootLevelRunEvent(event: SpanEventWire): boolean {
  if (!("runId" in event)) return false;
  if (event.t === "span.started" || event.t === "span.ended") return event.kind === "run";
  return event.t === "run.claimed"
    || event.t === "run.requeued"
    || event.t === "gate.opened"
    || event.t === "gate.resolved"
    || event.t === "transaction.previewed";
}

function validateRunEventAgainstRoot(
  root: MutableSpanAuthorityRoot,
  event: Exclude<SpanEventWire, RunQueuedWire>,
  fileName: string,
  lineNumber: number,
  lastAttemptByItem: Map<string, number>,
): void {
  if (!("runId" in event)) return;
  if (event.t === "transaction.fenced") root.possibleExternalWrite = true;
  const location = `${spanFileLabel(fileName)}:${String(lineNumber)}`;
  if (root.terminal) addStreamIssue(root, `${event.t} at ${location} appears after its terminal run span`);
  const timestampMs = Date.parse(event.ts);
  if (timestampMs < root.lastTimestampMs) {
    addStreamIssue(root, `${event.t} at ${location} precedes the prior run event timestamp`);
  }
  root.lastTimestampMs = timestampMs;
  if (event.t === "span.started" && event.kind === "task") {
    const key = `${String(event.attempt)}\0${event.spanPath}`;
    if (root.taskSpans.has(key)) addStreamIssue(root, `task span at ${location} opens twice`);
    root.taskSpans.add(key);
  }
  if (event.t === "span.ended" && event.kind === "task") {
    const key = `${String(event.attempt)}\0${event.spanPath}`;
    if (!root.taskSpans.delete(key)) addStreamIssue(root, `task span at ${location} ends before its matching start`);
  }
  if (event.t === "span.ended" && event.kind === "run") root.terminal = true;
  if (event.workflow !== root.queued.workflow) {
    addStreamIssue(
      root,
      `${event.t} at ${location} workflow does not match root workflow`,
    );
  }
  if (event.traceId !== root.queued.traceId) {
    addStreamIssue(
      root,
      `${event.t} at ${location} traceId ${event.traceId} does not match root ${root.queued.traceId}`,
    );
  }
  if (event.attempt !== root.finalAttempt) {
    addStreamIssue(
      root,
      `${event.t} at ${location} attempt ${String(event.attempt)} does not match current root attempt ${String(root.finalAttempt)}`,
    );
  }
  const expectedRootPath = root.queued.spanPath;
  const taskScoped = (event.t === "span.started" && event.kind === "task")
    || (event.t === "span.ended" && event.kind === "task")
    || event.t === "transaction.fenced"
    || event.t === "data.observed";
  if (taskScoped && event.parentSpanPath !== root.queued.traceId) {
    addStreamIssue(root, `${event.t} at ${location} parentSpanPath must equal run root traceId`);
  }
  if (isRootLevelRunEvent(event)) {
    if (event.parentSpanPath !== undefined) {
      addStreamIssue(root, `${event.t} at ${location} unexpectedly names a root parentSpanPath`);
    }
    if (event.spanPath !== expectedRootPath) {
      addStreamIssue(
        root,
        `${event.t} at ${location} spanPath does not match the run root spanPath`,
      );
    }
  } else if (!event.spanPath.startsWith(`${expectedRootPath}/`)) {
    addStreamIssue(
      root,
      `${event.t} at ${location} spanPath is not beneath the run root spanPath`,
    );
  }
  if (event.parentSpanPath !== undefined
    && event.parentSpanPath !== expectedRootPath
    && !event.parentSpanPath.startsWith(`${expectedRootPath}/`)) {
    addStreamIssue(
      root,
      `${event.t} at ${location} parentSpanPath is outside the run root spanPath`,
    );
  }
  if (event.t === "run.requeued") {
    if (event.nextAttempt <= event.attempt) {
      addStreamIssue(
        root,
        `run.requeued at ${location} next attempt ${String(event.nextAttempt)} did not strictly increase after ${String(event.attempt)}`,
      );
      return;
    }
    const itemKey = `${root.queued.workflow}\u0000${root.queued.itemId}`;
    const previousItemAttempt = lastAttemptByItem.get(itemKey);
    if (previousItemAttempt !== undefined && event.nextAttempt <= previousItemAttempt) {
      addStreamIssue(
        root,
        `run.requeued item attempt ${String(event.nextAttempt)} did not strictly increase after ${String(previousItemAttempt)}`,
      );
    } else {
      lastAttemptByItem.set(itemKey, event.nextAttempt);
    }
    root.finalAttempt = event.nextAttempt;
  }
}

function immutableSpanRoot(root: MutableSpanAuthorityRoot): SpanAuthorityRunRoot {
  const queued = root.queued;
  return SpanAuthorityRunRootSchema.parse({
    ...(root.possibleExternalWrite ? { possibleExternalWrite: true } : {}),
    runId: queued.runId,
    workflow: queued.workflow,
    itemId: queued.itemId,
    traceId: queued.traceId,
    spanPath: queued.spanPath,
    parentRunId: queued.parentRunId,
    shape: queued.shape,
    priority: queued.priority,
    dryRun: queued.dryRun,
    retryOf: queued.retryOf,
    descriptorVersion: queued.descriptorVersion,
    contractFingerprint: queued.contractFingerprint,
    resolvedInstance: queued.resolvedInstance,
    configFingerprint: queued.configFingerprint,
    configSnapshotId: queued.configSnapshotId,
    queuedAt: queued.ts,
    reconstructed: queued.repair?.kind === "authority-reconstruction",
    initialAttempt: queued.attempt,
    finalAttempt: root.finalAttempt,
    streamIssues: root.streamIssues,
  });
}

function scanSpanAuthorityRoots(corpusIdentity: DirectoryIdentity): readonly SpanAuthorityRunRoot[] {
  let fileNames: readonly string[];
  let exceededFileLimit = false;
  try {
    const directory = opendirSync(".");
    try {
      if (!sameDirectoryIdentity(statSync("."), corpusIdentity)) {
        throw new SafeSpanCorpusError("span corpus directory spans changed identity before enumeration");
      }
      const names: string[] = [];
      let entry = directory.readSync();
      while (entry !== null) {
        if (names.length === SPAN_DOCTOR_LIMITS.maxFiles) {
          exceededFileLimit = true;
          break;
        }
        names.push(entry.name);
        entry = directory.readSync();
      }
      if (!sameDirectoryIdentity(statSync("."), corpusIdentity)) {
        throw new SafeSpanCorpusError("span corpus directory spans changed identity during enumeration");
      }
      fileNames = names.sort();
    } finally {
      directory.closeSync();
    }
  } catch (error) {
    throw new SafeSpanCorpusError(`span corpus enumeration failed (${errnoCode(error)})`, { cause: error });
  }
  if (exceededFileLimit) {
    throw new SafeSpanCorpusError(
      `span corpus is exceeding the ${String(SPAN_DOCTOR_LIMITS.maxFiles)}-file limit during enumeration`,
    );
  }

  let declaredCorpusBytes = 0;
  let corpusBytesRead = 0;
  let linesRead = 0;
  const roots: MutableSpanAuthorityRoot[] = [];
  const firstRootByRunId = new Map<string, MutableSpanAuthorityRoot>();
  const lastAttemptByItem = new Map<string, number>();
  const eventsBeforeRoot = new Map<string, PendingRunEvent[]>();
  for (const fileName of fileNames) {
    if (!SPAN_FILE_PATTERN.test(fileName)) {
      throw new SafeSpanCorpusError(
        `spans/ contains ${spanFileLabel(fileName)}, which is not a <workflow>-<date>.jsonl stream file; refusing to enumerate around it`,
      );
    }
    let before: Stats;
    try {
      before = lstatSync(fileName);
    } catch (error) {
      throw new SafeSpanCorpusError(`span file ${spanFileLabel(fileName)} could not be inspected (${errnoCode(error)})`, { cause: error });
    }
    if (!before.isFile() || before.isSymbolicLink()) {
      throw new SafeSpanCorpusError(`span file ${spanFileLabel(fileName)} is not a regular no-follow file`);
    }
    if (before.size > SPAN_DOCTOR_LIMITS.maxFileBytes) {
      throw new SafeSpanCorpusError(
        `span file ${spanFileLabel(fileName)} exceeds the ${String(SPAN_DOCTOR_LIMITS.maxFileBytes)}-byte file limit`,
      );
    }
    declaredCorpusBytes += before.size;
    if (declaredCorpusBytes > SPAN_DOCTOR_LIMITS.maxCorpusBytes) {
      throw new SafeSpanCorpusError(`span corpus exceeds the ${String(SPAN_DOCTOR_LIMITS.maxCorpusBytes)}-byte corpus limit`);
    }

    let handle: number;
    try {
      handle = openSync(fileName, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      throw new SafeSpanCorpusError(`span file ${spanFileLabel(fileName)} could not be opened without following links (${errnoCode(error)})`, { cause: error });
    }
    let closeError: unknown;
    try {
      const opened = fstatSync(handle);
      if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
        throw new SafeSpanCorpusError(`span file ${spanFileLabel(fileName)} changed identity before its no-follow read`);
      }
      const chunk = Buffer.allocUnsafe(SPAN_READ_CHUNK_BYTES);
      let lineParts: Buffer[] = [];
      let lineBytes = 0;
      let fileBytesRead = 0;
      let lineNumber = 0;
      while (true) {
        const bytesRead = readSync(handle, chunk, 0, chunk.length, null);
        if (bytesRead === 0) break;
        fileBytesRead += bytesRead;
        corpusBytesRead += bytesRead;
        if (fileBytesRead > SPAN_DOCTOR_LIMITS.maxFileBytes) {
          throw new SafeSpanCorpusError(`span file ${spanFileLabel(fileName)} exceeded the ${String(SPAN_DOCTOR_LIMITS.maxFileBytes)}-byte file limit while reading`);
        }
        if (corpusBytesRead > SPAN_DOCTOR_LIMITS.maxCorpusBytes) {
          throw new SafeSpanCorpusError(`span corpus exceeded the ${String(SPAN_DOCTOR_LIMITS.maxCorpusBytes)}-byte corpus limit while reading`);
        }
        let start = 0;
        for (let index = 0; index < bytesRead; index += 1) {
          if (chunk[index] !== 0x0a) continue;
          const segment = chunk.subarray(start, index);
          lineBytes += segment.length;
          if (lineBytes > SPAN_DOCTOR_LIMITS.maxLineBytes) {
            throw new SafeSpanCorpusError(`span file ${spanFileLabel(fileName)} line ${String(lineNumber + 1)} exceeds the ${String(SPAN_DOCTOR_LIMITS.maxLineBytes)}-byte line limit`);
          }
          if (segment.length > 0) lineParts.push(Buffer.from(segment));
          lineNumber += 1;
          linesRead += 1;
          if (linesRead > SPAN_DOCTOR_LIMITS.maxLines) {
            throw new SafeSpanCorpusError(`span corpus exceeds the ${String(SPAN_DOCTOR_LIMITS.maxLines)}-line limit`);
          }
          if (lineBytes > 0) {
            const event = parseSpanLine(fileName, lineNumber, Buffer.concat(lineParts, lineBytes));
            if (event.t === "run.queued") {
              const pending = eventsBeforeRoot.get(event.runId) ?? [];
              const root: MutableSpanAuthorityRoot = {
                queued: event,
                finalAttempt: event.attempt,
                possibleExternalWrite: false,
                streamIssues: [],
                lastTimestampMs: Date.parse(event.ts),
                terminal: false,
                taskSpans: new Set(),
              };
              eventsBeforeRoot.delete(event.runId);
              roots.push(root);
              if (roots.length > SPAN_DOCTOR_LIMITS.maxRunIds) {
                throw new SafeSpanCorpusError(`span corpus exceeds the ${String(SPAN_DOCTOR_LIMITS.maxRunIds)}-run-ID limit`);
              }
              if (event.spanPath !== event.traceId) {
                addStreamIssue(root, "run.queued root spanPath does not equal traceId");
              }
              if (event.parentSpanPath !== undefined) {
                addStreamIssue(root, "run.queued root unexpectedly names parentSpanPath");
              }
              validateSpanFileWorkflow(root, event, fileName, lineNumber);
              const duplicate = firstRootByRunId.get(event.runId);
              if (duplicate === undefined) {
                firstRootByRunId.set(event.runId, root);
              } else {
                const issue = `duplicate run.queued root for run ${event.runId}`;
                addStreamIssue(duplicate, issue);
                addStreamIssue(root, issue);
              }
              const itemKey = `${event.workflow}\u0000${event.itemId}`;
              const previousItemAttempt = lastAttemptByItem.get(itemKey);
              if (previousItemAttempt !== undefined && event.attempt <= previousItemAttempt) {
                addStreamIssue(
                  root,
                  `run.queued item attempt ${String(event.attempt)} did not strictly increase after ${String(previousItemAttempt)}`,
                );
              }
              lastAttemptByItem.set(itemKey, event.attempt);
              if (pending.length > 0) {
                if (event.repair?.kind === "authority-reconstruction") {
                  for (const prior of pending) {
                    validateSpanFileWorkflow(root, prior.event, prior.fileName, prior.lineNumber);
                    validateRunEventAgainstRoot(
                      root,
                      prior.event,
                      prior.fileName,
                      prior.lineNumber,
                      lastAttemptByItem,
                    );
                  }
                } else {
                  addStreamIssue(
                    root,
                    `run.queued at ${spanFileLabel(fileName)}:${String(lineNumber)} appears after prior run event(s) without authority-reconstruction repair`,
                  );
                }
              }
            } else if ("runId" in event) {
              const root = firstRootByRunId.get(event.runId);
              if (root === undefined) {
                const pending = eventsBeforeRoot.get(event.runId) ?? [];
                pending.push({ event, fileName, lineNumber });
                eventsBeforeRoot.set(event.runId, pending);
              } else {
                validateSpanFileWorkflow(root, event, fileName, lineNumber);
                validateRunEventAgainstRoot(root, event, fileName, lineNumber, lastAttemptByItem);
              }
            }
          }
          lineParts = [];
          lineBytes = 0;
          start = index + 1;
        }
        const remainder = chunk.subarray(start, bytesRead);
        lineBytes += remainder.length;
        if (lineBytes > SPAN_DOCTOR_LIMITS.maxLineBytes) {
          throw new SafeSpanCorpusError(`span file ${spanFileLabel(fileName)} line ${String(lineNumber + 1)} exceeds the ${String(SPAN_DOCTOR_LIMITS.maxLineBytes)}-byte line limit`);
        }
        if (remainder.length > 0) lineParts.push(Buffer.from(remainder));
      }
      // A non-newline-terminated tail may be an append in progress. It is not
      // an authority event until its one-write JSONL record is complete.
    } catch (error) {
      closeError = error;
    } finally {
      try {
        closeSync(handle);
      } catch (error) {
        if (closeError === undefined) closeError = new SafeSpanCorpusError(`span file ${spanFileLabel(fileName)} could not be closed (${errnoCode(error)})`, { cause: error });
      }
    }
    if (closeError !== undefined) {
      if (closeError instanceof Error) throw closeError;
      throw new SafeSpanCorpusError(`span file ${spanFileLabel(fileName)} failed its bounded read`, { cause: closeError });
    }
    if (!sameDirectoryIdentity(statSync("."), corpusIdentity)) {
      throw new SafeSpanCorpusError("span corpus directory spans changed identity during file reads");
    }
  }
  if (eventsBeforeRoot.size > 0) {
    const [runId, events] = [...eventsBeforeRoot.entries()][0] ?? [];
    const issues = events?.map(({ event, fileName, lineNumber }) =>
      `${event.t} at ${spanFileLabel(fileName)}:${String(lineNumber)} appeared before run.queued`);
    throw new SafeSpanCorpusError(`span run ${runId ?? "unknown"} has no run.queued root: ${issues?.join("; ") ?? "unknown event"}`);
  }
  return Object.freeze(roots.map(immutableSpanRoot));
}

/**
 * Node exposes neither `openat` nor descriptor-based `readdir`. A synchronous
 * cwd critical section is the POSIX equivalent: every relative lookup starts
 * from the kernel-held current directory, no callback can interleave before
 * the original cwd is restored, and explicit re-entry refuses.
 */
let spanWorkingDirectoryTraversalActive = false;

type SpanAuthorityCorpus = Readonly<
  | { state: "present"; roots: readonly SpanAuthorityRunRoot[] }
  | { state: "missing"; roots: readonly [] }
>;

function spanAuthorityCorpus(stateRootTrustAnchor: string, stateRoot: string): SpanAuthorityCorpus {
  if (spanWorkingDirectoryTraversalActive) {
    throw new SafeSpanCorpusError("span corpus descriptor-relative traversal is already active in this process");
  }
  spanWorkingDirectoryTraversalActive = true;
  try {
    return withStateRootWorkingDirectory(stateRootTrustAnchor, stateRoot, () => {
      const roots = withNoFollowRelativeDirectory(
        "spans",
        "span corpus directory spans",
        true,
        (identity) => scanSpanAuthorityRoots(identity),
      );
      return roots === undefined
        ? { state: "missing", roots: [] }
        : { state: "present", roots };
    });
  } finally {
    spanWorkingDirectoryTraversalActive = false;
  }
}

/** Migration-only reuse of the doctor's bounded, no-follow span-root scan. */
export function inspectSpanAuthorityCorpusReadOnly(
  stateRootTrustAnchor: string,
  stateRoot: string,
): SpanAuthorityCorpus {
  return spanAuthorityCorpus(stateRootTrustAnchor, stateRoot);
}

function reconcileSpanAuthority(
  stateRootTrustAnchor: string,
  stateRoot: string,
  authorityPath: string,
  busyTimeoutMs: number,
): Readonly<{
  reconciliation: z.infer<typeof SpanAuthorityReconciliationSchema>;
  tombstoneOrdinalFindings?: SpanAuthorityReadSnapshot["tombstoneOrdinalFindings"];
  authorityIdentity?: Readonly<{ authorityGeneration: number; authorityContentFingerprint: string }>;
}> {
  let corpus: SpanAuthorityCorpus;
  try {
    corpus = spanAuthorityCorpus(stateRootTrustAnchor, stateRoot);
  } catch (error) {
    return {
      reconciliation: SpanAuthorityReconciliationSchema.parse({
        state: "unavailable",
        cause: {
          code: "span-stream-invalid",
          summary: error instanceof SafeSpanCorpusError
            ? error.message
            : `span corpus spans could not be safely inspected (${errnoCode(error)})`,
        },
      }),
    };
  }

  let snapshot: ReturnType<typeof AuthorityDatabase.inspectSpanRunAuthorityReadOnly>;
  try {
    snapshot = AuthorityDatabase.inspectSpanRunAuthorityReadOnly(
      authorityPath,
      corpus.roots,
      busyTimeoutMs,
    );
  } catch (error) {
    return {
      reconciliation: SpanAuthorityReconciliationSchema.parse({
        state: "unavailable",
        cause: {
          code: "span-authority-unavailable",
          summary: `authority ${basename(authorityPath)} could not reconcile span run IDs (${errnoCode(error)})`,
        },
      }),
    };
  }
  if (corpus.state === "missing" && snapshot.malformedRecords.length === 0
    && (snapshot.liveRunCount > 0 || snapshot.archivedRunCount > 0)) {
    return {
      reconciliation: SpanAuthorityReconciliationSchema.parse({
        state: "unavailable",
        cause: {
          code: "span-stream-invalid",
          summary: "span corpus directory spans is missing while authority holds "
            + `${String(snapshot.liveRunCount)} live and ${String(snapshot.archivedRunCount)} archived run(s)`,
        },
      }),
      authorityIdentity: {
        authorityGeneration: snapshot.authorityGeneration,
        authorityContentFingerprint: snapshot.authorityContentFingerprint,
      },
    };
  }
  const resolutions = snapshot.resolutions;
  const liveRunCount = resolutions.filter(({ state }) => state === "live").length;
  const archived = resolutions.flatMap((resolution) => resolution.state === "archived"
    ? [{ runId: resolution.runId, archivedAt: resolution.archivedAt }]
    : []);
  // D308: a root whose run carries a tombstone is ACCOUNTED. It is listed
  // beside the archived roots and is never a problem arm.
  const deleted = resolutions.flatMap((resolution) => resolution.state === "deleted"
    ? [{
      runId: resolution.runId,
      workflow: resolution.workflow,
      traceId: resolution.traceId,
      origin: resolution.origin,
      commandId: resolution.commandId,
      deletedAt: resolution.deletedAt,
    }]
    : []);
  const malformedResolutionKeys = new Set(resolutions.flatMap((resolution) =>
    resolution.state === "malformed" ? [`${resolution.table}\0${resolution.runId}`] : []));
  const problems = snapshot.malformedRecords.length > 0
    ? [
        ...resolutions.filter((resolution) => resolution.state === "malformed"),
        ...snapshot.malformedRecords.filter((record) => !malformedResolutionKeys.has(
          `${record.source === "current" ? "workflow_runs" : "archived_runs"}\0${record.recordKey}`)),
      ]
    : [
        ...resolutions.filter((resolution) => resolution.state === "missing" || resolution.state === "malformed"),
        ...snapshot.missingSpanRunIds.map((runId) => ({ state: "missing-span" as const, runId })),
      ];
  return {
    tombstoneOrdinalFindings: snapshot.tombstoneOrdinalFindings,
    reconciliation: SpanAuthorityReconciliationSchema.parse(problems.length === 0
      ? { state: "reconciled", streamRunCount: corpus.roots.length, liveRunCount, archived, deleted }
      : { state: "degraded", streamRunCount: corpus.roots.length, liveRunCount, archived, deleted, problems }),
    authorityIdentity: {
      authorityGeneration: snapshot.authorityGeneration,
      authorityContentFingerprint: snapshot.authorityContentFingerprint,
    },
  };
}

type AuthorityReadIdentity = Readonly<{
  authorityGeneration: number;
  authorityContentFingerprint: string;
}>;

function authorityIdentityOf(input: AuthorityReadIdentity): AuthorityReadIdentity {
  return {
    authorityGeneration: input.authorityGeneration,
    authorityContentFingerprint: input.authorityContentFingerprint,
  };
}

function sameAuthorityIdentity(left: AuthorityReadIdentity, right: AuthorityReadIdentity): boolean {
  return left.authorityGeneration === right.authorityGeneration
    && left.authorityContentFingerprint === right.authorityContentFingerprint;
}

type AuthorityIdentityRead = Readonly<
  | { state: "available"; identity: AuthorityReadIdentity }
  | { state: "unavailable"; cause: ReturnType<typeof storageHealthCauseFromError> }
>;

function inspectAuthorityIdentity(
  authorityPath: string,
  busyTimeoutMs: number,
): AuthorityIdentityRead {
  try {
    return {
      state: "available",
      identity: authorityIdentityOf(
        AuthorityDatabase.inspectAuthorityReadIdentityReadOnly(authorityPath, busyTimeoutMs),
      ),
    };
  } catch (error) {
    return { state: "unavailable", cause: storageHealthCauseFromError(error) };
  }
}

function authorityIdentityState(read: AuthorityIdentityRead): string {
  return read.state === "available" ? "available" : read.cause.code;
}

function authorityIdentityChanged(
  initial: AuthorityIdentityRead,
  final: AuthorityIdentityRead,
): Error {
  return new Error(
    `authority changed while the storage doctor awaited external evidence (initial=${authorityIdentityState(initial)}; final=${authorityIdentityState(final)})`,
    { cause: { initial, final } },
  );
}

export const BackupSummaryOptionsSchema = z.strictObject({
  backupDirectory: z.string().min(1),
  maxBackupAgeMs: z.number().int().positive().optional(),
});

export const SpanAuthorityHealthSummarySchema = z.strictObject({
  state: z.enum(["healthy", "degraded"]),
  summary: z.string().min(1),
});
export type SpanAuthorityHealthSummary = z.infer<typeof SpanAuthorityHealthSummarySchema>;

/** One health judgment consumed by preflight and the CLI; archived evidence is accounted evidence. */
export function summarizeSpanAuthorityReconciliation(input: unknown): SpanAuthorityHealthSummary {
  const reconciliation = SpanAuthorityReconciliationSchema.parse(input);
  if (reconciliation.state === "reconciled") {
    return SpanAuthorityHealthSummarySchema.parse({
      state: "healthy",
      summary: `span/authority identities reconcile (${String(reconciliation.liveRunCount)} current, `
        + `${String(reconciliation.archived.length)} archived, ${String(reconciliation.deleted.length)} deleted)`,
    });
  }
  if (reconciliation.state === "degraded") {
    const kinds = [...new Set(reconciliation.problems.map(({ state }) => state))].sort();
    return SpanAuthorityHealthSummarySchema.parse({
      state: "degraded",
      summary: `span/authority reconciliation is degraded (${kinds.join(", ")})`,
    });
  }
  return SpanAuthorityHealthSummarySchema.parse({
    state: "degraded",
    summary: `span/authority reconciliation is unavailable: ${reconciliation.cause.code}`,
  });
}

/**
 * The CHEAP backup indicator the bootstrap summary serves (ref dashboard-surfaces §2.5's
 * "expose age/health in Settings", 2i-D): newest parseable manifest, judged
 * by its own created-at age and the live authority generation gap. This
 * deliberately does NOT re-hash backup bytes — every manifest was
 * byte-verified against the backup COPY when it was written
 * (`AuthorityBackupService`), so the summary trusts write-time verification
 * and the full `doctorAuthorityStorage` re-verifies bytes on demand for
 * restore decisions. A manifest that no longer parses is treated as absent
 * here — "missing" is the fail-safe reading for a summary whose enum has no
 * invalid arm — and the doctor names the corruption precisely.
 */
export function summarizeBackupHealth(
  input: unknown,
  liveAuthorityGeneration: number | undefined,
  clock: Clock = systemClock,
): "current" | "stale" | "missing" {
  const options = BackupSummaryOptionsSchema.parse(input);
  const directory = resolve(options.backupDirectory);
  if (!existsSync(directory)) return "missing";
  const manifests = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".manifest.json"))
    .map(({ name }) => name);
  let newest: { createdAtMs: number; authorityGeneration: number } | undefined;
  for (const name of manifests) {
    let createdAtMs: number;
    let authorityGeneration: number;
    try {
      const manifest = parseBackupManifestFile(join(directory, name));
      createdAtMs = Date.parse(manifest.createdAt);
      authorityGeneration = manifest.authorityGeneration;
    } catch {
      // Unparseable is a REAL state the doctor reports as `invalid` with the
      // error named; the summary's closed enum has no such arm, so the file
      // simply does not count as a usable backup here.
      continue;
    }
    // Ties on created-at break by generation: two backups in one clock tick
    // are ordered by what they actually captured.
    if (newest === undefined
      || createdAtMs > newest.createdAtMs
      || (createdAtMs === newest.createdAtMs && authorityGeneration > newest.authorityGeneration)) {
      newest = { createdAtMs, authorityGeneration };
    }
  }
  if (newest === undefined) return "missing";
  const age = clock.nowMs() - newest.createdAtMs;
  if (options.maxBackupAgeMs !== undefined && age > options.maxBackupAgeMs) return "stale";
  if (liveAuthorityGeneration !== undefined
    && liveAuthorityGeneration > newest.authorityGeneration) {
    return "stale";
  }
  return "current";
}

type CandidateWithMtime = Readonly<{
  candidate: RestoreCandidate;
  modifiedMs: number;
}>;

function backupInvalidCause(error: unknown) {
  return StorageHealthCauseSchema.parse({
    code: "backup-invalid",
    summary: error instanceof Error ? error.message : String(error),
  });
}

/**
 * D282's read-only cross-check. Only exact identities from the one authority
 * path and the one span root participate; malformed evidence stops absence
 * classification instead of being skipped around as though it were empty.
 */

async function inspectCandidates(
  directory: string,
  sourceDatabaseIdentity: string,
  authorityInspection: AuthorityCopyInspection | undefined,
  clock: Clock,
): Promise<readonly CandidateWithMtime[]> {
  if (!existsSync(directory)) return [];
  const manifestNames = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".manifest.json"))
    .map(({ name }) => name)
    .sort();
  const candidates: CandidateWithMtime[] = [];
  for (const manifestFileName of manifestNames) {
    const manifestPath = join(directory, manifestFileName);
    const modifiedMs = statSync(manifestPath).mtimeMs;
    try {
      const verified = await verifyBackupManifestAtPath(manifestPath, sourceDatabaseIdentity);
      const ageMs = clock.nowMs() - Date.parse(verified.manifest.createdAt);
      if (ageMs < 0) throw new Error(`backup manifest ${manifestFileName} was created in the future`);
      const generationGap = authorityInspection === undefined
        ? { state: "unavailable" as const, reason: "live authority generation is unavailable" }
        : {
            state: "known" as const,
            value: Math.max(0, authorityInspection.authorityGeneration - verified.manifest.authorityGeneration),
          };
      candidates.push({
        modifiedMs,
        candidate: RestoreCandidateSchema.parse({
          state: "verified-compatible",
          manifestFileName,
          backupFileName: verified.manifest.backupFileName,
          createdAt: verified.manifest.createdAt,
          authorityGeneration: verified.manifest.authorityGeneration,
          ageMs,
          generationGap,
        }),
      });
    } catch (error) {
      candidates.push({
        modifiedMs,
        candidate: RestoreCandidateSchema.parse({
          state: "invalid",
          manifestFileName,
          cause: backupInvalidCause(error),
        }),
      });
    }
  }
  return candidates.sort((left, right) => right.modifiedMs - left.modifiedMs);
}

/** No credential value or value-bearing error may escape this presence observer. */
function inspectCredentialPresence(stateRoot: string) {
  try {
    const record = createCredentialStore({ stateRoot }).read();
    return ProtectedSettingsInspectionSchema.parse({
      state: "available",
      entries: ProtectedSettingsNameSchema.options.map((name) => ({
        name,
        present: record.entries[name] !== undefined,
      })),
    });
  } catch {
    return ProtectedSettingsInspectionSchema.parse({ state: "unavailable", cause: {
      code: "authority-unavailable",
      summary: `credentials in ${basename(join(stateRoot, "credentials"))} could not be verified read-only`,
    } });
  }
}

export async function doctorAuthorityStorage(input: unknown, clock: Clock = systemClock): Promise<StorageDoctorReport> {
  const options = StorageDoctorOptionsSchema.parse(input);
  const authorityPath = resolve(options.authorityPath);
  const stateRootTrustAnchor = resolve(options.stateRootTrustAnchor);
  const stateRoot = resolve(options.stateRoot);
  const backupDirectory = resolve(options.backupDirectory);
  const sourceDatabaseIdentity = AuthorityDatabase.sourceDatabaseIdentity(authorityPath);
  let authorityInspection: AuthorityCopyInspection | undefined;
  let authorityCause: ReturnType<typeof storageHealthCauseFromError> | undefined;
  try {
    authorityInspection = AuthorityDatabase.inspectExistingReadOnly(authorityPath, options.busyTimeoutMs);
  } catch (error) {
    authorityCause = storageHealthCauseFromError(error);
  }
  const initialAuthorityRead: AuthorityIdentityRead = authorityInspection === undefined
    ? inspectAuthorityIdentity(authorityPath, options.busyTimeoutMs)
    : { state: "available", identity: authorityIdentityOf(authorityInspection) };
  const initialAuthorityIdentity = initialAuthorityRead.state === "available"
    ? initialAuthorityRead.identity
    : undefined;

  const candidates = await inspectCandidates(
    backupDirectory,
    sourceDatabaseIdentity,
    authorityInspection,
    clock,
  );
  const first = candidates[0];
  const latestVerified = candidates
    .filter((entry): entry is CandidateWithMtime & { candidate: Extract<RestoreCandidate, { state: "verified-compatible" }> } => (
      entry.candidate.state === "verified-compatible"
    ))
    .sort((left, right) => Date.parse(right.candidate.createdAt) - Date.parse(left.candidate.createdAt))[0];

  let backup: z.infer<typeof BackupHealthSchema>;
  if (first?.candidate.state === "invalid") {
    backup = BackupHealthSchema.parse({ state: "invalid", cause: first.candidate.cause });
  } else if (latestVerified === undefined) {
    backup = BackupHealthSchema.parse({
      state: candidates.length === 0 ? "missing" : "invalid",
      cause: StorageHealthCauseSchema.parse({
        code: candidates.length === 0 ? "backup-missing" : "backup-invalid",
        summary: candidates.length === 0
          ? `no authority backup manifests exist in ${basename(backupDirectory)}`
          : `no verified compatible authority backup exists in ${basename(backupDirectory)}`,
      }),
    });
  } else {
    const generationGap = latestVerified.candidate.generationGap;
    const stale = (options.maxBackupAgeMs !== undefined && latestVerified.candidate.ageMs > options.maxBackupAgeMs)
      || generationGap.state === "known" && generationGap.value > 0;
    const gapSummary = generationGap.state === "known"
      ? String(generationGap.value)
      : generationGap.reason;
    backup = BackupHealthSchema.parse(stale
      ? {
          state: "stale",
          latest: latestVerified.candidate,
          cause: StorageHealthCauseSchema.parse({
            code: "backup-stale",
            summary: `latest verified backup is ${String(latestVerified.candidate.ageMs)}ms old with authority generation gap ${gapSummary}`,
          }),
        }
      : { state: "current", latest: latestVerified.candidate });
  }

  if (authorityInspection === undefined && authorityCause === undefined) {
    throw new Error("authority doctor produced neither an inspection nor a failure cause");
  }
  const spanAuthorityRead = reconcileSpanAuthority(
    stateRootTrustAnchor,
    stateRoot,
    authorityPath,
    options.busyTimeoutMs,
  );
  const spanAuthority = spanAuthorityRead.reconciliation;
  const spanAuthorityBecameIdentifiable = initialAuthorityIdentity === undefined
    && spanAuthorityRead.authorityIdentity !== undefined;
  const spanAuthorityIdentityMismatch = initialAuthorityIdentity !== undefined
    && spanAuthorityRead.authorityIdentity !== undefined
    && !sameAuthorityIdentity(initialAuthorityIdentity, spanAuthorityRead.authorityIdentity);
  const protectedSettings = inspectCredentialPresence(stateRoot);
  const finalAuthorityRead = inspectAuthorityIdentity(authorityPath, options.busyTimeoutMs);
  if (initialAuthorityRead.state !== finalAuthorityRead.state) {
    throw authorityIdentityChanged(initialAuthorityRead, finalAuthorityRead);
  }
  if (initialAuthorityRead.state === "available" && finalAuthorityRead.state === "available"
    && !sameAuthorityIdentity(initialAuthorityRead.identity, finalAuthorityRead.identity)) {
    throw authorityIdentityChanged(initialAuthorityRead, finalAuthorityRead);
  }
  if (initialAuthorityRead.state === "unavailable" && finalAuthorityRead.state === "unavailable"
    && (initialAuthorityRead.cause.code !== finalAuthorityRead.cause.code
      || initialAuthorityRead.cause.summary !== finalAuthorityRead.cause.summary)) {
    throw authorityIdentityChanged(initialAuthorityRead, finalAuthorityRead);
  }
  if (spanAuthorityBecameIdentifiable) {
    throw new Error("span authority became identifiable after the storage doctor's initial authority read");
  }
  if (spanAuthorityIdentityMismatch) {
    throw new Error("span authority snapshot does not match the storage doctor's initial authority identity");
  }
  return StorageDoctorReportSchema.parse({
    kind: "authority-storage-doctor",
    tombstoneOrdinals: spanAuthorityRead.tombstoneOrdinalFindings === undefined
      ? { state: "unavailable", cause: { code: "authority-unavailable", summary: "tombstone ordinals could not be verified in the span authority snapshot" } }
      : { state: "available", findings: spanAuthorityRead.tombstoneOrdinalFindings },
    protectedSettings,
    mode: "read-only",
    checkedAt: clock.now().toISOString(),
    sourceDatabaseIdentity,
    authority: authorityInspection === undefined
      ? { state: "degraded", cause: authorityCause }
      : { state: "healthy", inspection: authorityInspection },
    counts: authorityInspection === undefined
      ? { state: "unavailable", cause: authorityCause }
      : { state: "available", values: authorityInspection.counts },
    spanAuthority,
    backup,
    restoreCandidates: candidates.map(({ candidate }) => candidate),
  });
}
