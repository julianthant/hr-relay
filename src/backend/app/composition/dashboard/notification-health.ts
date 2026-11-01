import { existsSync, readdirSync, statSync, statfsSync } from "node:fs";
import { join } from "node:path";
import type { Clock } from "../../../../rules/time/clock.js";
import { AuthorityDatabase } from "../../../storage/sqlite/authority-database.js";
import { verifyBackupManifestAtPath } from "../../../storage/sqlite/backup-service.js";
import { sha256Hex } from "../../../../rules/validation/sha256.js";
import type { NotificationInbox } from "../../../runs/notifications/inbox.js";
import { StorageHealthConcernSchema } from "../../../../rules/notifications/notification-triggers.js";
import { listCanonicalRuns } from "../../../runs/queries/canonical-runs.js";
import type { RunRecordService } from "../../../runs/lifecycle/run-record-service.js";
import type { RuntimeAdmission } from "../../../storage/admission/admission.js";

export interface NotificationHealthReading { freeBytes: number; walBytes: number; integrityFailed: boolean; backupFailed: boolean; leaseExpired: boolean }
/** No backup writer, credential reader, or unrelated outbox is called by this observation. */
export async function readNotificationHealth(input: { admission: RuntimeAdmission; database: AuthorityDatabase; reader: Pick<RunRecordService, "list">; stateRoot: string; clock: Clock }): Promise<NotificationHealthReading> {
  const { stateRoot, clock } = input;
  const filesystem = statfsSync(stateRoot, { bigint: true });
  const wal = join(stateRoot, "state.db-wal");
  let integrityFailed = false;
  try { AuthorityDatabase.inspectExistingReadOnly(input.admission, join(stateRoot, "state.db")); } catch { integrityFailed = true; }
  let backupFailed = false;
  const backupRoot = join(stateRoot, "backups", "authority");
  if (existsSync(backupRoot)) {
    for (const file of readdirSync(backupRoot).filter(name => name.endsWith(".manifest.json"))) {
      try { await verifyBackupManifestAtPath(input.admission,join(backupRoot, file)); }
      catch { backupFailed = true; }
    }
  }
  const expiredWorker = input.database.authority.workerLeases.listLive().some(worker => "heartbeatAt" in worker.lifecycle && clock.nowMs() - Date.parse(worker.lifecycle.heartbeatAt) > 60_000);
  const leaseExpired = expiredWorker || listCanonicalRuns(input.reader, "live").some(run => "heartbeatAt" in run.lifecycle && clock.nowMs() - Date.parse(run.lifecycle.heartbeatAt) > 60_000);
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
      database.withAuthorityTransaction(repos => repos.notificationHealth.put({ concern, active, occurrence, observedAt: at, samples: concern === "wal-growth" ? samples : [], createdAt: previous?.createdAt ?? at }));
    }
  };
}
