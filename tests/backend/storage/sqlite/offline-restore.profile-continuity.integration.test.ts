import { createStorageRestoreTestWorld } from "../../../support/helpers/backend/storage-restore-world.js";
import { RuntimeLifetimeLock, RuntimeAlreadyRunningError, type OfflineMaintenanceOperation, isOfflineMaintenanceOperationActive } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { runSecureEnvironmentBootstrap } from "../../../../src/backend/app/bootstrap/secure-env-bootstrap.js";
import { profileBrowserClosure, BrowserProfileStillClosingError, NativeBrowserClosureUnprovedError } from "../../../../src/backend/runtime/browser/native-profile-probe.js";
import * as nativeBrowserInventory from "../../../../src/backend/storage/maintenance/profile-inventory.js";
import { storageTree } from "../../../support/helpers/integration/storage-recovery-fixture.js";
import { z } from "zod";
import { acquireInstallation, CompletedRestoreCustodySchema, type ExclusiveInstallationLease } from "../../../../src/backend/storage/admission/installation.js";
import { composeProfileCredentialRepairInventory, composeProfileCredentialInitializationInventory } from "../../../../src/backend/app/composition/profile-credential-inventory.js";
import { AuthorityDatabase as FixtureAuthorityDatabase } from "../../../support/helpers/synthetic-database-admission.js";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { acquireRecoveryRuntimeRestore, RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { ProfileStorageRelocationUnsupportedError } from "../../../../src/backend/storage/admission/admission-identity.js";
import { seedAtomicWriteOwner } from "../../../support/helpers/timeline-write-fixture.js";
import { fenceWriteFixture } from "../../../support/helpers/write-fence-fixture.js";
import { ATOMIC_WRITE_COMMIT, CONFIG_SNAPSHOT, WRITE_INTENT_ATTEMPTING, WRITE_ATTEMPT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { runClaim } from "../../../../src/models/run/record.js";
import { deriveWriteAuthorityReason } from "../../../../src/rules/write-safety/write-authority-reason.js";
import { executeSettingsCommand } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { initialSettingsFileRecord, SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint } from "../../../../src/models/config/settings.js";
import { ConfigSnapshotRecordSchema } from "../../../../src/models/config/snapshot.js";
import { manualClock, systemClock, type Clock } from "../../../../src/rules/time/clock.js";
import { credentialKeyCustody } from "../../../../src/backend/storage/configuration/credential-key-custody.js";
import { FakeKeyringEntry } from "../../../support/helpers/credential-keychain-fake.js";
import { spawn } from "node:child_process";
import { CredentialEraseInputSchema } from "../../../../src/models/config/credential-store.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync, rmSync, readdirSync, lstatSync } from "node:fs";
import { join } from 'node:path';
import { describe, it, vi } from "vitest";
import { createBoundProfileFixture, readAuthenticatedCredentialFixture } from "../../../support/helpers/admission-fixture.js";
import { createCredentialStore, captureCredentialErasureHead, verifyCredentialErasureHead } from "../../../../src/backend/storage/configuration/credential-store.js";
import { createProfileRegistry } from "../../../../src/backend/profiles/registry.js";
import { createProfileSession } from "../../../../src/backend/profiles/profile-session.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityBackupService } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { OfflineAuthorityRestoreService, OfflineRestoreFailure, settleInterruptedAuthorityRestore } from "../../../../src/backend/storage/sqlite/offline-restore.js";
import { acquireRuntimeProcessLock } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/protected-settings.js";

async function world(clock: Clock = systemClock) {
  const fixture = await createBoundProfileFixture();
  const profileId = fixture.admission.profileBinding.profileId;
  const journalPath = join(fixture.machine.stateRoot, "machine", "erasures", profileId + ".json");
  const processLockRoot = join(fixture.workspace, rebuildRuntimeIsolation.processLockRoot);
  let admission = fixture.admission;
  const renew = () => { admission = fixture.machine.admitProfile(createProfileRegistry(fixture.machine).storageClaim(profileId)); return admission; };
  const credentialInventories = {
    repairInventory: (child: RuntimeAdmission, ...args: Parameters<ReturnType<typeof composeProfileCredentialRepairInventory>>) =>
      composeProfileCredentialRepairInventory({ machine: fixture.machine, admission: child, clock, hostFacts: { primaryDisplay: null } })(...args),
    initializationInventory: (child: RuntimeAdmission, ...args: Parameters<ReturnType<typeof composeProfileCredentialInitializationInventory>>) =>
      composeProfileCredentialInitializationInventory({ machine: fixture.machine, admission: child, clock, hostFacts: { primaryDisplay: null } })(...args),
  };
  const store = () => createCredentialStore({ admission, stateRoot: fixture.stateRoot, erasureJournalAdmission: fixture.machine, erasureJournalPath: journalPath,
    repairInventory: composeProfileCredentialRepairInventory({ machine: fixture.machine, admission, clock, hostFacts: { primaryDisplay: null } }) });
  const newSession = () => createProfileSession({ admission: fixture.machine, machineRoot: fixture.machine.stateRoot, ...credentialInventories,
    activity: { hasUnquiescedWork: () => false }, backupPaths: () => [], loginDataPaths: () => [] });
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
  return { ...fixture, profileId, journalPath, processLockRoot, credentialInventories, renew, store, session, signIn, backup, operation, restore, closeController, current: () => admission };
}

function childJob(script: string) {
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (bytes: Buffer) => { output += bytes.toString("utf8"); });
  // Child diagnostics remain private; parent reports only exit and fixed protocol tokens.
  child.stderr.resume();
  const done = new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  return { child, done, output: () => output };
}
async function waitForFile(path: string) {
  const deadline = Date.now() + 10_000;
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
      const membership = database.authority.workerSlots.get(claim.workerId), lease = database.authority.workerLeases.get(claim.workerId);
      assert.ok(membership); assert.ok(lease); assert.equal(claim.claimGeneration, run.claimGeneration);
      assert.notEqual(lease.lifecycle.state, "stopped");
      const manifestPath = await drill.takeBackup(database, paths);
      closeDatabase(); drill.corrupt(paths);
      const corrupted = readFileSync(paths.authorityPath);
      const protectedBytes = readFileSync(join(paths.stateRoot, "credentials", "protected.json"));
      const machineRoot = join(paths.repoRoot, rebuildRuntimeIsolation.stateRoot, "machine");
      const independent = () => Object.fromEntries(Object.entries(storageTree(machineRoot)).filter(([path]) => path !== "profiles.json"));
      const independentBefore = independent();
      const restored = await drill.composeStorageCommand(rebuildRuntimeIsolation, ["restore", "--from", manifestPath], drill.CLOCK, paths.repoRoot);
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
        assert.deepEqual(current.authority.workerLeases.get(claim.workerId), lease);
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
    const inventoryProbe=vi.spyOn(nativeBrowserInventory,"probeRestoreProfileBrowsersClosed");
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
      assert.equal(native.mock.calls.length,1);assert.equal(inventoryProbe.mock.calls[0]?.[0],f.current());
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
      const key = credentialKeyCustody.read(JSON.parse(metadata.toString("utf8")));
      const manifestPath = await f.backup();
      const backupBytes = readFileSync(manifestPath.slice(0, -".manifest.json".length));
      assert.equal(backupBytes.includes(key.key), false); assert.equal(backupBytes.includes(Buffer.from(key.key, "base64")), false);
      assert.equal("key" in JSON.parse(metadata.toString("utf8")), false);
      const before = f.machine.readProfileRegistry().sessionGeneration;
      const old = f.current();
      const result = await f.restore().restore({ manifestPath }, f.operation());
      assert.equal(result.state, "restored");
      assert.deepEqual(readFileSync(keyPath), metadata);
      assert.deepEqual(readFileSync(join(f.stateRoot, "credentials", "protected.json")), protectedBefore);
      assert.equal(f.machine.readProfileRegistry().sessionGeneration, before + 1);
      assert.throws(() => store.read());
      assert.throws(() => AuthorityDatabase.open(old, { path: f.path, busyTimeoutMs: 250, migrationOwner: "restore-old-context" }), /profile-restore-context-expired/);
      const fresh = f.renew();
      const database = AuthorityDatabase.open(fresh, { path: f.path, busyTimeoutMs: 250, migrationOwner: "restore-fresh-context" });
      assert.equal(database.getMeta().profileId, f.profileId); database.close();
      assert.ok(f.store().read().entries.ucpathPassword);
    } finally { await f.close(); }
  });

  it("retains completed suspect custody across sign-in and real credential erasure inventory", async () => {
    const f = await world();
    let primary: { error: unknown } | undefined;
    try {
      const manifestPath = await f.backup();
      await f.restore().restore({ manifestPath }, f.operation());
      const fresh = f.renew(), rows = fresh.readCompletedRestores();
      assert.equal(rows.length, 1);
      assert.deepEqual(rows[0]?.profile, fresh.profileBinding);
      assert.equal(rows[0]?.outcome, "replaced");
      const copies = rows.map(row => ({ path: join(f.stateRoot, row.suspect.relativePath), bytes: readFileSync(join(f.stateRoot, row.suspect.relativePath)) }));
      const active = f.signIn();
      assert.deepEqual(f.current().readCompletedRestores(), rows);
      assert.equal(f.session().logOut(active.token, { at: "2026-10-21T12:01:00.000Z" }).state, "wiped");
      const after = z.object({ completedRestores: z.array(CompletedRestoreCustodySchema) })
        .parse(JSON.parse(readFileSync(join(f.workspace, ".tracker", "control", "profile-registry.json"), "utf8")));
      assert.deepEqual(after.completedRestores, rows);
      for (const copy of copies) assert.deepEqual(readFileSync(copy.path), copy.bytes);
    } catch (error) { primary = { error }; }
    finally { await closeCustodyFixture(() => f.close(), primary); }
  });

  it("refuses raw lease relocation of completed custody before destination or journal effects", async () => {
    const f = await world();
    let lease: ExclusiveInstallationLease | undefined;
    let held: OfflineMaintenanceOperation | undefined;
    let primary: { error: unknown } | undefined;
    try {
      const manifestPath = await f.backup();
      await f.restore().restore({ manifestPath }, f.operation());
      f.machine.release();
      const activeLease = acquireInstallation(f.workspace, "exclusive", f.lifetime); lease = activeLease;
      const activeHeld = activeLease.beginOfflineMaintenance(); held = activeHeld;
      const before = storageTree(f.workspace), destination = { stateRoot: join(f.workspace, "destination-state"), artifactRoot: join(f.workspace, "destination-artifacts") };
      assert.throws(() => activeLease.beginRelocation(destination, { commandId: randomUUID(), revision: 1, expectedRevision: 0,
        requestFingerprint: "a".repeat(64), desiredDigest: "b".repeat(64) }, activeHeld), ProfileStorageRelocationUnsupportedError);
      assert.deepEqual(storageTree(f.workspace), before);
      assert.equal(existsSync(destination.stateRoot), false); assert.equal(existsSync(destination.artifactRoot), false);
    } catch (error) { primary = { error }; }
    finally { await closeCustodyFixture(async () => { held?.release(); lease?.release(); await f.close(); }, primary); }
  });

  for (const mutation of ["missing", "substituted", "extra companion", "divergent row", "duplicate operation", "missing history"] as const) {
    it(`refuses completed restore ${mutation} custody before admitting credential copies`, async () => {
      const f = await world();
      let undo: (() => void) | undefined;
      let primary: { error: unknown } | undefined;
      try {
        const manifestPath = await f.backup();
        await f.restore().restore({ manifestPath }, f.operation());
        const fresh = f.renew(), original = fresh.readCompletedRestores();
        const first = original[0]; assert.ok(first);
        const row = CompletedRestoreCustodySchema.parse(first);
        const path = join(f.stateRoot, row.suspect.relativePath), retained = `${path}.fixture-retained`;
        const controlPath = join(f.workspace, ".tracker", "control", "profile-registry.json"), controlBytes = readFileSync(controlPath);
        const sourceBytes = readFileSync(f.path), suspectBytes = readFileSync(path);
        if (mutation === "missing" || mutation === "substituted") {
          renameSync(path, retained);
          undo = () => { rmSync(path, { force: true }); renameSync(retained, path); };
          if (mutation === "substituted") copyFileSync(retained, path);
        } else if (mutation === "extra companion") {
          undo = () => rmSync(`${path}-wal`);
          writeFileSync(`${path}-wal`, "synthetic-unbound-companion", { mode: 0o600 });
        } else {
          const control = z.looseObject({ completedRestores: z.array(CompletedRestoreCustodySchema) }).parse(JSON.parse(controlBytes.toString("utf8")));
          if (mutation === "divergent row") row.suspect.file.sha256 = "0".repeat(64);
          const { completedRestores: _history, ...withoutHistory } = control;
          undo = () => writeFileSync(controlPath, controlBytes);
          writeFileSync(controlPath, JSON.stringify(mutation === "missing history" ? withoutHistory
            : { ...control, completedRestores: mutation === "duplicate operation" ? [row, row] : [row] }));
        }
        assert.throws(() => fresh.readCompletedRestores());
        assert.deepEqual(readFileSync(f.path), sourceBytes);
        assert.equal(existsSync(join(f.workspace, ".tracker", "control", "journal.json")), false);
        undo(); undo = undefined;
        assert.deepEqual(readFileSync(path), suspectBytes);
        assert.deepEqual(fresh.readCompletedRestores(), original);
      } catch (error) { primary = { error }; }
      finally { await closeCustodyFixture(async () => { undo?.(); await f.close(); }, primary); }
    });
  }

  it("refuses ordinary SQLite restore before effects when its retained OS entry is missing", async () => {
    const f = await world();
    const binding = f.current().profileBinding, entry = new FakeKeyringEntry("Relay", `${binding.installationId}:${binding.profileId}`);
    const key = entry.getPassword(); assert.ok(key !== null);
    try {
      const manifestPath = await f.backup(), authority = readFileSync(f.path), protectedBefore = readFileSync(join(f.stateRoot, "credentials", "protected.json"));
      credentialKeyCustody.delete(binding);
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
      database = AuthorityDatabase.open(f.renew(), options, undefined, undefined, undefined, undefined, f.store());
      try {
        assert.deepEqual({ settings: database.authority.settingsCurrent.get(), command: database.authority.commands.get(settingsCommandId),
          audit: database.authority.commandAudits.findByCommand(settingsCommandId), intent: database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId),
          attempt: database.authority.writeAttempts.get(WRITE_ATTEMPT.writeAttemptId), run: database.authority.runs.get(WRITE_INTENT_ATTEMPTING.runId) }, expected);
        assert.equal(database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId)?.status, "parked");
        assert.equal(database.authority.runs.get(WRITE_INTENT_ATTEMPTING.runId)?.lifecycle.state, "parked-write");
      } finally { database.close(); }
    } finally { await f.close(); }
  });

  it.each(["journal", "anchor", "both"] as const)("refuses %s rollback against independent current control", async kind => {
    const f = await world();
    try {
      const active = f.signIn();
      assert.equal(f.session().logOut(active.token, { at: "2026-10-21T12:01:00.000Z" }).state, "wiped");
      const oldJournal = readFileSync(f.journalPath), oldAnchor = readFileSync(f.journalPath + ".authority");
      const again = f.signIn();
      assert.equal(f.session().logOut(again.token, { at: "2026-10-21T12:02:00.000Z" }).state, "wiped");
      f.signIn();
      if (kind !== "anchor") writeFileSync(f.journalPath, oldJournal, { mode: 0o600 });
      if (kind !== "journal") writeFileSync(f.journalPath + ".authority", oldAnchor, { mode: 0o600 });
      if (kind === "both") {
        const anchor = JSON.parse(oldAnchor.toString("utf8")) as { epoch: number; device: number; inode: number };
        const journal = JSON.parse(oldJournal.toString("utf8")) as { epoch: number };
        const file = lstatSync(f.journalPath);
        anchor.device = file.dev; anchor.inode = file.ino;
        writeFileSync(f.journalPath + ".authority", JSON.stringify(anchor), { mode: 0o600 });
        assert.equal(anchor.epoch, journal.epoch);
        assert.equal(anchor.device, file.dev); assert.equal(anchor.inode, file.ino);
      }
      const bytes = readFileSync(f.path);
      assert.throws(() => f.store().read());
      assert.throws(() => captureCredentialErasureHead(f.store()));
      assert.deepEqual(readFileSync(f.path), bytes);
    } finally { await f.close(); }
  });

  it("settles an interrupted erase through its exact original command before restoring availability", async () => {
    const f = await world();
    try {
      const session = createProfileSession({ admission: f.machine, machineRoot: f.machine.stateRoot, ...f.credentialInventories,
        activity: { hasUnquiescedWork: () => false }, backupPaths: () => [], loginDataPaths: () => [],
        credentialHooks: { afterErasureJournal: () => { throw new Error("synthetic-interrupted-erasure"); } } });
      const active = session.signIn({ email: "fixture@ucsd.edu", password: "disposable-fixture-password", at: "2026-10-21T12:00:00.000Z" });
      assert.equal(active.state, "active"); if (active.state !== "active") throw new Error("fixture-sign-in-refused");
      assert.throws(() => session.logOut(active.token, { at: "2026-10-21T12:01:00.000Z" }), /synthetic-interrupted-erasure/);
      const intentPath = join(f.workspace, ".tracker", "control", "profile-publication.json");
      const intent = JSON.parse(readFileSync(intentPath, "utf8")) as { kind: string; request: { commandId: string; writeId: string; expectedRevision: number } };
      assert.equal(intent.kind, "erasure");
      const operations = f.machine.readProfileRegistry();
      assert.equal(operations.profiles.find(row => row.profileId === f.profileId)?.lifecycle, "cancelling");
      const directory = join(f.machine.stateRoot, "machine", "operations");
      const files = readdirSync(directory).filter(name => name.endsWith(".json"));
      assert.equal(files.length, 1);
      const path = join(directory, files[0]);
      const operation = JSON.parse(readFileSync(path, "utf8")) as { operationId: string; commandId: string; writeId: string; expectedRevision: number };
      assert.deepEqual({ commandId: operation.commandId, writeId: operation.writeId, expectedRevision: operation.expectedRevision }, { commandId: intent.request.commandId, writeId: intent.request.writeId, expectedRevision: intent.request.expectedRevision });
      assert.throws(() => f.store().read());
      assert.equal(f.session().resumeLogout(operation.operationId).state, "wiped");
      assert.equal(existsSync(intentPath), false);
      const document = z.object({ history: z.array(z.object({ receipt: z.object({ commandId: z.string(), writeId: z.string() }) })) })
        .parse(readAuthenticatedCredentialFixture(f.machine.stateRoot, f.profileId));
      assert.equal(document.history.filter(entry => entry.receipt.commandId === operation.commandId).length, 1);
      assert.equal(document.history.at(-1)?.receipt.writeId, operation.writeId);
      assert.equal(readFileSync(join(f.stateRoot, "credentials", "protected.json")).includes(Buffer.from("disposable-fixture-password")), false);
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

  it("refuses whole-machine restore and relocation without an independent retained continuity witness", async () => {
    const f = await world();
    try {
      const manifestPath = await f.backup(), before = readFileSync(f.path);
      assert.throws(() => new OfflineAuthorityRestoreService(profileBrowserClosure, f.machine,
        { authorityPath: f.path, suspectDirectory: join(f.stateRoot, "backups", "suspects"), busyTimeoutMs: 250, processLockRoot: f.processLockRoot}, async () => {}), /profile-bound-authority-required/);
      assert.throws(() => f.machine.assertStorageRelocationSupported(), ProfileStorageRelocationUnsupportedError);
      assert.deepEqual(readFileSync(f.path), before);
      assert.ok(existsSync(manifestPath));
      assert.equal(existsSync(join(f.workspace, ".tracker", "control", "journal.json")), false);
    } finally { await f.close(); }
  });

  it("preserves external tombstones through SQLite restore and strips restored old credential plaintext", async () => {
    const f = await world();
    try {
      const manifestPath = await f.backup();
      const old = readFileSync(join(f.stateRoot, "credentials", "protected.json"));
      const active = f.signIn();
      assert.equal(f.session().logOut(active.token, { at: "2026-10-21T12:01:00.000Z" }).state, "wiped");
      f.signIn();
      const journal = readFileSync(f.journalPath), anchor = readFileSync(f.journalPath + ".authority");
      const current = readFileSync(join(f.stateRoot, "credentials", "protected.json"));
      await f.restore().restore({ manifestPath }, f.operation());
      assert.deepEqual(readFileSync(f.journalPath), journal);
      assert.deepEqual(readFileSync(f.journalPath + ".authority"), anchor);
      assert.deepEqual(readFileSync(join(f.stateRoot, "credentials", "protected.json")), current);
      f.renew();
      writeFileSync(join(f.stateRoot, "credentials", "protected.json"), old, { mode: 0o600 });
      const repaired = f.store().read();
      assert.equal(repaired.entries.ucpathPassword, undefined);
      assert.equal(repaired.entries.ucpathUserId, undefined);
      assert.deepEqual(readFileSync(f.journalPath), journal);
    } finally { await f.close(); }
  });

  it("refuses erased evidence changed during staging and retains unchanged SQLite", async () => {
    const f = await world();
    try {
      const manifestPath = await f.backup(), bytes = readFileSync(f.path);
      const service = f.restore(async () => {
        writeFileSync(f.journalPath, "{}", { mode: 0o600 });
        writeFileSync(f.journalPath + ".authority", "{}", { mode: 0o600 });
      });
      await assert.rejects(service.restore({ manifestPath }, f.operation()));
      assert.deepEqual(readFileSync(f.path), bytes);
    } finally { await f.close(); }
  });

  it("refuses copied/fabricated opaque heads and an ordinary arbitrary erase identity", async () => {
    const f = await world();
    try {
      const store = f.store(), head = captureCredentialErasureHead(store);
      assert.throws(() => verifyCredentialErasureHead({ ...head }, f.stateRoot, f.journalPath, f.current().profileBinding), /unissued/);
      const before = readFileSync(join(f.stateRoot, "credentials", "protected.json"));
      assert.throws(() => store.erase(CredentialEraseInputSchema.parse({ commandId: randomUUID(), writeId: randomUUID(), commandFingerprint: "b".repeat(64), expectedRevision: store.read().revision,
        updatedAt: "2026-10-21T12:00:00.000Z", protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH })));
      assert.deepEqual(readFileSync(join(f.stateRoot, "credentials", "protected.json")), before);
      assert.equal(existsSync(f.journalPath), false);
    } finally { await f.close(); }
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
    let worker: ReturnType<typeof acquireRuntimeProcessLock> | undefined;
    try {
      const manifestPath = await f.backup(), operation = f.operation(), bytes = readFileSync(f.path);
      worker = acquireRuntimeProcessLock({ processLockRoot: f.processLockRoot, name: "workers", workerId: "synthetic-restore-worker", pid: process.pid });
      await assert.rejects(f.restore().restore({ manifestPath }, operation));
      assert.deepEqual(readFileSync(f.path), bytes);
      assert.equal(existsSync(join(f.workspace, ".tracker", "control", "journal.json")), false);
    } finally { worker?.release(); await f.close(); }
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
      const beforeWrong = readFileSync(journalPath), databaseBytes = readFileSync(f.path);
      const companionBytes = () => ["-wal", "-shm"].map(suffix => existsSync(f.path + suffix) ? readFileSync(f.path + suffix) : undefined);
      const beforeCompanions = companionBytes();
      await assert.rejects(settleInterruptedAuthorityRestore({ admission: recovery.admission, operationId: pending.restore.operationId,
        manifestPath, outcome: "unchanged", processLockRoot: f.processLockRoot, restoreAdmission: restoreHandle }));
      assert.deepEqual(readFileSync(journalPath), beforeWrong); assert.deepEqual(readFileSync(f.path), databaseBytes);
      assert.deepEqual(companionBytes(), beforeCompanions);
      restoreHandle.release(); recovery.admission.release();
      restoreHandle = f.lifetime.beginOfflineMaintenance(f.workspace);
      recovery = acquireRecoveryRuntimeRestore(f.workspace, f.lifetime, pending.restore.operationId, restoreHandle);
      assert.equal((await settleInterruptedAuthorityRestore({ admission: recovery.admission, operationId: pending.restore.operationId,
        manifestPath, outcome: "replaced", processLockRoot: f.processLockRoot, restoreAdmission: restoreHandle })).state, "settled");
      assert.equal(replacements, 1); assert.equal(existsSync(journalPath), false);
      restoreHandle.release(); restoreHandle = undefined; recovery.admission.release(); recovery = undefined;
      freshMachine = RuntimeAdmission.acquireMachine(f.workspace, "exclusive", f.lifetime);
      assert.equal(freshMachine.readProfileRegistry().sessionGeneration, beforeGeneration + 1);
      const fresh = freshMachine.admitProfile(createProfileRegistry(freshMachine).storageClaim(f.profileId));
      const database = AuthorityDatabase.open(fresh, { path: f.path, busyTimeoutMs: 250, migrationOwner: "restore-recovered-fresh" }); database.close(); fresh.release();
    } finally {
      vi.restoreAllMocks(); syncBuiltinESMExports();
      restoreHandle?.release(); recovery?.admission.release(); freshMachine?.release(); await f.close();
    }
  });

  for (const outcome of ["unchanged", "replaced"] as const) it(`recovers ${outcome} history publication before journal unlink once and refuses divergent custody`, async () => {
    const f = await world();
    let restoreHandle: OfflineMaintenanceOperation | undefined;
    let recovery: ReturnType<typeof acquireRecoveryRuntimeRestore> | undefined;
    let freshMachine: RuntimeAdmission | undefined;
    let primary: { error: unknown } | undefined;
    const controlPath = join(f.workspace, ".tracker", "control", "profile-registry.json"), journalPath = join(f.workspace, ".tracker", "control", "journal.json");
    const originalUnlink = fs.unlinkSync;
    try {
      const manifestPath = await f.backup();
      let interrupted = false, replacements = 0;
      vi.spyOn(fs, "unlinkSync").mockImplementation(path => {
        if (!interrupted && String(path) === journalPath) {
          const control = z.object({ completedRestores: z.array(CompletedRestoreCustodySchema) }).parse(JSON.parse(readFileSync(controlPath, "utf8")));
          if (control.completedRestores.length === 1) { interrupted = true; throw new Error("synthetic-history-before-journal-unlink"); }
        }
        originalUnlink(path);
      });
      syncBuiltinESMExports();
      try {
        await assert.rejects(f.restore(async () => {}, (source, target) => {
          replacements++;
          if (outcome === "unchanged") throw new Error("synthetic-replacement-before-effect");
          renameSync(source, target);
        }).restore({ manifestPath }, f.operation()), error => error instanceof OfflineRestoreFailure && error.authorityState === outcome);
      } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); }
      assert.equal(interrupted, true); assert.equal(replacements, 1);
      const pending = z.object({ restore: z.object({ operationId: z.uuid() }) }).parse(JSON.parse(readFileSync(journalPath, "utf8")));
      const published = readFileSync(controlPath), control = z.looseObject({ completedRestores: z.array(CompletedRestoreCustodySchema) }).parse(JSON.parse(published.toString("utf8")));
      assert.equal(control.completedRestores.length, 1);
      assert.equal(control.completedRestores[0]?.operationId, pending.restore.operationId);
      f.machine.release();
      restoreHandle = f.lifetime.beginOfflineMaintenance(f.workspace);
      recovery = acquireRecoveryRuntimeRestore(f.workspace, f.lifetime, pending.restore.operationId, restoreHandle);
      const completed = control.completedRestores[0]; assert.ok(completed);
      writeFileSync(controlPath, JSON.stringify({ ...control, completedRestores: [{ ...completed, outcome: outcome === "replaced" ? "unchanged" : "replaced" }] }));
      const beforeJournal = readFileSync(journalPath), beforeDatabase = readFileSync(f.path), divergent = readFileSync(controlPath);
      await assert.rejects(settleInterruptedAuthorityRestore({ admission: recovery.admission, operationId: pending.restore.operationId,
        manifestPath, outcome, processLockRoot: f.processLockRoot, restoreAdmission: restoreHandle }));
      assert.deepEqual(readFileSync(journalPath), beforeJournal); assert.deepEqual(readFileSync(f.path), beforeDatabase);
      assert.deepEqual(readFileSync(controlPath), divergent);
      writeFileSync(controlPath, published);
      restoreHandle.release(); recovery.admission.release();
      restoreHandle = f.lifetime.beginOfflineMaintenance(f.workspace);
      recovery = acquireRecoveryRuntimeRestore(f.workspace, f.lifetime, pending.restore.operationId, restoreHandle);
      assert.equal((await settleInterruptedAuthorityRestore({ admission: recovery.admission, operationId: pending.restore.operationId,
        manifestPath, outcome, processLockRoot: f.processLockRoot, restoreAdmission: restoreHandle })).state, "settled");
      assert.equal(replacements, 1); assert.equal(existsSync(journalPath), false);
      restoreHandle.release(); restoreHandle = undefined; recovery.admission.release(); recovery = undefined;
      freshMachine = RuntimeAdmission.acquireMachine(f.workspace, "exclusive", f.lifetime);
      const fresh = freshMachine.admitProfile(createProfileRegistry(freshMachine).storageClaim(f.profileId));
      try { assert.deepEqual(fresh.readCompletedRestores(), control.completedRestores); } finally { fresh.release(); }
    } catch (error) { primary = { error }; }
    finally {
      vi.restoreAllMocks(); syncBuiltinESMExports();
      await closeCustodyFixture(async () => {
        restoreHandle?.release(); recovery?.admission.release(); freshMachine?.release(); await f.close();
      }, primary);
    }
  });

  it("reports replaced and retains the genuine root when exclusive operation release fails", async () => {
    const f = await world();
    const operation = f.operation(), journal = join(f.workspace, ".tracker", "control", "journal.json");
    const releaseFailure = new Error("synthetic-exact-operation-release-failure");
    const assertHeld = f.lifetime.assertOfflineMaintenance.bind(f.lifetime);
    let replaced = false;
    const failedRelease = vi.spyOn(f.lifetime, "assertOfflineMaintenance").mockImplementation((owned, workspace) => {
      assertHeld(owned, workspace);
      if (replaced && !existsSync(journal)) throw releaseFailure;
    });
    try {
      const manifestPath = await f.backup();
      await assert.rejects(f.restore(async () => {}, (source, target) => { renameSync(source, target); replaced = true; })
        .restore({ manifestPath }, operation), error => error instanceof OfflineRestoreFailure
          && error.authorityState === "replaced" && error.message.includes("release failed"));
      assert.equal(isOfflineMaintenanceOperationActive(operation), true);
      await assert.rejects(RuntimeLifetimeLock.acquire(f.lifetime.port), RuntimeAlreadyRunningError);
      assert.throws(() => f.machine.beginOfflineMaintenance(), /offline-maintenance-busy/u);
      assert.throws(() => f.current().assertProfileRuntime());
    } finally { failedRelease.mockRestore(); operation.release(); await f.close(); }
  });

  it.each(["erase", "restore"] as const)("excludes a real concurrent controller during %s through the held kernel listener", async held => {
    const f = await world();
    let owner: ReturnType<typeof childJob> | undefined, competitor: ReturnType<typeof childJob> | undefined;
    const ready = join(f.workspace, "child-ready"), release = join(f.workspace, "child-release");
    try {
      const manifestPath = await f.backup();
      const databaseBytes = readFileSync(f.path);
      const port = f.lifetime.port;
      await f.closeController();
      const imports = `
        import { existsSync, writeFileSync } from "node:fs";
        import { join } from "node:path";


        import { acquireEntrypointAdmission } from './src/backend/storage/admission/bootstrap-admission.ts';
        import { RuntimeAlreadyRunningError, RuntimeLifetimeLock } from './src/backend/storage/admission/lifetime-lock.ts';
        import { composeProfileCredentialRepairInventory } from './src/backend/app/composition/profile-credential-inventory.ts';
        import { systemClock } from './src/rules/time/clock.ts';
        import { createProfileSession } from './src/backend/profiles/profile-session.ts';
        import { createProfileRegistry } from './src/backend/profiles/registry.ts';
        import { createCredentialStore } from './src/backend/storage/configuration/credential-store.ts';
        import { OfflineAuthorityRestoreService } from './src/backend/storage/sqlite/offline-restore.ts';
        import { profileBrowserClosure } from './src/backend/runtime/browser/native-profile-probe.ts';
        import { AuthorityDatabase } from './src/backend/storage/sqlite/authority-database.ts';
                import { acquireRuntimeProcessLock, observeRuntimeLockSnapshot } from "./src/backend/storage/sqlite/runtime-process-locks.ts";
        const port=${String(port)},workspace=${JSON.stringify(f.workspace)},profileId=${JSON.stringify(f.profileId)},manifestPath=${JSON.stringify(manifestPath)};
        const ready=${JSON.stringify(ready)},release=${JSON.stringify(release)},processLockRoot=${JSON.stringify(f.processLockRoot)};
      `;
      const barrier = `writeFileSync(ready,'ready',{mode:0o600});const deadline=Date.now()+10000;while(!existsSync(release)){if(Date.now()>deadline)throw new Error('barrier-timeout');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}`;
      const erase = `const lifetime=await RuntimeLifetimeLock.acquire(port);const machine=acquireEntrypointAdmission(workspace,'shared',lifetime);try {
        const session=createProfileSession({admission:machine,machineRoot:machine.stateRoot,activity:{hasUnquiescedWork:()=>false},backupPaths:()=>[],loginDataPaths:()=>[],repairInventory:(admission,request,writer,copies)=>composeProfileCredentialRepairInventory({machine,admission,clock:systemClock,hostFacts:{primaryDisplay:null}})(request,writer,copies),credentialHooks:{afterErasureJournal:()=>{${barrier}}}});
        const active=session.signIn({email:'fixture@ucsd.edu',password:'disposable-fixture-password',at:'2026-10-21T12:00:00.000Z'});
        if(active.state!=='active')throw new Error('activation-refused');
        const result=session.logOut(active.token,{at:'2026-10-21T12:01:00.000Z'});if(result.state!=='wiped')throw new Error('erase-not-wiped');
      }finally{machine.release();await lifetime.close();}process.stdout.write('OWNER_DONE');`;
      const restore = `const lifetime=await RuntimeLifetimeLock.acquire(port);const machine=acquireEntrypointAdmission(workspace,'exclusive',lifetime);try {
        const child=machine.admitProfile(createProfileRegistry(machine).storageClaim(profileId));const root=child.stateRoot,path=join(root,'state.db');
        const store=createCredentialStore({admission:child,stateRoot:root,erasureJournalAdmission:machine,erasureJournalPath:join(machine.stateRoot,'machine','erasures',profileId+'.json')});

        const proof=child.acquireOfflineMaintenance();
        const service=new OfflineAuthorityRestoreService(profileBrowserClosure, child,{authorityPath:path,suspectDirectory:join(root,'backups','suspects'),busyTimeoutMs:250,processLockRoot},async()=>{${barrier}},undefined,undefined,store);
        await service.restore({ manifestPath }, proof);
      }finally{machine.release();await lifetime.close();}process.stdout.write('OWNER_DONE');`;
      owner = childJob(imports + (held === "erase" ? erase : restore));
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
