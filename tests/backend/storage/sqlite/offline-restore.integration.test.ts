import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/profile-browser-closure.js";
import { createBoundProfileFixture, boundProfileCredentials } from "../../../support/helpers/admission-fixture.js";
import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createNotificationInbox } from "../../../../src/backend/runs/notifications/inbox.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityBackupService } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { OfflineAuthorityRestoreService } from "../../../../src/backend/storage/sqlite/offline-restore.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";

{

describe("corruption → degraded → automatic restore → rebuild", () => {

  it("restores exact inbox, source and health metadata through the real backup/restore boundary", async () => {
    const profile = await createBoundProfileFixture(), admission = profile.admission;
    const root = profile.stateRoot, path = profile.path;
    const clock = manualClock(new Date("2026-09-10T20:00:00Z"));
    const f = { root, path, clock, input: { processLockRoot: join(profile.workspace, rebuildRuntimeIsolation.processLockRoot) } };
    try {
      const open = () => AuthorityDatabase.open(profile.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "notification-restore" }, f.clock,
        undefined, undefined, undefined, boundProfileCredentials(profile.admission));
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


      const operation = admission.acquireOfflineMaintenance();
      const manifest = backup.manifests[0]; expect(manifest).toBeDefined();
      const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admission, { authorityPath: f.path, suspectDirectory: join(f.root, "backups", "suspects"), busyTimeoutMs: 250, processLockRoot: f.input.processLockRoot}, async (stagedPath, restoreAdmission) => { const stagedAdmission = admission.stoppedRestoreProjection(stagedPath, restoreAdmission); try { const staged = AuthorityDatabase.openStoppedRestoreProjection(stagedAdmission, { path: stagedPath, busyTimeoutMs: 250, migrationOwner: "notification-projection-proof" }, f.clock); staged.close(); } finally { stagedAdmission.release(); } }, f.clock, undefined, boundProfileCredentials(admission));
      await restore.restore({ manifestPath: join(f.root, "backups", "authority", `${manifest.backupFileName}.manifest.json`) }, operation);
      assert.throws(() => admission.assertProfileRuntime(), /profile-restore-context-expired/u);
      profile.renewAfterRestore();
      db = open();
      try {
        expect({ row: db.authority.notifications.get(report.notification.notificationId), sources: db.authority.notificationPublications.list(), health: db.authority.notificationHealth.get("disk-space") }).toEqual(expected);
        expect((await createNotificationInbox({ authority: db, clock: f.clock, ids: sequentialIdFactory("a"), actorId: "local-operator" }).publish(event)).durable).toBe("existing");
      } finally { db.close(); }
    } finally { await profile.close(); }
  });
});
}
