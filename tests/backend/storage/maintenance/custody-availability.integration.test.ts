import { ERROR_CATALOG } from "../../../../src/models/failures/error-catalog.js";
import { prepareStoppedBackupClosure } from "../../../../src/backend/storage/maintenance/profile-inventory.js";
import { backupStoppedAuthority } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { DatabaseSync } from "node:sqlite";
import children from "node:child_process";
import { openAuthorityBackupSourceReadOnly } from "../../../../src/backend/storage/sqlite/backup-inspection.js";
import { createHistoricalFlatProfileFixture } from "../../../support/fixtures/storage/historical-flat-profile-fixture.js";
import { PublicProfileStateSchema } from "../../../../src/models/profiles/public-profile.js";
import { Server as HttpServer } from "node:http";
import { runClaim } from "../../../../src/models/run/record.js";
import { deriveWriteAuthorityReason } from "../../../../src/rules/write-safety/write-authority-reason.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { initialSettingsFileRecord } from "../../../../src/models/config/settings.js";
import { ConfigSnapshotRecordSchema } from "../../../../src/models/config/snapshot.js";
import { ATOMIC_WRITE_COMMIT, CONFIG_SNAPSHOT, WRITE_ATTEMPT, WRITE_INTENT_ATTEMPTING } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { seedAtomicWriteOwner } from "../../../support/helpers/timeline-write-fixture.js";
import { fenceWriteFixture } from "../../../support/helpers/write-fence-fixture.js";
import nativeFs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { createProfileRegistry } from "../../../../src/backend/profiles/registry.js";
import { acquireStoppedProfileControlUpgrade } from "../../../../src/backend/storage/admission/installation.js";
import { createHistoricalIncompleteProfileFixture, createHistoricalRegisteredProfileFixture } from "../../../support/fixtures/storage/historical-incomplete-profile-fixture.js";
import { writeStoppedProfileControlPredecessor } from "../../../support/fixtures/storage/stopped-profile-control-predecessor.js";
import { StorageMaintenanceCustodyUnavailableError } from "../../../../src/backend/storage/maintenance/custody-availability.js";
import { AuthoritySourceClosureUnprovedError } from "../../../../src/backend/storage/source-closure.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { runSecureEnvironmentBootstrap } from "../../../../src/backend/app/bootstrap/secure-env-bootstrap.js";
import { initializeRegisteredPersonStores, backupRegisteredPeopleAtCleanShutdown, upgradeRegisteredPersonStores, AutomaticPersonRepairRefusedError, composeStorageCommand } from "../../../../src/backend/app/composition/storage-compose.js";
import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/profile-browser-closure.js";
import { OfflineAuthorityRestoreService } from "../../../../src/backend/storage/sqlite/offline-restore.js";
import { resumeShutdownBackupRetirement } from "../../../../src/backend/storage/maintenance/clean-shutdown-backups.js";
import { composeDashboardApplication } from "../../../../src/backend/app/composition/dashboard/compose.js";
import { RuntimeCustodyUncertainError } from "../../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { healthyRuntimePreflightRunners } from "../../../support/fixtures/preflight-seams.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, renameSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, it, vi } from "vitest";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityBackupService } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { createBoundProfileFixture, boundProfileCredentials } from "../../../support/helpers/admission-fixture.js";
import { manualClock } from "../../../../src/rules/time/clock.js";

const host = vi.hoisted(() => ({ platform: "win32" }));
vi.mock("node:os", async actual => ({ ...await actual<typeof import("node:os")>(), platform: () => host.platform }));
const originalArgv = [...process.argv];
afterEach(() => { host.platform = "win32"; vi.restoreAllMocks(); syncBuiltinESMExports(); process.argv.splice(0, process.argv.length, ...originalArgv); });
const clock = manualClock(new Date("2026-11-04T02:00:00.000Z"));

function files(root: string): Record<string, string> {
  if (!existsSync(root)) return {};
  const result: Record<string, string> = {};
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else result[relative(root, path)] = createHash("sha256").update(readFileSync(path)).digest("hex");
    }
  };
  visit(root); return result;
}

function parkedUnknown(database: AuthorityDatabase, path: string, stateRoot: string) {
  const resolved = resolveConfigWithProvenance(initialSettingsFileRecord().settings, { primaryDisplay: null }, clock,
    { stateRoot, artifactRoot: join(stateRoot, "artifacts") });
  const snapshot = ConfigSnapshotRecordSchema.parse({ ...CONFIG_SNAPSHOT, config: resolved.config, fingerprint: resolved.fingerprint, provenance: resolved.provenance });
  seedAtomicWriteOwner(database, { ...ATOMIC_WRITE_COMMIT,
    transaction: { ...ATOMIC_WRITE_COMMIT.transaction, configFingerprint: snapshot.fingerprint } }, path, 2, snapshot);
  fenceWriteFixture(database, { intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT }, path);
  const run = database.authority.runs.get(WRITE_INTENT_ATTEMPTING.runId); assert.ok(run);
  const claim = runClaim(run); assert.ok(claim);
  const now = clock.now().toISOString();
  database.authority.writeIntents.parkAttempt({ writeIntentId: WRITE_INTENT_ATTEMPTING.writeIntentId, generation: 1, expectedVersion: 1,
    code: "unknown", message: "synthetic-unresolved-submit", authorityReason: deriveWriteAuthorityReason("recovery-probe-unknown", "probe", "synthetic-unresolved-submit"), now });
  assert.equal(database.authority.runs.transition({ runId: run.envelope.runId, expectedVersion: run.version,
    claim: { workerId: claim.workerId, claimGeneration: claim.claimGeneration }, lifecycle: { state: "parked-write", writeIntentId: WRITE_INTENT_ATTEMPTING.writeIntentId,
      intentGeneration: 1, parkedAt: now, code: "unknown", message: "synthetic-unresolved-submit" }, now }).state, "applied");
  return { intent: database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId), run: database.authority.runs.get(run.envelope.runId) };
}

it("refuses a Windows backup before publishing or capturing source data", async () => {
  const f = await createBoundProfileFixture();
  const database = AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "windows-refusal" }, clock,
    undefined, undefined, undefined, boundProfileCredentials(f.admission));
  try {
    const unknown = parkedUnknown(database, f.path, f.stateRoot);
    const before = files(f.stateRoot), directory = join(f.stateRoot, "backups", "authority");
    const request = new AuthorityBackupService(f.admission, database, { directory }, clock);
    let failure: unknown;
    try { await request.request({ trigger: "operator", requiredGeneration: database.getMeta().authorityGeneration }); }
    catch (error) { failure = error; }
    assert.deepEqual(files(f.stateRoot), before, "unavailable Windows custody must preserve backup/source bytes and membership");
    assert.equal(failure instanceof Error && "code" in failure && failure.code, "STORAGE_MAINTENANCE_CUSTODY_UNAVAILABLE");
    assert.deepEqual(database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId), unknown.intent);
    assert.deepEqual(database.authority.runs.get(WRITE_INTENT_ATTEMPTING.runId), unknown.run);
    f.admission.assertLive();
  } finally { database.close(); await f.close(); }
});

for (const platform of ["darwin", "linux"]) it(`preserves successful backup behavior under the ${platform} custody policy`, async () => {
  host.platform = platform;
  const f = await createBoundProfileFixture();
  const database = AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "non-windows-refusal-control" }, clock,
    undefined, undefined, undefined, boundProfileCredentials(f.admission));
  try {
    const directory = join(f.stateRoot, "backups", "authority");
    const result = await new AuthorityBackupService(f.admission, database, { directory }, clock)
      .request({ trigger: "operator", requiredGeneration: database.getMeta().authorityGeneration });
    assert.equal(result.manifests.length, 1);
    assert.ok(result.manifests[0]);
    assert.ok(existsSync(join(directory, result.manifests[0].backupFileName)));
  } finally { database.close(); await f.close(); }
});

it("refuses a readable Windows restore before retaining suspect copies or changing authority", async () => {
  host.platform = "linux";
  const f = await createBoundProfileFixture();
  const database = AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "restore-refusal" }, clock,
    undefined, undefined, undefined, boundProfileCredentials(f.admission));
  let operation: ReturnType<typeof f.admission.acquireOfflineMaintenance> | undefined;
  try {
    const unknown = parkedUnknown(database, f.path, f.stateRoot);
    const directory = join(f.stateRoot, "backups", "authority");
    const backup = await new AuthorityBackupService(f.admission, database, { directory }, clock)
      .request({ trigger: "operator", requiredGeneration: database.getMeta().authorityGeneration });
    database.close();
    const manifest = backup.manifests[0]; assert.ok(manifest);
    operation = f.admission.acquireOfflineMaintenance();
    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, f.admission, {
      authorityPath: f.path, suspectDirectory: join(f.stateRoot, "backups", "suspects"), busyTimeoutMs: 250,
      processLockRoot: join(f.workspace, rebuildRuntimeIsolation.processLockRoot),
    }, async (path, restoreOperation) => {
      const staged = f.admission.stoppedRestoreProjection(path, restoreOperation);
      try {
        const copy = AuthorityDatabase.openStoppedRestoreProjection(staged, { path, busyTimeoutMs: 250, migrationOwner: "restore-refusal-projection" }, clock);
        copy.close();
      } finally { staged.release(); }
    }, clock, undefined, boundProfileCredentials(f.admission));
    const before = files(f.stateRoot);
    host.platform = "win32";
    let failure: unknown;
    try { await restore.restore({ manifestPath: join(directory, `${manifest.backupFileName}.manifest.json`) }, operation); }
    catch (error) { failure = error; }
    assert.deepEqual(files(f.stateRoot), before, "unavailable Windows restore must preserve every authority/backup/credential byte");
    assert.equal(failure instanceof Error && "code" in failure && failure.code, "STORAGE_MAINTENANCE_CUSTODY_UNAVAILABLE");
    const reopened = AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "restore-unknown-preserved" }, clock,
      undefined, undefined, undefined, boundProfileCredentials(f.admission));
    try {
      assert.deepEqual(reopened.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId), unknown.intent);
      assert.deepEqual(reopened.authority.runs.get(WRITE_INTENT_ATTEMPTING.runId), unknown.run);
    } finally { reopened.close(); }
  } finally { database.close(); operation?.release(); await f.close(); }
});

it("preserves a pending Windows backup retirement before any backup is unlinked", async () => {
  host.platform = "linux";
  const f = await createBoundProfileFixture();
  const database = AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "retirement-refusal" }, clock,
    undefined, undefined, undefined, boundProfileCredentials(f.admission));
  try {
    const directory = join(f.stateRoot, "backups", "authority");
    const service = new AuthorityBackupService(f.admission, database, { directory, purpose: "clean-shutdown" }, clock);
    for (let index = 0; index < 4; index++) {
      clock.advanceWall(1000);
      await service.request({ trigger: "graceful-drain", requiredGeneration: database.getMeta().authorityGeneration });
    }
    database.close();
    const oldest = readdirSync(directory).filter(name => name.endsWith(".manifest.json")).sort()[0]; assert.ok(oldest);
    renameSync(join(directory, oldest), join(directory, `${oldest}.retiring`));
    const before = files(f.stateRoot);
    host.platform = "win32";
    let failure: unknown;
    try { await resumeShutdownBackupRetirement(f.admission, clock); } catch (error) { failure = error; }
    assert.deepEqual(files(f.stateRoot), before, "unavailable Windows retirement must preserve the pending journal and backup");
    assert.equal(failure instanceof Error && "code" in failure && failure.code, "STORAGE_MAINTENANCE_CUSTODY_UNAVAILABLE");
  } finally { database.close(); await f.close(); }
});

it("keeps Windows retirement with no pending work usable", async () => {
  const f = await createBoundProfileFixture();
  try { const before = files(f.stateRoot); await resumeShutdownBackupRetirement(f.admission, clock); assert.deepEqual(files(f.stateRoot), before); }
  finally { await f.close(); }
});

it("closes the application before reporting Windows backup unavailability without retaining runtime custody", async () => {
  const f = await createBoundProfileFixture();
  const application = await composeDashboardApplication({ lifetimeLock: f.lifetime, admission: f.machine,
    isolation: rebuildRuntimeIsolation, repoRoot: process.cwd(), backendPortOverride: 0, frontendPortOverride: 0,
    env: {}, clock, preflightRunnerFactory: healthyRuntimePreflightRunners });
  try {
    let failure: unknown;
    try { await application.stop(); } catch (error) { failure = error; }
    assert.equal(failure instanceof RuntimeCustodyUncertainError, false);
    assert.equal(failure instanceof Error && "code" in failure && failure.code, "STORAGE_MAINTENANCE_CUSTODY_UNAVAILABLE");
    assert.equal(existsSync(join(f.stateRoot, "backups", "authority")), false);
    await assert.rejects(fetch(`http://127.0.0.1:${application.port}/api/v1/profile`));
    await assert.rejects(application.stop(), error => error === failure);
  } finally { await f.close(); }
});

it("releases the lifetime and permits restart after the closed application reports Windows backup refusal", async () => {
  const f = await createBoundProfileFixture(), port = f.lifetime.port;
  try {
    await assert.rejects(runSecureEnvironmentBootstrap(["cli", "dashboard"], {
      acquireLifetimeLock: async () => f.lifetime, acquireAdmission: () => f.machine, assertEnvironment: () => undefined,
      runCli: async (_admission, take) => {
        const application = await composeDashboardApplication({ lifetimeLock: f.lifetime, admission: f.machine,
          isolation: rebuildRuntimeIsolation, repoRoot: process.cwd(), backendPortOverride: 0, frontendPortOverride: 0,
          env: {}, clock, preflightRunnerFactory: healthyRuntimePreflightRunners });
        take?.(); await application.stop();
      },
    }), error => error instanceof StorageMaintenanceCustodyUnavailableError);
    assert.throws(() => f.lifetime.assertHeld());
    assert.throws(() => f.machine.assertLive());
    const restarted = await RuntimeLifetimeLock.acquire(port);
    try { restarted.assertHeld(); } finally { await restarted.close(); }
  } finally { await f.close(); }
});

for (const kind of ["aggregate-close", "unproved-native-close", "runtime-custody"] as const) it(`retains lifetime for ${kind} combined with backup refusal`, async () => {
  host.platform = "linux";
  const f = await createBoundProfileFixture();
  const refusal = new StorageMaintenanceCustodyUnavailableError("backup");
  const failure = kind === "aggregate-close" ? new AggregateError([refusal, new Error("injected close failure")])
    : kind === "unproved-native-close" ? new AggregateError([refusal, new AuthoritySourceClosureUnprovedError([new Error("injected native close failure")])])
    : new RuntimeCustodyUncertainError([refusal]);
  let fault: { mockRestore(): void } | undefined;
  try {
    await assert.rejects(runSecureEnvironmentBootstrap(["cli", "dashboard"], {
      acquireLifetimeLock: async () => f.lifetime, acquireAdmission: () => f.machine, assertEnvironment: () => undefined,
      runCli: async (_admission, take) => {
        const application = await composeDashboardApplication({ lifetimeLock: f.lifetime, admission: f.machine,
          isolation: rebuildRuntimeIsolation, repoRoot: process.cwd(), backendPortOverride: 0, frontendPortOverride: 0,
          env: {}, clock, preflightRunnerFactory: healthyRuntimePreflightRunners });
        if (kind === "unproved-native-close") {
          fault = vi.spyOn(HttpServer.prototype, "close").mockImplementation(function (this: HttpServer, callback?: (error?: Error) => void) {
            const address = this.address();
            fault?.mockRestore();
            return this.close(typeof address === "object" && address?.port === application.port
              ? () => { callback?.(failure); } : callback);
          });
        } else fault = vi.spyOn(AuthorityBackupService.prototype, "request").mockRejectedValue(failure);
        take?.(); await application.stop();
      },
    }), error => error instanceof RuntimeCustodyUncertainError);
    f.lifetime.assertHeld();
    assert.equal(existsSync(join(f.stateRoot, "backups", "authority")), false);
  } finally { fault?.mockRestore(); await f.close(); }
});

for (const pending of [undefined, "storage"] as const) it(`keeps Windows current-profile startup and no-work retirement usable (pending draft: ${pending !== undefined})`, async () => {
  const f = await createBoundProfileFixture(pending === undefined ? {} : { pending });
  f.admission.release(); f.machine.release();
  try {
    await initializeRegisteredPersonStores(f.workspace, f.lifetime, { primaryDisplay: null }, clock);
    if (pending !== undefined) await backupRegisteredPeopleAtCleanShutdown(f.workspace, f.lifetime, clock);
    const machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime);
    try { machine.assertLive(); } finally { machine.release(); }
    assert.equal(existsSync(join(f.stateRoot, "backups", "authority")), false);
  } finally { await f.close(); }
});

it("refuses a Windows machine-control migration before archive copies or receipts are created", async () => {
  host.platform = "linux";
  const f = await createHistoricalIncompleteProfileFixture();
  writeStoppedProfileControlPredecessor(f, 1);
  const before = files(f.workspace);
  const operation = f.lifetime.beginOfflineMaintenance(f.workspace);
  let control: ReturnType<typeof acquireStoppedProfileControlUpgrade> | undefined;
  try {
    host.platform = "win32";
    let failure: unknown;
    try {
      control = acquireStoppedProfileControlUpgrade(f.workspace, operation, f.lifetime);
      await control.prepareBrowserInventory(false, input => ({ signal: input.signal,
        async probe() { throw new Error("browser probe reached before Windows refusal"); } }));
    } catch (error) { failure = error; }
    assert.deepEqual(files(f.workspace), before, "Windows control migration must preserve source and create no recovery copies or receipt");
    assert.equal(failure instanceof Error && "code" in failure && failure.code, "STORAGE_MAINTENANCE_CUSTODY_UNAVAILABLE", failure instanceof Error ? failure.message : "missing refusal");
  } finally { control?.release(); operation.release(); await f.close(); }
});

it("refuses direct Windows account deletion before credential capture and preserves all profile files", async () => {
  const f = await createBoundProfileFixture();
  const profileId = f.admission.profileBinding.profileId;
  const database = AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "deletion-unknown-preserved" }, clock,
    undefined, undefined, undefined, boundProfileCredentials(f.admission));
  parkedUnknown(database, f.path, f.stateRoot); database.close();
  const epoch = createProfileRegistry(f.machine).advanceSession(null);
  f.admission.release();
  const keyPath = join(f.machine.stateRoot, "machine", "credential-keys", `${profileId}.json`);
  const before = files(f.workspace), open = nativeFs.openSync;
  let credentialOpens = 0;
  const observed = vi.spyOn(nativeFs, "openSync").mockImplementation((...args) => {
    if (String(args[0]) === keyPath) credentialOpens++;
    return open(...args);
  });
  syncBuiltinESMExports();
  try {
    let failure: unknown;
    try { f.machine.deleteProfileAccount(profileId, epoch); } catch (error) { failure = error; }
    assert.equal(credentialOpens, 0, "unavailable account deletion must refuse before reading the credential head");
    observed.mockRestore(); syncBuiltinESMExports();
    assert.deepEqual(files(f.workspace), before);
    assert.equal(failure instanceof Error && "code" in failure && failure.code, "STORAGE_MAINTENANCE_CUSTODY_UNAVAILABLE");
  } finally { observed.mockRestore(); syncBuiltinESMExports(); await f.close(); }
});

it.each([14, 19] as const)("refuses a Windows registered-profile schema %s upgrade before a backup or upgrade is published", async sourceVersion => {
  host.platform = "linux";
  const f = await createHistoricalRegisteredProfileFixture({ sourceVersion });
  const before = files(f.workspace), open = nativeFs.openSync;
  const keyPath = join(f.workspace, rebuildRuntimeIsolation.stateRoot, "machine", "credential-keys", `${f.binding.profileId}.json`);
  let credentialOpens = 0;
  const observed = vi.spyOn(nativeFs, "openSync").mockImplementation((...args) => {
    if (String(args[0]) === keyPath) credentialOpens++;
    return open(...args);
  });
  syncBuiltinESMExports();
  try {
    host.platform = "win32";
    let failure: unknown;
    try { await upgradeRegisteredPersonStores(f.workspace, f.lifetime, { primaryDisplay: null }, clock); }
    catch (error) { failure = error; }
    assert.equal(credentialOpens, 0, "unavailable schema upgrade must refuse before capturing the credential head");
    observed.mockRestore(); syncBuiltinESMExports();
    assert.deepEqual(files(f.workspace), before, "Windows schema upgrade must preserve the exact source, credentials and recovery inventory");
    assert.ok(failure instanceof Error && failure.cause instanceof StorageMaintenanceCustodyUnavailableError,
      failure instanceof Error ? String(failure.cause) : String(failure));
  } finally { observed.mockRestore(); syncBuiltinESMExports(); await f.close(); }
});

it("refuses Windows flat-store migration before hashing the legacy source", async () => {
  host.platform = "linux";
  const f = await createHistoricalFlatProfileFixture({ unknownWrite: true });
  const machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime);
  const before = files(f.workspace), open = nativeFs.openSync;
  let sourceOpens = 0;
  const observed = vi.spyOn(nativeFs, "openSync").mockImplementation((...args) => {
    if (String(args[0]) === f.databasePath) sourceOpens++;
    return open(...args);
  });
  syncBuiltinESMExports();
  try {
    host.platform = "win32";
    let failure: unknown;
    try { await machine.startCleanFlatStore(profileBrowserClosure); } catch (error) { failure = error; }
    assert.equal(sourceOpens, 0, "flat-store refusal must precede source capture, including UNKNOWN receipts");
    observed.mockRestore(); syncBuiltinESMExports();
    assert.deepEqual(files(f.workspace), before);
    assert.ok(failure instanceof Error && failure.cause instanceof StorageMaintenanceCustodyUnavailableError);
  } finally { observed.mockRestore(); syncBuiltinESMExports(); machine.release(); await f.close(); }
});

it("refuses authenticated Windows account deletion without logging out and keeps ordinary logout usable", async () => {
  const f = await createBoundProfileFixture();
  const application = await composeDashboardApplication({ lifetimeLock: f.lifetime, admission: f.machine,
    isolation: rebuildRuntimeIsolation, repoRoot: process.cwd(), backendPortOverride: 0, frontendPortOverride: 0,
    env: {}, clock, preflightRunnerFactory: healthyRuntimePreflightRunners });
  const base = `http://127.0.0.1:${application.port}`;
  const post = (path: string, body: unknown, cookie?: string) => fetch(`${base}${path}`, { method: "POST",
    headers: { "content-type": "application/json", origin: base, ...(cookie === undefined ? {} : { cookie }) }, body: JSON.stringify(body) });
  try {
    const login = await post("/api/v1/profile/sign-in", { email: "fixture@ucsd.edu", password: "disposable-fixture-password" });
    assert.equal(PublicProfileStateSchema.parse(await login.json()).state, "active");
    const header = login.headers.get("set-cookie"); assert.ok(header);
    const cookie = header.split(";")[0]; assert.ok(cookie);
    const durableAccountFiles = () => Object.fromEntries(Object.entries(files(f.workspace)).filter(([path]) =>
      path !== ".tracker/data/logs/boot.jsonl" && !path.endsWith("state.db-shm")));
    const before = durableAccountFiles(), profile = f.machine.readProfileRegistry();
    const deletion = await post("/api/v1/profile/delete-account", { confirmed: true }, cookie);
    assert.equal(deletion.status, 409);
    assert.deepEqual(PublicProfileStateSchema.parse(await deletion.json()), { state: "refused", code: "PROFILE_ACCOUNT_DELETION_REFUSED" });
    assert.deepEqual(f.machine.readProfileRegistry(), profile);
    assert.deepEqual(durableAccountFiles(), before, "refused deletion must not publish logout or erase credentials");
    assert.equal((await fetch(`${base}/api/v1/bootstrap`, { headers: { cookie } })).status, 200);
    const logout = await post("/api/v1/profile/logout", {}, cookie);
    assert.deepEqual(PublicProfileStateSchema.parse(await logout.json()), { state: "signed-out", signUpRequired: false });
  } finally {
    await application.stop().catch((error: unknown) => { assert.ok(error instanceof StorageMaintenanceCustodyUnavailableError); });
    await f.close();
  }
});

it("refuses direct Windows backup source opening and native export before source capture", async () => {
  const f = await createBoundProfileFixture();
  const database = AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "direct-export-refusal" }, clock,
    undefined, undefined, undefined, boundProfileCredentials(f.admission));
  const before = files(f.stateRoot), open = nativeFs.openSync;
  let sourceOpens = 0;
  const observed = vi.spyOn(nativeFs, "openSync").mockImplementation((...args) => {
    if (String(args[0]) === f.path) sourceOpens++;
    return open(...args);
  });
  const spawn = children.spawnSync;
  let sourceCaptures = 0;
  const childCapture = vi.spyOn(children, "spawnSync").mockImplementation((command, args, options) => {
    if (args?.some(argument => argument.includes(f.path))) sourceCaptures++;
    return spawn(command, args, options);
  });
  syncBuiltinESMExports();
  try {
    let source: ReturnType<typeof openAuthorityBackupSourceReadOnly> | undefined, sourceFailure: unknown, exportFailure: unknown;
    try { source = openAuthorityBackupSourceReadOnly(f.admission, f.path); } catch (error) { sourceFailure = error; }
    source?.close();
    try { await database.onlineBackupTo(join(f.stateRoot, "direct-backup.sqlite")); } catch (error) { exportFailure = error; }
    assert.equal(sourceCaptures, 0, "direct backup source opening must refuse before isolated source capture");
    assert.equal(sourceOpens, 0, "direct backup APIs must refuse before opening source bytes");
    observed.mockRestore(); childCapture.mockRestore(); syncBuiltinESMExports();
    assert.deepEqual(files(f.stateRoot), before, "direct native export must not create a backup file");
    assert.ok(sourceFailure instanceof StorageMaintenanceCustodyUnavailableError);
    assert.ok(exportFailure instanceof StorageMaintenanceCustodyUnavailableError);
  } finally { observed.mockRestore(); childCapture.mockRestore(); syncBuiltinESMExports(); database.close(); await f.close(); }
});

it("refuses startup Windows backup retirement before repair admission captures profile data", async () => {
  host.platform = "linux";
  const f = await createBoundProfileFixture(), profileId = f.admission.profileBinding.profileId;
  const directory = join(f.stateRoot, "backups", "authority");
  const database = AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "startup-retirement-refusal" }, clock,
    undefined, undefined, undefined, boundProfileCredentials(f.admission));
  const service = new AuthorityBackupService(f.admission, database, { directory, purpose: "clean-shutdown" }, clock);
  try {
    for (let index = 0; index < 4; index++) {
      clock.advanceWall(1000); await service.request({ trigger: "graceful-drain", requiredGeneration: database.getMeta().authorityGeneration });
    }
  } finally { database.close(); }
  const oldest = readdirSync(directory).filter(name => name.endsWith(".manifest.json")).sort()[0]; assert.ok(oldest);
  renameSync(join(directory, oldest), join(directory, `${oldest}.retiring`));
  const keyPath = join(f.machine.stateRoot, "machine", "credential-keys", `${profileId}.json`);
  f.admission.release(); f.machine.release();
  const before = files(f.workspace), open = nativeFs.openSync;
  let credentialOpens = 0;
  const observed = vi.spyOn(nativeFs, "openSync").mockImplementation((...args) => {
    if (String(args[0]) === keyPath) credentialOpens++;
    return open(...args);
  });
  const list = nativeFs.readdirSync, spawn = children.spawnSync;
  let pendingObserved = false, sourceCaptures = 0;
  const discovery = vi.spyOn(nativeFs, "readdirSync").mockImplementation((...args) => {
    const entries = list(...args);
    if (String(args[0]) === directory && entries.some((entry: unknown) => typeof entry === "string" && entry.endsWith(".retiring"))) pendingObserved = true;
    return entries;
  });
  const capture = vi.spyOn(children, "spawnSync").mockImplementation((command, args, options) => {
    if (pendingObserved && args?.some(argument => argument.includes(f.path))) sourceCaptures++;
    return spawn(command, args, options);
  }); syncBuiltinESMExports();
  try {
    host.platform = "win32";
    let failure: unknown;
    try { await initializeRegisteredPersonStores(f.workspace, f.lifetime, { primaryDisplay: null }, clock); } catch (error) { failure = error; }
    assert.equal(pendingObserved, true);
    assert.equal(sourceCaptures, 0, "pending retirement must refuse before repair admission captures profile source bytes");
    assert.equal(credentialOpens, 0, "pending retirement must refuse before repair admission reads the credential head");
    observed.mockRestore(); syncBuiltinESMExports(); assert.deepEqual(files(f.workspace), before);
    assert.ok(failure instanceof AutomaticPersonRepairRefusedError && failure.cause instanceof StorageMaintenanceCustodyUnavailableError);
  } finally { observed.mockRestore(); discovery.mockRestore(); capture.mockRestore(); syncBuiltinESMExports(); await f.close(); }
});

it("refuses automatic Windows restore before repair admission captures an unsupported profile", async () => {
  const f = await createBoundProfileFixture(), profileId = f.admission.profileBinding.profileId;
  const keyPath = join(f.machine.stateRoot, "machine", "credential-keys", `${profileId}.json`);
  f.admission.release(); f.machine.release();
  const raw = new DatabaseSync(f.path); raw.exec("PRAGMA user_version=999"); raw.close();
  const before = files(f.workspace), open = nativeFs.openSync;
  let credentialOpens = 0;
  const observed = vi.spyOn(nativeFs, "openSync").mockImplementation((...args) => {
    if (String(args[0]) === keyPath) credentialOpens++;
    return open(...args);
  });
  const spawn = children.spawnSync;
  let sourceCaptures = 0;
  const capture = vi.spyOn(children, "spawnSync").mockImplementation((command, args, options) => {
    if (args?.some(argument => argument.includes(f.path))) sourceCaptures++;
    return spawn(command, args, options);
  }); syncBuiltinESMExports();
  try {
    let failure: unknown;
    try { await initializeRegisteredPersonStores(f.workspace, f.lifetime, { primaryDisplay: null }, clock); } catch (error) { failure = error; }
    assert.equal(sourceCaptures, 1, "only the initial startup health read may capture source bytes; refused repair must capture none");
    assert.equal(credentialOpens, 0, "automatic restore must refuse before repair admission reads the credential head");
    observed.mockRestore(); syncBuiltinESMExports(); assert.deepEqual(files(f.workspace), before);
    assert.ok(failure instanceof AutomaticPersonRepairRefusedError && failure.cause instanceof AggregateError
      && failure.cause.cause instanceof StorageMaintenanceCustodyUnavailableError);
  } finally { observed.mockRestore(); capture.mockRestore(); syncBuiltinESMExports(); await f.close(); }
});

for (const kind of ["backup admission", "restore context"] as const) it(`refuses direct Windows ${kind} before payload capture`, async () => {
  host.platform = "linux";
  const f = await createBoundProfileFixture(), profileId = f.admission.profileBinding.profileId;
  const operation = f.admission.acquireOfflineMaintenance(), stopped = f.admission.forStoppedMaintenance(operation);
  const before = files(f.workspace), spawn = children.spawnSync, open = nativeFs.openSync;
  const keyPath = join(f.machine.stateRoot, "machine", "credential-keys", `${profileId}.json`);
  let captures = 0, credentialOpens = 0, backup: RuntimeAdmission | undefined;
  const childrenObserved = vi.spyOn(children, "spawnSync").mockImplementation((command, args, options) => {
    if (args?.some(argument => argument.includes(f.path))) captures++;
    return spawn(command, args, options);
  });
  const filesObserved = vi.spyOn(nativeFs, "openSync").mockImplementation((...args) => {
    if (String(args[0]) === keyPath) credentialOpens++;
    return open(...args);
  }); syncBuiltinESMExports();
  try {
    host.platform = "win32";
    let failure: unknown;
    try {
      if (kind === "backup admission") backup = f.machine.admitStoppedProfileBackup(profileId, operation);
      else stopped.captureProfileRestore(operation);
    } catch (error) { failure = error; }
    backup?.release(); backup = undefined;
    assert.equal(captures, 0, "unavailable maintenance admission must not capture source payloads");
    assert.equal(credentialOpens, 0, "unavailable maintenance admission must not capture the credential head");
    childrenObserved.mockRestore(); filesObserved.mockRestore(); syncBuiltinESMExports();
    assert.deepEqual(files(f.workspace), before);
    assert.ok(failure instanceof StorageMaintenanceCustodyUnavailableError);
  } finally {
    childrenObserved.mockRestore(); filesObserved.mockRestore(); syncBuiltinESMExports();
    backup?.release(); if (stopped !== f.admission) stopped.release(); operation.release(); await f.close();
  }
});

for (const kind of ["newest restore", "stopped backup"] as const) it(`refuses Windows ${kind} before source capture and releases its borrowed owner`, async () => {
  host.platform = "linux";
  const f = await createBoundProfileFixture();
  const database = AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "early-derived-owner" }, clock,
    undefined, undefined, undefined, boundProfileCredentials(f.admission));
  try {
    await new AuthorityBackupService(f.admission, database, { directory: join(f.stateRoot, "backups", "authority") }, clock)
      .request({ trigger: "operator", requiredGeneration: database.getMeta().authorityGeneration });
  } finally { database.close(); }
  const operation = f.admission.acquireOfflineMaintenance();
  const processLockRoot = join(f.workspace, rebuildRuntimeIsolation.processLockRoot);
  const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, f.admission, {
    authorityPath: f.path, suspectDirectory: join(f.stateRoot, "backups", "suspects"), busyTimeoutMs: 250, processLockRoot,
  }, async () => { throw new Error("projection must not run for refused restore"); }, clock, undefined, boundProfileCredentials(f.admission));
  const closure = kind === "stopped backup" ? await prepareStoppedBackupClosure(profileBrowserClosure, f.admission, operation, clock, processLockRoot) : undefined;
  const before = files(f.workspace), spawn = children.spawnSync;
  let captures = 0;
  const observed = vi.spyOn(children, "spawnSync").mockImplementation((command, args, options) => {
    if (args?.some(argument => argument.includes(f.path))) captures++;
    return spawn(command, args, options);
  }); syncBuiltinESMExports();
  try {
    host.platform = "win32";
    let failure: unknown;
    try {
      if (kind === "newest restore") await restore.restoreNewest(operation);
      else { assert.ok(closure); await backupStoppedAuthority(closure, f.admission, f.stateRoot, clock, processLockRoot, operation); }
    } catch (error) { failure = error; }
    assert.equal(captures, 0, "refused operation must not derive an owner by capturing source bytes");
    observed.mockRestore(); syncBuiltinESMExports(); assert.deepEqual(files(f.workspace), before);
    assert.ok(failure instanceof StorageMaintenanceCustodyUnavailableError);
  } finally { observed.mockRestore(); syncBuiltinESMExports(); operation.release(); await f.close(); }
});

for (const json of [false, true]) it(`reports canonical Windows custody refusal from a valid machine-control command (JSON: ${json})`, async () => {
  host.platform = "linux";
  const f = await createHistoricalIncompleteProfileFixture();
  writeStoppedProfileControlPredecessor(f, 1);
  const machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime);
  const before = files(f.workspace);
  try {
    host.platform = "win32";
    const result = await composeStorageCommand(rebuildRuntimeIsolation,
      ["upgrade", "--machine-control", ...(json ? ["--json"] : [])], clock, f.workspace, machine);
    assert.equal(result.exitCode, 1);
    assert.deepEqual(files(f.workspace), before, "refused command must not create upgrade copies or change sources");
    if (json) assert.deepEqual(JSON.parse(result.output), { state: "refused-or-incomplete", code: "STORAGE_MAINTENANCE_CUSTODY_UNAVAILABLE" });
    else {
      assert.ok(result.output.includes("STORAGE_MAINTENANCE_CUSTODY_UNAVAILABLE"));
      assert.ok(result.output.includes(ERROR_CATALOG.STORAGE_MAINTENANCE_CUSTODY_UNAVAILABLE.text));
      assert.equal(result.output.includes("before retrying"), false);
    }
  } finally { machine.release(); await f.close(); }
});

it("keeps the current Windows machine-control command a no-work success", async () => {
  const f = await createBoundProfileFixture();
  f.admission.release(); f.machine.release();
  const machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime);
  const before = files(f.workspace);
  try {
    const result = await composeStorageCommand(rebuildRuntimeIsolation, ["upgrade", "--machine-control", "--json"], clock, f.workspace, machine);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(JSON.parse(result.output), { state: "current", runtimeAccess: "unchanged", profileCount: 1 });
    assert.deepEqual(files(f.workspace), before);
  } finally { machine.release(); await f.close(); }
});
