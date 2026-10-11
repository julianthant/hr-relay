import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { acquireEntrypointAdmission } from "../../../../../../src/backend/storage/admission/bootstrap-admission.js";
import { AuthorityBackupService } from "../../../../../../src/backend/storage/sqlite/backup-service.js";
import { OfflineAuthorityRestoreService } from "../../../../../../src/backend/storage/sqlite/offline-restore.js";
import { manualClock } from "../../../../../../src/rules/time/clock.js";
import { RecoveryStopProofStore } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { AuthorityDatabase } from "../../../../../../src/backend/storage/sqlite/authority-database.js";
import { observeRuntimeLockSnapshot } from "../../../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { createNotificationInbox } from "../../../../../../src/backend/runs/notifications/inbox.js";
import { sequentialIdFactory } from "../../../../../support/fixtures/phase1f-run-fixtures.js";

describe("native notification recovery", () => {
  it("restores exact inbox, source and health metadata through the real backup/restore boundary", async () => {
    const workspace = mkdtempSync(join(realpathSync(tmpdir()), "notification-native-restore-"));
    const admission = acquireEntrypointAdmission(workspace, "exclusive");
    const root = admission.stateRoot, path = join(root, "state.db");
    const clock = manualClock(new Date("2026-09-10T20:00:00Z"));
    const f = { root, path, clock, input: { processLockRoot: join(root, "locks") } };
    try {
      const open = () => AuthorityDatabase.open(admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "notification-restore" }, f.clock);
      let db = open();
      const inbox = createNotificationInbox({ authority: db, clock: f.clock, ids: sequentialIdFactory("a"), actorId: "local-operator" });
      const event = { kind: "storage-degraded", concern: "disk-space", state: "degraded", diagnosticFingerprint: "a".repeat(64) };
      const report = await inbox.publish(event); inbox.markRead(report.notification.notificationId, 1);
      db.withAuthorityTransaction(repos => repos.notificationHealth.put({ concern: "disk-space", active: true, occurrence: 1, samples: [], observedAt: f.clock.now().toISOString(), createdAt: f.clock.now().toISOString() }));
      const expected = { row: inbox.get(report.notification.notificationId), sources: db.authority.notificationPublications.list(), health: db.authority.notificationHealth.get("disk-space") };
      db.close();
      const backupDb = open();
      const backup = await new AuthorityBackupService(admission, backupDb, { directory: join(root, "backups", "authority") }, clock)
        .request({ trigger: "operator", requiredGeneration: backupDb.getMeta().authorityGeneration });
      backupDb.close();
      db = open(); db.authority.notifications.updateState({ notificationId: report.notification.notificationId, expectedVersion: 2, status: "unread", snooze: { state: "not-snoozed" }, updatedAt: f.clock.now().toISOString() }); db.close();
      const identity = AuthorityDatabase.sourceDatabaseIdentity(f.path);
      const proofStore = new RecoveryStopProofStore({ processLockRoot: f.input.processLockRoot, maxProofAgeMs: 60_000 }, f.clock);
      proofStore.recordRuntimeState(observeRuntimeLockSnapshot({ processLockRoot: f.input.processLockRoot, sourceDatabaseIdentity: identity }, f.clock));
      const stoppedSystemProof = proofStore.issue({ observedBy: "local-operator", sourceDatabaseIdentity: identity });
      const manifest = backup.manifests[0]; expect(manifest).toBeDefined();
      const restore = new OfflineAuthorityRestoreService(admission, { authorityPath: f.path, suspectDirectory: join(f.root, "backups", "suspects"), busyTimeoutMs: 250, processLockRoot: f.input.processLockRoot, stoppedProofMaxAgeMs: 60_000 }, async stagedPath => { const stagedAdmission = admission.stoppedStagedAuthority(stagedPath); try { const staged = AuthorityDatabase.open(stagedAdmission, { path: stagedPath, busyTimeoutMs: 250, migrationOwner: "notification-projection-proof" }, f.clock); staged.close(); } finally { stagedAdmission.release(); } }, f.clock);
      await restore.restore({ manifestPath: join(f.root, "backups", "authority", `${manifest.backupFileName}.manifest.json`), stoppedSystemProof });
      db = open();
      try {
        expect({ row: db.authority.notifications.get(report.notification.notificationId), sources: db.authority.notificationPublications.list(), health: db.authority.notificationHealth.get("disk-space") }).toEqual(expected);
        expect((await createNotificationInbox({ authority: db, clock: f.clock, ids: sequentialIdFactory("a"), actorId: "local-operator" }).publish(event)).durable).toBe("existing");
      } finally { db.close(); }
    } finally { admission.release(); rmSync(workspace, { recursive: true, force: true }); }
  });
});
