import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/native-profile-probe.js";
import { createCredentialStore } from "../../../../src/backend/storage/configuration/credential-store.js";
import { createProfileRegistry } from "../../../../src/backend/profiles/registry.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync,existsSync,readdirSync,readFileSync,renameSync,rmSync,statSync,writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach,beforeEach,describe,expect,it } from "vitest";
import { executeSettingsCommand } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { acquireRecoveryRuntimeRestore } from "../../../../src/backend/storage/admission/admission.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { inspectPendingRelocationStatus } from "../../../../src/backend/storage/admission/installation.js";
import { backupStoppedAuthority,upgradeStorage } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { inspectAuthorityBackupReadOnly,openAuthorityBackupSourceReadOnly } from "../../../../src/backend/storage/sqlite/backup-inspection.js";
import { AuthorityBackupService,verifyBackupManifestAtPath } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { OfflineAuthorityRestoreService,settleInterruptedAuthorityRestore } from "../../../../src/backend/storage/sqlite/offline-restore.js";
import { AuthorityBackupManifestSchema,RecoveryRuntimeLockSnapshotSchema } from "../../../../src/backend/storage/sqlite/recovery-contracts.js";
import { RecoveryStopProofStore } from "../../../../src/backend/storage/sqlite/recovery-stop-proof.js";
import { acquireRuntimeProcessLock,acquireRuntimeRestoreAdmission,observeRuntimeLockSnapshot } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { AUTHORITY_TABLE_REGISTRY } from "../../../../src/models/config/authority.js";
import { initialSettingsFileRecord } from "../../../../src/models/config/settings.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/protected-settings.js";
import { ProtectedSettingsCommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../src/rules/identity/ids.js";
import { capturedInstantClock } from "../../../../src/rules/time/clock.js";
import { CONFIG_SNAPSHOT,NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";
const expectedTables = AUTHORITY_TABLE_REGISTRY.map(({name,classification})=>({name,classification}))
  .sort((left,right)=>left.name.localeCompare(right.name));
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of [...cleanups]) { await cleanup(); cleanups.splice(cleanups.indexOf(cleanup), 1); } });
async function fixture() {
  const bound = await createBoundProfileFixture();
  const { workspace, path } = bound, root = bound.stateRoot;
  let admission = bound.admission;
  const profileId = admission.profileBinding.profileId;
  let credentials = boundProfileCredentials(admission);
  const database = AuthorityDatabase.open(admission, { path, busyTimeoutMs: 250, migrationOwner: "native-backup" }, undefined, undefined, undefined, undefined, credentials);
  cleanups.push(async () => { database.close(); admission.release(); await bound.close(); });
  const directory = join(root, "backups", "authority"), clock = capturedInstantClock(NOW);
  const resolved = resolveConfigWithProvenance(initialSettingsFileRecord().settings, { primaryDisplay: null }, clock, admission);
  const configSnapshot = { ...CONFIG_SNAPSHOT, config: resolved.config, fingerprint: resolved.fingerprint,
    provenance: resolved.provenance, capturedAt: clock.now().toISOString() };
  const service = new AuthorityBackupService(admission, database, { directory }, clock);
  return { workspace, lifetime: bound.lifetime, root, path, get admission() { return admission; }, get credentials() { return credentials; }, machine: bound.machine,
    renewAfterRestore() {
      admission.release();
      admission = bound.machine.admitProfile(createProfileRegistry(bound.machine).storageClaim(profileId));
      credentials = createCredentialStore({ admission, stateRoot: root, erasureJournalAdmission: bound.machine,
        erasureJournalPath: join(bound.machine.stateRoot, "machine", "erasures", `${profileId}.json`) });
    }, database, directory, clock, service, configSnapshot };
}
describe("native authority backup", () => {
  it("restores the genuine protected command and audit while retaining independent credential bytes and exact replay", async () => {
    const f = await fixture(), store = f.credentials;
    f.database.authority.runtimeConfig.initialize(f.configSnapshot);
    const command = ProtectedSettingsCommandRequestSchema.parse({ commandId: randomUUID(), requestedAt: NOW,
      requestedBy: LOCAL_OPERATOR_ACTOR_ID, source: "settings-surface", family: "settings", type: "apply-protected-settings",
      target: { expectedRevision: store.read().revision }, payload: { protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
        writeId: randomUUID(), entries: { ucpathPassword: { set: "synthetic-native-restore-private-value" } } } });
    const execute = (database: AuthorityDatabase) => executeSettingsCommand({ authority: database, clock: f.clock,
      ids: { uuid: randomUUID }, settings: createSettingsApplicationExecutor(() => { throw new Error("protected command reached ordinary settings"); }, f.credentials) }, command);
    const accepted = execute(f.database); expect(accepted.state).toBe("applied");
    const audit = f.database.authority.commandAudits.findSettingsHistory(command.commandId);
    expect(audit?.result).toEqual(accepted);
    const credentialPath = join(f.root, "credentials", "protected.json"), bytes = readFileSync(credentialPath), before = statSync(credentialPath);
    const report = await f.service.request({ trigger: "operator", requiredGeneration: f.database.getMeta().authorityGeneration });
    const manifest = report.manifests[0], manifestPath = join(f.directory, `${manifest.backupFileName}.manifest.json`);
    f.database.close(); const processLockRoot = join(f.workspace, rebuildRuntimeIsolation.processLockRoot);
    const snapshot = observeRuntimeLockSnapshot({ processLockRoot, sourceDatabaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(f.path) }, f.clock);
    const proofs = new RecoveryStopProofStore({ processLockRoot, maxProofAgeMs: 60_000 }, f.clock); proofs.recordRuntimeState(snapshot);
    const stoppedSystemProof = proofs.issue({ observedBy: LOCAL_OPERATOR_ACTOR_ID, sourceDatabaseIdentity: snapshot.sourceDatabaseIdentity });
    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, f.admission, { authorityPath: f.path, suspectDirectory: join(f.root, "backups", "suspects"),
      busyTimeoutMs: 250, processLockRoot, stoppedProofMaxAgeMs: 60_000 }, async () => undefined, f.clock, undefined, undefined, f.credentials);
    await expect(restore.restore({ manifestPath, stoppedSystemProof })).resolves.toMatchObject({ state: "restored" });
    expect(() => AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "stale-restore-owner" })).toThrow();
    f.renewAfterRestore();
    const reopened = AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "native-protected-restore" }, undefined, undefined, undefined, undefined, f.credentials);
    try {
      expect(reopened.authority.commandAudits.findSettingsHistory(command.commandId)).toEqual(audit);
      expect(execute(reopened)).toEqual({ ...accepted, state: "already-applied" });
      expect(reopened.authority.commandAudits.findSettingsHistory(command.commandId)).toEqual(audit);
      expect(f.credentials.read().revision).toBe(command.target.expectedRevision + 1);
      expect(readFileSync(credentialPath)).toEqual(bytes);
      const after = statSync(credentialPath);
      expect({ ino: after.ino, mtimeMs: after.mtimeMs, ctimeMs: after.ctimeMs, mode: after.mode, uid: after.uid }).toEqual({
        ino: before.ino, mtimeMs: before.mtimeMs, ctimeMs: before.ctimeMs, mode: before.mode, uid: before.uid });
    } finally { reopened.close(); }
  });
  it("restores authenticated native populated authority and preserves the suspect original and independent credential custody", async () => {
    const f = await fixture(), report = await f.service.request({ trigger: "operator", requiredGeneration: f.database.getMeta().authorityGeneration });
    const manifest = report.manifests[0], manifestPath = join(f.directory, `${manifest.backupFileName}.manifest.json`);
    f.database.close();
    const original = readFileSync(f.path), credentials = join(f.root, "credentials"), credentialPath = join(f.root, "offline-custody.bin");
    expect(statSync(credentials).isDirectory()).toBe(true); writeFileSync(credentialPath, "synthetic-independent-credential", { mode: 0o600 });
    const credentialBytes = readFileSync(credentialPath), credentialStat = statSync(credentialPath), processLockRoot = join(f.workspace, rebuildRuntimeIsolation.processLockRoot);
    const snapshot = observeRuntimeLockSnapshot({ processLockRoot, sourceDatabaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(f.path) }, f.clock);
    const proofs = new RecoveryStopProofStore({ processLockRoot, maxProofAgeMs: 60_000 }, f.clock);
    proofs.recordRuntimeState(snapshot);
    const stoppedSystemProof = proofs.issue({ observedBy: LOCAL_OPERATOR_ACTOR_ID, sourceDatabaseIdentity: snapshot.sourceDatabaseIdentity });
    let rebuilds = 0;
    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, f.admission, { authorityPath: f.path,
      suspectDirectory: join(f.root, "backups", "suspects"), busyTimeoutMs: 250, processLockRoot, stoppedProofMaxAgeMs: 60_000 },
      async staged => { rebuilds += 1; const stagedAdmission = f.admission.stoppedStagedAuthority(staged);
        try { expect(inspectAuthorityBackupReadOnly(stagedAdmission, staged).tables).toEqual(expectedTables); } finally { stagedAdmission.release(); } }, f.clock, undefined, undefined, f.credentials);
    const restored = await restore.restore({ manifestPath, stoppedSystemProof });
    expect(restored.state).toBe("restored"); expect(rebuilds).toBe(1);
    expect(readFileSync(join(f.root, "backups", "suspects", restored.suspectFileName))).toEqual(original);
    expect(() => AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "stale-restore-owner" })).toThrow();
    f.renewAfterRestore();
    const admitted = inspectAuthorityBackupReadOnly(f.admission, f.path);
    expect(admitted.authorityContentFingerprint).toBe(manifest.authorityContentFingerprint);
    expect(admitted.authorityGeneration).toBe(manifest.authorityGeneration);
    expect(readFileSync(credentialPath)).toEqual(credentialBytes);
    expect(statSync(credentialPath).ino).toBe(credentialStat.ino); expect(statSync(credentialPath).mtimeMs).toBe(credentialStat.mtimeMs);
  });
  it.each(["before-swap", "after-swap"] as const)("preserves authenticated suspect evidence and reports the actual authority outcome on %s failure", async phase => {
    const f = await fixture(), report = await f.service.request({ trigger: "operator", requiredGeneration: f.database.getMeta().authorityGeneration });
    const manifest = report.manifests[0], manifestPath = join(f.directory, `${manifest.backupFileName}.manifest.json`);
    f.database.close(); const original = readFileSync(f.path), processLockRoot = join(f.workspace, rebuildRuntimeIsolation.processLockRoot), suspects = join(f.root, "backups", "suspects");
    const snapshot = observeRuntimeLockSnapshot({ processLockRoot, sourceDatabaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(f.path) }, f.clock);
    const proofs = new RecoveryStopProofStore({ processLockRoot, maxProofAgeMs: 60_000 }, f.clock); proofs.recordRuntimeState(snapshot);
    const stoppedSystemProof = proofs.issue({ observedBy: LOCAL_OPERATOR_ACTOR_ID, sourceDatabaseIdentity: snapshot.sourceDatabaseIdentity });
    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, f.admission, { authorityPath: f.path, suspectDirectory: suspects,
      busyTimeoutMs: 250, processLockRoot, stoppedProofMaxAgeMs: 60_000 }, async () => undefined, f.clock,
      { copyFile: copyFileSync, atomicReplace: (source, destination) => {
        if (phase === "after-swap") renameSync(source, destination);
        throw new Error("synthetic-swap-fault");
      } }, undefined, f.credentials);
    await expect(restore.restore({ manifestPath, stoppedSystemProof })).rejects.toMatchObject({
      authorityState: phase === "after-swap" ? "replaced" : "unchanged",
    });
    const preserved = readdirSync(suspects).filter(name => name.endsWith(".sqlite")); expect(preserved).toHaveLength(1);
    expect(readFileSync(join(suspects, preserved[0]))).toEqual(original);
    const copy = f.machine.verifiedReadOnlyCopy(f.path, createHash("sha256").update(readFileSync(f.path)).digest("hex"));
    try { expect(inspectAuthorityBackupReadOnly(copy, f.path).authorityContentFingerprint).toBe(manifest.authorityContentFingerprint); } finally { copy.release(); }
    if (phase === "before-swap") expect(readFileSync(f.path)).toEqual(original);
    const reacquired = acquireRuntimeRestoreAdmission({ processLockRoot, pid: process.pid }, f.clock);
    reacquired.release();
  });
  it.each([false,true])("keeps exact SQLite companion custody on rollback and retains an unfinished operation on rollback fault: %s", async rollbackFault => {
    const f = await fixture(); f.database.authority.runtimeConfig.initialize(f.configSnapshot);
    const report = await f.service.request({ trigger: "operator", requiredGeneration: f.database.getMeta().authorityGeneration });
    const manifest = report.manifests[0], manifestPath = join(f.directory, `${manifest.backupFileName}.manifest.json`);
    const companions = ["-wal","-shm"].map(suffix => ({ suffix, bytes: readFileSync(`${f.path}${suffix}`) }));
    f.database.close();
    for(const row of companions)writeFileSync(`${f.path}${row.suffix}`,row.bytes,{mode:0o600});
    const before = companions.map(row => ({...row, inode:statSync(`${f.path}${row.suffix}`).ino}));
    const original = readFileSync(f.path), processLockRoot = join(f.workspace,rebuildRuntimeIsolation.processLockRoot), journalPath = join(f.workspace,".tracker","control","journal.json");
    const snapshot = observeRuntimeLockSnapshot({processLockRoot,sourceDatabaseIdentity:AuthorityDatabase.sourceDatabaseIdentity(f.path)},f.clock);
    const proofs = new RecoveryStopProofStore({processLockRoot,maxProofAgeMs:60_000},f.clock);proofs.recordRuntimeState(snapshot);
    const stoppedSystemProof = proofs.issue({observedBy:LOCAL_OPERATOR_ACTOR_ID,sourceDatabaseIdentity:snapshot.sourceDatabaseIdentity});
    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, f.admission,{authorityPath:f.path,suspectDirectory:join(f.root,"backups","suspects"),
      busyTimeoutMs:250,processLockRoot,stoppedProofMaxAgeMs:60_000},async()=>undefined,f.clock,{
      copyFile:copyFileSync,atomicReplace(){throw new Error("before-authority-replacement");},renamePath(source,destination){
        if(rollbackFault && source.endsWith(".live-companion"))throw new Error("companion-rollback-fault");
        renameSync(source,destination);
      }}, undefined, f.credentials);
    await expect(restore.restore({manifestPath,stoppedSystemProof})).rejects.toMatchObject({authorityState:rollbackFault ? "companion-state-uncertain" : "unchanged"});
    expect(readFileSync(f.path)).toEqual(original);
    if(rollbackFault){
      const journal = JSON.parse(readFileSync(journalPath,"utf8")) as {restore:{stagedPath:string}};
      expect(existsSync(journal.restore.stagedPath)).toBe(true);
      for(const row of before){expect(readFileSync(`${journal.restore.stagedPath}${row.suffix}.live-companion`)).toEqual(row.bytes);
        expect(statSync(`${journal.restore.stagedPath}${row.suffix}.live-companion`).ino).toBe(row.inode);}
      f.admission.release();f.machine.release();expect(()=>acquireEntrypointAdmission(f.workspace,"shared", f.lifetime)).toThrow(/unfinished restoring/u);
    }else{
      expect(existsSync(journalPath)).toBe(false);
      for(const row of before){expect(readFileSync(`${f.path}${row.suffix}`)).toEqual(row.bytes);expect(statSync(`${f.path}${row.suffix}`).ino).toBe(row.inode);}
    }
  });
  it("retains a durable restore barrier after ambiguous replacement and staged disappearance, then settles only the exact verified replacement", async () => {
    const f = await fixture(), report = await f.service.request({ trigger: "operator", requiredGeneration: f.database.getMeta().authorityGeneration });
    const manifest = report.manifests[0], manifestPath = join(f.directory, `${manifest.backupFileName}.manifest.json`);
    f.database.close(); const original = readFileSync(f.path), processLockRoot = join(f.workspace, rebuildRuntimeIsolation.processLockRoot);
    const proofs = new RecoveryStopProofStore({ processLockRoot, maxProofAgeMs: 60_000 }, f.clock);
    const snapshot = observeRuntimeLockSnapshot({ processLockRoot, sourceDatabaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(f.path) }, f.clock);
    proofs.recordRuntimeState(snapshot);
    const stoppedSystemProof = proofs.issue({ observedBy: LOCAL_OPERATOR_ACTOR_ID, sourceDatabaseIdentity: snapshot.sourceDatabaseIdentity });
    const service = new OfflineAuthorityRestoreService(profileBrowserClosure, f.admission, { authorityPath: f.path, suspectDirectory: join(f.root, "backups", "suspects"),
      busyTimeoutMs: 250, processLockRoot, stoppedProofMaxAgeMs: 60_000 }, async () => undefined, f.clock,
      { copyFile: copyFileSync, atomicReplace(source, destination) {
        renameSync(source, destination); copyFileSync(destination, source); throw new Error("both-paths-after-replacement");
      } }, undefined, f.credentials);
    await expect(service.restore({ manifestPath, stoppedSystemProof })).rejects.toMatchObject({ authorityState: "authority-state-uncertain" });
    const journalPath = join(f.workspace, ".tracker", "control", "journal.json"), journalBytes = readFileSync(journalPath);
    const journal = JSON.parse(journalBytes.toString()) as { phase: string; restore: { operationId: string; stagedPath: string; suspectPath: string } };
    expect(journal.phase).toBe("restoring"); expect(existsSync(journal.restore.stagedPath)).toBe(true);
    expect(readFileSync(journal.restore.suspectPath)).toEqual(original); expect(readFileSync(manifestPath)).not.toHaveLength(0);
    f.admission.release(); f.machine.release();
    expect(() => acquireEntrypointAdmission(f.workspace, "shared", f.lifetime)).toThrow(/unfinished restoring/u);
    expect(() => inspectPendingRelocationStatus(f.workspace)).toThrow(/not an owned relocation/u);
    rmSync(journal.restore.stagedPath);
    expect(() => acquireEntrypointAdmission(f.workspace, "shared", f.lifetime)).toThrow(/unfinished restoring/u);
    const restore = acquireRuntimeRestoreAdmission({ processLockRoot, pid: process.pid }, f.clock);
    let recovered: ReturnType<typeof acquireRecoveryRuntimeRestore> | undefined;
    try {
      expect(() => acquireRecoveryRuntimeRestore(f.workspace, f.lifetime, "ffffffff-ffff-4fff-8fff-ffffffffffff", restore)).toThrow(/exact offline restore recovery/u);
      recovered = acquireRecoveryRuntimeRestore(f.workspace, f.lifetime, journal.restore.operationId, restore);
      const currentRecovery = recovered;
      let wrongBindingVerifications = 0;
      expect(() => currentRecovery.admission.settleAuthorityRestore({ ...currentRecovery.input, authorityGeneration: currentRecovery.input.authorityGeneration + 1 },
        "replaced", () => { wrongBindingVerifications += 1; throw new Error("wrong binding reached verifier"); }, restore)).toThrow("profile-restore-custody-mismatch");
      expect(wrongBindingVerifications).toBe(0);
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
    const reopened = acquireEntrypointAdmission(f.workspace, "shared", f.lifetime);
    try { const copy = reopened.verifiedReadOnlyCopy(f.path, createHash("sha256").update(readFileSync(f.path)).digest("hex"));
      try { expect(inspectAuthorityBackupReadOnly(copy, f.path).authorityContentFingerprint).toBe(manifest.authorityContentFingerprint); } finally { copy.release(); } }
    finally { reopened.release(); }
  });
  it("publishes authenticated populated current bytes with the exact generation and table registry", async () => {
    const f = await fixture(), report = await f.service.request({ trigger: "operator", requiredGeneration: f.database.getMeta().authorityGeneration });
    expect(report.manifests).toHaveLength(1);
    const manifest = report.manifests[0], manifestPath = join(f.directory, `${manifest.backupFileName}.manifest.json`);
    const verified = await verifyBackupManifestAtPath(f.admission, manifestPath);
    expect(verified.manifest).toEqual(manifest);
    expect(manifest.verification.authorityGeneration).toBe(f.database.getMeta().authorityGeneration);
    const copy = f.admission.verifiedReadOnlyCopy(verified.backupPath, manifest.sha256);
    try { const inspection = inspectAuthorityBackupReadOnly(copy, verified.backupPath);
      expect(inspection.tables).toEqual(expectedTables); expect(inspection.authorityContentFingerprint).toBe(manifest.authorityContentFingerprint);
      expect(inspection.exactTableRegistry).toBe(true); expect(inspection.invariantViolations).toEqual([]);
    } finally { copy.release(); }
  });
  it("refuses changed backup bytes and altered authenticated manifest identity", async () => {
    const f = await fixture(), report = await f.service.request({ trigger: "operator", requiredGeneration: 0 });
    const manifest = report.manifests[0], manifestPath = join(f.directory, `${manifest.backupFileName}.manifest.json`);
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, authorityGeneration: manifest.authorityGeneration + 1 }));
    await expect(verifyBackupManifestAtPath(f.admission, manifestPath)).rejects.toThrow();
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const backupPath = join(f.directory, manifest.backupFileName), bytes = readFileSync(backupPath);
    bytes[bytes.length - 1] ^= 1; writeFileSync(backupPath, bytes);
    await expect(verifyBackupManifestAtPath(f.admission, manifestPath)).rejects.toThrow(/checksum/u);
  });
  it("refuses historical manifests, non-current database versions and an extra physical authority object", async () => {
    const f = await fixture(), report = await f.service.request({ trigger: "operator", requiredGeneration: 0 });
    const manifest = report.manifests[0];
    expect(AuthorityBackupManifestSchema.safeParse({ ...manifest, manifestVersion: 1 }).success).toBe(false);
    expect(AuthorityBackupManifestSchema.safeParse({ ...manifest, schemaVersion: 56 }).success).toBe(false);
    f.database.close();
    const raw = new DatabaseSync(f.path);
    try { raw.exec("PRAGMA user_version=56"); } finally { raw.close(); }
    expect(() => inspectAuthorityBackupReadOnly(f.admission, f.path)).toThrow(/schema/u);
    const historical = new DatabaseSync(f.path);
    try { historical.exec("PRAGMA user_version=6"); } finally { historical.close(); }
    expect(() => inspectAuthorityBackupReadOnly(f.admission, f.path)).toThrow(/schema/u);
    const current = new DatabaseSync(f.path);
    try { current.exec(`PRAGMA user_version=${String(CURRENT_AUTHORITY_SCHEMA_VERSION)}; CREATE TABLE extra_authority(id TEXT)`); } finally { current.close(); }
    expect(() => inspectAuthorityBackupReadOnly(f.admission, f.path)).toThrow(/schema-shape/u);
  });
  it("backs up a stopped current source without conversion or settings side files", async () => {
    const f = await fixture(), expected = f.database.getMeta(); f.database.close();
    const source = openAuthorityBackupSourceReadOnly(f.admission, f.path);
    try { expect(source.getMeta()).toEqual({ schemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION, authorityGeneration: expected.authorityGeneration, updatedAt: expected.updatedAt, installationId: expected.installationId, profileId: expected.profileId });
      const report = await new AuthorityBackupService(f.admission, source, { directory: f.directory }, f.clock).request({ trigger: "operator", requiredGeneration: expected.authorityGeneration });
      expect(report.finalGeneration).toBe(expected.authorityGeneration);
    } finally { source.close(); }
  });
  it("observes every admitted process role and refuses stopped maintenance while live-smoke or unbound custody is held", async () => {
    const f = await fixture(), processLockRoot=join(f.workspace,rebuildRuntimeIsolation.processLockRoot); f.database.close();
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
        await expect(backupStoppedAuthority(profileBrowserClosure, f.admission,f.root,f.clock,processLockRoot)).rejects.toThrow(/runtime-active/u);
        await expect(upgradeStorage(profileBrowserClosure, f.admission,{stateRoot:f.root,processLockRoot,plan:false},f.clock)).rejects.toThrow(/runtime-active/u);
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
    await expect(upgradeStorage(profileBrowserClosure, f.admission,{stateRoot:f.root,processLockRoot,plan:false},f.clock)).resolves.toMatchObject({state:"already-upgraded"});
    const restore=acquireRuntimeRestoreAdmission({processLockRoot,pid:process.pid},f.clock);
    try{await expect(backupStoppedAuthority(profileBrowserClosure, f.admission,f.root,f.clock,processLockRoot,restore)).resolves.toMatchObject({state:"verified"});
      expect(()=>acquireRuntimeProcessLock({processLockRoot,name:"server",pid:process.pid},f.clock)).toThrow(/restore admission/u);
    }finally{restore.release();}
  });

  it("refuses uncertain immutable geocode claims before stopped maintenance can open or mutate authority",async()=>{
    const f=await fixture(),processLockRoot=join(f.workspace,rebuildRuntimeIsolation.processLockRoot);f.database.close();
    acquireRuntimeProcessLock({processLockRoot,name:"geocode",pid:process.pid},f.clock);
    const claims=join(processLockRoot,"geocode-claims"),claim=readdirSync(claims).find(name=>name.endsWith(".claim.json"));
    if(claim===undefined)throw new Error("missing genuine geocode claim");
    writeFileSync(join(claims,claim),"{}");const before=readFileSync(f.path);
    expect(()=>observeRuntimeLockSnapshot({processLockRoot,sourceDatabaseIdentity:AuthorityDatabase.sourceDatabaseIdentity(f.path)},f.clock)).toThrow();
    await expect(backupStoppedAuthority(profileBrowserClosure, f.admission,f.root,f.clock,processLockRoot)).rejects.toThrow();
    await expect(upgradeStorage(profileBrowserClosure, f.admission,{stateRoot:f.root,processLockRoot,plan:false},f.clock)).rejects.toThrow();
    expect(readFileSync(f.path)).toEqual(before);
  });

});

describe("native authority backup", () => {
  const faults = ["missing","replaced-inode","changed-bytes","companion-missing","companion-inode","companion-bytes"] as const;
  const prepared = new Map<typeof faults[number], Awaited<ReturnType<typeof fixture>>>();
  beforeEach(() => { prepared.clear(); });
  for (const fault of faults) {
    beforeEach(async () => { prepared.set(fault, await fixture()); });
  }
  it.each(["replaced","unchanged"] as const)("keeps %s settlement and stopped recovery fenced when exact preserved suspect custody changes", async outcome => {
    expect([...prepared.keys()]).toEqual(faults);
    for(const fault of faults){
      const f = prepared.get(fault);
      if (f === undefined) throw new Error("backup-suspect-fixture-owner-missing");
      f.database.authority.runtimeConfig.initialize(f.configSnapshot);
      const report=await f.service.request({trigger:"operator",requiredGeneration:f.database.getMeta().authorityGeneration});
      const manifest=report.manifests[0],manifestPath=join(f.directory,`${manifest.backupFileName}.manifest.json`);
      const companions=["-wal","-shm"].map(suffix=>({suffix,bytes:readFileSync(`${f.path}${suffix}`)}));f.database.close();
      for(const row of companions)writeFileSync(`${f.path}${row.suffix}`,row.bytes,{mode:0o600});
      const processLockRoot=join(f.workspace,rebuildRuntimeIsolation.processLockRoot),suspects=join(f.root,"backups","suspects"),journalPath=join(f.workspace,".tracker","control","journal.json");
      const proofs=new RecoveryStopProofStore({processLockRoot,maxProofAgeMs:60_000},f.clock);
      const fresh=()=>{const observed=observeRuntimeLockSnapshot({processLockRoot,sourceDatabaseIdentity:AuthorityDatabase.sourceDatabaseIdentity(f.path)},f.clock);
        proofs.recordRuntimeState(observed);return proofs.issue({observedBy:LOCAL_OPERATOR_ACTOR_ID,sourceDatabaseIdentity:observed.sourceDatabaseIdentity});};
      const restore=new OfflineAuthorityRestoreService(profileBrowserClosure, f.admission,{authorityPath:f.path,suspectDirectory:suspects,
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
        }}, undefined, f.credentials);
      await expect(restore.restore({manifestPath,stoppedSystemProof:fresh()}),fault).rejects.toMatchObject({authorityState:outcome});
      const journalBytes=readFileSync(journalPath),journal=JSON.parse(journalBytes.toString()) as {restore:{operationId:string}};
      f.admission.release();f.machine.release();expect(()=>acquireEntrypointAdmission(f.workspace,"shared", f.lifetime),fault).toThrow(/unfinished restoring/u);
      const held=acquireRuntimeRestoreAdmission({processLockRoot,pid:process.pid},f.clock);
      const recovery=acquireRecoveryRuntimeRestore(f.workspace, f.lifetime,journal.restore.operationId,held);
      try{
        await expect(settleInterruptedAuthorityRestore({admission:recovery.admission,operationId:journal.restore.operationId,
          manifestPath,outcome,processLockRoot,stoppedSystemProof:fresh(),restoreAdmission:held,clock:f.clock}),fault).rejects.toThrow();
        expect(readFileSync(journalPath),fault).toEqual(journalBytes);
      }finally{recovery.admission.release();held.release();}
      expect(()=>acquireEntrypointAdmission(f.workspace,"shared", f.lifetime),fault).toThrow(/unfinished restoring/u);
    }
  },30_000);
});
