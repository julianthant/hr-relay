import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Clock } from "../../../rules/time/clock.js";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";
import type { RuntimeAdmission } from "../admission/admission.js";
import { fsyncPath } from "../private-path.js";
import type { AuthorityDatabase } from "../sqlite/authority-database.js";
import { AuthorityBackupService, parseBackupManifestFile, verifyBackupBytesAtPath, type AuthorityBackupSource } from "../sqlite/backup-service.js";
import { backupThreadIdle, copyAuthorityOffThread } from "../sqlite/backup-inspection-worker.js";
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

function readManifest(path: string) {
  try { return parseBackupManifestFile(path); } catch { return undefined; }
}

function fileIdentity(path: string): string {
  const stats = statSync(path, { bigint: true, throwIfNoEntry: false });
  return stats === undefined ? "missing" : `${String(stats.dev)}:${String(stats.ino)}:${String(stats.size)}:${String(stats.mtimeNs)}:${String(stats.ctimeNs)}`;
}

function isCustodyUnavailable(error: unknown): boolean {
  if (error instanceof StorageMaintenanceCustodyUnavailableError) return true;
  return error instanceof AggregateError && error.errors.some(isCustodyUnavailable);
}

function removeBackupFiles(path: string): void {
  for (const candidate of [path, `${path}-wal`, `${path}-shm`, `${path}-journal`]) rmSync(candidate, { force: true });
}

/** Removes every in-session backup but the kept one, manifest first so a backup never stands without its proof. */
function retainOnlyNewestSessionBackup(admission: RuntimeAdmission, directory: string, keepFileName: string): void {
  const names = readdirSync(directory), keepManifest = `${keepFileName}${ManifestSuffix}`;
  const withManifest = new Set<string>();
  for (const name of names.filter(entry => SessionManifest.test(entry))) {
    const backupName = name.slice(0, -ManifestSuffix.length);
    withManifest.add(backupName);
    if (name === keepManifest) continue;
    admission.assertAuthorityBackupWrite(directory);
    rmSync(join(directory, name)); fsyncPath(directory);
    removeBackupFiles(join(directory, backupName)); fsyncPath(directory);
  }
  for (const name of names.filter(entry => SessionBackupFile.test(entry))) {
    if (name === keepFileName || withManifest.has(name)) continue;
    admission.assertAuthorityBackupWrite(directory);
    removeBackupFiles(join(directory, name)); fsyncPath(directory);
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

  /** Manifests of this profile whose backup bytes verify, newest first; a passed verdict stands while both files keep their identity. */
  const newestVerified = async (only?: RegExp): Promise<VerifiedManifest | undefined> => {
    if (!existsSync(directory)) return undefined;
    const binding = admission.profileBinding, nowMs = clock.nowMs(), candidates: Array<VerifiedManifest & { manifestPath: string; backup: NonNullable<ReturnType<typeof readManifest>> }> = [];
    for (const name of readdirSync(directory).filter(entry => entry.endsWith(ManifestSuffix) && (only === undefined || only.test(entry)))) {
      const manifestPath = join(directory, name), manifest = readManifest(manifestPath);
      if (manifest === undefined || manifest.installationId !== binding.installationId || manifest.profileId !== binding.profileId || Date.parse(manifest.createdAt) > nowMs) continue;
      candidates.push({ name, createdAt: manifest.createdAt, authorityGeneration: manifest.authorityGeneration, manifestPath, backup: manifest });
    }
    candidates.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt) || right.name.localeCompare(left.name));
    for (const candidate of candidates) {
      const backupPath = join(directory, candidate.backup.backupFileName), identity = `${fileIdentity(candidate.manifestPath)}|${fileIdentity(backupPath)}`;
      if (passed.get(candidate.manifestPath) !== identity) {
        try { await verifyBackupBytesAtPath(backupPath, candidate.backup); } catch { passed.delete(candidate.manifestPath); continue; }
        passed.set(candidate.manifestPath, identity);
      }
      return { name: candidate.name, createdAt: candidate.createdAt, authorityGeneration: candidate.authorityGeneration };
    }
    return undefined;
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

  const take = async (): Promise<SessionBackupCheck> => {
    const copies: string[] = [];
    try {
      const service = new AuthorityBackupService(admission, source(copies), { directory, purpose: "in-session" }, clock, controller.signal);
      const result = await service.request({ trigger: "interval", requiredGeneration: database.getMeta().authorityGeneration });
      const fresh = result.manifests.at(-1);
      if (fresh === undefined) throw new Error("session-backup-result-missing");
      retainOnlyNewestSessionBackup(admission, directory, fresh.backupFileName);
      return "taken";
    } finally {
      // An aborted worker may still create its file after the request's own cleanup ran.
      lingeringThread = true;
      const idle = backupThreadIdle();
      void idle.then(() => {
        lingeringThread = false;
        if (controller.signal.aborted) for (const copy of copies) { try { removeBackupFiles(copy); } catch { /* The next start's sweep owns leftovers. */ } }
      });
    }
  };

  const decide = async (): Promise<SessionBackupCheck> => {
    if (closureFailure !== undefined) return "failed";
    if (stopped) return "stopped";
    // An interrupted replacement leaves two verified pairs; only the newest stays.
    const session = await newestVerified(SessionManifest);
    if (session !== undefined) retainOnlyNewestSessionBackup(admission, directory, session.name.slice(0, -ManifestSuffix.length));
    const newest = await newestVerified();
    if (newest !== undefined) {
      if (clock.nowMs() - Date.parse(newest.createdAt) <= SESSION_BACKUP_INTERVAL_MS) return "recent";
      if (newest.authorityGeneration === database.getMeta().authorityGeneration) return "unchanged";
    }
    if (lastFailureMonotonicMs !== undefined && clock.monotonicMs() - lastFailureMonotonicMs < RETRY_AFTER_FAILURE_MS) return "failed";
    return take();
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
      await inFlight?.catch(() => undefined);
      await backupThreadIdle().catch(() => undefined);
      if (closureFailure !== undefined) throw closureFailure.error;
    },
  });
}
