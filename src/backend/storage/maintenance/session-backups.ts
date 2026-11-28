import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync, lstatSync, readdirSync, rmSync, rmdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import type { Clock } from "../../../rules/time/clock.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";
import type { RuntimeAdmission } from "../admission/admission.js";
import { fsyncPath } from "../private-path.js";
import { LOG_DATABASE_NAMES } from "../events/log-mutations.js";
import { AuthorityDatabase } from "../sqlite/authority-database.js";
import { AuthorityBackupService, backupLogFileMatches, backupLogPaths, parseBackupManifestFile, type AuthorityBackupSource } from "../sqlite/backup-service.js";
import { backupThreadIdle, copyAuthorityOffThread } from "../sqlite/backup-inspection-worker.js";
import type { AuthorityBackupManifest } from "../sqlite/recovery-contracts.js";
import { hasUnprovedSourceClosure } from "../source-closure.js";
import { StorageMaintenanceCustodyUnavailableError } from "./custody-availability.js";

export const SESSION_BACKUP_INTERVAL_MS = 60 * 60_000;
const CHECK_INTERVAL_MS = 60_000;
const RETRY_AFTER_FAILURE_MS = 5 * 60_000;
const SessionManifest = /^authority-g\d+-\d+-[0-9a-f-]{36}\.session\.sqlite\.manifest\.json$/u;
const SessionBackupFile = /^authority-g\d+-\d+-[0-9a-f-]{36}\.session\.sqlite$/u;
const ManifestSuffix = ".manifest.json";

export type SessionBackupCheck = "taken" | "recent" | "unchanged" | "failed" | "stopped" | "unavailable";

type DebugEvents = { emit(input: unknown): unknown };

export type SessionBackups = Readonly<{
  /** One pass of the hourly rule; resolves with what it did and never rejects. */
  check(): Promise<SessionBackupCheck>;
  /** Starts the one-minute timer and sets where failures are reported. */
  start(debugEvents: DebugEvents): void;
  /** A backup is in flight, its worker thread has not exited, or a source closure is unproved. */
  hasUnquiescedWork(): boolean;
  /** Stops the timer and aborts the in-flight backup; later checks answer "stopped". */
  requestCancellation(): void;
  /** Settles once the in-flight backup settled and every worker thread exited; rejects with an unproved source closure. */
  awaitCancellation(): Promise<void>;
}>;

type VerifiedManifest = Readonly<{ name: string; createdAt: string; authorityGeneration: number }>;

function fileIdentity(path: string): string {
  const stats = lstatSync(path, { bigint: true, throwIfNoEntry: false });
  return stats === undefined ? "missing" : `${String(stats.dev)}:${String(stats.ino)}:${String(stats.size)}:${String(stats.mtimeNs)}:${String(stats.ctimeNs)}`;
}

function isCustodyUnavailable(error: unknown): boolean {
  if (error instanceof StorageMaintenanceCustodyUnavailableError) return true;
  return error instanceof AggregateError && error.errors.some(isCustodyUnavailable);
}

/** Classify manifest content. Operational read failures stop the pass. */
function readManifest(path: string): { state: "valid"; manifest: AuthorityBackupManifest } | { state: "invalid" } {
  try { return { state: "valid", manifest: parseBackupManifestFile(path) }; }
  catch (error) {
    if (error instanceof SyntaxError || error instanceof z.ZodError || (error instanceof Error && error.message === "backup-profile-binding-required")) {
      return { state: "invalid" };
    }
    throw error;
  }
}

/** Whether the bytes match the manifest; false only for a confirmed absence, a non-file or a size or checksum mismatch. */
async function backupBytesMatch(path: string, manifest: AuthorityBackupManifest): Promise<boolean> {
  const stats = lstatSync(path, { throwIfNoEntry: false });
  if (stats === undefined || !stats.isFile() || stats.size !== manifest.byteSize) return false;
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  if (hash.digest("hex") !== manifest.sha256) return false;
  const logFiles = manifest.logFiles;
  if (logFiles !== undefined) {
    for (const name of LOG_DATABASE_NAMES) if (!await backupLogFileMatches(`${path}.${name}.db`, logFiles[name])) return false;
  }
  return true;
}

/** A backup file and the sidecars SQLite may leave beside it. */
function backupFiles(path: string): string[] {
  return [path, ...[path, ...backupLogPaths(path)].flatMap(database =>
    ["-wal", "-shm", "-journal"].map(suffix => database + suffix)), ...backupLogPaths(path)];
}

function removeBackupEntry(path: string): void {
  const metadata = lstatSync(path, { throwIfNoEntry: false });
  if (metadata?.isDirectory()) rmdirSync(path);
  else rmSync(path, { force: true });
}

function removeBackupFiles(path: string): void {
  for (const candidate of backupFiles(path).slice(1)) removeBackupEntry(candidate);
  removeBackupEntry(path);
}

/** A file as one pass classified it; its identity is "missing" when it was absent. */
type FileProof = Readonly<{ path: string; identity: string }>;
const proofs = (paths: readonly string[]): FileProof[] => paths.map(path => ({ path, identity: fileIdentity(path) }));

/** What a pass over the session manifests established: the kept pair (manifest, backup, then sidecars), and the files of pairs it proved older or invalid. */
type SessionPlan = Readonly<{ keep: readonly FileProof[]; retire: readonly FileProof[] }>;

function assertUnchanged(proof: FileProof): void {
  if (fileIdentity(proof.path) !== proof.identity) throw new Error("session-backup-retirement-changed");
}

/** Removes exactly the classified files, manifest first so a backup never stands without its proof, while every file keeps the identity it was classified with. */
function retire(admission: RuntimeAdmission, directory: string, plan: SessionPlan): void {
  if (plan.keep.length < 2 || plan.keep.slice(0, 2).some(proof => proof.identity === "missing")) throw new Error("session-backup-keeper-unproved");
  for (const proof of [...plan.keep, ...plan.retire]) assertUnchanged(proof);
  const retireOrder = [...plan.retire.filter(proof => !proof.path.endsWith(".sqlite")), ...plan.retire.filter(proof => proof.path.endsWith(".sqlite"))];
  for (const proof of retireOrder) {
    if (proof.identity === "missing") continue;
    assertUnchanged(proof);
    admission.assertAuthorityBackupWrite(directory);
    removeBackupEntry(proof.path); fsyncPath(directory);
  }
}

export function createSessionBackups(input: Readonly<{ admission: RuntimeAdmission; database: AuthorityDatabase; clock: Clock; directory: string }>): SessionBackups {
  const admission = requireRuntimeAdmission(input.admission), { database, clock, directory } = input;
  const authorityPath = join(admission.stateRoot, "state.db");
  const controller = new AbortController();
  let stopped = false, timer: NodeJS.Timeout | undefined, debugEvents: DebugEvents | undefined;
  let inFlight: Promise<SessionBackupCheck> | undefined, lingeringThread = false;
  let lastFailureMonotonicMs: number | undefined, closureFailure: { error: unknown } | undefined;
  const passed = new Map<string, string>();

  /**
   * The newest manifest of this profile and authority database, named for its backup, whose bytes verify; only a copy proved invalid is passed over.
   * forRetirement verifies the older ones too and lists, with the identities they were classified at, the files of every pair proved older or invalid
   * and of every session backup without a manifest; a future-dated pair is neither. A passed verdict stands while both files keep their identity.
   */
  const classify = async (only?: RegExp, forRetirement = false): Promise<SessionPlan & { newest: VerifiedManifest | undefined }> => {
    if (!existsSync(directory)) return { newest: undefined, keep: [], retire: [] };
    const sourceIdentity = AuthorityDatabase.sourceDatabaseIdentity(admission.authorityBackupExpectedSource()), listed = readdirSync(directory);
    const binding = admission.profileBinding, nowMs = clock.nowMs(), retired: FileProof[] = [];
    const candidates: Array<VerifiedManifest & { pair: FileProof[]; backup: AuthorityBackupManifest }> = [];
    for (const name of listed.filter(entry => entry.endsWith(ManifestSuffix) && (only === undefined || only.test(entry)))) {
      const manifestPath = join(directory, name), pair = proofs([manifestPath, ...backupFiles(manifestPath.slice(0, -ManifestSuffix.length))]);
      const parsed = readManifest(manifestPath);
      if (parsed.state === "invalid") { retired.push(...pair); continue; }
      const { manifest } = parsed;
      if (name !== `${manifest.backupFileName}${ManifestSuffix}` || manifest.installationId !== binding.installationId
        || manifest.profileId !== binding.profileId || manifest.sourceDatabaseIdentity !== sourceIdentity) { retired.push(...pair); continue; }
      if (Date.parse(manifest.createdAt) > nowMs) continue;
      candidates.push({ name, createdAt: manifest.createdAt, authorityGeneration: manifest.authorityGeneration, pair, backup: manifest });
    }
    const sessionNames = new Set(listed.map(entry => entry.replace(/\.(?:timeline|dashboard)\.db(?:-wal|-shm|-journal)?$/u, "")));
    if (forRetirement) for (const name of [...sessionNames].filter(entry => SessionBackupFile.test(entry) && !listed.includes(`${entry}${ManifestSuffix}`))) {
      // The manifest's confirmed absence is part of the proof: one published during the pass makes this a pair again.
      const path = join(directory, name), orphan = proofs([`${path}${ManifestSuffix}`, ...backupFiles(path)]);
      if (orphan[0].identity === "missing") retired.push(...orphan);
    }
    candidates.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt) || right.name.localeCompare(left.name));
    let newest: VerifiedManifest | undefined, keep: FileProof[] = [];
    for (const candidate of candidates) {
      const [manifest, backup] = candidate.pair, identity = candidate.pair.map(proof => proof.identity).join("|");
      if (passed.get(manifest.path) !== identity) {
        passed.delete(manifest.path);
        if (!await backupBytesMatch(backup.path, candidate.backup)) { retired.push(...candidate.pair); continue; }
        passed.set(manifest.path, identity);
      }
      if (newest === undefined) { newest = { name: candidate.name, createdAt: candidate.createdAt, authorityGeneration: candidate.authorityGeneration }; keep = candidate.pair; }
      else retired.push(...candidate.pair);
      if (!forRetirement) break;
    }
    return { newest, keep, retire: retired };
  };

  const stopScheduler = (): void => {
    stopped = true;
    if (timer !== undefined) { clearInterval(timer); timer = undefined; }
  };

  const source = (copies: string[]): AuthorityBackupSource => {
    // A commit during the copy must not make the copy "behind" what the request compares against, so the meta is fixed per copy.
    let snapshotMeta = database.getMeta();
    return {
      getMeta: () => snapshotMeta,
      getSourceDatabaseIdentity: () => database.getSourceDatabaseIdentity(),
      async onlineBackupTo(destination: string): Promise<number> {
        snapshotMeta = database.getMeta();
        copies.push(destination);
        await copyAuthorityOffThread(admission, authorityPath, destination, { signal: controller.signal });
        return statSync(destination).size;
      },
    };
  };

  const report = (): void => {
    try { debugEvents?.emit({ category: "worker", phase: "failed", correlationId: randomUUID(), area: "session-backup", reason: "session-backup-failed" }); }
    catch { /* A failed diagnostic append must not turn a kept backup into a rejected check. */ }
  };

  /** previous is the session plan of this same pass, retired only once the fresh pair is proved. */
  const take = async (previous: SessionPlan): Promise<SessionBackupCheck> => {
    const copies: string[] = [];
    let closureUnproved = false;
    try {
      const service = new AuthorityBackupService(admission, source(copies), { directory, purpose: "in-session" }, clock, controller.signal);
      const result = await service.request({ trigger: "interval", requiredGeneration: database.getMeta().authorityGeneration });
      const fresh = result.manifests.at(-1);
      if (fresh === undefined) throw new Error("session-backup-result-missing");
      // The request verified the fresh pair; its files are observed and verified again so the proof binds these exact files.
      const freshPath = join(directory, fresh.backupFileName), keep = proofs([`${freshPath}${ManifestSuffix}`, ...backupFiles(freshPath)]);
      const written = readManifest(`${freshPath}${ManifestSuffix}`);
      if (written.state === "invalid" || canonicalJsonStringify(written.manifest) !== canonicalJsonStringify(fresh) || !await backupBytesMatch(freshPath, written.manifest)) throw new Error("session-backup-fresh-unproved");
      retire(admission, directory, { keep, retire: [...previous.keep, ...previous.retire] });
      return "taken";
    } catch (error) {
      closureUnproved = hasUnprovedSourceClosure(error);
      throw error;
    } finally {
      // An aborted worker may still create its file after the request's own cleanup ran.
      lingeringThread = true;
      const idle = backupThreadIdle();
      void idle.then(() => {
        lingeringThread = false;
        // A copy whose descriptor close is unproved stays where the retained closure left it.
        if (controller.signal.aborted && !closureUnproved && closureFailure === undefined) for (const copy of copies) { try { removeBackupFiles(copy); } catch { /* The next start's sweep owns leftovers. */ } }
      });
    }
  };

  const decide = async (): Promise<SessionBackupCheck> => {
    if (closureFailure !== undefined) return "failed";
    if (stopped) return "stopped";
    // An interrupted replacement leaves two verified pairs; only the newest stays, once every lookup of this pass settled.
    const session = await classify(SessionManifest, true);
    const { newest } = await classify();
    // A pass that needs a new copy carries its plan forward instead.
    const settled = (outcome: SessionBackupCheck): SessionBackupCheck => { if (session.newest !== undefined) retire(admission, directory, session); return outcome; };
    if (newest !== undefined) {
      if (clock.nowMs() - Date.parse(newest.createdAt) <= SESSION_BACKUP_INTERVAL_MS) return settled("recent");
      if (newest.authorityGeneration === database.getMeta().authorityGeneration) return settled("unchanged");
    }
    // A pass that needs a new copy but may not take one yet retires nothing.
    if (lastFailureMonotonicMs !== undefined && clock.monotonicMs() - lastFailureMonotonicMs < RETRY_AFTER_FAILURE_MS) return "failed";
    return take(session);
  };

  const settleFailure = (error: unknown): SessionBackupCheck => {
    if (hasUnprovedSourceClosure(error)) {
      closureFailure ??= { error };
      stopScheduler();
      try { admission.retainSourceClosure(error); } catch { /* The remembered error keeps this profile's closure unproved. */ }
      return "failed";
    }
    if (controller.signal.aborted) return "stopped";
    if (isCustodyUnavailable(error)) { stopScheduler(); return "unavailable"; }
    lastFailureMonotonicMs = clock.monotonicMs();
    report();
    return "failed";
  };

  const check = (): Promise<SessionBackupCheck> => {
    if (inFlight !== undefined) return inFlight;
    const tracked = decide().catch(settleFailure).finally(() => { inFlight = undefined; });
    inFlight = tracked;
    return tracked;
  };

  return Object.freeze({
    check,
    start(events: DebugEvents): void {
      debugEvents = events;
      if (stopped || timer !== undefined) return;
      timer = setInterval(() => void check(), CHECK_INTERVAL_MS);
      timer.unref();
    },
    hasUnquiescedWork: () => closureFailure !== undefined || inFlight !== undefined || lingeringThread,
    requestCancellation(): void {
      stopScheduler();
      controller.abort(new DOMException("session backup stopped", "AbortError"));
    },
    async awaitCancellation(): Promise<void> {
      await inFlight;
      await backupThreadIdle();
      if (closureFailure !== undefined) throw closureFailure.error;
    },
  });
}
