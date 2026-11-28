import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/profile-browser-closure.js";
import { createBoundProfileFixture, boundProfileCredentials } from "../../../support/helpers/admission-fixture.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createNotificationInbox } from "../../../../src/backend/runs/notifications/inbox.js";
import { createDebugEventWriter } from "../../../../src/backend/logs/debug-events.js";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityBackupService, backupLogPaths, verifyBackupManifestAtPath } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { OfflineAuthorityRestoreService } from "../../../../src/backend/storage/sqlite/offline-restore.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { seedAssistantPhaseOne } from "../../../support/helpers/assistant-m1-history-fixture.js";

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
      createNoteTimelineWriter({ repository: db.authority.timelineEvents, clock }).emitNote({
        workflow: "person-lookup", address: { workerId: "person-lookup-worker-1", spanPath: "worker" },
        level: "step", message: "Present in the backup",
      });
      createDebugEventWriter({ repository: db.authority.timelineEvents, clock, build: "test" }).emit({
        category: "worker", phase: "settled", area: "restore-test", correlationId: randomUUID(),
      });
      const expected = { row: inbox.get(report.notification.notificationId), sources: db.authority.notificationPublications.list(), health: db.authority.notificationHealth.get("disk-space") };
      db.close();
      const backupDb = open();
      const backup = await new AuthorityBackupService(admission, backupDb, { directory: join(root, "backups", "authority") }, clock)
        .request({ trigger: "schema-migration", requiredGeneration: backupDb.getMeta().authorityGeneration });
      backupDb.close();
      db = open(); db.authority.notifications.updateState({ notificationId: report.notification.notificationId, expectedVersion: 2, status: "unread", snooze: { state: "not-snoozed" }, updatedAt: f.clock.now().toISOString() }); db.close();


      const operation = admission.acquireOfflineMaintenance();
      const manifest = backup.manifests[0]; expect(manifest).toBeDefined();
      const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admission, { authorityPath: f.path, suspectDirectory: join(f.root, "backups", "suspects"), busyTimeoutMs: 250, processLockRoot: f.input.processLockRoot}, async (stagedPath, restoreAdmission) => { const stagedAdmission = admission.stoppedRestoreProjection(stagedPath, restoreAdmission); try { const staged = AuthorityDatabase.openStoppedRestoreProjection(stagedAdmission, { path: stagedPath, busyTimeoutMs: 250, migrationOwner: "notification-projection-proof" }, f.clock); staged.close(); } finally { stagedAdmission.release(); } }, f.clock, undefined, boundProfileCredentials(admission));
      assert.ok(manifest.manifestVersion === 4 && manifest.logFiles !== undefined);
      const backupLogs = backupLogPaths(join(f.root, "backups", "authority", manifest.backupFileName));
      const manifestPath = join(root, "backups", "authority", `${manifest.backupFileName}.manifest.json`);
      const originalAuthority = readFileSync(path);
      const originalBackupLog = readFileSync(backupLogs[0]);
      writeFileSync(backupLogs[0], "damaged backup");
      await assert.rejects(restore.restore({ manifestPath }, operation), /backup-log-file-unverified/u);
      assert.deepEqual(readFileSync(path), originalAuthority);
      writeFileSync(backupLogs[0], originalBackupLog);
      for (const name of ["timeline", "dashboard"]) {
        writeFileSync(join(root, `${name}.db`), "damaged live log", { mode: 0o600 });
        writeFileSync(join(root, `${name}.db-wal`), "stale live WAL", { mode: 0o600 });
      }
      await restore.restore({ manifestPath }, admission.acquireOfflineMaintenance());
      for (const [name, table, index] of [["timeline", "timeline_events", 0], ["dashboard", "debug_events", 1]] as const) {
        using restoredLog = new DatabaseSync(join(root, `${name}.db`), { readOnly: true });
        using backedUpLog = new DatabaseSync(backupLogs[index], { readOnly: true });
        const query = `SELECT id, payload_json FROM ${table} ORDER BY cursor`;
        assert.ok(backedUpLog.prepare(query).all().length > 0);
        assert.deepEqual(restoredLog.prepare(query).all(), backedUpLog.prepare(query).all());
      }
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

{

describe("assistant history through backup and restore", () => {
  function phaseOneRows(path: string, conversationId: string) {
    using raw = new DatabaseSync(path, { readOnly: true });
    return {
      messages: raw.prepare("SELECT * FROM assistant_messages WHERE conversation_id=? ORDER BY ordinal").all(conversationId),
      proposals: raw.prepare("SELECT * FROM assistant_proposals ORDER BY id").all(),
      rows: raw.prepare("SELECT * FROM assistant_proposal_rows ORDER BY id").all(),
      claims: raw.prepare("SELECT * FROM assistant_session_claims ORDER BY action_id").all(),
    };
  }

  it.each(["explicit", "newest"] as const)("restores populated current-schema legacy history and assistant accounting through the %s backup", async kind => {
    const profile = await createBoundProfileFixture(), admission = profile.admission, root = profile.stateRoot;
    const clock = manualClock(new Date("2026-09-10T20:00:00Z")), now = clock.now().toISOString();
    try {
      const open = () => AuthorityDatabase.open(profile.admission, { path: profile.path, busyTimeoutMs: 250, migrationOwner: "assistant-history-restore" }, clock,
        undefined, undefined, undefined, boundProfileCredentials(profile.admission));
      open().close();
      // Seed the prepared owner before legacy messages enter its profile-wide budget.
      const phaseOneChat = (() => {
        using raw = new DatabaseSync(profile.path);
        return seedAssistantPhaseOne(raw, admission.profileBinding.profileId, now);
      })();
      let db = open();
      db.bindAssistantEpoch(() => 1);
      const history = db.authority.assistantHistory, id = randomUUID(), messageId = randomUUID();
      assert.equal(history.apply({ operation: "create", conversationId: id, title: "Kept chat" }, now).state, "saved");
      assert.equal(history.apply({ operation: "draft", conversationId: id, draft: "unsent é", composer: "😀" }, now).state, "saved");
      const accepted = history.accept({ conversationId: id, expectedRevision: 1, messageId, text: "Explain 10812345", modelText: "Explain [[E1.g1]]", subjectRef: null, attachments: [], proposalAnswer: null, now });
      if (accepted.state !== "accepted") assert.fail("the turn was not accepted");
      assert.equal(typeof history.settle(accepted, { delivery: "answered", usage: { state: "measured", callCount: 1, inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        reply: { id: randomUUID(), kind: "answer", parts: [{ kind: "text", runs: [{ kind: "plain", text: "Answer for 10812345" }] }], modelText: "Answer for [[E1.g1]]" } }, now), "number");
      const expected = { conversation: history.conversation(id, now), replay: history.replay(id, 99, now) };
      db.close();
      const expectedRows = phaseOneRows(profile.path, phaseOneChat);
      assert.deepEqual(Object.values(expectedRows).map(rows => rows.length), [3, 1, 1, 1]);
      const backupDb = open();
      const expectedList = backupDb.authority.assistantHistory.list(now);
      const backup = await new AuthorityBackupService(admission, backupDb, { directory: join(root, "backups", "authority") }, clock)
        .request({ trigger: "schema-migration", requiredGeneration: backupDb.getMeta().authorityGeneration });
      backupDb.close();
      db = open(); assert.equal(db.authority.assistantHistory.apply({ operation: "clear", conversationId: id, expectedRevision: expected.conversation?.revision ?? 0 }, now).state, "cleared"); db.close();
      {
        using raw = new DatabaseSync(profile.path);
        raw.prepare("DELETE FROM assistant_conversations WHERE id=?").run(phaseOneChat);
      }
      assert.deepEqual(Object.values(phaseOneRows(profile.path, phaseOneChat)).map(rows => rows.length), [0, 0, 0, 0]);
      const manifest = backup.manifests[0]; assert.ok(manifest);
      assert.equal(manifest.schemaVersion, 48);
      const manifestPath = join(root, "backups", "authority", `${manifest.backupFileName}.manifest.json`);
      const verified = await verifyBackupManifestAtPath(admission, manifestPath);
      assert.deepEqual(phaseOneRows(verified.backupPath, phaseOneChat), expectedRows);
      const operation = admission.acquireOfflineMaintenance();
      const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admission, { authorityPath: profile.path, suspectDirectory: join(root, "backups", "suspects"), busyTimeoutMs: 250,
        processLockRoot: join(profile.workspace, rebuildRuntimeIsolation.processLockRoot) }, async (stagedPath, restoreAdmission) => {
        const stagedAdmission = admission.stoppedRestoreProjection(stagedPath, restoreAdmission);
        try { AuthorityDatabase.openStoppedRestoreProjection(stagedAdmission, { path: stagedPath, busyTimeoutMs: 250, migrationOwner: "assistant-history-projection-proof" }, clock).close(); }
        finally { stagedAdmission.release(); }
      }, clock, undefined, boundProfileCredentials(admission));
      if (kind === "explicit") await restore.restore({ manifestPath }, operation);
      else await restore.restoreNewest(operation);
      profile.renewAfterRestore();
      db = open();
      try {
        const restored = db.authority.assistantHistory;
        assert.deepEqual(restored.list(now), expectedList);
        assert.deepEqual({ conversation: restored.conversation(id, now), replay: restored.replay(id, 99, now) }, expected);
        assert.deepEqual(phaseOneRows(profile.path, phaseOneChat), expectedRows);
      } finally { db.close(); }
    } finally { await profile.close(); }
  });
});
}
