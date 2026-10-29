import { profileBrowserClosure, BrowserProfileStillClosingError } from "../../../../src/backend/runtime/browser/native-profile-probe.js";
import { AuthoritySourceClosureUnprovedError, retainAuthoritySourceClosure } from "../../../../src/backend/storage/source-closure.js";
import { createBoundProfileFixture, boundProfileCredentials } from "../../../support/helpers/admission-fixture.js";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { restoreFailureDisposition } from "../../../../src/backend/app/composition/storage-compose.js";
import { createNotificationInbox } from "../../../../src/backend/runs/notifications/inbox.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { initialSettingsFileRecord } from "../../../../src/models/config/settings.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityBackupService } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { OfflineAuthorityRestoreService, OfflineRestoreFailure } from "../../../../src/backend/storage/sqlite/offline-restore.js";
import { RecoveryStopProofStore } from "../../../../src/backend/storage/sqlite/recovery-stop-proof.js";
import { observeRuntimeLockSnapshot } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { CONFIG_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";

const retainedNativeRestoreFixtures = new Set<object>();

{

describe("corruption → degraded → restore → rebuild, through the CLI", () => {

  it("reports post-swap failures without claiming the live authority was untouched", () => {
    const failure = new OfflineRestoreFailure(
      "replaced",
      "offline authority restore failed",
      new Error("injected post-swap fsync failure"),
    );
    assert.deepEqual(restoreFailureDisposition(failure), {
      heading: "authority restore POST-SWAP FAILURE",
      authorityLine: "the authority database was replaced; inspect the post-swap failure before restarting runtime",
    });
    assert.deepEqual(restoreFailureDisposition(new OfflineRestoreFailure(
      "companion-state-uncertain",
      "offline authority restore failed",
      new Error("rollback fsync failed"),
    )), {
      heading: "authority restore COMPANION-STATE FAILURE",
      authorityLine: "the authority database was not replaced, but live WAL/SHM rollback is unproven; inspect recovery artifacts before restarting runtime",
    });
    assert.deepEqual(restoreFailureDisposition(new OfflineRestoreFailure(
      "authority-state-uncertain",
      "offline authority restore failed",
      new Error("swap outcome could not be observed"),
    )), {
      heading: "authority restore AUTHORITY-STATE UNCERTAIN",
      authorityLine: "the authority replacement outcome is unproven; inspect staged/live paths before restarting runtime",
    });
    assert.deepEqual(restoreFailureDisposition(new Error("pre-swap refusal")), {
      heading: "authority restore REFUSED",
      authorityLine: "the live authority database was not modified",
    });
  });
});
}

{

describe("native notification recovery", () => {
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
      const identity = AuthorityDatabase.sourceDatabaseIdentity(f.path);
      const proofStore = new RecoveryStopProofStore({ processLockRoot: f.input.processLockRoot, maxProofAgeMs: 60_000 }, f.clock);
      proofStore.recordRuntimeState(observeRuntimeLockSnapshot({ processLockRoot: f.input.processLockRoot, sourceDatabaseIdentity: identity }, f.clock));
      const stoppedSystemProof = proofStore.issue({ observedBy: "local-operator", sourceDatabaseIdentity: identity });
      const manifest = backup.manifests[0]; expect(manifest).toBeDefined();
      const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admission, { authorityPath: f.path, suspectDirectory: join(f.root, "backups", "suspects"), busyTimeoutMs: 250, processLockRoot: f.input.processLockRoot, stoppedProofMaxAgeMs: 60_000 }, async (stagedPath, restoreAdmission) => { const stagedAdmission = admission.stoppedRestoreProjection(stagedPath, restoreAdmission); try { const staged = AuthorityDatabase.openStoppedRestoreProjection(stagedAdmission, { path: stagedPath, busyTimeoutMs: 250, migrationOwner: "notification-projection-proof" }, f.clock); staged.close(); } finally { stagedAdmission.release(); } }, f.clock, undefined, undefined, boundProfileCredentials(admission));
      await restore.restore({ manifestPath: join(f.root, "backups", "authority", `${manifest.backupFileName}.manifest.json`), stoppedSystemProof });
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
      mkdirSync(profileDirectory, { recursive: true, mode: 0o700 });
      db.authority.workerControls.observe({ workerId: WORKER, leaseGeneration: 1, sessionId: randomUUID(), system: "crm", configFingerprint: resolved.fingerprint, signInFingerprint: "a".repeat(64), profileDirectory, openedAt: now, profileRevision: 1, browserMode: "headless", acceptDownloads: false, exclusive: false, health: "unknown", observedAt: now });
      const expected = { controls: db.authority.workerControls.list(), browsers: db.authority.workerControls.browsers(WORKER) }; db.close();
      const backupDb = open();
      const backup = await new AuthorityBackupService(admission,backupDb,{directory:join(root,"backups","authority")},f.clock).request({trigger:"operator",requiredGeneration:backupDb.getMeta().authorityGeneration});
      backupDb.close();
      const identity = AuthorityDatabase.sourceDatabaseIdentity(f.path);
      const proofStore = new RecoveryStopProofStore({ processLockRoot: f.input.processLockRoot, maxProofAgeMs: 60_000 }, f.clock);
      proofStore.recordRuntimeState(observeRuntimeLockSnapshot({ processLockRoot: f.input.processLockRoot, sourceDatabaseIdentity: identity }, f.clock));
      const stoppedSystemProof = proofStore.issue({ observedBy: "local-operator", sourceDatabaseIdentity: identity });
      const manifest = backup.manifests[0]; expect(manifest).toBeDefined();
      if (manifest === undefined) throw new Error("backup-manifest-missing");
      const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admission, { authorityPath: f.path, suspectDirectory: join(f.root, "backups", "suspects"), busyTimeoutMs: 250, processLockRoot: f.input.processLockRoot, stoppedProofMaxAgeMs: 60_000 }, async (stagedPath, restoreAdmission) => {
        const stagedAdmission = admission.stoppedRestoreProjection(stagedPath, restoreAdmission);
        try { const staged = AuthorityDatabase.openStoppedRestoreProjection(stagedAdmission,{ path: stagedPath, busyTimeoutMs: 250, migrationOwner: "worker-control-restore-check" }, f.clock); staged.close(); } finally { stagedAdmission.release(); }
      }, f.clock, undefined, undefined, boundProfileCredentials(admission));
      closureUnproved = true;
      await restore.restore({ manifestPath: join(f.root,"backups","authority",`${manifest.backupFileName}.manifest.json`), stoppedSystemProof });
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
