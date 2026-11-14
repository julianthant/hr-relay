import { existsSync, readdirSync, statSync, statfsSync } from "node:fs";
import { join } from "node:path";
import type { Clock } from "../../../../rules/time/clock.js";
import { AuthorityDatabase } from "../../../storage/sqlite/authority-database.js";
import { verifyBackupManifestAtPath } from "../../../storage/sqlite/backup-service.js";
import { sha256Hex } from "../../../../rules/validation/sha256.js";
import type { NotificationInbox } from "../../../runs/notifications/inbox.js";
import { followOwnedWrite } from "./notification-sources.js";
import { StorageHealthConcernSchema } from "../../../../rules/notifications/notification-triggers.js";
import { listCanonicalRuns } from "../../../runs/queries/canonical-runs.js";
import type { RunRecordService } from "../../../runs/lifecycle/run-record-service.js";
import type { RuntimeAdmission } from "../../../storage/admission/admission.js";

export interface NotificationHealthReading { freeBytes: number; walBytes: number; integrityFailed: boolean; backupFailed: boolean; leaseExpired: boolean }
type ChangeKey = ReturnType<AuthorityDatabase["changeKey"]>;
/** Integrity and live-run heartbeats both hold until the store changes; lease age is re-judged against the clock on every pass. */
const inspected = new WeakMap<AuthorityDatabase, { key: ChangeKey; integrityFailed: boolean; heartbeats: readonly number[] }>();
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
  followOwnedWrite(database, before, after);
  return result;
}
/** A stall line is this process's own diagnostic append; letting it move the key would re-inspect the store, stall again and loop. */
export function ownedDiagnostics(database: AuthorityDatabase, debugEvents: { emit(input: unknown): unknown }): { emit(input: unknown): unknown } {
  return { emit: input => ownWrite(database, () => debugEvents.emit(input)) };
}
type VerifiedBackup = Readonly<{ manifest: string; backupPath: string; backup: string }>;
const verifiedBackups = new WeakMap<AuthorityDatabase, ReadonlyMap<string, VerifiedBackup>>();
function fileIdentity(path: string): string {
  const stats = statSync(path, { bigint: true, throwIfNoEntry: false });
  return stats === undefined ? "missing" : `${String(stats.dev)}:${String(stats.ino)}:${String(stats.size)}:${String(stats.mtimeNs)}:${String(stats.ctimeNs)}`;
}
/** A backup's verdict depends on its manifest, its database file and that file's SQLite companions. */
const backupFiles = (backupPath: string) => ["", "-wal", "-shm", "-journal"].map(suffix => fileIdentity(`${backupPath}${suffix}`)).join("|");
/** No backup writer, credential reader, or unrelated outbox is called by this observation. */
export async function readNotificationHealth(input: { admission: RuntimeAdmission; database: AuthorityDatabase; reader: Pick<RunRecordService, "list">; stateRoot: string; clock: Clock }): Promise<NotificationHealthReading> {
  const { stateRoot, clock } = input;
  const filesystem = statfsSync(stateRoot, { bigint: true });
  const wal = join(stateRoot, "state.db-wal");
  const opening = input.database.changeKey();
  const prior = inspected.get(input.database);
  let integrityFailed: boolean, heartbeats: readonly number[];
  if (prior !== undefined && sameKey(prior.key, opening)) ({ integrityFailed, heartbeats } = prior);
  else {
    heartbeats = listCanonicalRuns(input.reader, "live").flatMap(run => "heartbeatAt" in run.lifecycle ? [Date.parse(run.lifecycle.heartbeatAt)] : []);
    integrityFailed = false;
    try { AuthorityDatabase.inspectExistingReadOnly(input.admission, join(stateRoot, "state.db")); } catch { integrityFailed = true; }
    inspected.set(input.database, { key: opening, integrityFailed, heartbeats });
  }
  const leaseExpired = heartbeats.some(heartbeatAt => clock.nowMs() - heartbeatAt > 60_000);
  let backupFailed = false;
  const backupRoot = join(stateRoot, "backups", "authority");
  const remembered = verifiedBackups.get(input.database), current = new Map<string, VerifiedBackup>();
  if (existsSync(backupRoot)) {
    for (const file of readdirSync(backupRoot).filter(name => name.endsWith(".manifest.json"))) {
      const manifestPath = join(backupRoot, file), manifest = fileIdentity(manifestPath), prior = remembered?.get(manifestPath);
      // The full verifier runs again only for a new or changed backup; a failure is never remembered.
      if (prior !== undefined && prior.manifest === manifest && prior.backup === backupFiles(prior.backupPath)) { current.set(manifestPath, prior); continue; }
      try {
        const { backupPath } = await verifyBackupManifestAtPath(input.admission, manifestPath);
        if (fileIdentity(manifestPath) === manifest) current.set(manifestPath, { manifest, backupPath, backup: backupFiles(backupPath) });
      } catch { backupFailed = true; }
    }
  }
  verifiedBackups.set(input.database, current);
  return { freeBytes: Number(filesystem.bavail * filesystem.bsize), walBytes: existsSync(wal) ? statSync(wal).size : 0, integrityFailed, backupFailed, leaseExpired };
}

/** Publication first, checkpoint second. A crash between them retries the same durable source ID. */
export function createNotificationHealthObserver(input: { database: AuthorityDatabase; clock: Clock; inbox: NotificationInbox; read(): Promise<NotificationHealthReading> }) {
  return async () => {
    const { database, clock } = input;
    const priorWal = database.authority.notificationHealth.get("wal-growth");
    if (priorWal !== undefined && clock.nowMs() - Date.parse(priorWal.observedAt) < 60_000) return;
    const reading = await input.read();
    const at = clock.now().toISOString();
    const samples = [...(priorWal?.samples ?? []), { at, bytes: reading.walBytes }].slice(-3);
    const growing = samples.length === 3 && samples.every(sample => sample.bytes >= 256 * 1024 * 1024)
      && samples.every((sample, index) => index === 0 || sample.bytes > samples[index - 1].bytes && Date.parse(sample.at) - Date.parse(samples[index - 1].at) >= 60_000);
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
      ownWrite(database, () => database.withAuthorityTransaction(repos => repos.notificationHealth.put({ concern, active, occurrence, observedAt: at, samples: concern === "wal-growth" ? samples : [], createdAt: previous?.createdAt ?? at })));
    }
  };
}
