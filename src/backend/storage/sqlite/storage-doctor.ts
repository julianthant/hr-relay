import { inspectRestoreEligibility, inspectStorageRecovery } from "./storage-recovery-status.js";
import { verifyBackupLocationEvidence } from "./backup-location-evidence.js";
import { validateStorageRelocationRestoreCandidate } from "./relocation-restore-candidate.js";
import { requireDatabaseSourcePath } from "./recovery-admission.js";
import { ProtectedSettingsNameSchema } from "../../../models/config/protected-settings.js";
import { TimelineRecordError } from "./timeline-repository.js";
import { createCredentialStore } from "../configuration/credential-store.js";
import { ProtectedSettingsInspectionSchema } from "./recovery-contracts.js";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readdirSync,
  statSync,
  type Stats,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { constants as systemConstants } from "node:os";
import { z } from "zod";
import type { Clock } from "../../../rules/time/clock.js";
import { systemClock } from "../../../rules/time/clock.js";
import {
  type RunQueuedWire,
  type SpanEventWire,
} from "../../../models/events/types.js";
import { AuthorityDatabase } from "./authority-database.js";
import { inspectAuthorityUpgradeStatus } from "./upgrade-status.js";
import { type RuntimeAdmission } from "../admission/admission.js";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";
import { storageHealthCauseFromError } from "./authority-boot.js";
import { parseBackupManifestFile } from "./backup-service.js";
import {
  BackupHealthSchema,
  PreviousLocationBackupSchema,
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
  // A schema-shaped filename can contain private data; report its digest instead.
  return `sha256:${createHash("sha256").update(fileName).digest("hex").replace(/(.{4})(?=.)/gu, "$1-")}`;
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

function addStreamIssue(root: MutableSpanAuthorityRoot, issue: string): void {
  if (!root.streamIssues.includes(issue)) root.streamIssues.push(issue);
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
  allowSameAttemptRequeue = false,
): void {
  if (!("runId" in event)) return;
  if (event.t === "transaction.fenced") root.possibleExternalWrite = true;
  const location = `${spanFileLabel(fileName)}:${String(lineNumber)}`;
  if (allowSameAttemptRequeue && event.t === "run.requeued") root.terminal = false;
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
    if (allowSameAttemptRequeue && event.nextAttempt === event.attempt) return;
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
    reconstructed: queued.repair !== undefined,
    initialAttempt: queued.attempt,
    finalAttempt: root.finalAttempt,
    streamIssues: root.streamIssues,
  });
}

type SpanAuthorityCorpus = Readonly<
  | { state: "present"; roots: readonly SpanAuthorityRunRoot[] }
  | { state: "missing"; roots: readonly [] }
>;

function timelineAuthorityCorpus(admission: RuntimeAdmission, authorityPath: string, busyTimeoutMs: number, includeRecoveryEvidence = false): SpanAuthorityCorpus & Readonly<{
  authorityGeneration: number; authorityContentFingerprint: string;
  recoveryEvidence: ReturnType<typeof AuthorityDatabase.inspectTimelineReadOnly>["recoveryEvidence"];
}> {
  const file = lstatSync(authorityPath);
  if (!file.isFile() || file.isSymbolicLink()) throw new SafeSpanCorpusError("timeline authority is not a regular no-follow file");
  const snapshot = AuthorityDatabase.inspectTimelineReadOnly(admission, authorityPath, busyTimeoutMs, includeRecoveryEvidence);
  const after = lstatSync(authorityPath);
  if (file.dev !== after.dev || file.ino !== after.ino) throw new SafeSpanCorpusError("timeline authority file changed identity during inspection");
  const rows = snapshot.records;
  const roots: MutableSpanAuthorityRoot[] = [];
  const firstRoot = new Map<string, MutableSpanAuthorityRoot>();
  const attempts = new Map<string, number>();
  const pending = new Map<string, typeof rows[number][]>();
  const validate = (root: MutableSpanAuthorityRoot, row: typeof rows[number]): void => {
    if (row.payload.kind !== "span" || row.payload.event.t === "run.queued") return;
    validateRunEventAgainstRoot(root, row.payload.event, `timeline:${row.workflow}:${row.retentionDate}`,
      row.cursor, attempts, row.source.kind === "native");
  };
  for (const row of rows) {
    if (row.payload.kind !== "span" || !("runId" in row.payload.event)) continue;
    const event = row.payload.event;
    if (event.t !== "run.queued") {
      const root = firstRoot.get(event.runId);
      if (root !== undefined) validate(root, row);
      else pending.set(event.runId, [...(pending.get(event.runId) ?? []), row]);
      continue;
    }
    const root: MutableSpanAuthorityRoot = { queued: event, finalAttempt: event.attempt, possibleExternalWrite: false,
      streamIssues: [], lastTimestampMs: Date.parse(event.ts), terminal: false, taskSpans: new Set() };
    roots.push(root);
    if (event.spanPath !== event.traceId) addStreamIssue(root, "run.queued root spanPath does not equal traceId");
    if (event.parentSpanPath !== undefined) addStreamIssue(root, "run.queued root unexpectedly names parentSpanPath");
    const duplicate = firstRoot.get(event.runId);
    if (duplicate === undefined) firstRoot.set(event.runId, root);
    else {
      const issue = `duplicate run.queued root for run ${event.runId}`;
      addStreamIssue(duplicate, issue);
      addStreamIssue(root, issue);
    }
    const key = `${event.workflow}\0${event.itemId}`;
    const previous = attempts.get(key);
    if (previous !== undefined && event.attempt <= previous) {
      addStreamIssue(root, `run.queued item attempt ${String(event.attempt)} did not strictly increase after ${String(previous)}`);
    }
    attempts.set(key, event.attempt);
    const prior = pending.get(event.runId) ?? [];
    pending.delete(event.runId);
    if (prior.length > 0) {
      if (event.repair !== undefined) {
        const repair = event.repair;
        if (repair.kind === "timeline-authority-reconstruction"
          && prior.some((entry) => entry.cursor > repair.priorCursor)) {
          addStreamIssue(root, "timeline repair does not cover the preceding event cursor");
        }
        for (const entry of prior) validate(root, entry);
      } else addStreamIssue(root, "run.queued appears after prior run event(s) without authority-reconstruction repair");
    }
  }
  // Retention may remove an ordinary queued root while retaining later events.
  // The canonical reconciliation reports that missing root without inventing it.
  return { state: "present", roots: roots.map(immutableSpanRoot),
    authorityGeneration: snapshot.authorityGeneration, authorityContentFingerprint: snapshot.authorityContentFingerprint,
    recoveryEvidence: snapshot.recoveryEvidence };
}

/** Quarantined SQLite is diagnostic recovery evidence only; it never feeds a current view. */
function displacedAuthorityProblems(admission: RuntimeAdmission, current: ReturnType<typeof timelineAuthorityCorpus>, busyTimeoutMs: number) {
  return withNoFollowRelativeDirectory("backups", "backup directory", true, () =>
    withNoFollowRelativeDirectory("suspects", "preserved authority directory", true, (directory) => {
    const names = readdirSync(".").sort();
    if (names.length > 384) throw new SafeSpanCorpusError("preserved authority file count exceeds the inspection limit");
    const databases = names.filter((name) => /^suspect-\d{17}-[0-9a-f-]{36}\.sqlite$/u.test(name));
    if (databases.length > 128) throw new SafeSpanCorpusError("preserved authority database count exceeds the inspection limit");
    const accepted = new Set(databases.flatMap((name) => [name, `${name}-wal`, `${name}-shm`]));
    if (names.some((name) => !accepted.has(name))) throw new SafeSpanCorpusError("preserved authority directory contains an unexpected entry");
    let bytes = 0;
    const observed = new Map<string, Stats>();
    for (const name of names) {
      const file = lstatSync(name);
      if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1) {
        throw new SafeSpanCorpusError("preserved authority is not a direct regular file");
      }
      bytes += file.size;
      if (bytes > 256 * 1024 * 1024) throw new SafeSpanCorpusError("preserved authority bytes exceed the inspection limit");
      observed.set(name, file);
    }
    const currentEvidence = current.recoveryEvidence;
    if (currentEvidence === undefined) throw new SafeSpanCorpusError("current recovery evidence was not inspected");
    const retained = new Map(currentEvidence.runs.map((run) => [run.runId, run]));
    const deleted = new Map(currentEvidence.deleted.map((run) => [run.runId, run]));
    const findings = new Map<string, { state: "missing" | "restore-loss"; runId: string; possibleExternalWrite?: true }>();
    for (const name of databases) {
      const source = AuthorityDatabase.inspectTimelineReadOnly(admission, name, busyTimeoutMs, true).recoveryEvidence;
      if (source === undefined) throw new SafeSpanCorpusError("preserved recovery evidence was not inspected");
      for (const run of source.runs) {
        const tombstone = deleted.get(run.runId);
        if (tombstone !== undefined) {
          if (tombstone.workflow !== run.workflow || tombstone.traceId !== run.traceId) {
            throw new SafeSpanCorpusError("preserved authority conflicts with a current deletion identity");
          }
          continue;
        }
        const owner = retained.get(run.runId);
        if (owner !== undefined && (owner.workflow !== run.workflow || owner.traceId !== run.traceId)) {
          throw new SafeSpanCorpusError("preserved authority conflicts with a current run identity");
        }
        if (owner !== undefined && owner.version >= run.version
          && run.attemptIds.every((id) => owner.attemptIds.includes(id))
          && run.confirmations.every((digest) => owner.confirmations.includes(digest))) continue;
        const prior = findings.get(run.runId);
        findings.set(run.runId, { state: owner === undefined ? "missing" : "restore-loss", runId: run.runId,
          ...(run.possibleExternalWrite || prior?.possibleExternalWrite === true ? { possibleExternalWrite: true as const } : {}) });
      }
    }
    const afterNames = readdirSync(".").sort();
    if (!sameDirectoryIdentity(statSync("."), directory)
      || names.some((name) => !afterNames.includes(name))) {
      throw new SafeSpanCorpusError("preserved authority directory changed during inspection");
    }
    // A read-only SQLite connection may initialize an empty WAL and shared-memory
    // cache for a checkpointed copy. Neither carries a new authority transaction.
    for (const name of afterNames.filter((name) => !observed.has(name))) {
      const file = lstatSync(name);
      const cache = accepted.has(name) && (name.endsWith("-shm") || (name.endsWith("-wal") && file.size === 0));
      if (!cache || !file.isFile() || file.isSymbolicLink() || file.nlink !== 1 || file.size > 64 * 1024) {
        throw new SafeSpanCorpusError("preserved authority directory changed during inspection");
      }
    }
    for (const [name, before] of observed) {
      const after = lstatSync(name);
      // SQLite read locks may update the shared-memory cache. The database and
      // WAL carry authority bytes; their identities and timestamps stay fixed.
      if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
        || (!name.endsWith("-shm") && (before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs))) {
        throw new SafeSpanCorpusError("preserved authority file changed during inspection");
      }
    }
    return [...findings.values()];
  })) ?? [];
}

function reconcileSpanAuthority(
  admission: RuntimeAdmission,
  stateRootTrustAnchor: string,
  stateRoot: string,
  authorityPath: string,
  busyTimeoutMs: number,
): Readonly<{
  reconciliation: z.infer<typeof SpanAuthorityReconciliationSchema>;
  tombstoneOrdinalFindings?: SpanAuthorityReadSnapshot["tombstoneOrdinalFindings"];
  authorityIdentity?: Readonly<{ authorityGeneration: number; authorityContentFingerprint: string }>;
}> {
  let corpus: ReturnType<typeof timelineAuthorityCorpus>;
  let displaced: ReturnType<typeof displacedAuthorityProblems> | undefined;
  try {
    const authorityName = relative(resolve(stateRoot), resolve(authorityPath));
    corpus = withStateRootWorkingDirectory(stateRootTrustAnchor, stateRoot, () => {
      if (authorityName !== basename(authorityName) || authorityName === "." || authorityName === "..") {
        throw new SafeSpanCorpusError("timeline authority must be a direct state-root file");
      }
      const current = timelineAuthorityCorpus(admission, authorityName, busyTimeoutMs, existsSync(join("backups", "suspects")));
      displaced = displacedAuthorityProblems(admission, current, busyTimeoutMs);
      return current;
    });
  } catch (error) {
    return {
      reconciliation: SpanAuthorityReconciliationSchema.parse({
        state: "unavailable",
        cause: {
          code: "span-stream-invalid",
          summary: error instanceof SafeSpanCorpusError || error instanceof TimelineRecordError
            ? error.message
            : `span corpus spans could not be safely inspected (${errnoCode(error)})`,
        },
      }),
    };
  }

  if (displaced === undefined) throw new Error("restore-evidence-inspection-missing");
  let snapshot: ReturnType<typeof AuthorityDatabase.inspectSpanRunAuthorityReadOnly>;
  try {
    snapshot = AuthorityDatabase.inspectSpanRunAuthorityReadOnly(
      admission,
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
  if (snapshot.authorityGeneration !== corpus.authorityGeneration
    || snapshot.authorityContentFingerprint !== corpus.authorityContentFingerprint) {
    return { reconciliation: SpanAuthorityReconciliationSchema.parse({ state: "unavailable",
      cause: { code: "span-authority-unavailable", summary: "timeline and run authority changed between read snapshots; inspect again" },
    }) };
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
          `${record.source === "current" ? "runs" : "archived_runs"}\0${record.recordKey}`)),
      ]
    : [
        ...resolutions.filter((resolution) => resolution.state === "missing" || resolution.state === "malformed"),
        ...snapshot.missingSpanRunIds.map((runId) => ({ state: "missing-span" as const, runId })),
        ...displaced,
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
  admission: RuntimeAdmission,
  authorityPath: string,
  busyTimeoutMs: number,
): AuthorityIdentityRead {
  try {
    return {
      state: "available",
      identity: authorityIdentityOf(
        AuthorityDatabase.inspectAuthorityReadIdentityReadOnly(admission, authorityPath, busyTimeoutMs),
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


export function summarizeBackupHealth(
  input: unknown,
  liveAuthorityGeneration: number | undefined,
  clock: Clock = systemClock,
): "current" | "stale" | "missing" | "unavailable" {
  const options = BackupSummaryOptionsSchema.parse(input);
  const directory = resolve(options.backupDirectory);
  if (basename(directory) !== "authority" || basename(dirname(directory)) !== "backups") {
    throw new Error("backup-summary-directory-shape-mismatch");
  }
  const activeIdentity = AuthorityDatabase.sourceDatabaseIdentity(join(dirname(dirname(directory)), "state.db"));
  let manifests: string[];
  try {
    if (!lstatSync(directory).isDirectory()) return "missing";
    manifests = readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".manifest.json"))
      .map(({ name }) => name);
  } catch (error) { return errnoCode(error) === "ENOENT" ? "missing" : "unavailable"; }
  let newest: { createdAtMs: number; authorityGeneration: number } | undefined;
  for (const name of manifests) {
    let createdAtMs: number;
    let authorityGeneration: number;
    try {
      const manifest = parseBackupManifestFile(join(directory, name));
      if (manifest.sourceDatabaseIdentity !== activeIdentity) continue;
      const copy = lstatSync(join(directory, manifest.backupFileName));
      if (!copy.isFile() || copy.size !== manifest.byteSize) continue;
      createdAtMs = Date.parse(manifest.createdAt);
      authorityGeneration = manifest.authorityGeneration;
    } catch (error) {
      const code = errnoCode(error);
      if (/^E[A-Z]+$/u.test(code) && code !== "ENOENT") return "unavailable";
      // An invalid manifest or missing copy cannot be a usable backup.
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
type PreviousWithMtime = Readonly<{
  backup: z.infer<typeof PreviousLocationBackupSchema>;
  modifiedMs: number;
}>;

async function inspectCandidates(
  admission: RuntimeAdmission,
  directory: string,
  authorityInspection: AuthorityCopyInspection | undefined,
  stateRoot: string,
  clock: Clock,
): Promise<Readonly<{ current: readonly CandidateWithMtime[]; previous: readonly PreviousWithMtime[] }>> {
  requireDatabaseSourcePath(join(directory, "probe"));
  try { lstatSync(directory); } catch (error) { if (errnoCode(error) === "ENOENT") return { current: [], previous: [] }; throw error; }
  const manifestNames = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.name.endsWith(".manifest.json"))
    .map(({ name }) => name)
    .sort();
  const candidates: CandidateWithMtime[] = [];
  const previous: PreviousWithMtime[] = [];
  for (const manifestFileName of manifestNames) {
    const manifestPath = join(directory, manifestFileName);
    const modifiedMs = lstatSync(manifestPath).mtimeMs;
    try {
      requireDatabaseSourcePath(manifestPath);
      const { verified, origin, selection } = await verifyBackupLocationEvidence(admission, join(stateRoot, "state.db"), manifestPath);
      const ageMs = clock.nowMs() - Date.parse(verified.manifest.createdAt);
      if (ageMs < 0) throw new Error(`backup manifest ${manifestFileName} was created in the future`);
      if (origin === "previous-location") {
        previous.push({ modifiedMs, backup: PreviousLocationBackupSchema.parse({
          selection,
          schemaVersion: verified.manifest.schemaVersion,
          manifestFileName,
          backupFileName: verified.manifest.backupFileName,
          createdAt: verified.manifest.createdAt,
          authorityGeneration: verified.manifest.authorityGeneration,
          restoreEligibility: "not-admitted",
        }) });
        continue;
      }
      const generationGap = authorityInspection === undefined
        ? { state: "unavailable" as const, reason: "live authority generation is unavailable" }
        : {
            state: "known" as const,
            value: Math.max(0, authorityInspection.authorityGeneration - verified.manifest.authorityGeneration),
          };
      let restoreEligibility = inspectRestoreEligibility(admission,{ schemaVersion: verified.manifest.schemaVersion,
        backupPath: verified.backupPath,
        backupSha256: verified.manifest.sha256, stateRoot, authorityAvailable: authorityInspection !== undefined });
      if (restoreEligibility.state === "eligible") {
        try {
          validateStorageRelocationRestoreCandidate({ admission, activeAuthorityPath: join(stateRoot, "state.db"),
            verifiedBackup: verified });
        } catch {
          restoreEligibility = { state: "unavailable", reason: "Backup does not prove the active relocation history." };
        }
      }
      candidates.push({
        modifiedMs,
        candidate: RestoreCandidateSchema.parse({
          state: "verified-compatible",
          selection,
          schemaVersion: verified.manifest.schemaVersion,
          restoreEligibility,
          manifestFileName,
          backupFileName: verified.manifest.backupFileName,
          createdAt: verified.manifest.createdAt,
          authorityGeneration: verified.manifest.authorityGeneration,
          ageMs,
          generationGap,
        }),
      });
    } catch {
      candidates.push({
        modifiedMs,
        candidate: RestoreCandidateSchema.parse({
          state: "invalid",
          manifestFileName,
          cause: StorageHealthCauseSchema.parse({
            code: "backup-invalid",
            summary: "The selected backup could not be authenticated as a complete readable recovery source. Check its manifest, identity, databases and retained files.",
          }),
        }),
      });
    }
  }
  return { current: candidates.sort((left, right) => right.modifiedMs - left.modifiedMs),
    previous: previous.sort((left, right) => right.modifiedMs - left.modifiedMs) };
}

/** No credential value or value-bearing error may escape this presence observer. */
function inspectCredentialPresence(admission: RuntimeAdmission, stateRoot: string) {
  try {
    const record = createCredentialStore({ admission, stateRoot }).read();
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

export async function doctorAuthorityStorage(admission: RuntimeAdmission, input: unknown, clock: Clock = systemClock): Promise<StorageDoctorReport> {
  requireRuntimeAdmission(admission);
  const options = StorageDoctorOptionsSchema.parse(input);
  const authorityPath = resolve(options.authorityPath);
  const stateRootTrustAnchor = resolve(options.stateRootTrustAnchor);
  const stateRoot = resolve(options.stateRoot);
  const backupDirectory = resolve(options.backupDirectory);
  if (stateRoot !== admission.stateRoot || authorityPath !== join(stateRoot, "state.db")
    || backupDirectory !== join(stateRoot, "backups", "authority")) {
    throw new Error("runtime-admission: storage doctor roots differ from active locator");
  }
  const sourceDatabaseIdentity = AuthorityDatabase.sourceDatabaseIdentity(authorityPath);
  let authorityInspection: AuthorityCopyInspection | undefined;
  let authorityCause: ReturnType<typeof storageHealthCauseFromError> | undefined;
  try {
    authorityInspection = AuthorityDatabase.inspectExistingReadOnly(admission, authorityPath, options.busyTimeoutMs);
  } catch (error) {
    authorityCause = storageHealthCauseFromError(error);
  }
  const initialAuthorityRead: AuthorityIdentityRead = authorityInspection === undefined
    ? inspectAuthorityIdentity(admission, authorityPath, options.busyTimeoutMs)
    : { state: "available", identity: authorityIdentityOf(authorityInspection) };
  const initialAuthorityIdentity = initialAuthorityRead.state === "available"
    ? initialAuthorityRead.identity
    : undefined;

  const initialRecovery = inspectStorageRecovery(admission, sourceDatabaseIdentity);
  let candidates: readonly CandidateWithMtime[] = [];
  let previous: readonly PreviousWithMtime[] = [];
  let candidateInspectionFailed = false;
  try {
    const inspected = await inspectCandidates(admission,backupDirectory, authorityInspection, stateRoot, clock);
    candidates = inspected.current;
    previous = inspected.previous;
  } catch { candidateInspectionFailed = true; }
  const first = candidates[0];
  const latestVerified = candidates
    .filter((entry): entry is CandidateWithMtime & { candidate: Extract<RestoreCandidate, { state: "verified-compatible" }> } => (
      entry.candidate.state === "verified-compatible"
    ))
    .sort((left, right) => Date.parse(right.candidate.createdAt) - Date.parse(left.candidate.createdAt))[0];

  let backup: z.infer<typeof BackupHealthSchema>;
  if (candidateInspectionFailed) {
    backup = BackupHealthSchema.parse({ state: "invalid", cause: { code: "backup-invalid",
      summary: "Backup directory inspection is unavailable; no restore selection can be established." } });
  } else if (first?.candidate.state === "invalid") {
    backup = BackupHealthSchema.parse({ state: "invalid", cause: first.candidate.cause });
  } else if (latestVerified === undefined) {
    backup = BackupHealthSchema.parse({
      state: candidates.length === 0 ? "missing" : "invalid",
      cause: StorageHealthCauseSchema.parse({
        code: candidates.length === 0 ? "backup-missing" : "backup-invalid",
        summary: candidates.length === 0
          ? previous.length > 0
            ? "no current-location authority backup exists; verified previous-location backups remain preserved"
            : `no authority backup manifests exist in ${basename(backupDirectory)}`
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
    admission,
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
  const protectedSettings = inspectCredentialPresence(admission, stateRoot);
  const authorityUpgrades = inspectAuthorityUpgradeStatus(admission, authorityPath, options.busyTimeoutMs, clock);
  const finalAuthorityRead = inspectAuthorityIdentity(admission, authorityPath, options.busyTimeoutMs);
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
  const finalRecovery = inspectStorageRecovery(admission, sourceDatabaseIdentity);
  const recovery = initialRecovery.identity === finalRecovery.identity ? finalRecovery.report
    : { state: "unavailable", findings: finalRecovery.report.state === "clear" ? [] : finalRecovery.report.findings,
      cause: { code: "authority-unavailable", summary: "Recovery evidence changed during inspection. Run the doctor again before deciding recovery." } };
  return StorageDoctorReportSchema.parse({
    recovery,
    authorityUpgrades,
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
    ...(previous.length === 0 ? {} : { previousLocationBackups: previous.map(({ backup }) => backup) }),
  });
}
