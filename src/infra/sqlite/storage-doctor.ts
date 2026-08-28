import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  statSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { z } from "zod";
import type { Clock } from "../../domain/clock.js";
import { systemClock } from "../../domain/clock.js";
import { SpanEventWireSchema } from "../../events/types.js";
import { listEventStreamFiles } from "../events/jsonl-streams.js";
import { AuthorityDatabase } from "./authority-database.js";
import { storageHealthCauseFromError } from "./authority-boot.js";
import { parseBackupManifestFile, verifyBackupManifestAtPath } from "./backup-service.js";
import {
  BackupHealthSchema,
  RestoreCandidateSchema,
  SpanAuthorityReconciliationSchema,
  StorageDoctorReportSchema,
  StorageHealthCauseSchema,
  type AuthorityCopyInspection,
  type RestoreCandidate,
  type StorageDoctorReport,
} from "./recovery-contracts.js";

export const StorageDoctorOptionsSchema = z.strictObject({
  stateRoot: z.string().min(1),
  authorityPath: z.string().min(1),
  backupDirectory: z.string().min(1),
  maxBackupAgeMs: z.number().int().positive(),
  busyTimeoutMs: z.number().int().positive(),
});

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const SPAN_DOCTOR_LIMITS = Object.freeze({
  maxFiles: 128,
  maxFileBytes: 8 * 1024 * 1024,
  maxCorpusBytes: 16 * 1024 * 1024,
  maxLineBytes: 256 * 1024,
  maxLines: 100_000,
  maxRunIds: 10_000,
});
const SPAN_READ_CHUNK_BYTES = 64 * 1024;

function errnoCode(error: unknown): string {
  if (typeof error !== "object" || error === null) return "unknown-error";
  const code: unknown = Reflect.get(error, "code");
  return typeof code === "string" ? code : "unknown-error";
}

type HeldDirectory = Readonly<{
  path: string;
  label: string;
  handle: number;
  device: number;
  inode: number;
}>;

function openNoFollowDirectory(path: string, label: string, allowMissing = false): HeldDirectory | undefined {
  let before: ReturnType<typeof lstatSync>;
  try {
    before = lstatSync(path);
  } catch (error) {
    if (allowMissing && errnoCode(error) === "ENOENT") return undefined;
    throw new Error(`${label} could not be inspected (${errnoCode(error)})`, { cause: error });
  }
  if (!before.isDirectory() || before.isSymbolicLink()) {
    throw new Error(`${label} is not a regular no-follow directory`);
  }
  let handle: number;
  try {
    handle = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  } catch (error) {
    throw new Error(`${label} could not be opened without following links (${errnoCode(error)})`, { cause: error });
  }
  const opened = fstatSync(handle);
  if (!opened.isDirectory() || opened.dev !== before.dev || opened.ino !== before.ino) {
    closeSync(handle);
    throw new Error(`${label} changed identity before enumeration`);
  }
  return { path, label, handle, device: opened.dev, inode: opened.ino };
}

function verifyHeldDirectory(directory: HeldDirectory): void {
  let current: ReturnType<typeof lstatSync>;
  try {
    current = lstatSync(directory.path);
  } catch (error) {
    throw new Error(`${directory.label} changed during enumeration (${errnoCode(error)})`, { cause: error });
  }
  const opened = fstatSync(directory.handle);
  if (!current.isDirectory()
    || current.isSymbolicLink()
    || current.dev !== directory.device
    || current.ino !== directory.inode
    || opened.dev !== directory.device
    || opened.ino !== directory.inode) {
    throw new Error(`${directory.label} changed identity during enumeration`);
  }
}

function strictSpanIssue(error: z.ZodError): string {
  const paths = [...new Set(error.issues.map((issue) => (
    issue.path.length === 0 ? "$" : issue.path.map(String).join(".")
  )))];
  return paths.slice(0, 8).join(", ");
}

function parseSpanLine(fileName: string, lineNumber: number, bytes: Buffer): z.infer<typeof SpanEventWireSchema> {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`span file ${fileName} line ${String(lineNumber)} is not valid UTF-8`, { cause: error });
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`span file ${fileName} line ${String(lineNumber)} is invalid JSON`, { cause: error });
  }
  const parsed = SpanEventWireSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `span file ${fileName} line ${String(lineNumber)} fails the strict span schema at ${strictSpanIssue(parsed.error)}`,
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

function scanSpanRunIds(stateRoot: string): readonly string[] {
  let files: ReturnType<typeof listEventStreamFiles>;
  try {
    files = listEventStreamFiles(stateRoot, "spans");
  } catch (error) {
    throw new Error(`span corpus enumeration failed (${errnoCode(error)})`, { cause: error });
  }
  if (files.length > SPAN_DOCTOR_LIMITS.maxFiles) {
    throw new Error(`span corpus has ${String(files.length)} files, exceeding the ${String(SPAN_DOCTOR_LIMITS.maxFiles)}-file limit`);
  }

  let declaredCorpusBytes = 0;
  let corpusBytesRead = 0;
  let linesRead = 0;
  const found = new Set<string>();
  for (const file of files) {
    const fileName = basename(file.path);
    let before: ReturnType<typeof lstatSync>;
    try {
      before = lstatSync(file.path);
    } catch (error) {
      throw new Error(`span file ${fileName} could not be inspected (${errnoCode(error)})`, { cause: error });
    }
    if (!before.isFile() || before.isSymbolicLink()) {
      throw new Error(`span file ${fileName} is not a regular no-follow file`);
    }
    if (before.size > SPAN_DOCTOR_LIMITS.maxFileBytes) {
      throw new Error(
        `span file ${fileName} exceeds the ${String(SPAN_DOCTOR_LIMITS.maxFileBytes)}-byte file limit`,
      );
    }
    declaredCorpusBytes += before.size;
    if (declaredCorpusBytes > SPAN_DOCTOR_LIMITS.maxCorpusBytes) {
      throw new Error(`span corpus exceeds the ${String(SPAN_DOCTOR_LIMITS.maxCorpusBytes)}-byte corpus limit`);
    }

    let handle: number;
    try {
      handle = openSync(file.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      throw new Error(`span file ${fileName} could not be opened without following links (${errnoCode(error)})`, { cause: error });
    }
    let closeError: unknown;
    try {
      const opened = fstatSync(handle);
      if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
        throw new Error(`span file ${fileName} changed identity before its no-follow read`);
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
          throw new Error(`span file ${fileName} exceeded the ${String(SPAN_DOCTOR_LIMITS.maxFileBytes)}-byte file limit while reading`);
        }
        if (corpusBytesRead > SPAN_DOCTOR_LIMITS.maxCorpusBytes) {
          throw new Error(`span corpus exceeded the ${String(SPAN_DOCTOR_LIMITS.maxCorpusBytes)}-byte corpus limit while reading`);
        }
        let start = 0;
        for (let index = 0; index < bytesRead; index += 1) {
          if (chunk[index] !== 0x0a) continue;
          const segment = chunk.subarray(start, index);
          lineBytes += segment.length;
          if (lineBytes > SPAN_DOCTOR_LIMITS.maxLineBytes) {
            throw new Error(`span file ${fileName} line ${String(lineNumber + 1)} exceeds the ${String(SPAN_DOCTOR_LIMITS.maxLineBytes)}-byte line limit`);
          }
          if (segment.length > 0) lineParts.push(Buffer.from(segment));
          lineNumber += 1;
          linesRead += 1;
          if (linesRead > SPAN_DOCTOR_LIMITS.maxLines) {
            throw new Error(`span corpus exceeds the ${String(SPAN_DOCTOR_LIMITS.maxLines)}-line limit`);
          }
          if (lineBytes > 0) {
            const event = parseSpanLine(fileName, lineNumber, Buffer.concat(lineParts, lineBytes));
            if (event.t === "run.queued") {
              found.add(event.runId);
              if (found.size > SPAN_DOCTOR_LIMITS.maxRunIds) {
                throw new Error(`span corpus exceeds the ${String(SPAN_DOCTOR_LIMITS.maxRunIds)}-run-ID limit`);
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
          throw new Error(`span file ${fileName} line ${String(lineNumber + 1)} exceeds the ${String(SPAN_DOCTOR_LIMITS.maxLineBytes)}-byte line limit`);
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
        if (closeError === undefined) closeError = new Error(`span file ${fileName} could not be closed (${errnoCode(error)})`, { cause: error });
      }
    }
    if (closeError !== undefined) {
      if (closeError instanceof Error) throw closeError;
      throw new Error(`span file ${fileName} failed its bounded read`, { cause: closeError });
    }
  }
  return [...found].sort();
}

function spanRunIds(stateRoot: string): readonly string[] {
  const parent = openNoFollowDirectory(stateRoot, `span corpus parent ${basename(stateRoot)}`);
  if (parent === undefined) throw new Error("span corpus parent unexpectedly disappeared");
  let corpus: HeldDirectory | undefined;
  try {
    corpus = openNoFollowDirectory(join(stateRoot, "spans"), "span corpus directory spans", true);
    if (corpus === undefined) {
      verifyHeldDirectory(parent);
      return [];
    }
    const runIds = scanSpanRunIds(stateRoot);
    verifyHeldDirectory(corpus);
    verifyHeldDirectory(parent);
    return runIds;
  } finally {
    if (corpus !== undefined) closeSync(corpus.handle);
    closeSync(parent.handle);
  }
}

function reconcileSpanAuthority(
  stateRoot: string,
  authorityPath: string,
  busyTimeoutMs: number,
): Readonly<{
  reconciliation: z.infer<typeof SpanAuthorityReconciliationSchema>;
  authorityIdentity?: Readonly<{ authorityGeneration: number; authorityContentFingerprint: string }>;
}> {
  let runIds: readonly string[];
  try {
    runIds = spanRunIds(stateRoot);
  } catch (error) {
    return {
      reconciliation: SpanAuthorityReconciliationSchema.parse({
        state: "unavailable",
        cause: { code: "span-stream-invalid", summary: message(error) },
      }),
    };
  }

  let snapshot: ReturnType<typeof AuthorityDatabase.inspectSpanRunAuthorityReadOnly>;
  try {
    snapshot = AuthorityDatabase.inspectSpanRunAuthorityReadOnly(
      authorityPath,
      runIds,
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
  const resolutions = snapshot.resolutions;
  const liveRunCount = resolutions.filter(({ state }) => state === "live").length;
  const archived = resolutions.flatMap((resolution) => resolution.state === "archived"
    ? [{ runId: resolution.runId, archivedAt: resolution.archivedAt }]
    : []);
  const problems = resolutions.filter((resolution) => (
    resolution.state === "missing" || resolution.state === "malformed"
  ));
  return {
    reconciliation: SpanAuthorityReconciliationSchema.parse(problems.length === 0
      ? { state: "reconciled", streamRunCount: runIds.length, liveRunCount, archived }
      : { state: "degraded", streamRunCount: runIds.length, liveRunCount, archived, problems }),
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

export const BackupSummaryOptionsSchema = z.strictObject({
  backupDirectory: z.string().min(1),
  maxBackupAgeMs: z.number().int().positive(),
});

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
  if (age > options.maxBackupAgeMs) return "stale";
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

export async function doctorAuthorityStorage(input: unknown, clock: Clock = systemClock): Promise<StorageDoctorReport> {
  const options = StorageDoctorOptionsSchema.parse(input);
  const authorityPath = resolve(options.authorityPath);
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
  let initialAuthorityIdentity: AuthorityReadIdentity | undefined = authorityInspection === undefined
    ? undefined
    : authorityIdentityOf(authorityInspection);
  if (initialAuthorityIdentity === undefined) {
    try {
      initialAuthorityIdentity = authorityIdentityOf(
        AuthorityDatabase.inspectSpanRunAuthorityReadOnly(authorityPath, [], options.busyTimeoutMs),
      );
    } catch {
      // The broad degraded cause remains authoritative when no strict raw
      // identity can be read; the final cause-equivalence check below still
      // refuses a transition to a different observable state.
    }
  }

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
    const stale = latestVerified.candidate.ageMs > options.maxBackupAgeMs
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
  const spanAuthorityRead = reconcileSpanAuthority(stateRoot, authorityPath, options.busyTimeoutMs);
  const spanAuthority = spanAuthorityRead.reconciliation;
  const spanAuthorityBecameIdentifiable = initialAuthorityIdentity === undefined
    && spanAuthorityRead.authorityIdentity !== undefined;
  const spanAuthorityIdentityMismatch = initialAuthorityIdentity !== undefined
    && spanAuthorityRead.authorityIdentity !== undefined
    && !sameAuthorityIdentity(initialAuthorityIdentity, spanAuthorityRead.authorityIdentity);
  let finalInspection: AuthorityCopyInspection | undefined;
  let finalCause: ReturnType<typeof storageHealthCauseFromError> | undefined;
  try {
    finalInspection = AuthorityDatabase.inspectExistingReadOnly(authorityPath, options.busyTimeoutMs);
  } catch (error) {
    finalCause = storageHealthCauseFromError(error);
  }
  let finalAuthorityIdentity: AuthorityReadIdentity | undefined = finalInspection === undefined
    ? undefined
    : authorityIdentityOf(finalInspection);
  if (finalAuthorityIdentity === undefined) {
    try {
      finalAuthorityIdentity = authorityIdentityOf(
        AuthorityDatabase.inspectSpanRunAuthorityReadOnly(authorityPath, [], options.busyTimeoutMs),
      );
    } catch {
      // Compared through the exact degraded cause below when raw identity is
      // unavailable at both ends.
    }
  }
  if (initialAuthorityIdentity !== undefined
    && (finalAuthorityIdentity === undefined
      || !sameAuthorityIdentity(initialAuthorityIdentity, finalAuthorityIdentity))) {
    throw new Error("authority changed while the storage doctor awaited external evidence");
  }
  if (initialAuthorityIdentity === undefined && finalAuthorityIdentity !== undefined) {
    throw new Error("authority changed while the storage doctor awaited external evidence");
  }
  if (spanAuthorityBecameIdentifiable) {
    throw new Error("span authority became identifiable after the storage doctor's initial authority read");
  }
  if (spanAuthorityIdentityMismatch) {
    throw new Error("span authority snapshot does not match the storage doctor's initial authority identity");
  }
  if (authorityInspection !== undefined) {
    if (finalInspection === undefined) {
      throw new Error(`authority became unreadable while the storage doctor awaited external evidence (${finalCause?.code ?? "unknown"})`);
    }
    if (finalInspection.authorityGeneration !== authorityInspection.authorityGeneration
      || finalInspection.authorityContentFingerprint !== authorityInspection.authorityContentFingerprint) {
      throw new Error("authority changed while the storage doctor awaited external evidence");
    }
  } else if (finalInspection !== undefined
    || finalCause?.code !== authorityCause?.code
    || finalCause?.summary !== authorityCause?.summary) {
    throw new Error("authority changed while the storage doctor awaited external evidence");
  }
  return StorageDoctorReportSchema.parse({
    kind: "authority-storage-doctor",
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
