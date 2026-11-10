import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs,{ copyFileSync,existsSync,lstatSync,readdirSync,readFileSync,renameSync,rmSync,writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from 'node:path';
import { describe,it,vi } from "vitest";
import { z } from "zod";
import { runSecureEnvironmentBootstrap } from "../../../../src/backend/app/bootstrap/secure-env-bootstrap.js";
import { createProfileRegistry } from "../../../../src/backend/profiles/registry.js";
import { reconcileStoppedLogout } from "../../../../src/backend/runs/lifecycle/startup-crash-recovery.js";
import { NativeBrowserClosureUnprovedError } from "../../../../src/backend/runtime/browser/native-browser.js";
import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/profile-browser-closure.js";
import { isOfflineMaintenanceOperationActive,RuntimeAlreadyRunningError,RuntimeLifetimeLock,type OfflineMaintenanceOperation } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import * as nativeBrowserInventory from "../../../../src/backend/storage/maintenance/profile-inventory.js";
import { BrowserProfileStillClosingError } from "../../../../src/workflow-kit/session.js";
import { testProcessImport } from "../../../support/compiled-process.js";
import { createStorageRestoreTestWorld } from "../../../support/helpers/backend/storage-restore-world.js";
import { storageTree } from "../../../support/helpers/integration/storage-recovery-fixture.js";
import { AuthorityDatabase as FixtureAuthorityDatabase } from "../../../support/helpers/synthetic-database-admission.js";

import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { createProfileSession } from "../../../../src/backend/profiles/profile-session.js";

import { executeSettingsCommand } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { acquireRecoveryRuntimeRestore,RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";

import { CanonicalCredentialHeadSchema,createCanonicalCredentials } from "../../../../src/backend/storage/configuration/canonical-credential-store.js";
import { credentialKeyCustody } from "../../../../src/backend/storage/configuration/credential-key-custody.js";
import { createCredentialStore } from "../../../../src/backend/storage/configuration/credential-store.js";

import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityBackupService } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { OfflineAuthorityRestoreService,OfflineRestoreFailure,resumeAutomaticAuthorityRestore } from "../../../../src/backend/storage/sqlite/offline-restore.js";
import { plantOldBuildArtifact } from "../../../support/helpers/storage/old-build-artifact.js";
import { DuoCredentialRecordSchema } from "../../../../src/models/config/duo-credential-store.js";
import { deriveSettingsPatchFingerprint,initialSettingsFileRecord,SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/settings.js";
import { ConfigSnapshotRecordSchema } from "../../../../src/models/config/snapshot.js";
import { LogoutOperationSchema } from "../../../../src/models/profiles/profile.js";
import { runClaim } from "../../../../src/models/run/record.js";
import { manualClock,systemClock,type Clock } from "../../../../src/rules/time/clock.js";
import { deriveWriteAuthorityReason } from "../../../../src/rules/write-safety/write-authority-reason.js";

import { ATOMIC_WRITE_COMMIT,CONFIG_SNAPSHOT,WRITE_ATTEMPT,WRITE_INTENT_ATTEMPTING } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { createBoundProfileFixture,signInBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

import { FakeKeyringEntry } from "../../../support/helpers/credential-keychain-fake.js";

import { seedAtomicWriteOwner } from "../../../support/helpers/timeline-write-fixture.js";
import { fenceWriteFixture } from "../../../support/helpers/write-fence-fixture.js";
import { scaledMs } from "../../../support/time-scale.js";

async function world(clock: Clock = systemClock) {
  const fixture = await createBoundProfileFixture();
  const profileId = fixture.admission.profileBinding.profileId;
  const headPath = join(fixture.machine.stateRoot, "machine", "credential-keys", profileId + ".json");
  const processLockRoot = join(fixture.workspace, rebuildRuntimeIsolation.processLockRoot);
  let admission = fixture.admission;
  const renew = (select = false) => {
    if (select) createProfileRegistry(fixture.machine).advanceSession(profileId);
    admission = fixture.machine.admitProfile(profileId); return admission;
  };
  const store = () => createCredentialStore({ admission, stateRoot: fixture.stateRoot });
  const sources = new Map<string, AuthorityDatabase>(), completed = new Map<string, { profileId: string; epoch: number }>();
  const newSession = () => createProfileSession({ admission: fixture.machine, machineRoot: fixture.machine.stateRoot,
    activity: { hasUnquiescedWork: () => false },
    prepareLogout(id, owner) {
      const database = AuthorityDatabase.open(owner, { path: fixture.path, busyTimeoutMs: 250, migrationOwner: "restore-continuity-logout" }, clock, undefined, undefined, undefined,
        createCredentialStore({ admission: owner, stateRoot: owner.stateRoot }));
      sources.set(id, database);
      return { source: database.capturePendingLogoutSource(), intentFailed(error): never { throw error; } };
    },
    closeStorage(id) { sources.get(id)?.close(); },
    prepareLogoutContinuation(operation) { assert.equal(operation.profileId, profileId); },
    completedLogout: id => completed.get(id),
  });
  const logout = async (token: string) => {
    const result = currentSession.logOut(token, { at: "2026-10-21T12:01:00.000Z" });
    assert.equal(result.state, "cancelling");
    if (result.state !== "cancelling") throw new Error("fixture logout did not produce its actual operation");
    const operation = LogoutOperationSchema.parse(JSON.parse(readFileSync(join(fixture.machine.stateRoot, "machine", "operations", `${result.operationId}.json`), "utf8")));
    const database = sources.get(profileId); assert.ok(database);
    const stopped = await database.settlePendingLogout(fixture.machine, operation, { browserClosure: profileBrowserClosure, recover: reconcileStoppedLogout });
    await stopped.complete();
    completed.set(operation.operationId, { profileId, epoch: operation.sessionGeneration + 1 });
    stopped.dispose();
    return currentSession.resumeLogout(operation.operationId);
  };
  let currentSession = newSession();
  const session = () => currentSession;
  const signIn = () => {
    currentSession = newSession();
    const result = currentSession.signIn({ email: "fixture@ucsd.edu", password: "disposable-fixture-password", at: "2026-10-21T12:00:00.000Z" });
    assert.equal(result.state, "active");
    if (result.state !== "active") throw new Error("fixture-sign-in-refused");
    renew(); return result;
  };
  const backup = async () => {
    const database = AuthorityDatabase.open(admission, { path: fixture.path, busyTimeoutMs: 250, migrationOwner: "restore-continuity" }, clock);
    try {
      const report = await new AuthorityBackupService(admission, database, { directory: join(fixture.stateRoot, "backups", "authority") }, clock)
        .request({ trigger: "operator", requiredGeneration: database.getMeta().authorityGeneration });
      const manifest = report.manifests[0];
      assert.ok(manifest);
      return join(fixture.stateRoot, "backups", "authority", manifest.backupFileName + ".manifest.json");
    } finally { database.close(); }
  };
  const operation = () => admission.acquireOfflineMaintenance();
  const restore = (projection: (path: string) => Promise<void> = async () => {}, replace = renameSync) => new OfflineAuthorityRestoreService(profileBrowserClosure, admission,
    { authorityPath: fixture.path, suspectDirectory: join(fixture.stateRoot, "backups", "suspects"), busyTimeoutMs: 250, processLockRoot},
    projection, clock, { copyFile: copyFileSync, atomicReplace: replace }, store());
  let controllerClosure: Promise<void> | undefined;
  const closeController = (): Promise<void> => controllerClosure ??= (async () => {
    await currentSession.closeOnboarding(); currentSession.close(); await fixture.closeController();
  })();
  return { ...fixture, profileId, headPath, processLockRoot, renew, store, session, signIn, logout, backup, operation, restore, closeController, current: () => admission };
}

function childJob(script: string) {
  const child = spawn(process.execPath, ["--import", testProcessImport(), "--input-type=module", "-e", script], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (bytes: Buffer) => { output += bytes.toString("utf8"); });
  // Child diagnostics remain private; parent reports only exit and fixed protocol tokens.
  child.stderr.resume();
  const done = new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  return { child, done, output: () => output };
}
async function waitForFile(path: string) {
  const deadline = Date.now() + scaledMs(10_000);
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error("synthetic-child-barrier-unreached");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

async function closeCustodyFixture(close: () => Promise<void>, primary: { error: unknown } | undefined): Promise<void> {
  try { await close(); }
  catch (error) { throw new AggregateError(primary === undefined ? [error] : [primary.error, error], "completed-custody-fixture-close-failed", { cause: error }); }
  if (primary !== undefined) throw primary.error;
}

describe("profile restore continuity", () => {
  for (const kind of ["root", "inherited-child"] as const) it(kind === "root"
    ? "refuses another genuine root before restore effects, then preserves attempting write identity after exact root release"
    : "refuses restore while an inherited child retains the listener, then preserves attempting write identity after owned child close", async () => {
    const drill = createStorageRestoreTestWorld();
    let primary: { error: unknown } | undefined;
    try {
      const { paths, database, closeDatabase } = await drill.attemptingDrillPaths({ kind, async inspect(held) {
        const before = storageTree(held.repoRoot), entries = readdirSync(held.repoRoot, { recursive: true }).sort();
        const stat = lstatSync(held.authorityPath);
        const refuse = async () => {
          await assert.rejects(runSecureEnvironmentBootstrap(["cli", "storage", "restore", "--from", held.manifestPath], {
            acquireLifetimeLock: () => RuntimeLifetimeLock.acquire(held.port),
            acquireAdmission: () => assert.fail("competing restore reached installation admission"),
          }), RuntimeAlreadyRunningError);
          assert.deepEqual(storageTree(held.repoRoot), before);
          assert.deepEqual(readdirSync(held.repoRoot, { recursive: true }).sort(), entries);
          const after = lstatSync(held.authorityPath);
          assert.deepEqual([after.dev, after.ino, after.size, after.mtimeMs, after.ctimeMs],
            [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs]);
          assert.equal(existsSync(join(held.stateRoot, "backups", "suspects")), false);
        };
        await refuse();
        if (kind === "inherited-child") { await held.closeRootListener(); await refuse(); }
      } });
      const intent = database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId);
      const run = database.authority.runs.get(WRITE_INTENT_ATTEMPTING.runId);
      assert.ok(intent); assert.ok(run); const claim = runClaim(run); assert.ok(claim);
      assert.equal(intent.status, "attempting"); assert.equal(run.lifecycle.state, "running");
      assert.equal(run.envelope.attempt, intent.runAttempt);
      assert.deepEqual(database.authority.writeAttempts.get(WRITE_ATTEMPT.writeAttemptId), WRITE_ATTEMPT);
      const membership = database.authority.workerSlots.get(claim.workerId);
      assert.ok(membership); assert.equal(claim.claimGeneration, run.claimGeneration);
      await drill.takeBackup(database, paths);
      closeDatabase(); drill.corrupt(paths);
      const corrupted = readFileSync(paths.authorityPath);
      const protectedBytes = readFileSync(join(paths.stateRoot, "credentials", "protected.json"));
      const machineRoot = join(paths.repoRoot, rebuildRuntimeIsolation.stateRoot, "machine");
      const independent = () => Object.fromEntries(Object.entries(storageTree(machineRoot)).filter(([path]) => path !== "profiles.json"));
      const independentBefore = independent();
      const restored = await drill.repairAutomatically(paths);
      assert.equal(restored.exitCode, 0, restored.output);
      assert.notDeepEqual(readFileSync(paths.authorityPath), corrupted);
      assert.deepEqual(independent(), independentBefore);
      assert.deepEqual(readFileSync(join(paths.stateRoot, "credentials", "protected.json")), protectedBytes);
      paths.renewAfterRestore();
      const current = drill.open(paths);
      try {
        assert.deepEqual(current.authority.writeIntents.get(intent.writeIntentId), intent);
        assert.deepEqual(current.authority.writeAttempts.get(WRITE_ATTEMPT.writeAttemptId), WRITE_ATTEMPT);
        assert.deepEqual(current.authority.runs.get(run.envelope.runId), run);
        assert.deepEqual(current.authority.workerSlots.get(claim.workerId), membership);
        assert.equal(current.authority.writeIntents.get(intent.writeIntentId)?.status, "attempting");
        assert.equal(current.authority.runs.get(run.envelope.runId)?.envelope.attempt, intent.runAttempt);
      } finally { current.close(); }
    } catch (error) { primary = { error }; }
    await closeCustodyFixture(drill.cleanup, primary);
  });

  for(const closure of ["busy","unproved"] as const)it(`retains source, suspects, backups and journals with zero replacement after ${closure} native browser closure`,async()=>{
    const clock=manualClock(new Date("2026-10-21T12:00:00.000Z")),f=await world(clock);
    const refusal=closure==="busy"?new BrowserProfileStillClosingError(new Error("synthetic native busy"))
      :new NativeBrowserClosureUnprovedError([new Error("synthetic native close unproved")]);
    let primary:{error:unknown}|undefined;
    let operation: OfflineMaintenanceOperation | undefined;
    const probe = nativeBrowserInventory.probeRestoreProfileBrowsersClosed;
    const inventoryProbe=vi.spyOn(nativeBrowserInventory,"probeRestoreProfileBrowsersClosed").mockImplementation((owner, ...args) => {
      assert.notEqual(owner, f.current());
      assert.deepEqual(owner.profileBinding, f.current().profileBinding);
      owner.assertStoppedProfile(args[1]);
      return probe(owner, ...args);
    });
    const native=vi.spyOn(profileBrowserClosure,"probeClosed").mockRejectedValue(refusal);
    try{
      const manifestPath=await f.backup(); operation=f.operation(); const request={manifestPath};
      const suspectDirectory=join(f.stateRoot,"backups","suspects"),control=join(f.workspace,".tracker","control");
      const sourceIdentity=fs.lstatSync(f.path),source=readFileSync(f.path),profileTree=storageTree(f.stateRoot);
      const machineTree=storageTree(join(f.machine.stateRoot,"machine")),controlTree=storageTree(control);
      const suspectsExisted=existsSync(suspectDirectory);
      let copies=0,replacements=0,projections=0;
      const restore=new OfflineAuthorityRestoreService(profileBrowserClosure, f.current(),{authorityPath:f.path,suspectDirectory,busyTimeoutMs:250,
        processLockRoot:f.processLockRoot},async()=>{projections++;},clock,
        {copyFile:(from,to)=>{copies++;copyFileSync(from,to);},atomicReplace:(from,to)=>{replacements++;renameSync(from,to);}},f.store());
      await assert.rejects(restore.restore(request,operation),error=>error instanceof OfflineRestoreFailure
        &&error.authorityState==="unchanged"&&error.cause===refusal);
      assert.equal(native.mock.calls.length,1);assert.equal(inventoryProbe.mock.calls.length,1);
      assert.deepEqual([copies,replacements,projections],[0,0,0]);
      const after=fs.lstatSync(f.path);
      assert.deepEqual([after.dev,after.ino,after.size,after.mtimeMs,after.ctimeMs],
        [sourceIdentity.dev,sourceIdentity.ino,sourceIdentity.size,sourceIdentity.mtimeMs,sourceIdentity.ctimeMs]);
      assert.deepEqual(readFileSync(f.path),source);assert.deepEqual(storageTree(f.stateRoot),profileTree);
      assert.deepEqual(storageTree(join(f.machine.stateRoot,"machine")),machineTree);assert.deepEqual(storageTree(control),controlTree);
      assert.equal(existsSync(suspectDirectory),suspectsExisted);
    }catch(error){primary={error};}
    native.mockRestore(); inventoryProbe.mockRestore();
    try{
      if(operation!==undefined&&isOfflineMaintenanceOperationActive(operation)) {
        await nativeBrowserInventory.probeRestoreProfileBrowsersClosed(f.current(),f.processLockRoot,operation,clock,profileBrowserClosure);
        operation.release();
      }
      await f.close();
    }catch(error){throw new AggregateError(primary===undefined?[error]:[primary.error,error],"offline-native-fixture-cleanup-failed",{cause:error});}
    if(primary!==undefined)throw primary.error;
  });

  it("restores matching canonical SQLite without rolling credentials/control back, invalidates old context and admits a fresh child", async () => {
    const f = await world();
    try {
      const store = f.store(), protectedBefore = readFileSync(join(f.stateRoot, "credentials", "protected.json"));
      const keyPath = join(f.machine.stateRoot, "machine", "credential-keys", `${f.profileId}.json`), metadata = readFileSync(keyPath);
      const key = credentialKeyCustody.read(CanonicalCredentialHeadSchema.parse(JSON.parse(metadata.toString("utf8"))).key);
      const manifestPath = await f.backup();
      const backupBytes = readFileSync(manifestPath.slice(0, -".manifest.json".length));
      assert.equal(backupBytes.includes(key.key), false); assert.equal(backupBytes.includes(Buffer.from(key.key, "base64")), false);
      assert.equal("key" in CanonicalCredentialHeadSchema.parse(JSON.parse(metadata.toString("utf8"))).key, false);
      const before = f.machine.readProfileRegistry().sessionGeneration;
      const old = f.current();
      const result = await f.restore().restore({ manifestPath }, f.operation());
      assert.equal(result.state, "restored");
      assert.deepEqual(readFileSync(keyPath), metadata);
      assert.deepEqual(readFileSync(join(f.stateRoot, "credentials", "protected.json")), protectedBefore);
      assert.equal(f.machine.readProfileRegistry().sessionGeneration, before + 1);
      assert.equal(f.machine.readProfileRegistry().activeProfileId, f.profileId);
      assert.throws(() => store.read());
      assert.throws(() => AuthorityDatabase.open(old, { path: f.path, busyTimeoutMs: 250, migrationOwner: "restore-old-context" }), /profile-restore-context-expired/);
      const fresh = f.renew();
      const database = AuthorityDatabase.open(fresh, { path: f.path, busyTimeoutMs: 250, migrationOwner: "restore-fresh-context" });
      assert.equal(database.getMeta().profileId, f.profileId); database.close();
      assert.ok(f.store().read().entries.ucpathPassword);
      assert.equal(f.session().resumeSignedInProfile({ at: "2026-10-21T12:00:00.000Z" }).state, "active");
    } finally { await f.close(); }
  });

  it("keeps quarantine bytes through sign-in and logout without a completed physical custody chain", async () => {
    const f = await world();
    let primary: { error: unknown } | undefined;
    try {
      await f.restore().restore({ manifestPath: await f.backup() }, f.operation());
      f.renew();
      const directory = join(f.stateRoot, "backups", "suspects");
      const copies = readdirSync(directory).map(name => ({ path: join(directory, name), bytes: readFileSync(join(directory, name)) }));
      assert.ok(copies.length > 0);
      const active = f.signIn();
      assert.equal((await f.logout(active.token)).state, "signed-out");
      const control = z.object({ schemaVersion: z.literal(7) }).parse(JSON.parse(readFileSync(join(f.workspace, ".tracker", "control", "profile-registry.json"), "utf8")));
      assert.equal("completedRestores" in control, false);
      for (const copy of copies) assert.deepEqual(readFileSync(copy.path), copy.bytes);
      const notice = z.object({ profileId: z.uuid(), backupTime: z.iso.datetime() }).parse(JSON.parse(readFileSync(join(f.workspace, ".tracker", "control", `automatic-repair-${f.profileId}.json`), "utf8")));
      assert.equal(notice.profileId, f.profileId);
    } catch (error) { primary = { error }; }
    finally { await closeCustodyFixture(() => f.close(), primary); }
  });

  it("refuses ordinary SQLite restore before effects when its retained OS entry is missing", async () => {
    const f = await world();
    const binding = f.current().profileBinding, entry = new FakeKeyringEntry("Relay", `${binding.installationId}:${binding.profileId}`);
    const key = entry.getPassword(); assert.ok(key !== null);
    try {
      const manifestPath = await f.backup(), authority = readFileSync(f.path), protectedBefore = readFileSync(join(f.stateRoot, "credentials", "protected.json"));
      credentialKeyCustody.delete(CanonicalCredentialHeadSchema.parse(JSON.parse(readFileSync(f.headPath, "utf8"))).key);
      await assert.rejects(async () => f.restore().restore({ manifestPath }, f.operation()), { code: "CREDENTIAL_KEYCHAIN_MISSING" });
      assert.deepEqual(readFileSync(f.path), authority);
      assert.deepEqual(readFileSync(join(f.stateRoot, "credentials", "protected.json")), protectedBefore);
      assert.equal(entry.getPassword(), null);
    } finally { entry.setPassword(key); await f.close(); }
  });

  it("preserves genuine saved settings and safely parked UNKNOWN write identities through canonical restore", async () => {
    const f = await world();
    try {
      const options = { path: f.path, busyTimeoutMs: 250, migrationOwner: "restore-settings-unknown" };
      let database = FixtureAuthorityDatabase.open(options, undefined, undefined, undefined, undefined, f.store());
      let expected: unknown;
      const settingsCommandId = randomUUID();
      try {
        const resolved = resolveConfigWithProvenance(initialSettingsFileRecord().settings, { primaryDisplay: null }, systemClock,
          { stateRoot: f.stateRoot, artifactRoot: f.admission.artifactRoot });
        const snapshot = ConfigSnapshotRecordSchema.parse({ ...CONFIG_SNAPSHOT, config: resolved.config, fingerprint: resolved.fingerprint, provenance: resolved.provenance });
        seedAtomicWriteOwner(database, { ...ATOMIC_WRITE_COMMIT,
          transaction: { ...ATOMIC_WRITE_COMMIT.transaction, configFingerprint: snapshot.fingerprint } }, f.path, 2, snapshot);
        fenceWriteFixture(database, { intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT }, f.path);
        const run = database.authority.runs.get(WRITE_INTENT_ATTEMPTING.runId);
        assert.ok(run); const claim = runClaim(run); assert.ok(claim);
        const now = "2026-10-21T12:00:00.000Z";
        database.authority.writeIntents.parkAttempt({ writeIntentId: WRITE_INTENT_ATTEMPTING.writeIntentId, generation: 1, expectedVersion: 1,
          code: "unknown", message: "synthetic-unresolved-submit", authorityReason: deriveWriteAuthorityReason("recovery-probe-unknown", "probe", "synthetic-unresolved-submit"), now });
        assert.equal(database.authority.runs.transition({ runId: run.envelope.runId, expectedVersion: run.version,
          claim: { workerId: claim.workerId, claimGeneration: claim.claimGeneration }, lifecycle: { state: "parked-write", writeIntentId: WRITE_INTENT_ATTEMPTING.writeIntentId,
            intentGeneration: 1, parkedAt: now, code: "unknown", message: "synthetic-unresolved-submit" }, now }).state, "applied");
        const patch = { "concurrency.defaultWorkers": { set: 3 } };
        const settings = createSettingsApplicationExecutor(value => resolveConfigWithProvenance(value, { primaryDisplay: null }, systemClock,
          { stateRoot: f.stateRoot, artifactRoot: f.admission.artifactRoot }), f.store());
        const result = executeSettingsCommand({ authority: database, clock: systemClock, ids: { uuid: randomUUID }, settings },
          { family: "settings", type: "apply-settings", commandId: settingsCommandId, requestedAt: now, requestedBy: "local-operator", source: "settings-surface",
            target: { expectedRevision: 1 }, payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } });
        assert.equal(result.state, "applied");
        expected = { settings: database.authority.settingsCurrent.get(), command: database.authority.commands.get(settingsCommandId),
          audit: database.authority.commandAudits.findByCommand(settingsCommandId), intent: database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId),
          attempt: database.authority.writeAttempts.get(WRITE_ATTEMPT.writeAttemptId), run: database.authority.runs.get(WRITE_INTENT_ATTEMPTING.runId) };
      } finally { database.close(); }
      const manifestPath = await f.backup();
      await f.restore().restore({ manifestPath }, f.operation());
      database = AuthorityDatabase.open(f.renew(true), options, undefined, undefined, undefined, undefined, f.store());
      try {
        assert.deepEqual({ settings: database.authority.settingsCurrent.get(), command: database.authority.commands.get(settingsCommandId),
          audit: database.authority.commandAudits.findByCommand(settingsCommandId), intent: database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId),
          attempt: database.authority.writeAttempts.get(WRITE_ATTEMPT.writeAttemptId), run: database.authority.runs.get(WRITE_INTENT_ATTEMPTING.runId) }, expected);
        assert.equal(database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId)?.status, "parked");
        assert.equal(database.authority.runs.get(WRITE_INTENT_ATTEMPTING.runId)?.lifecycle.state, "parked-write");
      } finally { database.close(); }
    } finally { await f.close(); }
  });

  it.each(["missing-control", "foreign-control", "registry-and-profile", "missing-binding"] as const)("refuses %s before restore payload effects", async kind => {
    const f = await world();
    try {
      const manifestPath = await f.backup();
      const databaseBytes = readFileSync(f.path);
      let expectedBefore = databaseBytes;
      const control = join(f.workspace, ".tracker", "control", "profile-registry.json");
      if (kind === "missing-control") rmSync(control);
      if (kind === "foreign-control") {
        const document = JSON.parse(readFileSync(control, "utf8")) as { installationId: string };
        document.installationId = randomUUID(); writeFileSync(control, JSON.stringify(document), { mode: 0o600 });
      }
      if (kind === "registry-and-profile") {
        const path = join(f.machine.stateRoot, "machine", "profiles.json"), protectedPath = join(f.stateRoot, "credentials", "protected.json");
        const registryBytes = readFileSync(path), protectedBytes = readFileSync(protectedPath);
        f.signIn();
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { backupFileName: string };
        const backupPath = join(f.stateRoot, "backups", "authority", manifest.backupFileName);
        expectedBefore = readFileSync(backupPath);
        copyFileSync(backupPath, f.path);
        writeFileSync(protectedPath, protectedBytes, { mode: 0o600 });
        writeFileSync(path, registryBytes, { mode: 0o600 });
      }
      if (kind === "missing-binding") { rmSync(f.path); writeFileSync(f.path, "invalid-synthetic-sqlite", { mode: 0o600 }); }
      const before = readFileSync(f.path);
      await assert.rejects(async () => f.restore().restore({ manifestPath }, f.operation()));
      assert.deepEqual(readFileSync(f.path), before);
      if (kind !== "missing-binding") assert.deepEqual(before, expectedBefore);
      assert.equal(existsSync(join(f.workspace, ".tracker", "control", "journal.json")), false);
    } finally { await f.close(); }
  });

  it("refuses whole-machine restore without an independent retained continuity witness", async () => {
    const f = await world();
    try {
      const manifestPath = await f.backup(), before = readFileSync(f.path);
      assert.throws(() => new OfflineAuthorityRestoreService(profileBrowserClosure, f.machine,
        { authorityPath: f.path, suspectDirectory: join(f.stateRoot, "backups", "suspects"), busyTimeoutMs: 250, processLockRoot: f.processLockRoot}, async () => {}), /profile-bound-authority-required/);
      assert.deepEqual(readFileSync(f.path), before);
      assert.ok(existsSync(manifestPath));
      assert.equal(existsSync(join(f.workspace, ".tracker", "control", "journal.json")), false);
    } finally { await f.close(); }
  });

  it("preserves exact encrypted records and burned Duo counters across SQLite restore", async () => {
    const f = await world();
    try {
      const manifestPath = await f.backup(), owner = createCanonicalCredentials(f.current());
      const duo = DuoCredentialRecordSchema.parse(owner.readRecord("duo")?.value), credential = duo.credentials.find(row => row.state === "ready");
      assert.ok(credential);
      const requestId = randomUUID(), reserved = owner.reserveDuoCounter(credential.credentialId, requestId);
      const paths = [f.headPath, join(f.stateRoot, "credentials", "protected.json"), join(f.stateRoot, "credentials", "chatgpt-account.json"),
        join(f.machine.stateRoot, "machine", "duo-credentials", `${f.profileId}.json`)];
      const before = paths.map(path => readFileSync(path));
      await f.restore().restore({ manifestPath }, f.operation());
      assert.deepEqual(paths.map(path => readFileSync(path)), before);
      const fresh = createCanonicalCredentials(f.renew(true));
      assert.throws(() => fresh.reserveDuoCounter(credential.credentialId, requestId), { code: "CREDENTIAL_CONFLICT" });
      assert.ok(fresh.reserveDuoCounter(credential.credentialId, randomUUID()).count > reserved.count);
    } finally { await f.close(); }
  });

  it("refuses external credential head changed during staging and retains unchanged SQLite", async () => {
    const f = await world();
    const head = readFileSync(f.headPath);
    try {
      const manifestPath = await f.backup(), bytes = readFileSync(f.path);
      const service = f.restore(async () => { writeFileSync(f.headPath, "{}", { mode: 0o600 }); });
      await assert.rejects(service.restore({ manifestPath }, f.operation()));
      assert.deepEqual(readFileSync(f.path), bytes);
      assert.equal(readFileSync(f.headPath, "utf8"), "{}");
    } finally { writeFileSync(f.headPath, head, { mode: 0o600 }); await f.close(); }
  });

  it("reports the replaced outcome after a rename that throws and refuses ordinary reuse", async () => {
    const f = await world();
    try {
      const manifestPath = await f.backup();
      await assert.rejects(f.restore(async () => {}, (source, target) => {
        renameSync(source, target);
        throw new Error("synthetic-replace-after-effect");
      }).restore({ manifestPath }, f.operation()), error => error instanceof OfflineRestoreFailure && error.authorityState === "replaced");
      assert.throws(() => f.current().assertProfileRuntime());
    } finally { await f.close(); }
  });
  it("refuses a genuinely expired operation before staging", async () => {
    const clock = manualClock(new Date("2026-10-21T12:00:00.000Z")), f = await world(clock);
    try {
      const manifestPath = await f.backup(), operation = f.operation(), bytes = readFileSync(f.path);
      operation.release();
      await assert.rejects(f.restore().restore({ manifestPath }, operation), /offline-maintenance-unissued/u);
      assert.deepEqual(readFileSync(f.path), bytes);
      assert.equal(existsSync(join(f.workspace, ".tracker", "control", "journal.json")), false);
    } finally { await f.close(); }
  });

  it("refuses old-build worker evidence during a held operation", async () => {
    const f = await world();
    try {
      const manifestPath = await f.backup(), operation = f.operation(), bytes = readFileSync(f.path);
      plantOldBuildArtifact(f.processLockRoot, "workers");
      await assert.rejects(f.restore().restore({ manifestPath }, operation));
      assert.deepEqual(readFileSync(f.path), bytes);
      assert.equal(existsSync(join(f.workspace, ".tracker", "control", "journal.json")), false);
    } finally { await f.close(); }
  });

  it("retains suspect and exact restore intent when replacement outcome is unobservable", async () => {
    const f = await world();
    try {
      const manifestPath = await f.backup();
      await assert.rejects(f.restore(async () => {}, (source, target) => {
        renameSync(source, target); rmSync(target); throw new Error("synthetic-replacement-outcome-unobservable");
      }).restore({ manifestPath }, f.operation()), error => error instanceof OfflineRestoreFailure && error.authorityState === "authority-state-uncertain");
      const intent = JSON.parse(readFileSync(join(f.workspace, ".tracker", "control", "journal.json"), "utf8")) as { restore: { suspectPath: string; operationId: string } };
      assert.ok(existsSync(intent.restore.suspectPath));
      assert.ok(intent.restore.operationId);
      assert.throws(() => f.current().assertProfileRuntime());
      assert.throws(() => f.machine.readProfileRegistry());
    } finally { await f.close(); }
  });

  it("retains strict unproved companion evidence when settlement fails after replacement", async () => {
    const f = await world();
    try {
      const manifestPath = await f.backup();
      await assert.rejects(f.restore(async () => {}, (source, target) => {
        renameSync(source, target); writeFileSync(String(target) + "-wal", "synthetic-unproved-companion", { mode: 0o600 });
      }).restore({ manifestPath }, f.operation()), error => error instanceof OfflineRestoreFailure && error.authorityState === "replaced");
      const intent = JSON.parse(readFileSync(join(f.workspace, ".tracker", "control", "journal.json"), "utf8")) as { restore: { suspectPath: string } };
      assert.ok(existsSync(intent.restore.suspectPath));
      assert.equal(readFileSync(f.path + "-wal", "utf8"), "synthetic-unproved-companion");
      assert.throws(() => f.current().assertProfileRuntime());
    } finally { await f.close(); }
  });

  it("recovers interrupted registry invalidation exactly once without rerunning replacement", async () => {
    const f = await world();
    let restoreHandle: OfflineMaintenanceOperation | undefined;
    let recovery: ReturnType<typeof acquireRecoveryRuntimeRestore> | undefined;
    let freshMachine: RuntimeAdmission | undefined;
    const registryPath = join(f.machine.stateRoot, "machine", "profiles.json"), journalPath = join(f.workspace, ".tracker", "control", "journal.json");
    const originalRename = fs.renameSync;
    try {
      const manifestPath = await f.backup(), beforeGeneration = f.machine.readProfileRegistry().sessionGeneration;
      let interrupted = false, replacements = 0;
      vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
        originalRename(source, target);
        if (!interrupted && String(target) === registryPath && existsSync(journalPath)) {
          const pending = JSON.parse(readFileSync(journalPath, "utf8")) as { invalidation?: unknown };
          if (pending.invalidation !== undefined) { interrupted = true; throw new Error("synthetic-invalidation-after-registry-rename"); }
        }
      });
      syncBuiltinESMExports();
      try {
        await assert.rejects(f.restore(async () => {}, (source, target) => { replacements += 1; originalRename(source, target); })
          .restore({ manifestPath }, f.operation()), error => error instanceof OfflineRestoreFailure && error.authorityState === "replaced");
      } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); }
      assert.equal(interrupted, true); assert.equal(replacements, 1);
      const pending = JSON.parse(readFileSync(journalPath, "utf8")) as { restore: { operationId: string }; invalidation: { document: { sessionGeneration: number } } };
      assert.equal(pending.invalidation.document.sessionGeneration, beforeGeneration + 1);
      assert.equal((JSON.parse(readFileSync(registryPath, "utf8")) as { sessionGeneration: number }).sessionGeneration, beforeGeneration + 1);
      f.machine.release();
      restoreHandle = f.lifetime.beginOfflineMaintenance(f.workspace);
      recovery = acquireRecoveryRuntimeRestore(f.workspace, f.lifetime, pending.restore.operationId, restoreHandle);
      const recoveredAdmission = recovery.admission;
      assert.throws(() => recoveredAdmission.assertWritable());
      assert.throws(() => recoveredAdmission.assertProfileRuntime());
      assert.throws(() => AuthorityDatabase.open(recoveredAdmission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "restore-recovery-new-work" }));
      assert.equal((await resumeAutomaticAuthorityRestore({ browserClosure: profileBrowserClosure, admission: recovery.admission, operationId: pending.restore.operationId,
        processLockRoot: f.processLockRoot, restoreAdmission: restoreHandle })).state, "settled");
      assert.equal(replacements, 1); assert.equal(existsSync(journalPath), false);
      restoreHandle.release(); restoreHandle = undefined; recovery.admission.release(); recovery = undefined;
      freshMachine = RuntimeAdmission.acquireMachine(f.workspace, "exclusive", f.lifetime);
      assert.equal(freshMachine.readProfileRegistry().sessionGeneration, beforeGeneration + 1);
      signInBoundProfileFixture(freshMachine);
      const fresh = freshMachine.admitProfile(f.profileId);
      const database = AuthorityDatabase.open(fresh, { path: f.path, busyTimeoutMs: 250, migrationOwner: "restore-recovered-fresh" }); database.close(); fresh.release();
    } finally {
      vi.restoreAllMocks(); syncBuiltinESMExports();
      restoreHandle?.release(); recovery?.admission.release(); freshMachine?.release(); await f.close();
    }
  });

  it("replays a completed automatic notice publication after interruption before journal removal", async () => {
    const f = await world(), journalPath = join(f.workspace, ".tracker", "control", "journal.json");
    let operation: OfflineMaintenanceOperation | undefined, recovery: ReturnType<typeof acquireRecoveryRuntimeRestore> | undefined;
    const unlink = fs.unlinkSync;
    try {
      const manifestPath = await f.backup();
      let interrupted = false;
      vi.spyOn(fs, "unlinkSync").mockImplementation(path => {
        if (!interrupted && String(path) === journalPath) { interrupted = true; throw new Error("interrupt-before-automatic-journal-removal"); }
        unlink(path);
      }); syncBuiltinESMExports();
      try { await assert.rejects(f.restore().restore({ manifestPath }, f.operation()), error => error instanceof OfflineRestoreFailure && error.authorityState === "replaced"); }
      finally { vi.restoreAllMocks(); syncBuiltinESMExports(); }
      assert.equal(interrupted, true);
      const pending = z.object({ restore: z.object({ operationId: z.uuid() }) }).parse(JSON.parse(readFileSync(journalPath, "utf8")));
      const noticePath = join(f.workspace, ".tracker", "control", `automatic-repair-${f.profileId}.json`), notice = readFileSync(noticePath);
      const database = readFileSync(f.path); f.machine.release();
      operation = f.lifetime.beginOfflineMaintenance(f.workspace);
      recovery = acquireRecoveryRuntimeRestore(f.workspace, f.lifetime, pending.restore.operationId, operation);
      await resumeAutomaticAuthorityRestore({ browserClosure: profileBrowserClosure, admission: recovery.admission, operationId: pending.restore.operationId,
        processLockRoot: f.processLockRoot, restoreAdmission: operation });
      assert.equal(existsSync(journalPath), false); assert.deepEqual(readFileSync(noticePath), notice); assert.deepEqual(readFileSync(f.path), database);
    } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); operation?.release(); recovery?.admission.release(); await f.close(); }
  });

  it("reports replaced and retains the genuine root when exclusive operation release fails", async () => {
    const f = await world();
    const manifestPath = await f.backup();
    const operation = f.operation(), journal = join(f.workspace, ".tracker", "control", "journal.json");
    const releaseFailure = new Error("synthetic-exact-operation-release-failure");
    const assertHeld = f.lifetime.assertOfflineMaintenance.bind(f.lifetime);
    let replaced = false;
    const failedRelease = vi.spyOn(f.lifetime, "assertOfflineMaintenance").mockImplementation((owned, workspace) => {
      assertHeld(owned, workspace);
      if (replaced && !existsSync(journal)) throw releaseFailure;
    });
    try {
      await assert.rejects(f.restore(async () => {}, (source, target) => { renameSync(source, target); replaced = true; })
        .restore({ manifestPath }, operation), error => error instanceof OfflineRestoreFailure
          && error.authorityState === "replaced" && error.message.includes("release failed"));
      assert.equal(isOfflineMaintenanceOperationActive(operation), true);
      await assert.rejects(RuntimeLifetimeLock.acquire(f.lifetime.port), RuntimeAlreadyRunningError);
      assert.throws(() => f.machine.beginOfflineMaintenance(), /offline-maintenance-busy/u);
      assert.throws(() => f.current().assertProfileRuntime());
    } finally { failedRelease.mockRestore(); operation.release(); await f.close(); }
  });

  it.each(["logout", "restore"] as const)("excludes a real concurrent controller during %s through the held kernel listener", async held => {
    const f = await world();
    let owner: ReturnType<typeof childJob> | undefined, competitor: ReturnType<typeof childJob> | undefined;
    const ready = join(f.workspace, "child-ready"), release = join(f.workspace, "child-release");
    try {
      const manifestPath = await f.backup();
      const databaseBytes = readFileSync(f.path);
      const port = f.lifetime.port;
      await f.closeController();
      const imports = `
        import { existsSync, readFileSync, writeFileSync } from "node:fs";
        import { join } from "node:path";


        import { acquireEntrypointAdmission } from './src/backend/storage/admission/bootstrap-admission.ts';
        import { RuntimeAlreadyRunningError, RuntimeLifetimeLock } from './src/backend/storage/admission/lifetime-lock.ts';
        import { LogoutOperationSchema } from './src/models/profiles/profile.ts';
        import { systemClock } from './src/rules/time/clock.ts';
        import { createProfileSession } from './src/backend/profiles/profile-session.ts';
        import { createProfileRegistry } from './src/backend/profiles/registry.ts';
        import { createCredentialStore } from './src/backend/storage/configuration/credential-store.ts';
        import { OfflineAuthorityRestoreService } from './src/backend/storage/sqlite/offline-restore.ts';
        import { profileBrowserClosure } from './src/backend/runtime/browser/profile-browser-closure.ts';
        import { AuthorityDatabase } from './src/backend/storage/sqlite/authority-database.ts';
        import { reconcileStoppedLogout } from './src/backend/runs/lifecycle/startup-crash-recovery.ts';
        const port=${String(port)},workspace=${JSON.stringify(f.workspace)},profileId=${JSON.stringify(f.profileId)},manifestPath=${JSON.stringify(manifestPath)};
        const ready=${JSON.stringify(ready)},release=${JSON.stringify(release)},processLockRoot=${JSON.stringify(f.processLockRoot)};
      `;
      const barrier = `writeFileSync(ready,'ready',{mode:0o600});const deadline=Date.now()+10000;while(!existsSync(release)){if(Date.now()>deadline)throw new Error('barrier-timeout');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}`;
      const logout = `const lifetime=await RuntimeLifetimeLock.acquire(port);const machine=acquireEntrypointAdmission(workspace,'exclusive',lifetime);let source,session;try {
        session=createProfileSession({admission:machine,machineRoot:machine.stateRoot,activity:{hasUnquiescedWork:()=>false},
          prepareLogout(id,owner){source=AuthorityDatabase.open(owner,{path:join(owner.stateRoot,'state.db'),busyTimeoutMs:250,migrationOwner:'restore-continuity-child-logout'});return {source:source.capturePendingLogoutSource(),intentFailed(error){throw error;}};},
          closeStorage(){source?.close();},prepareLogoutContinuation(operation){if(operation.profileId!==profileId)throw new Error('logout-profile-changed');}});
        const active=session.signIn({email:'fixture@ucsd.edu',password:'disposable-fixture-password',at:'2026-10-21T12:00:00.000Z'});
        if(active.state!=='active')throw new Error('activation-refused');
        const result=session.logOut(active.token,{at:'2026-10-21T12:01:00.000Z'});if(result.state!=='cancelling'||!source)throw new Error('logout-not-cancelling');
        ${barrier}
        const operation=LogoutOperationSchema.parse(JSON.parse(readFileSync(join(machine.stateRoot,'machine','operations',result.operationId+'.json'),'utf8')));
        const stopped=await source.settlePendingLogout(machine,operation,{browserClosure:profileBrowserClosure,recover:reconcileStoppedLogout});await stopped.complete();stopped.dispose();
      }finally{await session?.closeOnboarding();session?.close();source?.close();machine.release();await lifetime.close();}process.stdout.write('OWNER_DONE');`;
      const restore = `const lifetime=await RuntimeLifetimeLock.acquire(port);const machine=acquireEntrypointAdmission(workspace,'exclusive',lifetime);try {
        const child=machine.admitProfile(profileId);const root=child.stateRoot,path=join(root,'state.db');
        const store=createCredentialStore({admission:child,stateRoot:root,});

        const proof=child.acquireOfflineMaintenance();
        const service=new OfflineAuthorityRestoreService(profileBrowserClosure, child,{authorityPath:path,suspectDirectory:join(root,'backups','suspects'),busyTimeoutMs:250,processLockRoot},async()=>{${barrier}},undefined,undefined,store);
        await service.restore({ manifestPath }, proof);
      }finally{machine.release();await lifetime.close();}process.stdout.write('OWNER_DONE');`;
      owner = childJob(imports + (held === "logout" ? logout : restore));
      await waitForFile(ready);
      competitor = childJob(imports + `let refused=false;try{const candidate=await RuntimeLifetimeLock.acquire(port);try{throw new Error('competing-controller-admitted');}finally{await candidate.close();}}catch(error){if(error instanceof RuntimeAlreadyRunningError)refused=true;else throw error;}if(!refused)throw new Error('competing-controller-admitted');process.stdout.write('REFUSED');`);
      assert.equal(await competitor.done, 0);
      assert.equal(competitor.output(), "REFUSED");
      assert.deepEqual(readFileSync(f.path), databaseBytes);
      writeFileSync(release, "release", { mode: 0o600 });
      assert.equal(await owner.done, 0);
      assert.equal(owner.output(), "OWNER_DONE");
    } finally {
      writeFileSync(release, "release", { mode: 0o600 });
      for (const job of [owner, competitor]) if (job !== undefined && job.child.exitCode === null && job.child.signalCode === null) { job.child.kill(); await job.done; }
      rmSync(ready, { force: true }); rmSync(release, { force: true });
      await f.close();
    }
  });

});


it("releases consumed restore ownership if stopped-facade derivation fails before payload effects", async () => {
  const f = await world();
  const restore = f.restore();
  createProfileRegistry(f.machine).advanceSession(null);
  const operation = f.operation();
  const before = readFileSync(f.path);
  try {
    await assert.rejects(restore.restore({ manifestPath: "unused" }, operation), /profile-storage-claim-generation-changed/u);
    assert.equal(isOfflineMaintenanceOperationActive(operation), false);
    assert.deepEqual(readFileSync(f.path), before);
  } finally { operation.release(); await f.close(); }
});
