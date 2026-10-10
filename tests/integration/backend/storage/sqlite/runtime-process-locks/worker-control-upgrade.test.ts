import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { manualClock } from "../../../../../../src/rules/time/clock.js";
import { acquireEntrypointAdmission } from "../../../../../../src/backend/storage/admission/bootstrap-admission.js";
import { AuthorityBackupService } from "../../../../../../src/backend/storage/sqlite/backup-service.js";
import { AuthorityDatabase } from "../../../../../../src/backend/storage/sqlite/authority-database.js";
import { OfflineAuthorityRestoreService } from "../../../../../../src/backend/storage/sqlite/offline-restore.js";
import { RecoveryStopProofStore } from "../../../../../../src/backend/storage/sqlite/recovery-stop-proof.js";
import { observeRuntimeLockSnapshot } from "../../../../../../src/backend/storage/sqlite/runtime-process-locks.js";

const WORKER = "person-lookup-worker-1";
function controlRecord(now: string) {
  const commandId = randomUUID();
  return { commandId, request: { commandId, family: "worker-browser", type: "refresh-browser", target: { workerId: WORKER, browserSessionId: randomUUID(), expectedVersion: 1, controlBasis: { leaseGeneration: 1, controlRevision: 1 } }, source: "dashboard", requestedBy: "local-operator", requestedAt: now },
    scope: "worker-pool:person-lookup", executorId: randomUUID(), admittedAt: now, expiresAt: now, basisVersion: 0, phase: { state: "admitted" } };
}
describe("native worker control recovery", () => {
  it("preserves pending control identity and browser observations through real backup and restore", async () => {
    const workspace = mkdtempSync(join(realpathSync(tmpdir()), "worker-control-native-"));
    const admission = acquireEntrypointAdmission(workspace, "exclusive");
    const root = admission.stateRoot;
    const f = {root,path:join(root,"state.db"),clock:manualClock(new Date("2026-09-10T20:00:00Z")),input:{processLockRoot:join(root,"locks")}};
    try {
      const open = () => AuthorityDatabase.open(admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "worker-control-restore" }, f.clock);
      let db = open(); const now = f.clock.now().toISOString(); const record = controlRecord(now);
      db.authority.workerPools.plan({workflow:"person-lookup",expectedVersion:0,desiredWorkers:1,requestedBy:"local-operator",now});
      const slot = db.authority.workerSlots.allocate({workflow:"person-lookup",poolIndex:1,commandId:null,now});
      expect(slot.workerId).toBe(WORKER);
      db.authority.commands.insert(record.request);
      db.authority.workerControls.admit(record);
      db.authority.workerControls.transition(record.commandId,"admitted",{ state: "executing", startedAt: now });
      db.authority.workerControls.transition(record.commandId,"executing",{ state: "uncertain", startedAt: now, observedAt: now, message: "owner crashed" });
      db.authority.workerControls.observe({ workerId: WORKER, leaseGeneration: 1, sessionId: randomUUID(), system: "crm", configFingerprint: "a".repeat(64), signInFingerprint: "a".repeat(64), openedAt: now, profileRevision: 1, browserMode: "headless", acceptDownloads: false, exclusive: false, health: "unknown", observedAt: now });
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
      const restore = new OfflineAuthorityRestoreService(admission, { authorityPath: f.path, suspectDirectory: join(f.root, "backups", "suspects"), busyTimeoutMs: 250, processLockRoot: f.input.processLockRoot, stoppedProofMaxAgeMs: 60_000 }, async stagedPath => {
        const stagedAdmission = admission.stoppedStagedAuthority(stagedPath);
        try { const staged = AuthorityDatabase.open(stagedAdmission,{ path: stagedPath, busyTimeoutMs: 250, migrationOwner: "worker-control-restore-check" }, f.clock); staged.close(); } finally { stagedAdmission.release(); }
      }, f.clock);
      await restore.restore({ manifestPath: join(f.root,"backups","authority",`${manifest.backupFileName}.manifest.json`), stoppedSystemProof });
      db = open(); try { expect({ controls: db.authority.workerControls.list(), browsers: db.authority.workerControls.browsers(WORKER) }).toEqual(expected); } finally { db.close(); }
    } finally { admission.release(); rmSync(workspace,{recursive:true,force:true}); }
  });

});
