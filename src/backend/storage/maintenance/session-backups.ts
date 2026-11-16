import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Clock } from "../../../rules/time/clock.js";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";
import type { RuntimeAdmission } from "../admission/admission.js";
import { fsyncPath } from "../private-path.js";
import type { AuthorityDatabase } from "../sqlite/authority-database.js";
import { AuthorityBackupService, parseBackupManifestFile, type AuthorityBackupSource } from "../sqlite/backup-service.js";
import { backupThreadIdle, copyAuthorityOffThread } from "../sqlite/backup-inspection-worker.js";
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
  /** A backup is in flight or its worker thread has not exited. */
  hasUnquiescedWork(): boolean;
  /** Stops the timer and aborts the in-flight backup; later checks answer "stopped". */
  requestCancellation(): void;
  /** Settles once the in-flight backup settled and every worker thread exited. */
  awaitCancellation(): Promise<void>;
}>;

/** Verified backups of any kind that belong to this profile, newest first by creation time. */
function newestBackupCreatedAt(admission: RuntimeAdmission, directory: string, nowMs: number): Readonly<{ createdAt: string; authorityGeneration: number }> | undefined {
  if (!existsSync(directory)) return undefined;
  const binding = admission.profileBinding;
  let newest: { createdAt: string; authorityGeneration: number } | undefined;
  for (const name of readdirSync(directory).filter(entry => entry.endsWith(ManifestSuffix))) {
    let manifest: ReturnType<typeof parseBackupManifestFile>;
    try { manifest = parseBackupManifestFile(join(directory, name)); } catch { continue; }
    if (manifest.installationId !== binding.installationId || manifest.profileId !== binding.profileId) continue;
    const createdMs = Date.parse(manifest.createdAt);
    if (createdMs > nowMs || newest !== undefined && createdMs <= Date.parse(newest.createdAt)) continue;
    newest = { createdAt: manifest.createdAt, authorityGeneration: manifest.authorityGeneration };
  }
  return newest;
}

function isCustodyUnavailable(error: unknown): boolean {
  if (error instanceof StorageMaintenanceCustodyUnavailableError) return true;
  return error instanceof AggregateError && error.errors.some(isCustodyUnavailable);
}

function removeBackupFiles(path: string): void {
  for (const candidate of [path, `${path}-wal`, `${path}-shm`, `${path}-journal`]) rmSync(candidate, { force: true });
}

/** Removes every other in-session backup, manifest first so a backup never stands without its proof. */
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
  let lastFailureMonotonicMs: number | undefined;

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
    } catch (error) {
      if (controller.signal.aborted) return "stopped";
      if (isCustodyUnavailable(error)) { stopScheduler(); return "unavailable"; }
      lastFailureMonotonicMs = clock.monotonicMs();
      report();
      return "failed";
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

  const decide = (): Promise<SessionBackupCheck> | SessionBackupCheck => {
    if (stopped) return "stopped";
    const newest = newestBackupCreatedAt(admission, directory, clock.nowMs());
    if (newest !== undefined) {
      if (clock.nowMs() - Date.parse(newest.createdAt) <= SESSION_BACKUP_INTERVAL_MS) return "recent";
      if (newest.authorityGeneration === database.getMeta().authorityGeneration) return "unchanged";
    }
    if (lastFailureMonotonicMs !== undefined && clock.monotonicMs() - lastFailureMonotonicMs < RETRY_AFTER_FAILURE_MS) return "failed";
    return take();
  };

  const check = (): Promise<SessionBackupCheck> => {
    if (inFlight !== undefined) return inFlight;
    let outcome: Promise<SessionBackupCheck> | SessionBackupCheck;
    try { outcome = decide(); }
    catch { lastFailureMonotonicMs = clock.monotonicMs(); report(); return Promise.resolve("failed"); }
    if (typeof outcome === "string") return Promise.resolve(outcome);
    const tracked = outcome.finally(() => { inFlight = undefined; });
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
    hasUnquiescedWork: () => inFlight !== undefined || lingeringThread,
    requestCancellation(): void {
      stopScheduler();
      controller.abort(new DOMException("session backup stopped", "AbortError"));
    },
    async awaitCancellation(): Promise<void> {
      await inFlight?.catch(() => undefined);
      await backupThreadIdle().catch(() => undefined);
    },
  });
}
