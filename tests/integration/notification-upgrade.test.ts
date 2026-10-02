import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { storageRecoveryFixture } from "./helpers/storage-recovery-fixture.js";
import { AuthorityDatabase, OfflineAuthorityRestoreService, RecoveryStopProofStore } from "../helpers/synthetic-storage-admission.js";
import { observeRuntimeLockSnapshot } from "../../src/backend/storage/sqlite/runtime-process-locks.js";
import { upgradeStorage } from "../helpers/synthetic-storage-admission.js";
import { createNotificationInbox } from "../../src/backend/runs/notifications/inbox.js";
import { sequentialIdFactory } from "../fixtures/phase1f-run-fixtures.js";
import { NOTIFICATION } from "../fixtures/phase1c-contract-fixtures.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION, UPGRADE_FLOOR_SCHEMA_VERSION } from "../../src/backend/storage/sqlite/migrations.js";

describe("notification schema upgrade and recovery", () => {
  it.each([0, 46, 47, 48, 49, 50, 51])("preserves old inbox exactly through supported source %s", async version => {
    const f = storageRecoveryFixture(version);
    try {
      if (version > 0) {
        const raw = new DatabaseSync(f.path);
        try { raw.prepare("INSERT INTO notifications(record_key,record_json,created_at,actor_id,dedupe_fingerprint,status,seen_count,version) VALUES (?,?,?,?,?,?,?,?)")
          .run(NOTIFICATION.notificationId, JSON.stringify(NOTIFICATION), NOTIFICATION.createdAt, NOTIFICATION.actorId, NOTIFICATION.dedupeFingerprint, NOTIFICATION.status, NOTIFICATION.count, NOTIFICATION.version); } finally { raw.close(); }
        await f.backup();
      }
      expect((await f.run()).state).toBe("converted");
      const db = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "notification-upgrade" }, f.clock);
      try {
        expect(db.authority.notificationPublications.list()).toEqual([]);
        if (version > 0) expect(db.authority.notifications.get(NOTIFICATION.notificationId)).toEqual(NOTIFICATION);
        expect(CURRENT_AUTHORITY_SCHEMA_VERSION).toBe(52); expect(UPGRADE_FLOOR_SCHEMA_VERSION).toBe(46);
      } finally { db.close(); }
    } finally { f.dispose(); }
  });
  it.each(["beforeCommit", "afterCommit"] as const)("resumes stopped conversion at %s", async boundary => {
    const f = storageRecoveryFixture(51);
    try {
      await f.backup();
      await expect(upgradeStorage({ ...f.input, hooks: { [boundary]: () => { throw new Error("notification-upgrade-crash"); } } }, f.clock)).rejects.toThrow("notification-upgrade-crash");
      expect((await f.run()).state).toBe("converted");
      const db = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "notification-recovery" }, f.clock);
      try { expect(db.authority.notificationPublications.list()).toEqual([]); } finally { db.close(); }
    } finally { f.dispose(); }
  });
  it("restores exact inbox, source and health metadata through the real backup/restore boundary", async () => {
    const f = storageRecoveryFixture();
    try {
      await f.run();
      const open = () => AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "notification-restore" }, f.clock);
      let db = open();
      const inbox = createNotificationInbox({ authority: db, clock: f.clock, ids: sequentialIdFactory("a"), actorId: "local-operator" });
      const event = { kind: "storage-degraded", concern: "disk-space", state: "degraded", diagnosticFingerprint: "a".repeat(64) };
      const report = await inbox.publish(event); inbox.markRead(report.notification.notificationId, 1);
      db.withAuthorityTransaction(repos => repos.notificationHealth.put({ concern: "disk-space", active: true, occurrence: 1, samples: [], observedAt: f.clock.now().toISOString(), createdAt: f.clock.now().toISOString() }));
      const expected = { row: inbox.get(report.notification.notificationId), sources: db.authority.notificationPublications.list(), health: db.authority.notificationHealth.get("disk-space") };
      db.close();
      const backup = await f.backup();
      db = open(); db.authority.notifications.updateState({ notificationId: report.notification.notificationId, expectedVersion: 2, status: "unread", snooze: { state: "not-snoozed" }, updatedAt: f.clock.now().toISOString() }); db.close();
      const identity = AuthorityDatabase.sourceDatabaseIdentity(f.path);
      const proofStore = new RecoveryStopProofStore({ processLockRoot: f.input.processLockRoot, maxProofAgeMs: 60_000 }, f.clock);
      proofStore.recordRuntimeState(observeRuntimeLockSnapshot({ processLockRoot: f.input.processLockRoot, sourceDatabaseIdentity: identity }, f.clock));
      const stoppedSystemProof = proofStore.issue({ observedBy: "local-operator", sourceDatabaseIdentity: identity });
      const manifest = backup.manifests[0]; expect(manifest).toBeDefined();
      const restore = new OfflineAuthorityRestoreService({ authorityPath: f.path, suspectDirectory: join(f.root, "suspects"), busyTimeoutMs: 250, processLockRoot: f.input.processLockRoot, stoppedProofMaxAgeMs: 60_000 }, async stagedPath => { const staged = AuthorityDatabase.open({ path: stagedPath, busyTimeoutMs: 250, migrationOwner: "notification-projection-proof" }, f.clock); staged.close(); }, f.clock);
      await restore.restore({ manifestPath: join(f.root, "backups", "authority", `${manifest.backupFileName}.manifest.json`), stoppedSystemProof });
      db = open();
      try {
        expect({ row: db.authority.notifications.get(report.notification.notificationId), sources: db.authority.notificationPublications.list(), health: db.authority.notificationHealth.get("disk-space") }).toEqual(expected);
        expect((await createNotificationInbox({ authority: db, clock: f.clock, ids: sequentialIdFactory("a"), actorId: "local-operator" }).publish(event)).durable).toBe("existing");
      } finally { db.close(); }
    } finally { f.dispose(); }
  });
});
