import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { storageRecoveryFixture } from "./helpers/storage-recovery-fixture.js";
import { AuthorityDatabase, OfflineAuthorityRestoreService, RecoveryStopProofStore } from "../../src/infra/sqlite/index.js";
import { observeRuntimeLockSnapshot } from "../../src/infra/sqlite/runtime-process-locks.js";
import { upgradeStorage } from "../../src/server/storage/upgrade.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION, UPGRADE_FLOOR_SCHEMA_VERSION, SQLITE_MIGRATIONS } from "../../src/infra/sqlite/migrations.js";

const WORKER = "person-lookup-worker-1";
function controlRecord(now: string) {
  const commandId = randomUUID();
  return { commandId, request: { commandId, family: "worker-browser", type: "plan-worker-count", target: { workflowId: "person-lookup", expectedVersion: 0 }, payload: { desiredWorkers: 1 }, source: "dashboard", requestedBy: "local-operator", requestedAt: now },
    scope: "worker-pool:person-lookup", executorId: randomUUID(), admittedAt: now, expiresAt: now, basisVersion: 0, phase: { state: "admitted" } };
}
function historicalRows(now: string) {
  const commandId = randomUUID(); const auditId = randomUUID();
  const request = { commandId, family: "worker-browser", type: "stop-worker", target: { workerId: WORKER, expectedVersion: 1 }, source: "dashboard", requestedBy: "local-operator", requestedAt: now };
  return { commandId, auditId, request: JSON.stringify(request), audit: JSON.stringify({ auditId, request,
    result: { state: "applied", commandId, affectedTargets: [{ family: "worker-browser", workerId: WORKER }] }, completedAt: now, versionChanges: [], affectedDependencyIds: [] }),
    lease: JSON.stringify({ workerId: WORKER, workflow: "person-lookup", browserSystems: ["crm"], processId: 42, leaseGeneration: 1,
      lifecycle: { state: "stopped", startedAt: now, stoppedAt: now, reason: "operator" }, control: { directive: "stop", requestedAt: now, requestedBy: "local-operator" }, version: 2, createdAt: now, updatedAt: now }) };
}

describe("worker control supported storage upgrade", () => {
  it.each([0, 46, 47, 48, 49, 50, 51, 52])("preserves historical bytes and explicit missing control basis from source %s", async version => {
    const f = storageRecoveryFixture(version); const now = f.clock.now().toISOString(); const history = historicalRows(now);
    try {
      if (version > 0) {
        const raw = new DatabaseSync(f.path);
        try {
          raw.prepare("INSERT INTO commands(record_key,family,record_json,created_at) VALUES (?,?,?,?)").run(history.commandId,"worker-browser",history.request,now);
          raw.prepare("INSERT INTO command_audits(record_key,command_id,record_json,created_at) VALUES (?,?,?,?)").run(history.auditId,history.commandId,history.audit,now);
          raw.prepare("INSERT INTO workflow_workers(record_key,worker_id,workflow,lease_generation,state,directive,version,record_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(WORKER,WORKER,"person-lookup",1,"stopped","stop",2,history.lease,now);
        } finally { raw.close(); }
        await f.backup();
      }
      expect((await f.run()).state).toBe("converted");
      const db = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "worker-control-upgrade" }, f.clock);
      try {
        expect(db.authority.workerControls.list()).toEqual([]);
        expect(CURRENT_AUTHORITY_SCHEMA_VERSION).toBe(53); expect(UPGRADE_FLOOR_SCHEMA_VERSION).toBe(46);
        if (version > 0) {
          expect(db.authority.workerLeases.get(WORKER)?.controlRevision).toBeUndefined();
          expect(() => db.authority.workerLeases.reserveControl(WORKER,{ leaseGeneration: 1, controlRevision: 1 },randomUUID(),now)).toThrow("worker-control-target-unavailable");
          const raw = new DatabaseSync(f.path, { readOnly: true });
          try {
            expect(raw.prepare("SELECT record_json FROM commands WHERE record_key=?").get(history.commandId)?.["record_json"]).toBe(history.request);
            expect(raw.prepare("SELECT record_json FROM command_audits WHERE record_key=?").get(history.auditId)?.["record_json"]).toBe(history.audit);
          } finally { raw.close(); }
        }
        const record = controlRecord(now); db.authority.workerControls.admit(record);
        db.authority.workerControls.transition(record.commandId,"admitted",{ state: "refused", completedAt: now, message: "expired without execution" });
        expect(db.authority.workerControls.get(record.commandId)?.phase.state).toBe("refused");
      } finally { db.close(); }
      const reopened = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "worker-control-reopen" }, f.clock);
      try { expect(reopened.authority.workerControls.list()[0]?.phase.state).toBe("refused"); } finally { reopened.close(); }
    } finally { f.dispose(); }
  });

  it.each(["beforeCommit", "afterCommit"] as const)("recovers stopped upgrade interruption at %s", async boundary => {
    const f = storageRecoveryFixture(52);
    try { await f.backup();
      await expect(upgradeStorage({ ...f.input, hooks: { [boundary]: () => { throw new Error("worker-control-upgrade-interruption"); } } }, f.clock)).rejects.toThrow("worker-control-upgrade-interruption");
      expect((await f.run()).state).toBe("converted");
    } finally { f.dispose(); }
  });

  it("preserves pending control identity and browser observations through real backup and restore", async () => {
    const f = storageRecoveryFixture();
    try {
      await f.run();
      const open = () => AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "worker-control-restore" }, f.clock);
      let db = open(); const now = f.clock.now().toISOString(); const record = controlRecord(now);
      db.authority.workerControls.admit(record);
      db.authority.workerControls.transition(record.commandId,"admitted",{ state: "executing", startedAt: now });
      db.authority.workerControls.transition(record.commandId,"executing",{ state: "uncertain", startedAt: now, observedAt: now, message: "owner crashed" });
      db.authority.workerControls.observe({ workerId: WORKER, leaseGeneration: 1, sessionId: randomUUID(), system: "crm", configFingerprint: "a".repeat(64), browserMode: "headless", acceptDownloads: false, exclusive: false, health: "unknown", observedAt: now });
      const expected = { controls: db.authority.workerControls.list(), browsers: db.authority.workerControls.browsers(WORKER) }; db.close();
      const backup = await f.backup();
      const identity = AuthorityDatabase.sourceDatabaseIdentity(f.path);
      const proofStore = new RecoveryStopProofStore({ processLockRoot: f.input.processLockRoot, maxProofAgeMs: 60_000 }, f.clock);
      proofStore.recordRuntimeState(observeRuntimeLockSnapshot({ processLockRoot: f.input.processLockRoot, sourceDatabaseIdentity: identity }, f.clock));
      const stoppedSystemProof = proofStore.issue({ observedBy: "local-operator", sourceDatabaseIdentity: identity });
      const manifest = backup.manifests[0]; expect(manifest).toBeDefined();
      if (manifest === undefined) throw new Error("backup-manifest-missing");
      const restore = new OfflineAuthorityRestoreService({ authorityPath: f.path, suspectDirectory: join(f.root,"suspects"), busyTimeoutMs: 250, processLockRoot: f.input.processLockRoot, stoppedProofMaxAgeMs: 60_000 }, async stagedPath => {
        const staged = AuthorityDatabase.open({ path: stagedPath, busyTimeoutMs: 250, migrationOwner: "worker-control-restore-check" }, f.clock); staged.close();
      }, f.clock);
      await restore.restore({ manifestPath: join(f.root,"backups","authority",`${manifest.backupFileName}.manifest.json`), stoppedSystemProof });
      db = open(); try { expect({ controls: db.authority.workerControls.list(), browsers: db.authority.workerControls.browsers(WORKER) }).toEqual(expected); } finally { db.close(); }
    } finally { f.dispose(); }
  });

  it("adds one schema without changing the released migration statement bytes", () => {
    const released = SQLITE_MIGRATIONS.filter(value => value.version <= 52);
    expect(released).toHaveLength(52);
    expect(createHash("sha256").update(JSON.stringify(released)).digest("hex")).toBe("ff27ffceea4316c10552a4e21610fc397d9b19e5c936502b1d20a8a0a03320f2");
  });
});
