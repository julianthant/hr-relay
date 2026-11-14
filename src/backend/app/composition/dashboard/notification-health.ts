import { existsSync, readdirSync, statSync, statfsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Clock } from "../../../../rules/time/clock.js";
import { AuthorityDatabase } from "../../../storage/sqlite/authority-database.js";
import { parseBackupManifestFile, verifyBackupBytesAtPath } from "../../../storage/sqlite/backup-service.js";
import { authoritySourceDatabaseIdentity } from "../../../storage/sqlite/database-identity.js";
import { sha256Hex } from "../../../../rules/validation/sha256.js";
import type { NotificationInbox } from "../../../runs/notifications/inbox.js";
import { followOwnedWrite } from "./notification-sources.js";
import { StorageHealthConcernSchema } from "../../../../rules/notifications/notification-triggers.js";
import { listCanonicalRuns } from "../../../runs/queries/canonical-runs.js";
import type { RunRecordService } from "../../../runs/lifecycle/run-record-service.js";
import type { RuntimeAdmission } from "../../../storage/admission/admission.js";

export interface NotificationHealthReading { freeBytes: number; walBytes: number; integrityFailed: boolean; backupFailed: boolean; leaseExpired: boolean }
type ChangeKey = ReturnType<AuthorityDatabase["changeKey"]>;
const inspected = new WeakMap<AuthorityDatabase, { key: ChangeKey; integrityFailed: boolean }>();
const sameKey = (a: ChangeKey, b: ChangeKey) => a.authorityGeneration === b.authorityGeneration && a.dataVersion === b.dataVersion && a.totalChanges === b.totalChanges;
/** Runs a synchronous write this observer owns that touches no notification source; remembered keys follow it only when nothing else moved them before or during the write. */
function ownWrite<T>(database: AuthorityDatabase, write: () => T): T {
  const before = database.changeKey();
  const result = write();
  const entry = inspected.get(database);
  const after = database.changeKey();
  // A changed dataVersion means another connection committed, which this observer does not own.
  if (after.dataVersion !== before.dataVersion) return result;
  if (entry !== undefined && sameKey(entry.key, before)) inspected.set(database, { key: after, integrityFailed: entry.integrityFailed });
  followOwnedWrite(database, before, after);
  return result;
}
/** A stall line is this process's own diagnostic append; letting it move the key would re-inspect the store, stall again and loop. */
export function ownedDiagnostics(database: AuthorityDatabase, debugEvents: { emit(input: unknown): unknown }): { emit(input: unknown): unknown } {
  return { emit: input => ownWrite(database, () => debugEvents.emit(input)) };
}
type CheckedBackup = { manifest: string; backupPath: string; backup: string; failed: boolean };
const checkedBackups = new WeakMap<AuthorityDatabase, ReadonlyMap<string, CheckedBackup>>();
function fileIdentity(path: string): string {
  const stats = statSync(path, { bigint: true, throwIfNoEntry: false });
  return stats === undefined ? "missing" : `${String(stats.dev)}:${String(stats.ino)}:${String(stats.size)}:${String(stats.mtimeNs)}:${String(stats.ctimeNs)}`;
}
/** A manifest is written only after its bytes passed full inspection, so a binding and checksum match proves the backup is still that verified copy. */
async function assertBackupUnchanged(admission: RuntimeAdmission, manifestPath: string): Promise<{ backupPath: string; backup: string }> {
  const expected = admission.authorityBackupExpectedSource();
  if (expected.kind !== "profile") throw new Error("profile-backup-binding-required");
  const manifest = parseBackupManifestFile(manifestPath);
  if (manifest.sourceDatabaseIdentity !== authoritySourceDatabaseIdentity(expected)
    || manifest.installationId !== expected.binding.installationId || manifest.profileId !== expected.binding.profileId) throw new Error("backup-profile-binding-mismatch");
  const backupPath = join(dirname(manifestPath), manifest.backupFileName), backup = fileIdentity(backupPath);
  await verifyBackupBytesAtPath(backupPath, manifest);
  return { backupPath, backup };
}
/** No backup writer, credential reader, or unrelated outbox is called by this observation. */
export async function readNotificationHealth(input: { admission: RuntimeAdmission; database: AuthorityDatabase; reader: Pick<RunRecordService, "list">; stateRoot: string; clock: Clock }): Promise<NotificationHealthReading> {
  const { stateRoot, clock } = input;
  const filesystem = statfsSync(stateRoot, { bigint: true });
  const wal = join(stateRoot, "state.db-wal");
  const leaseExpired = listCanonicalRuns(input.reader, "live").some(run => "heartbeatAt" in run.lifecycle && clock.nowMs() - Date.parse(run.lifecycle.heartbeatAt) > 60_000);
  const opening = input.database.changeKey();
  const prior = inspected.get(input.database);
  let integrityFailed: boolean;
  if (prior !== undefined && sameKey(prior.key, opening)) integrityFailed = prior.integrityFailed;
  else {
    integrityFailed = false;
    try { AuthorityDatabase.inspectExistingReadOnly(input.admission, join(stateRoot, "state.db")); } catch { integrityFailed = true; }
    inspected.set(input.database, { key: opening, integrityFailed });
  }
  let backupFailed = false;
  const backupRoot = join(stateRoot, "backups", "authority");
  const remembered = checkedBackups.get(input.database), current = new Map<string, CheckedBackup>();
  if (existsSync(backupRoot)) {
    for (const file of readdirSync(backupRoot).filter(name => name.endsWith(".manifest.json"))) {
      const manifestPath = join(backupRoot, file), prior = remembered?.get(manifestPath);
      let checked: CheckedBackup;
      if (prior !== undefined && !prior.failed && prior.manifest === fileIdentity(manifestPath) && prior.backup === fileIdentity(prior.backupPath)) checked = prior;
      else {
        const manifest = fileIdentity(manifestPath);
        let verified = { backupPath: manifestPath, backup: manifest }, failed = false;
        try { verified = await assertBackupUnchanged(input.admission, manifestPath); } catch { failed = true; }
        checked = { manifest, ...verified, failed };
      }
      current.set(manifestPath, checked);
      backupFailed ||= checked.failed;
    }
  }
  checkedBackups.set(input.database, current);
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
