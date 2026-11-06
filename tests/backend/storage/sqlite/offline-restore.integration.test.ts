import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/profile-browser-closure.js";
import { BrowserProfileStillClosingError } from "../../../../src/workflow-kit/session.js";
import { createBrowserRoots } from "../../../../src/backend/storage/browser-roots.js";
import { AuthoritySourceClosureUnprovedError, retainAuthoritySourceClosure } from "../../../../src/backend/storage/source-closure.js";
import { createBoundProfileFixture, boundProfileCredentials } from "../../../support/helpers/admission-fixture.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createNotificationInbox } from "../../../../src/backend/runs/notifications/inbox.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { initialSettingsFileRecord } from "../../../../src/models/config/settings.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityBackupService } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { OfflineAuthorityRestoreService } from "../../../../src/backend/storage/sqlite/offline-restore.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { CONFIG_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";

const retainedNativeRestoreFixtures = new Set<object>();

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

{

describe("assistant history through backup and restore", () => {
  it.each(["explicit", "newest"] as const)("restores populated current-schema history exactly through the %s backup", async kind => {
    const profile = await createBoundProfileFixture(), admission = profile.admission, root = profile.stateRoot;
    const clock = manualClock(new Date("2026-09-10T20:00:00Z")), now = clock.now().toISOString();
    try {
      const open = () => AuthorityDatabase.open(admission, { path: profile.path, busyTimeoutMs: 250, migrationOwner: "assistant-history-restore" }, clock,
        undefined, undefined, undefined, boundProfileCredentials(admission));
      let db = open();
      const history = db.authority.assistantHistory, id = randomUUID(), messageId = randomUUID();
      assert.equal(history.apply({ operation: "create", conversationId: id, title: "Kept chat" }, now).state, "saved");
      assert.equal(history.apply({ operation: "draft", conversationId: id, draft: "unsent é", composer: "😀" }, now).state, "saved");
      const accepted = history.accept({ conversationId: id, expectedRevision: 1, messageId, text: "Explain 10812345", modelText: "Explain [[E1.g1]]", subjectRef: null, now });
      assert.equal(accepted.state, "accepted");
      assert.equal(typeof history.settle(id, messageId, { delivery: "answered", reply: { id: randomUUID(), kind: "answer", text: "Answer for 10812345", modelText: "Answer for [[E1.g1]]" } }, now), "number");
      const expected = { list: history.list(now), conversation: history.conversation(id, now), replay: history.replay(id, 99) };
      db.close();
      const backupDb = open();
      const backup = await new AuthorityBackupService(admission, backupDb, { directory: join(root, "backups", "authority") }, clock)
        .request({ trigger: "operator", requiredGeneration: backupDb.getMeta().authorityGeneration });
      backupDb.close();
      db = open(); assert.equal(db.authority.assistantHistory.apply({ operation: "clear", conversationId: id, expectedRevision: expected.conversation?.revision ?? 0 }, now).state, "cleared"); db.close();
      const operation = admission.acquireOfflineMaintenance(), manifest = backup.manifests[0]; assert.ok(manifest);
      const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admission, { authorityPath: profile.path, suspectDirectory: join(root, "backups", "suspects"), busyTimeoutMs: 250,
        processLockRoot: join(profile.workspace, rebuildRuntimeIsolation.processLockRoot) }, async (stagedPath, restoreAdmission) => {
        const stagedAdmission = admission.stoppedRestoreProjection(stagedPath, restoreAdmission);
        try { AuthorityDatabase.openStoppedRestoreProjection(stagedAdmission, { path: stagedPath, busyTimeoutMs: 250, migrationOwner: "assistant-history-projection-proof" }, clock).close(); }
        finally { stagedAdmission.release(); }
      }, clock, undefined, boundProfileCredentials(admission));
      if (kind === "explicit") await restore.restore({ manifestPath: join(root, "backups", "authority", `${manifest.backupFileName}.manifest.json`) }, operation);
      else await restore.restoreNewest(operation);
      profile.renewAfterRestore();
      db = open();
      try {
        const restored = db.authority.assistantHistory;
        assert.deepEqual({ list: restored.list(now), conversation: restored.conversation(id, now), replay: restored.replay(id, 99) }, expected);
      } finally { db.close(); }
    } finally { await profile.close(); }
  });
});
}

{

const WORKER = "person-lookup-worker-1";
function controlRecord(now: string) {
  const commandId = randomUUID();
  return { commandId, request: { commandId, family: "worker-browser", type: "refresh-browser", target: { workerId: WORKER, browserSessionId: randomUUID(), expectedVersion: 1, controlBasis: { leaseGeneration: 1, controlRevision: 1 } }, source: "dashboard", requestedBy: "local-operator", requestedAt: now },
    scope: "worker-pool:person-lookup", executorId: randomUUID(), admittedAt: now, expiresAt: now, basisVersion: 0, phase: { state: "admitted" } };
}
describe("native worker control recovery", () => {
  it("preserves pending control identity and browser observations through real backup and restore", async () => {
    const profile = await createBoundProfileFixture(), admission = profile.admission;
    const root = profile.stateRoot;
    const f = {root,path:profile.path,clock:manualClock(new Date("2026-09-10T20:00:00Z")),input:{processLockRoot:join(profile.workspace,rebuildRuntimeIsolation.processLockRoot)}};
    let closureUnproved = false;
    try {
      const open = () => AuthorityDatabase.open(profile.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "worker-control-restore" }, f.clock,
        undefined, undefined, undefined, boundProfileCredentials(profile.admission));
      let db = open(); const now = f.clock.now().toISOString(); const record = controlRecord(now);
      const resolved = resolveConfigWithProvenance(initialSettingsFileRecord().settings, { primaryDisplay: null }, f.clock, admission);
      db.authority.runtimeConfig.initialize({ ...CONFIG_SNAPSHOT, config: resolved.config, fingerprint: resolved.fingerprint,
        provenance: resolved.provenance, capturedAt: now });
      db.authority.workerPools.plan({workflow:"person-lookup",expectedVersion:0,desiredWorkers:1,requestedBy:"local-operator",now});
      const slot = db.authority.workerSlots.allocate({workflow:"person-lookup",poolIndex:1,commandId:null,now});
      expect(slot.workerId).toBe(WORKER);
      db.authority.workerLeases.start({ workerId: WORKER, workflow: "person-lookup", browserSystems: ["crm"], processId: process.pid, requestedBy: "local-operator", now });
      db.authority.workerLeases.reserveControl(WORKER, record.request.target.controlBasis, record.commandId, now);
      db.authority.commands.insert(record.request);
      db.authority.workerControls.admit(record);
      db.authority.workerControls.transition(record.commandId,"admitted",{ state: "executing", startedAt: now });
      db.authority.workerControls.transition(record.commandId,"executing",{ state: "uncertain", startedAt: now, observedAt: now, message: "owner crashed" });
      const profileDirectory = profileBrowserClosure.workerDirectory({profileRoot:resolved.config.paths.browserProfileRoot,slotOrdinal:slot.ordinal,system:"crm"});
      createBrowserRoots(admission).beginLaunch({ profileId: admission.profileBinding.profileId, profileRoot: resolved.config.paths.browserProfileRoot, profileDirectory,
        credentialFingerprint: "a".repeat(64), owner: { kind: "worker", database: db, workerId: WORKER } });
      mkdirSync(profileDirectory, { recursive: true, mode: 0o700 });
      db.authority.workerControls.observe({ workerId: WORKER, leaseGeneration: 1, sessionId: randomUUID(), system: "crm", configFingerprint: resolved.fingerprint, signInFingerprint: "a".repeat(64), profileDirectory, openedAt: now, profileRevision: 1, browserMode: "headless", acceptDownloads: false, exclusive: false, health: "unknown", observedAt: now });
      const expected = { controls: db.authority.workerControls.list(), browsers: db.authority.workerControls.browsers(WORKER) }; db.close();
      const backupDb = open();
      const backup = await new AuthorityBackupService(admission,backupDb,{directory:join(root,"backups","authority")},f.clock).request({trigger:"operator",requiredGeneration:backupDb.getMeta().authorityGeneration});
      backupDb.close();


      const operation = admission.acquireOfflineMaintenance();
      const manifest = backup.manifests[0]; expect(manifest).toBeDefined();
      if (manifest === undefined) throw new Error("backup-manifest-missing");
      const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admission, { authorityPath: f.path, suspectDirectory: join(f.root, "backups", "suspects"), busyTimeoutMs: 250, processLockRoot: f.input.processLockRoot}, async (stagedPath, restoreAdmission) => {
        const stagedAdmission = admission.stoppedRestoreProjection(stagedPath, restoreAdmission);
        try { const staged = AuthorityDatabase.openStoppedRestoreProjection(stagedAdmission,{ path: stagedPath, busyTimeoutMs: 250, migrationOwner: "worker-control-restore-check" }, f.clock); staged.close(); } finally { stagedAdmission.release(); }
      }, f.clock, undefined, boundProfileCredentials(admission));
      closureUnproved = true;
      await restore.restore({ manifestPath: join(f.root,"backups","authority",`${manifest.backupFileName}.manifest.json`) }, operation);
      closureUnproved = false;
      assert.throws(() => admission.assertProfileRuntime(), /profile-restore-context-expired/u);
      profile.renewAfterRestore();
      db = open(); try { expect({ controls: db.authority.workerControls.list(), browsers: db.authority.workerControls.browsers(WORKER) }).toEqual(expected); } finally { db.close(); }
    } catch (error) {
      if (closureUnproved || error instanceof AuthoritySourceClosureUnprovedError || error instanceof BrowserProfileStillClosingError) {
        closureUnproved = true;
        const failure = retainAuthoritySourceClosure([error], { admission: profile });
        retainedNativeRestoreFixtures.add({ profile, failure });
        throw failure;
      }
      throw error;
    } finally { if (!closureUnproved) await profile.close(); }
  });

});
}
