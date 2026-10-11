
import assert_m0 from "node:assert/strict";
import { randomUUID as randomUUID_m2 } from "node:crypto";
import {
mkdtempSync as mkdtempSync_m1,
mkdtempSync as mkdtempSync_m2,
realpathSync as realpathSync_m1,
realpathSync as realpathSync_m2,
rmSync as rmSync_m0,
rmSync as rmSync_m1,
rmSync as rmSync_m2
} from "node:fs";
import { tmpdir as tmpdir_m1,tmpdir as tmpdir_m2 } from "node:os";
import { join as join_m1,join as join_m2 } from "node:path";
import { afterEach as afterEach_m0,describe as describe_m0,describe as describe_m1,describe as describe_m2,expect as expect_m1,expect as expect_m2,it as it_m0,it as it_m1,it as it_m2 } from "vitest";
import {
restoreFailureDisposition as restoreFailureDisposition_m0
} from "../../../../src/backend/app/composition/storage-compose.js";
import { createNotificationInbox as createNotificationInbox_m1 } from "../../../../src/backend/runs/notifications/inbox.js";
import type { RuntimeAdmission as RuntimeAdmission_m0 } from "../../../../src/backend/storage/admission/admission.js";
import { acquireEntrypointAdmission as acquireEntrypointAdmission_m1,acquireEntrypointAdmission as acquireEntrypointAdmission_m2 } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { AuthorityDatabase as AuthorityDatabase_m1,AuthorityDatabase as AuthorityDatabase_m2 } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityBackupService as AuthorityBackupService_m1,AuthorityBackupService as AuthorityBackupService_m2 } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { OfflineAuthorityRestoreService as OfflineAuthorityRestoreService_m1,OfflineAuthorityRestoreService as OfflineAuthorityRestoreService_m2,OfflineRestoreFailure as OfflineRestoreFailure_m0 } from "../../../../src/backend/storage/sqlite/offline-restore.js";
import { RecoveryStopProofStore as RecoveryStopProofStore_m2 } from "../../../../src/backend/storage/sqlite/recovery-stop-proof.js";
import { observeRuntimeLockSnapshot as observeRuntimeLockSnapshot_m1,observeRuntimeLockSnapshot as observeRuntimeLockSnapshot_m2 } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { manualClock as manualClock_m1,manualClock as manualClock_m2 } from "../../../../src/rules/time/clock.js";
import { sequentialIdFactory as sequentialIdFactory_m1 } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { RecoveryStopProofStore as RecoveryStopProofStore_m1 } from "../../../support/helpers/synthetic-storage-admission.js";


{

const roots: string[] = [];
const admissions = new Map<string,RuntimeAdmission_m0>();

const _afterEachFixture0 = () => {
  for(const admission of admissions.values())admission.release();admissions.clear();
  for (const root of roots.splice(0)) rmSync_m0(root, { recursive: true, force: true });
};

describe_m0("corruption → degraded → restore → rebuild, through the CLI", () => {
afterEach_m0(_afterEachFixture0);

  it_m0("reports post-swap failures without claiming the live authority was untouched", () => {
    const failure = new OfflineRestoreFailure_m0(
      "replaced",
      "offline authority restore failed",
      new Error("injected post-swap fsync failure"),
    );
    assert_m0.deepEqual(restoreFailureDisposition_m0(failure), {
      heading: "authority restore POST-SWAP FAILURE",
      authorityLine: "the authority database was replaced; inspect the post-swap failure before restarting runtime",
    });
    assert_m0.deepEqual(restoreFailureDisposition_m0(new OfflineRestoreFailure_m0(
      "companion-state-uncertain",
      "offline authority restore failed",
      new Error("rollback fsync failed"),
    )), {
      heading: "authority restore COMPANION-STATE FAILURE",
      authorityLine: "the authority database was not replaced, but live WAL/SHM rollback is unproven; inspect recovery artifacts before restarting runtime",
    });
    assert_m0.deepEqual(restoreFailureDisposition_m0(new OfflineRestoreFailure_m0(
      "authority-state-uncertain",
      "offline authority restore failed",
      new Error("swap outcome could not be observed"),
    )), {
      heading: "authority restore AUTHORITY-STATE UNCERTAIN",
      authorityLine: "the authority replacement outcome is unproven; inspect staged/live paths before restarting runtime",
    });
    assert_m0.deepEqual(restoreFailureDisposition_m0(new Error("pre-swap refusal")), {
      heading: "authority restore REFUSED",
      authorityLine: "the live authority database was not modified",
    });
  });
});
}

{


describe_m1("native notification recovery", () => {
  it_m1("restores exact inbox, source and health metadata through the real backup/restore boundary", async () => {
    const workspace = mkdtempSync_m1(join_m1(realpathSync_m1(tmpdir_m1()), "notification-native-restore-"));
    const admission = acquireEntrypointAdmission_m1(workspace, "exclusive");
    const root = admission.stateRoot, path = join_m1(root, "state.db");
    const clock = manualClock_m1(new Date("2026-09-10T20:00:00Z"));
    const f = { root, path, clock, input: { processLockRoot: join_m1(root, "locks") } };
    try {
      const open = () => AuthorityDatabase_m1.open(admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "notification-restore" }, f.clock);
      let db = open();
      const inbox = createNotificationInbox_m1({ authority: db, clock: f.clock, ids: sequentialIdFactory_m1("a"), actorId: "local-operator" });
      const event = { kind: "storage-degraded", concern: "disk-space", state: "degraded", diagnosticFingerprint: "a".repeat(64) };
      const report = await inbox.publish(event); inbox.markRead(report.notification.notificationId, 1);
      db.withAuthorityTransaction(repos => repos.notificationHealth.put({ concern: "disk-space", active: true, occurrence: 1, samples: [], observedAt: f.clock.now().toISOString(), createdAt: f.clock.now().toISOString() }));
      const expected = { row: inbox.get(report.notification.notificationId), sources: db.authority.notificationPublications.list(), health: db.authority.notificationHealth.get("disk-space") };
      db.close();
      const backupDb = open();
      const backup = await new AuthorityBackupService_m1(admission, backupDb, { directory: join_m1(root, "backups", "authority") }, clock)
        .request({ trigger: "operator", requiredGeneration: backupDb.getMeta().authorityGeneration });
      backupDb.close();
      db = open(); db.authority.notifications.updateState({ notificationId: report.notification.notificationId, expectedVersion: 2, status: "unread", snooze: { state: "not-snoozed" }, updatedAt: f.clock.now().toISOString() }); db.close();
      const identity = AuthorityDatabase_m1.sourceDatabaseIdentity(f.path);
      const proofStore = new RecoveryStopProofStore_m1({ processLockRoot: f.input.processLockRoot, maxProofAgeMs: 60_000 }, f.clock);
      proofStore.recordRuntimeState(observeRuntimeLockSnapshot_m1({ processLockRoot: f.input.processLockRoot, sourceDatabaseIdentity: identity }, f.clock));
      const stoppedSystemProof = proofStore.issue({ observedBy: "local-operator", sourceDatabaseIdentity: identity });
      const manifest = backup.manifests[0]; expect_m1(manifest).toBeDefined();
      const restore = new OfflineAuthorityRestoreService_m1(admission, { authorityPath: f.path, suspectDirectory: join_m1(f.root, "backups", "suspects"), busyTimeoutMs: 250, processLockRoot: f.input.processLockRoot, stoppedProofMaxAgeMs: 60_000 }, async stagedPath => { const stagedAdmission = admission.stoppedStagedAuthority(stagedPath); try { const staged = AuthorityDatabase_m1.open(stagedAdmission, { path: stagedPath, busyTimeoutMs: 250, migrationOwner: "notification-projection-proof" }, f.clock); staged.close(); } finally { stagedAdmission.release(); } }, f.clock);
      await restore.restore({ manifestPath: join_m1(f.root, "backups", "authority", `${manifest.backupFileName}.manifest.json`), stoppedSystemProof });
      db = open();
      try {
        expect_m1({ row: db.authority.notifications.get(report.notification.notificationId), sources: db.authority.notificationPublications.list(), health: db.authority.notificationHealth.get("disk-space") }).toEqual(expected);
        expect_m1((await createNotificationInbox_m1({ authority: db, clock: f.clock, ids: sequentialIdFactory_m1("a"), actorId: "local-operator" }).publish(event)).durable).toBe("existing");
      } finally { db.close(); }
    } finally { admission.release(); rmSync_m1(workspace, { recursive: true, force: true }); }
  });
});
}

{


const WORKER = "person-lookup-worker-1";
function controlRecord(now: string) {
  const commandId = randomUUID_m2();
  return { commandId, request: { commandId, family: "worker-browser", type: "refresh-browser", target: { workerId: WORKER, browserSessionId: randomUUID_m2(), expectedVersion: 1, controlBasis: { leaseGeneration: 1, controlRevision: 1 } }, source: "dashboard", requestedBy: "local-operator", requestedAt: now },
    scope: "worker-pool:person-lookup", executorId: randomUUID_m2(), admittedAt: now, expiresAt: now, basisVersion: 0, phase: { state: "admitted" } };
}
describe_m2("native worker control recovery", () => {
  it_m2("preserves pending control identity and browser observations through real backup and restore", async () => {
    const workspace = mkdtempSync_m2(join_m2(realpathSync_m2(tmpdir_m2()), "worker-control-native-"));
    const admission = acquireEntrypointAdmission_m2(workspace, "exclusive");
    const root = admission.stateRoot;
    const f = {root,path:join_m2(root,"state.db"),clock:manualClock_m2(new Date("2026-09-10T20:00:00Z")),input:{processLockRoot:join_m2(root,"locks")}};
    try {
      const open = () => AuthorityDatabase_m2.open(admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "worker-control-restore" }, f.clock);
      let db = open(); const now = f.clock.now().toISOString(); const record = controlRecord(now);
      db.authority.workerPools.plan({workflow:"person-lookup",expectedVersion:0,desiredWorkers:1,requestedBy:"local-operator",now});
      const slot = db.authority.workerSlots.allocate({workflow:"person-lookup",poolIndex:1,commandId:null,now});
      expect_m2(slot.workerId).toBe(WORKER);
      db.authority.commands.insert(record.request);
      db.authority.workerControls.admit(record);
      db.authority.workerControls.transition(record.commandId,"admitted",{ state: "executing", startedAt: now });
      db.authority.workerControls.transition(record.commandId,"executing",{ state: "uncertain", startedAt: now, observedAt: now, message: "owner crashed" });
      db.authority.workerControls.observe({ workerId: WORKER, leaseGeneration: 1, sessionId: randomUUID_m2(), system: "crm", configFingerprint: "a".repeat(64), signInFingerprint: "a".repeat(64), openedAt: now, profileRevision: 1, browserMode: "headless", acceptDownloads: false, exclusive: false, health: "unknown", observedAt: now });
      const expected = { controls: db.authority.workerControls.list(), browsers: db.authority.workerControls.browsers(WORKER) }; db.close();
      const backupDb = open();
      const backup = await new AuthorityBackupService_m2(admission,backupDb,{directory:join_m2(root,"backups","authority")},f.clock).request({trigger:"operator",requiredGeneration:backupDb.getMeta().authorityGeneration});
      backupDb.close();
      const identity = AuthorityDatabase_m2.sourceDatabaseIdentity(f.path);
      const proofStore = new RecoveryStopProofStore_m2({ processLockRoot: f.input.processLockRoot, maxProofAgeMs: 60_000 }, f.clock);
      proofStore.recordRuntimeState(observeRuntimeLockSnapshot_m2({ processLockRoot: f.input.processLockRoot, sourceDatabaseIdentity: identity }, f.clock));
      const stoppedSystemProof = proofStore.issue({ observedBy: "local-operator", sourceDatabaseIdentity: identity });
      const manifest = backup.manifests[0]; expect_m2(manifest).toBeDefined();
      if (manifest === undefined) throw new Error("backup-manifest-missing");
      const restore = new OfflineAuthorityRestoreService_m2(admission, { authorityPath: f.path, suspectDirectory: join_m2(f.root, "backups", "suspects"), busyTimeoutMs: 250, processLockRoot: f.input.processLockRoot, stoppedProofMaxAgeMs: 60_000 }, async stagedPath => {
        const stagedAdmission = admission.stoppedStagedAuthority(stagedPath);
        try { const staged = AuthorityDatabase_m2.open(stagedAdmission,{ path: stagedPath, busyTimeoutMs: 250, migrationOwner: "worker-control-restore-check" }, f.clock); staged.close(); } finally { stagedAdmission.release(); }
      }, f.clock);
      await restore.restore({ manifestPath: join_m2(f.root,"backups","authority",`${manifest.backupFileName}.manifest.json`), stoppedSystemProof });
      db = open(); try { expect_m2({ controls: db.authority.workerControls.list(), browsers: db.authority.workerControls.browsers(WORKER) }).toEqual(expected); } finally { db.close(); }
    } finally { admission.release(); rmSync_m2(workspace,{recursive:true,force:true}); }
  });

});
}
