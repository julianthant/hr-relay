import { randomUUID } from "node:crypto";
import { copyFileSync,existsSync,mkdirSync,mkdtempSync,readdirSync,readFileSync,realpathSync,renameSync,rmSync,statSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach,describe,expect,it } from "vitest";
import { executeSettingsCommand } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { acquireRecoveryRuntimeRestore } from "../../../../src/backend/storage/admission/admission.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { inspectPendingRelocationStatus } from "../../../../src/backend/storage/admission/installation.js";
import { createCredentialStore } from "../../../../src/backend/storage/configuration/credential-store.js";
import { backupStoppedAuthority,upgradeStorage } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { inspectAuthorityBackupReadOnly,openAuthorityBackupSourceReadOnly } from "../../../../src/backend/storage/sqlite/backup-inspection.js";
import { AuthorityBackupService,verifyBackupManifestAtPath } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { OfflineAuthorityRestoreService,settleInterruptedAuthorityRestore } from "../../../../src/backend/storage/sqlite/offline-restore.js";
import { AuthorityBackupManifestSchema,RecoveryRuntimeLockSnapshotSchema } from "../../../../src/backend/storage/sqlite/recovery-contracts.js";
import { RecoveryStopProofStore } from "../../../../src/backend/storage/sqlite/recovery-stop-proof.js";
import { acquireRuntimeProcessLock,acquireRuntimeRestoreAdmission,observeRuntimeLockSnapshot } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/protected-settings.js";
import { ProtectedSettingsCommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../src/rules/identity/ids.js";
import { capturedInstantClock } from "../../../../src/rules/time/clock.js";
import { CONFIG_SNAPSHOT,NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";
const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });
function fixture() {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "relay-native-backup-")));
  const admission = acquireEntrypointAdmission(workspace, "exclusive"), root = admission.stateRoot, path = join(root, "state.db");
  const database = AuthorityDatabase.open(admission, { path, busyTimeoutMs: 250, migrationOwner: "native-backup" });
  cleanups.push(() => { database.close(); admission.release(); rmSync(workspace, { recursive: true, force: true }); });
  const directory = join(root, "backups"), clock = capturedInstantClock(NOW);
  const service = new AuthorityBackupService(admission, database, { directory }, clock);
  return { workspace, root, path, admission, database, directory, clock, service };
}
describe("native authority backup", () => {
  it("restores the genuine protected command and audit while retaining independent credential bytes and exact replay", async () => {
    const f = fixture(), store = createCredentialStore({ admission: f.admission, stateRoot: f.root });
    f.database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    const command = ProtectedSettingsCommandRequestSchema.parse({ commandId: randomUUID(), requestedAt: NOW,
      requestedBy: LOCAL_OPERATOR_ACTOR_ID, source: "settings-surface", family: "settings", type: "apply-protected-settings",
      target: { expectedRevision: store.read().revision }, payload: { protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
        writeId: randomUUID(), entries: { ucpathPassword: { set: "synthetic-native-restore-private-value" } } } });
    const settings = createSettingsApplicationExecutor(() => { throw new Error("protected command reached ordinary settings"); }, store);
    const execute = (database: AuthorityDatabase) => executeSettingsCommand({ authority: database, clock: f.clock,
      ids: { uuid: randomUUID }, settings }, command);
    const accepted = execute(f.database); expect(accepted.state).toBe("applied");
    const audit = f.database.authority.commandAudits.findSettingsHistory(command.commandId);
    expect(audit?.result).toEqual(accepted);
    const credentialPath = join(f.root, "credentials", "protected.json"), bytes = readFileSync(credentialPath), before = statSync(credentialPath);
    const report = await f.service.request({ trigger: "operator", requiredGeneration: f.database.getMeta().authorityGeneration });
    const manifest = report.manifests[0], manifestPath = join(f.directory, `${manifest.backupFileName}.manifest.json`);
    f.database.close(); const processLockRoot = join(f.root, "locks");
    const snapshot = observeRuntimeLockSnapshot({ processLockRoot, sourceDatabaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(f.path) }, f.clock);
    const proofs = new RecoveryStopProofStore({ processLockRoot, maxProofAgeMs: 60_000 }, f.clock); proofs.recordRuntimeState(snapshot);
    const stoppedSystemProof = proofs.issue({ observedBy: LOCAL_OPERATOR_ACTOR_ID, sourceDatabaseIdentity: snapshot.sourceDatabaseIdentity });
    const restore = new OfflineAuthorityRestoreService(f.admission, { authorityPath: f.path, suspectDirectory: join(f.root, "backups", "suspects"),
      busyTimeoutMs: 250, processLockRoot, stoppedProofMaxAgeMs: 60_000 }, async () => undefined, f.clock);
    await expect(restore.restore({ manifestPath, stoppedSystemProof })).resolves.toMatchObject({ state: "restored" });
    const reopened = AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "native-protected-restore" });
    try {
      expect(reopened.authority.commandAudits.findSettingsHistory(command.commandId)).toEqual(audit);
      expect(execute(reopened)).toEqual({ ...accepted, state: "already-applied" });
      expect(reopened.authority.commandAudits.findSettingsHistory(command.commandId)).toEqual(audit);
      expect(store.read().revision).toBe(2);
      expect(readFileSync(credentialPath)).toEqual(bytes);
      const after = statSync(credentialPath);
      expect({ ino: after.ino, mtimeMs: after.mtimeMs, ctimeMs: after.ctimeMs, mode: after.mode, uid: after.uid }).toEqual({
        ino: before.ino, mtimeMs: before.mtimeMs, ctimeMs: before.ctimeMs, mode: before.mode, uid: before.uid });
    } finally { reopened.close(); }
  });
  it("restores authenticated native populated authority and preserves the suspect original and independent credential custody", async () => {
    const f = fixture(), report = await f.service.request({ trigger: "operator", requiredGeneration: f.database.getMeta().authorityGeneration });
    const manifest = report.manifests[0], manifestPath = join(f.directory, `${manifest.backupFileName}.manifest.json`);
    f.database.close();
    const original = readFileSync(f.path), credentials = join(f.root, "credentials"), credentialPath = join(credentials, "offline-custody.bin");
    mkdirSync(credentials, { mode: 0o700 }); writeFileSync(credentialPath, "synthetic-independent-credential", { mode: 0o600 });
    const credentialBytes = readFileSync(credentialPath), credentialStat = statSync(credentialPath), processLockRoot = join(f.root, "locks");
    const snapshot = observeRuntimeLockSnapshot({ processLockRoot, sourceDatabaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(f.path) }, f.clock);
    const proofs = new RecoveryStopProofStore({ processLockRoot, maxProofAgeMs: 60_000 }, f.clock);
    proofs.recordRuntimeState(snapshot);
    const stoppedSystemProof = proofs.issue({ observedBy: LOCAL_OPERATOR_ACTOR_ID, sourceDatabaseIdentity: snapshot.sourceDatabaseIdentity });
    let rebuilds = 0;
    const restore = new OfflineAuthorityRestoreService(f.admission, { authorityPath: f.path,
      suspectDirectory: join(f.root, "backups", "suspects"), busyTimeoutMs: 250, processLockRoot, stoppedProofMaxAgeMs: 60_000 },
      async staged => { rebuilds += 1; const stagedAdmission = f.admission.stoppedStagedAuthority(staged);
        try { expect(inspectAuthorityBackupReadOnly(stagedAdmission, staged).tables).toHaveLength(36); } finally { stagedAdmission.release(); } }, f.clock);
    const restored = await restore.restore({ manifestPath, stoppedSystemProof });
    expect(restored.state).toBe("restored"); expect(rebuilds).toBe(1);
    expect(readFileSync(join(f.root, "backups", "suspects", restored.suspectFileName))).toEqual(original);
    const admitted = inspectAuthorityBackupReadOnly(f.admission, f.path);
    expect(admitted.authorityContentFingerprint).toBe(manifest.authorityContentFingerprint);
    expect(admitted.authorityGeneration).toBe(manifest.authorityGeneration);
    expect(readFileSync(credentialPath)).toEqual(credentialBytes);
    expect(statSync(credentialPath).ino).toBe(credentialStat.ino); expect(statSync(credentialPath).mtimeMs).toBe(credentialStat.mtimeMs);
  });
  it.each(["before-swap", "after-swap"] as const)("preserves authenticated suspect evidence and reports the actual authority outcome on %s failure", async phase => {
    const f = fixture(), report = await f.service.request({ trigger: "operator", requiredGeneration: f.database.getMeta().authorityGeneration });
    const manifest = report.manifests[0], manifestPath = join(f.directory, `${manifest.backupFileName}.manifest.json`);
    f.database.close(); const original = readFileSync(f.path), processLockRoot = join(f.root, "locks"), suspects = join(f.root, "backups", "suspects");
    const snapshot = observeRuntimeLockSnapshot({ processLockRoot, sourceDatabaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(f.path) }, f.clock);
    const proofs = new RecoveryStopProofStore({ processLockRoot, maxProofAgeMs: 60_000 }, f.clock); proofs.recordRuntimeState(snapshot);
    const stoppedSystemProof = proofs.issue({ observedBy: LOCAL_OPERATOR_ACTOR_ID, sourceDatabaseIdentity: snapshot.sourceDatabaseIdentity });
    const restore = new OfflineAuthorityRestoreService(f.admission, { authorityPath: f.path, suspectDirectory: suspects,
      busyTimeoutMs: 250, processLockRoot, stoppedProofMaxAgeMs: 60_000 }, async () => undefined, f.clock,
      { copyFile: copyFileSync, atomicReplace: (source, destination) => {
        if (phase === "after-swap") renameSync(source, destination);
        throw new Error("synthetic-swap-fault");
      } });
    await expect(restore.restore({ manifestPath, stoppedSystemProof })).rejects.toMatchObject({
      authorityState: phase === "after-swap" ? "replaced" : "unchanged",
    });
    const preserved = readdirSync(suspects).filter(name => name.endsWith(".sqlite")); expect(preserved).toHaveLength(1);
    expect(readFileSync(join(suspects, preserved[0]))).toEqual(original);
    expect(inspectAuthorityBackupReadOnly(f.admission, f.path).authorityContentFingerprint).toBe(manifest.authorityContentFingerprint);
    if (phase === "before-swap") expect(readFileSync(f.path)).toEqual(original);
    const reacquired = acquireRuntimeRestoreAdmission({ processLockRoot, pid: process.pid }, f.clock);
    reacquired.release();
  });
  it.each([false,true])("keeps exact SQLite companion custody on rollback and retains an unfinished operation on rollback fault: %s", async rollbackFault => {
    const f = fixture(); f.database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    const report = await f.service.request({ trigger: "operator", requiredGeneration: f.database.getMeta().authorityGeneration });
    const manifest = report.manifests[0], manifestPath = join(f.directory, `${manifest.backupFileName}.manifest.json`);
    const companions = ["-wal","-shm"].map(suffix => ({ suffix, bytes: readFileSync(`${f.path}${suffix}`) }));
    f.database.close();
    for(const row of companions)writeFileSync(`${f.path}${row.suffix}`,row.bytes,{mode:0o600});
    const before = companions.map(row => ({...row, inode:statSync(`${f.path}${row.suffix}`).ino}));
    const original = readFileSync(f.path), processLockRoot = join(f.root,"locks"), journalPath = join(f.workspace,".tracker","control","journal.json");
    const snapshot = observeRuntimeLockSnapshot({processLockRoot,sourceDatabaseIdentity:AuthorityDatabase.sourceDatabaseIdentity(f.path)},f.clock);
    const proofs = new RecoveryStopProofStore({processLockRoot,maxProofAgeMs:60_000},f.clock);proofs.recordRuntimeState(snapshot);
    const stoppedSystemProof = proofs.issue({observedBy:LOCAL_OPERATOR_ACTOR_ID,sourceDatabaseIdentity:snapshot.sourceDatabaseIdentity});
    const restore = new OfflineAuthorityRestoreService(f.admission,{authorityPath:f.path,suspectDirectory:join(f.root,"backups","suspects"),
      busyTimeoutMs:250,processLockRoot,stoppedProofMaxAgeMs:60_000},async()=>undefined,f.clock,{
      copyFile:copyFileSync,atomicReplace(){throw new Error("before-authority-replacement");},renamePath(source,destination){
        if(rollbackFault && source.endsWith(".live-companion"))throw new Error("companion-rollback-fault");
        renameSync(source,destination);
      }});
    await expect(restore.restore({manifestPath,stoppedSystemProof})).rejects.toMatchObject({authorityState:rollbackFault ? "companion-state-uncertain" : "unchanged"});
    expect(readFileSync(f.path)).toEqual(original);
    if(rollbackFault){
      const journal = JSON.parse(readFileSync(journalPath,"utf8")) as {restore:{stagedPath:string}};
      expect(existsSync(journal.restore.stagedPath)).toBe(true);
      for(const row of before){expect(readFileSync(`${journal.restore.stagedPath}${row.suffix}.live-companion`)).toEqual(row.bytes);
        expect(statSync(`${journal.restore.stagedPath}${row.suffix}.live-companion`).ino).toBe(row.inode);}
      f.admission.release();expect(()=>acquireEntrypointAdmission(f.workspace,"shared")).toThrow(/unfinished restoring/u);
    }else{
      expect(existsSync(journalPath)).toBe(false);
      for(const row of before){expect(readFileSync(`${f.path}${row.suffix}`)).toEqual(row.bytes);expect(statSync(`${f.path}${row.suffix}`).ino).toBe(row.inode);}
    }
  });
  it.each(["replaced","unchanged"] as const)("keeps %s settlement and stopped recovery fenced when exact preserved suspect custody changes", async outcome => {
    for(const fault of ["missing","replaced-inode","changed-bytes","companion-missing","companion-inode","companion-bytes"]){
      const f=fixture();f.database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
      const report=await f.service.request({trigger:"operator",requiredGeneration:f.database.getMeta().authorityGeneration});
      const manifest=report.manifests[0],manifestPath=join(f.directory,`${manifest.backupFileName}.manifest.json`);
      const companions=["-wal","-shm"].map(suffix=>({suffix,bytes:readFileSync(`${f.path}${suffix}`)}));f.database.close();
      for(const row of companions)writeFileSync(`${f.path}${row.suffix}`,row.bytes,{mode:0o600});
      const processLockRoot=join(f.root,"locks"),suspects=join(f.root,"backups","suspects"),journalPath=join(f.workspace,".tracker","control","journal.json");
      const proofs=new RecoveryStopProofStore({processLockRoot,maxProofAgeMs:60_000},f.clock);
      const fresh=()=>{const observed=observeRuntimeLockSnapshot({processLockRoot,sourceDatabaseIdentity:AuthorityDatabase.sourceDatabaseIdentity(f.path)},f.clock);
        proofs.recordRuntimeState(observed);return proofs.issue({observedBy:LOCAL_OPERATOR_ACTOR_ID,sourceDatabaseIdentity:observed.sourceDatabaseIdentity});};
      const restore=new OfflineAuthorityRestoreService(f.admission,{authorityPath:f.path,suspectDirectory:suspects,
        busyTimeoutMs:250,processLockRoot,stoppedProofMaxAgeMs:60_000},async()=>undefined,f.clock,{
        copyFile:copyFileSync,atomicReplace(source,destination){
          if(outcome === "replaced")renameSync(source,destination);
          const suspect=join(suspects,readdirSync(suspects).find(name=>name.endsWith(".sqlite"))!);
          const target=fault.startsWith("companion")?`${suspect}-wal`:suspect;
          if(fault.endsWith("missing"))rmSync(target);
          else if(fault === "replaced-inode" || fault === "companion-inode"){
            renameSync(target,`${target}.preserved`);copyFileSync(`${target}.preserved`,target);
          }else{const bytes=readFileSync(target);bytes[bytes.length-1]^=1;writeFileSync(target,bytes);}
          if(outcome === "unchanged")throw new Error("fault-before-authority-replacement");
        }});
      await expect(restore.restore({manifestPath,stoppedSystemProof:fresh()}),fault).rejects.toMatchObject({authorityState:outcome});
      const journalBytes=readFileSync(journalPath),journal=JSON.parse(journalBytes.toString()) as {restore:{operationId:string}};
      f.admission.release();expect(()=>acquireEntrypointAdmission(f.workspace,"shared"),fault).toThrow(/unfinished restoring/u);
      const held=acquireRuntimeRestoreAdmission({processLockRoot,pid:process.pid},f.clock);
      const recovery=acquireRecoveryRuntimeRestore(f.workspace,journal.restore.operationId,held);
      try{
        await expect(settleInterruptedAuthorityRestore({admission:recovery.admission,operationId:journal.restore.operationId,
          manifestPath,outcome,processLockRoot,stoppedSystemProof:fresh(),restoreAdmission:held,clock:f.clock}),fault).rejects.toThrow();
        expect(readFileSync(journalPath),fault).toEqual(journalBytes);
      }finally{recovery.admission.release();held.release();}
      expect(()=>acquireEntrypointAdmission(f.workspace,"shared"),fault).toThrow(/unfinished restoring/u);
    }
  },30_000);
  it("retains a durable restore barrier after ambiguous replacement and staged disappearance, then settles only the exact verified replacement", async () => {
    const f = fixture(), report = await f.service.request({ trigger: "operator", requiredGeneration: f.database.getMeta().authorityGeneration });
    const manifest = report.manifests[0], manifestPath = join(f.directory, `${manifest.backupFileName}.manifest.json`);
    f.database.close(); const original = readFileSync(f.path), processLockRoot = join(f.root, "locks");
    const proofs = new RecoveryStopProofStore({ processLockRoot, maxProofAgeMs: 60_000 }, f.clock);
    const snapshot = observeRuntimeLockSnapshot({ processLockRoot, sourceDatabaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(f.path) }, f.clock);
    proofs.recordRuntimeState(snapshot);
    const stoppedSystemProof = proofs.issue({ observedBy: LOCAL_OPERATOR_ACTOR_ID, sourceDatabaseIdentity: snapshot.sourceDatabaseIdentity });
    const service = new OfflineAuthorityRestoreService(f.admission, { authorityPath: f.path, suspectDirectory: join(f.root, "backups", "suspects"),
      busyTimeoutMs: 250, processLockRoot, stoppedProofMaxAgeMs: 60_000 }, async () => undefined, f.clock,
      { copyFile: copyFileSync, atomicReplace(source, destination) {
        renameSync(source, destination); copyFileSync(destination, source); throw new Error("both-paths-after-replacement");
      } });
    await expect(service.restore({ manifestPath, stoppedSystemProof })).rejects.toMatchObject({ authorityState: "authority-state-uncertain" });
    const journalPath = join(f.workspace, ".tracker", "control", "journal.json"), journalBytes = readFileSync(journalPath);
    const journal = JSON.parse(journalBytes.toString()) as { phase: string; restore: { operationId: string; stagedPath: string; suspectPath: string } };
    expect(journal.phase).toBe("restoring"); expect(existsSync(journal.restore.stagedPath)).toBe(true);
    expect(readFileSync(journal.restore.suspectPath)).toEqual(original); expect(readFileSync(manifestPath)).not.toHaveLength(0);
    f.admission.release();
    expect(() => acquireEntrypointAdmission(f.workspace, "shared")).toThrow(/unfinished restoring/u);
    expect(() => inspectPendingRelocationStatus(f.workspace)).toThrow(/not an owned relocation/u);
    rmSync(journal.restore.stagedPath);
    expect(() => acquireEntrypointAdmission(f.workspace, "shared")).toThrow(/unfinished restoring/u);
    const restore = acquireRuntimeRestoreAdmission({ processLockRoot, pid: process.pid }, f.clock);
    let recovered: ReturnType<typeof acquireRecoveryRuntimeRestore> | undefined;
    try {
      expect(() => acquireRecoveryRuntimeRestore(f.workspace, "ffffffff-ffff-4fff-8fff-ffffffffffff", restore)).toThrow(/exact offline restore recovery/u);
      recovered = acquireRecoveryRuntimeRestore(f.workspace, journal.restore.operationId, restore);
      const currentRecovery = recovered;
      expect(() => currentRecovery.admission.settleAuthorityRestore({ ...currentRecovery.input, authorityGeneration: currentRecovery.input.authorityGeneration + 1 },
        "replaced", () => { throw new Error("wrong binding reached verifier"); }, restore)).toThrow(/operation binding mismatch/u);
      expect(() => currentRecovery.admission.settleAuthorityRestore(currentRecovery.input, "replaced", () => ({
        authorityGeneration: currentRecovery.input.authorityGeneration + 1, authorityContentFingerprint: currentRecovery.input.authorityContentFingerprint,
      }), restore)).toThrow(/authority proof mismatch/u);
      expect(readFileSync(journalPath)).toEqual(journalBytes);
      const fresh = () => { const observed = observeRuntimeLockSnapshot({ processLockRoot, sourceDatabaseIdentity: snapshot.sourceDatabaseIdentity }, f.clock);
        proofs.recordRuntimeState(observed); return proofs.issue({ observedBy: LOCAL_OPERATOR_ACTOR_ID, sourceDatabaseIdentity: observed.sourceDatabaseIdentity }); };
      await expect(settleInterruptedAuthorityRestore({ admission: currentRecovery.admission, operationId: journal.restore.operationId,
        manifestPath: join(f.directory, "other.manifest.json"), outcome: "replaced", processLockRoot,
        stoppedSystemProof: fresh(), restoreAdmission: restore, clock: f.clock })).rejects.toThrow(/manifest-binding-mismatch/u);
      expect(readFileSync(journalPath)).toEqual(journalBytes);
      const settled = await settleInterruptedAuthorityRestore({ admission: currentRecovery.admission, operationId: journal.restore.operationId,
        manifestPath, outcome: "replaced", processLockRoot, stoppedSystemProof: fresh(), restoreAdmission: restore, clock: f.clock });
      expect(settled).toEqual({ state: "settled", operationId: journal.restore.operationId, outcome: "replaced" });
      expect(existsSync(journalPath)).toBe(false);
    } finally { recovered?.admission.release(); restore.release(); }
    const reopened = acquireEntrypointAdmission(f.workspace, "shared");
    try { expect(inspectAuthorityBackupReadOnly(reopened, f.path).authorityContentFingerprint).toBe(manifest.authorityContentFingerprint); }
    finally { reopened.release(); }
  });
  it("publishes authenticated populated current bytes with the exact generation and table registry", async () => {
    const f = fixture(), report = await f.service.request({ trigger: "operator", requiredGeneration: f.database.getMeta().authorityGeneration });
    expect(report.manifests).toHaveLength(1);
    const manifest = report.manifests[0], manifestPath = join(f.directory, `${manifest.backupFileName}.manifest.json`);
    const verified = await verifyBackupManifestAtPath(f.admission, manifestPath);
    expect(verified.manifest).toEqual(manifest);
    expect(manifest.verification.authorityGeneration).toBe(f.database.getMeta().authorityGeneration);
    const copy = f.admission.verifiedReadOnlyCopy(verified.backupPath, manifest.sha256);
    try { const inspection = inspectAuthorityBackupReadOnly(copy, verified.backupPath);
      expect(inspection.tables).toHaveLength(36); expect(inspection.authorityContentFingerprint).toBe(manifest.authorityContentFingerprint);
      expect(inspection.exactTableRegistry).toBe(true); expect(inspection.invariantViolations).toEqual([]);
    } finally { copy.release(); }
  });
  it("refuses changed backup bytes and altered authenticated manifest identity", async () => {
    const f = fixture(), report = await f.service.request({ trigger: "operator", requiredGeneration: 0 });
    const manifest = report.manifests[0], manifestPath = join(f.directory, `${manifest.backupFileName}.manifest.json`);
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, authorityGeneration: manifest.authorityGeneration + 1 }));
    await expect(verifyBackupManifestAtPath(f.admission, manifestPath)).rejects.toThrow();
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const backupPath = join(f.directory, manifest.backupFileName), bytes = readFileSync(backupPath);
    bytes[bytes.length - 1] ^= 1; writeFileSync(backupPath, bytes);
    await expect(verifyBackupManifestAtPath(f.admission, manifestPath)).rejects.toThrow(/checksum/u);
  });
  it("refuses historical manifests, non-current database versions and an extra physical authority object", async () => {
    const f = fixture(), report = await f.service.request({ trigger: "operator", requiredGeneration: 0 });
    const manifest = report.manifests[0];
    expect(AuthorityBackupManifestSchema.safeParse({ ...manifest, manifestVersion: 1 }).success).toBe(false);
    expect(AuthorityBackupManifestSchema.safeParse({ ...manifest, schemaVersion: 56 }).success).toBe(false);
    f.database.close();
    const raw = new DatabaseSync(f.path);
    try { raw.exec("PRAGMA user_version=56"); } finally { raw.close(); }
    expect(() => inspectAuthorityBackupReadOnly(f.admission, f.path)).toThrow(/schema/u);
    const current = new DatabaseSync(f.path);
    try { current.exec("PRAGMA user_version=4; CREATE TABLE extra_authority(id TEXT)"); } finally { current.close(); }
    expect(() => inspectAuthorityBackupReadOnly(f.admission, f.path)).toThrow(/schema-shape/u);
  });
  it("backs up a stopped current source without conversion or settings side files", async () => {
    const f = fixture(), expected = f.database.getMeta(); f.database.close();
    const source = openAuthorityBackupSourceReadOnly(f.admission, f.path);
    try { expect(source.getMeta()).toEqual({ schemaVersion: 4, authorityGeneration: expected.authorityGeneration, updatedAt: expected.updatedAt });
      const report = await new AuthorityBackupService(f.admission, source, { directory: f.directory }, f.clock).request({ trigger: "operator", requiredGeneration: expected.authorityGeneration });
      expect(report.finalGeneration).toBe(expected.authorityGeneration);
    } finally { source.close(); }
  });
  it("observes every admitted process role and refuses stopped maintenance while live-smoke or unbound custody is held", async () => {
    const f = fixture(), processLockRoot=join(f.root,"locks"); f.database.close();
    for(const role of ["live-smoke","workers","geocode"] as const){
      const lock=acquireRuntimeProcessLock(role==="workers"?{processLockRoot,name:role,pid:process.pid,
        admission:{kind:"unbound-worker",authorityPath:f.path}}:{processLockRoot,name:role,pid:process.pid},f.clock);
      try{
        const snapshot=observeRuntimeLockSnapshot({processLockRoot,sourceDatabaseIdentity:AuthorityDatabase.sourceDatabaseIdentity(f.path)},f.clock);
        expect(Object.keys(snapshot.processLocks).sort()).toEqual(["geocode","live-smoke","server","workers"]);
        expect(snapshot.processLocks[role].state).toBe("active");
        const proofs=new RecoveryStopProofStore({processLockRoot,maxProofAgeMs:60_000},f.clock);
        proofs.recordRuntimeState(snapshot);
        expect(()=>proofs.issue({observedBy:LOCAL_OPERATOR_ACTOR_ID,sourceDatabaseIdentity:snapshot.sourceDatabaseIdentity})).toThrow();
        await expect(backupStoppedAuthority(f.admission,f.root,f.clock,processLockRoot)).rejects.toThrow(/runtime-active/u);
        await expect(upgradeStorage(f.admission,{stateRoot:f.root,processLockRoot,plan:false},f.clock)).rejects.toThrow(/runtime-active/u);
      }finally{lock.release();}
    }
    const stopped=observeRuntimeLockSnapshot({processLockRoot,sourceDatabaseIdentity:AuthorityDatabase.sourceDatabaseIdentity(f.path)},f.clock);
    const proofs=new RecoveryStopProofStore({processLockRoot,maxProofAgeMs:60_000},f.clock);proofs.recordRuntimeState(stopped);
    const proof=proofs.issue({observedBy:LOCAL_OPERATOR_ACTOR_ID,sourceDatabaseIdentity:stopped.sourceDatabaseIdentity});
    expect(proof.processLockGenerations["live-smoke"]).toBe(stopped.processLocks["live-smoke"].generation);
    expect(proof.processLockGenerations.geocode).toBe(stopped.processLocks.geocode.generation);
    const {geocode:_geocode,...withoutGeocode}=stopped.processLocks;
    expect(RecoveryRuntimeLockSnapshotSchema.safeParse({...stopped,processLocks:withoutGeocode}).success).toBe(false);
    expect(RecoveryRuntimeLockSnapshotSchema.safeParse({...stopped,processLocks:{...stopped.processLocks,"live-smoke":undefined}}).success).toBe(false);
    for(const role of ["geocode","live-smoke","workers"] as const){
      expect(()=>proofs.consumeAgainstLiveSnapshot(proof,{...stopped,processLocks:{...stopped.processLocks,
        [role]:{state:"stopped",generation:stopped.processLocks[role].generation+1}}})).toThrow(/generations/u);
    }
    await expect(upgradeStorage(f.admission,{stateRoot:f.root,processLockRoot,plan:false},f.clock)).resolves.toMatchObject({state:"already-upgraded"});
    const restore=acquireRuntimeRestoreAdmission({processLockRoot,pid:process.pid},f.clock);
    try{await expect(backupStoppedAuthority(f.admission,f.root,f.clock,processLockRoot,restore)).resolves.toMatchObject({state:"verified"});
      expect(()=>acquireRuntimeProcessLock({processLockRoot,name:"server",pid:process.pid},f.clock)).toThrow(/restore admission/u);
    }finally{restore.release();}
  });

  it("refuses uncertain immutable geocode claims before stopped maintenance can open or mutate authority",async()=>{
    const f=fixture(),processLockRoot=join(f.root,"locks");f.database.close();
    acquireRuntimeProcessLock({processLockRoot,name:"geocode",pid:process.pid},f.clock);
    const claims=join(processLockRoot,"geocode-claims"),claim=readdirSync(claims).find(name=>name.endsWith(".claim.json"));
    if(claim===undefined)throw new Error("missing genuine geocode claim");
    writeFileSync(join(claims,claim),"{}");const before=readFileSync(f.path);
    expect(()=>observeRuntimeLockSnapshot({processLockRoot,sourceDatabaseIdentity:AuthorityDatabase.sourceDatabaseIdentity(f.path)},f.clock)).toThrow();
    await expect(backupStoppedAuthority(f.admission,f.root,f.clock,processLockRoot)).rejects.toThrow();
    await expect(upgradeStorage(f.admission,{stateRoot:f.root,processLockRoot,plan:false},f.clock)).rejects.toThrow();
    expect(readFileSync(f.path)).toEqual(before);
  });

});
