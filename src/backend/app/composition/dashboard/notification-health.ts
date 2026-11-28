import { existsSync, lstatSync, readdirSync, statSync, statfsSync } from "node:fs";
import { join } from "node:path";
import type { z } from "zod";
import type { Clock } from "../../../../rules/time/clock.js";
import type { AuthorityDatabase } from "../../../storage/sqlite/authority-database.js";
import { inspectAuthorityOffThread } from "../../../storage/sqlite/authority-inspection-off-thread.js";
import { hasInspectionIntegrityFailureCode } from "../../../storage/sqlite/backup-inspection-worker.js";
import { backupLogPaths, parseBackupManifestFile, verifyBackupManifestOffThread } from "../../../storage/sqlite/backup-service.js";
import type { NotificationHealthSchema } from "../../../storage/sqlite/notification-publications.js";
import { sha256Hex } from "../../../../rules/validation/sha256.js";
import type { NotificationInbox } from "../../../runs/notifications/inbox.js";
import { StorageHealthConcernSchema } from "../../../../rules/notifications/notification-triggers.js";
import { listCanonicalRuns } from "../../../runs/queries/canonical-runs.js";
import type { RunRecordService } from "../../../runs/lifecycle/run-record-service.js";
import type { RuntimeAdmission } from "../../../storage/admission/admission.js";
import { isAuthoritySourceChanged } from "../../../storage/sqlite/readonly-authority-snapshot.js";

type InspectionVerdict = "sound" | "failed" | "overtaken";

async function inspectStore(admission: RuntimeAdmission, path: string, signal: AbortSignal | undefined): Promise<InspectionVerdict> {
  try { await inspectAuthorityOffThread(admission, path, { signal }); return "sound"; }
  catch (error) {
    if (signal?.aborted === true) throw error;
    if (isAuthoritySourceChanged(error)) return "overtaken";
    if (hasInspectionIntegrityFailureCode(error)) return "failed";
    throw error;
  }
}

export interface NotificationHealthReading { freeBytes: number; walBytes: number; integrityFailed: boolean; backupFailed: boolean; leaseExpired: boolean }
type ChangeKey = ReturnType<AuthorityDatabase["changeKey"]>;
/** Integrity and live-run heartbeats both hold until the store changes; lease age is re-judged against the clock on every pass. */
const inspected = new WeakMap<AuthorityDatabase, { key: ChangeKey; integrityFailed: boolean; heartbeats: readonly number[] }>();
/** The key an inspection still on its worker thread will be remembered under; an owned write while it runs moves it like a remembered one. */
const inFlight = new WeakMap<AuthorityDatabase, { key: ChangeKey }>();
const sameKey = (a: ChangeKey, b: ChangeKey) => a.authorityGeneration === b.authorityGeneration && a.dataVersion === b.dataVersion && a.totalChanges === b.totalChanges;
/** Runs a synchronous write this observer owns that touches no notification source; remembered keys follow it only when nothing else moved them before or during the write. */
function ownWrite<T>(database: AuthorityDatabase, write: () => T): T {
  const before = database.changeKey();
  const result = write();
  const entry = inspected.get(database);
  const after = database.changeKey();
  // A changed dataVersion means another connection committed, which this observer does not own.
  if (after.dataVersion !== before.dataVersion) return result;
  if (entry !== undefined && sameKey(entry.key, before)) inspected.set(database, { ...entry, key: after });
  const flight = inFlight.get(database);
  if (flight !== undefined && sameKey(flight.key, before)) flight.key = after;
  return result;
}
/** A stall line is this process's own diagnostic append; letting it move the key would re-inspect the store, stall again and loop. */
export function ownedDiagnostics(database: AuthorityDatabase, debugEvents: { emit(input: unknown): unknown }): { emit(input: unknown): unknown } {
  return { emit: input => ownWrite(database, () => debugEvents.emit(input)) };
}
type VerifiedBackup = Readonly<{ manifest: string; backupPath: string; backup: string }>;
const verifiedBackups = new WeakMap<AuthorityDatabase, ReadonlyMap<string, VerifiedBackup>>();
function fileIdentity(path: string, followLinks = true): string {
  const fileStat = followLinks ? statSync : lstatSync;
  const stats = fileStat(path, { bigint: true, throwIfNoEntry: false });
  return stats === undefined ? "missing" : `${String(stats.dev)}:${String(stats.ino)}:${String(stats.size)}:${String(stats.mtimeNs)}:${String(stats.ctimeNs)}`;
}
const backupFiles = (backupPath: string) => [backupPath, ...backupLogPaths(backupPath)]
  .flatMap(path => ["", "-wal", "-shm", "-journal"].map(suffix => fileIdentity(path + suffix, path === backupPath))).join("|");
/** No backup writer, credential reader, or unrelated outbox is called by this observation. An aborted read rejects: a stopped inspection is no reading. */
export async function readNotificationHealth(input: { admission: RuntimeAdmission; database: AuthorityDatabase; reader: Pick<RunRecordService, "list">; stateRoot: string; clock: Clock; signal?: AbortSignal }): Promise<NotificationHealthReading> {
  const { stateRoot, clock } = input;
  const filesystem = statfsSync(stateRoot, { bigint: true });
  const wal = join(stateRoot, "state.db-wal");
  const opening = input.database.changeKey();
  const prior = inspected.get(input.database);
  let integrityFailed: boolean, heartbeats: readonly number[];
  if (prior !== undefined && sameKey(prior.key, opening)) ({ integrityFailed, heartbeats } = prior);
  else {
    heartbeats = listCanonicalRuns(input.reader, "live").flatMap(run => "heartbeatAt" in run.lifecycle ? [Date.parse(run.lifecycle.heartbeatAt)] : []);
    const flight = { key: opening };
    inFlight.set(input.database, flight);
    let verdict: InspectionVerdict;
    try { verdict = await inspectStore(input.admission, join(stateRoot, "state.db"), input.signal); }
    finally { if (inFlight.get(input.database) === flight) inFlight.delete(input.database); }
    // A write that landed during the inspection is no verdict: the last one, remembered or stored, holds and the next pass inspects again.
    integrityFailed = verdict === "overtaken" ? prior?.integrityFailed ?? input.database.authority.notificationHealth.get("integrity-check")?.active === true : verdict === "failed";
    if (verdict !== "overtaken") inspected.set(input.database, { key: flight.key, integrityFailed, heartbeats });
  }
  const leaseExpired = heartbeats.some(heartbeatAt => clock.nowMs() - heartbeatAt > 60_000);
  let backupFailed = false;
  const backupRoot = join(stateRoot, "backups", "authority");
  const remembered = verifiedBackups.get(input.database), current = new Map<string, VerifiedBackup>();
  if (existsSync(backupRoot)) {
    for (const file of readdirSync(backupRoot).filter(name => name.endsWith(".manifest.json"))) {
      const manifestPath = join(backupRoot, file), manifest = fileIdentity(manifestPath), prior = remembered?.get(manifestPath);
      // The full verifier runs again only for a new or changed backup, on a worker thread; a failure is never remembered.
      if (prior !== undefined && prior.manifest === manifest && prior.backup === backupFiles(prior.backupPath)) { current.set(manifestPath, prior); continue; }
      try {
        // The verdict belongs to the files as they were before verification began; a backup that changed since is not the one inspected.
        const backupPath = join(backupRoot, parseBackupManifestFile(manifestPath).backupFileName), file = fileIdentity(backupPath), backup = backupFiles(backupPath);
        const verified = await verifyBackupManifestOffThread(input.admission, manifestPath, { signal: input.signal });
        if (verified.backupPath !== backupPath || fileIdentity(backupPath) !== file) throw new Error("backup-changed-during-inspection");
        if (fileIdentity(manifestPath) === manifest && backupFiles(backupPath) === backup) current.set(manifestPath, { manifest, backupPath, backup });
      } catch (error) {
        if (input.signal?.aborted === true) throw error;
        backupFailed = true;
      }
    }
  }
  verifiedBackups.set(input.database, current);
  return { freeBytes: Number(filesystem.bavail * filesystem.bsize), walBytes: existsSync(wal) ? statSync(wal).size : 0, integrityFailed, backupFailed, leaseExpired };
}

/** Publication first, checkpoint second. A crash between them retries the same durable source ID. A pass stopped before its reading writes and publishes nothing. */
export function createNotificationHealthObserver(input: { database: AuthorityDatabase; clock: Clock; inbox: NotificationInbox; read(): Promise<NotificationHealthReading>; signal?: AbortSignal }) {
  return async () => {
    const { database, clock } = input;
    const priorWal = database.authority.notificationHealth.get("wal-growth");
    if (priorWal !== undefined && clock.nowMs() - Date.parse(priorWal.observedAt) < 60_000) return;
    const stopped = () => input.signal?.aborted === true;
    if (stopped()) return;
    let reading: NotificationHealthReading;
    try { reading = await input.read(); }
    catch (error) { if (stopped()) return; throw error; }
    const at = clock.now().toISOString();
    const samples = [...(priorWal?.samples ?? []), { at, bytes: reading.walBytes }].slice(-3);
    const growing = samples.length === 3 && samples.every(sample => sample.bytes >= 256 * 1024 * 1024)
      && samples.every((sample, index) => index === 0 || sample.bytes > samples[index - 1].bytes && Date.parse(sample.at) - Date.parse(samples[index - 1].at) >= 60_000);
    const records: z.input<typeof NotificationHealthSchema>[] = [];
    for (const concern of StorageHealthConcernSchema.options) {
      if (concern === "outbox-stalled") continue;
      const previous = database.authority.notificationHealth.get(concern);
      const active = concern === "disk-space" ? reading.freeBytes < 1024 ** 3 : concern === "wal-growth" ? growing : concern === "integrity-check" ? reading.integrityFailed : concern === "backup" ? reading.backupFailed : reading.leaseExpired;
      const occurrence = (previous?.occurrence ?? 0) + (active && previous?.active !== true ? 1 : 0);
      if (active && previous?.active !== true) {
        await input.inbox.publish({ kind: "storage-degraded", concern, state: concern === "backup" || concern === "integrity-check" ? "failed" : "degraded",
          diagnosticFingerprint: sha256Hex(`notification-health:${concern}`) },
        { identity: sha256Hex(`notification-health:${concern}:${String(occurrence)}`), occurredAt: at });
      }
      records.push({ concern, active, occurrence, observedAt: at, samples: concern === "wal-growth" ? samples : [], createdAt: previous?.createdAt ?? at });
    }
    ownWrite(database, () => database.withAuthorityTransaction(repos => {
      for (const record of records) repos.notificationHealth.put(record);
    }));
  };
}
