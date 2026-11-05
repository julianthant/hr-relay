import { removeSchema16PersonPreferences, prePreferencesSettingsRow } from "../../../../support/fixtures/storage/person-preferences-predecessor.js";
import { restoreSchema18WorkbookReferenceFixture, removeEmptySchema18WorkbookCatalog, removeEmptySchema17OcrReview, removeSchema15RunPause, removeEmptyExclusiveSessionLeaseFixture } from "../../../../support/fixtures/storage/historical-run-schema.js";
import { restoreEmptyPreMasterWorkbookFixture } from '../../../../support/helpers/workbooks/pre-master-schema.js';
import { restorePreReadingArtifactRetention } from "../../../../support/fixtures/storage/pre-reading-artifact-retention.js";
import assert from "node:assert/strict";
import { createHash,randomUUID } from "node:crypto";
import { copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,renameSync,rmSync,writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { it,vi } from "vitest";
import { composeDashboardApplication,composeDashboardRuntime } from "../../../../../src/backend/app/composition/dashboard/compose.js";
import * as notificationHealthOwner from "../../../../../src/backend/app/composition/dashboard/notification-health.js";
import * as notificationOwner from "../../../../../src/backend/app/composition/dashboard/notifications.js";
import * as credentialInventoryOwner from "../../../../../src/backend/app/composition/profile-credential-inventory.js";
import { prepareApplicationDataWorkspace,composeProfileRuntime } from "../../../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { createProfileSession } from "../../../../../src/backend/profiles/profile-session.js";
import { requireLifecycleApplied } from "../../../../../src/backend/runs/lifecycle/run-record-service.js";
import * as admissionOwner from "../../../../../src/backend/storage/admission/admission.js";
import { acquireSharedRuntimeAdmission,type RuntimeAdmission } from "../../../../../src/backend/storage/admission/admission.js";
import { RuntimeLifetimeLock } from "../../../../../src/backend/storage/admission/lifetime-lock.js";
import { acquireEntrypointAdmission } from "../../../../../src/backend/storage/admission/bootstrap-admission.js";
import { createBrowserRoots } from "../../../../../src/backend/storage/browser-roots.js";
import { readFixedLayoutIntent } from "../../../../../src/backend/storage/maintenance/fixed-layout.js";
import { WorkerBrowserObservationSchema } from "../../../../../src/models/run/worker-control.js";
import { isLiveWorker } from "../../../../../src/models/run/worker.js";
import { canonicalJsonStringify } from "../../../../../src/rules/validation/canonical-json.js";
import { AuthorityDatabase } from "../../../../../src/backend/storage/sqlite/authority-database.js";
import { createCredentialStore } from "../../../../../src/backend/storage/configuration/credential-store.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../../src/backend/storage/sqlite/migrations.js";
import { readProfileDatabaseBinding } from "../../../../../src/backend/storage/sqlite/profile-local-databases.js";
import * as http from "../../../../../src/backend/transports/http/http-server.js";
import { PublicProfileStateSchema } from "../../../../../src/models/profiles/public-profile.js";
import { LogoutOperationSchema,SignUpOperationSchema } from "../../../../../src/models/profiles/profile.js";
import { seedRegisteredSignupBrowser } from "../../../../support/helpers/browser/browser-roots.js";
import { systemClock } from "../../../../../src/rules/time/clock.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";
import { createBoundProfileFixture,syntheticOnboardingDuo } from "../../../../support/helpers/admission-fixture.js";
import { CANONICAL_WORKER_ID,createRunRecordServiceTestWorld } from "../../../../support/helpers/backend/run-record-service-world.js";
import { assertRuntimeLifetimeHeld,runtimeLifetimeLock } from "../../../../support/helpers/backend/runtime-lifetime.js";

vi.mock("../../../../../src/backend/transports/http/http-server.js", { spy: true });
vi.mock("../../../../../src/backend/storage/admission/admission.js", async importOriginal => {
  const actual = await importOriginal<typeof admissionOwner>();
  return { ...actual, acquireExclusiveRuntimeAdmission: vi.fn(actual.acquireExclusiveRuntimeAdmission) };
});
vi.mock("../../../../../src/backend/app/composition/dashboard/notifications.js", async importOriginal => {
  const actual = await importOriginal<typeof notificationOwner>();
  return { ...actual, createTrustNotifications: vi.fn(actual.createTrustNotifications) };
});
vi.mock("../../../../../src/backend/app/composition/dashboard/notification-health.js", async importOriginal => {
  const actual = await importOriginal<typeof notificationHealthOwner>();
  return { ...actual, readNotificationHealth: vi.fn(actual.readNotificationHealth) };
});
vi.mock("../../../../../src/backend/app/composition/profile-credential-inventory.js", async importOriginal => {
  const actual = await importOriginal<typeof credentialInventoryOwner>();
  return { ...actual, composeProfileClosureInventory: vi.fn(actual.composeProfileClosureInventory) };
});


import { inspectOpenDatabase } from "../../../../../src/backend/storage/sqlite/backup-inspection.js";
import { withReadonlyAuthoritySnapshot } from "../../../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";
import { StoppedAuthorityBackupManifestSchema } from "../../../../../src/backend/storage/sqlite/recovery-contracts.js";
import { createHistoricalRegisteredProfileFixture } from "../../../../support/fixtures/storage/historical-incomplete-profile-fixture.js";
import { FakeKeyringEntry } from "../../../../support/helpers/credential-keychain-fake.js";
import { runCredentialSourceRetentionCase } from "../../../../support/helpers/credential-source-retention.js";

import { initializeRegisteredPersonStores,RegisteredPersonUpgradeRefusedError,upgradeRegisteredPersonStores } from "../../../../../src/backend/app/composition/storage-compose.js";
import { AuthorityBackupService } from "../../../../../src/backend/storage/sqlite/backup-service.js";
import { migrationTableNames } from "../../../../../src/backend/storage/sqlite/migrations.js";

const login = { email: "fixture@ucsd.edu", password: "disposable-fixture-password" };
const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const hostFacts = { primaryDisplay: null };
/** One person's refused upgrade is a sign-in hold for that person, not a boot failure. */
async function assertStartupHeld(workspace: string, lifetime: RuntimeLifetimeLock, cause: (error: unknown) => boolean): Promise<void> {
  const machine = acquireEntrypointAdmission(workspace, "shared", lifetime);
  const runtime = composeProfileRuntime({ admission: machine, clock: systemClock, hostFacts });
  try {
    assert.throws(() => runtime.session.signIn({ ...login, at: systemClock.now().toISOString() }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "STORAGE_PROFILE_UPGRADE_REFUSED" && cause(error.cause));
  } finally { await runtime.close("shutdown"); machine.release(); }
}
function post(port: number) {
  return fetch(`http://127.0.0.1:${port}/api/v1/profile/sign-in`, { method: "POST", headers: {
    "content-type": "application/json", origin: `http://127.0.0.1:${port}`,
  }, body: JSON.stringify(login) });
}
function rows(path: string, version: number) {
  return withReadonlyAuthoritySnapshot(path, database => Object.fromEntries(migrationTableNames(version).filter(table => table !== "explorer_overrides")
    .map(table => [table, database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])));
}

it.each([8, 9, 10, 11, 12, 13] as const)("automatically upgrades registered schema %s before the first HTTP listener or sign-in", async sourceVersion => {
  const profile = await createHistoricalRegisteredProfileFixture({ sourceVersion });
  const machineRoot = join(profile.workspace, ".tracker", "data"), protectedPath = join(profile.stateRoot, "credentials", "protected.json");
  const keyPath = join(machineRoot, "machine", "credential-keys", `${profile.binding.profileId}.json`);
  const protectedBefore = digest(protectedPath), keyBefore = digest(keyPath), before = rows(profile.path, sourceVersion);
  const sourceBefore = withReadonlyAuthoritySnapshot(profile.path, database => inspectOpenDatabase(database, sourceVersion));
  const nativeKey = new FakeKeyringEntry("Relay", `${profile.binding.installationId}:${profile.binding.profileId}`).getPassword(); assert.ok(nativeKey);
  const actual = await vi.importActual<typeof http>("../../../../../src/backend/transports/http/http-server.js");
  let starts = 0, machine: RuntimeAdmission | undefined, application: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  const start = vi.spyOn(http, "startDashboardHttpServer").mockImplementation(input => { starts++; return actual.startDashboardHttpServer(input); });
  try {
    await upgradeRegisteredPersonStores(profile.workspace, profile.lifetime, hostFacts);
    assert.equal(starts, 0); assert.equal(readProfileDatabaseBinding(profile.path).schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    const after = rows(profile.path, sourceVersion);
    for (const [table, previous] of Object.entries(before)) {
      if (table === "runs") assert.deepEqual(after[table]?.map(row => ({ ...row })), previous.map(row => ({ ...row, pause_state: null })));
      else if (table === "database_states") assert.deepEqual(after[table]?.map(row => ({ ...row })), previous.map(row => ({ ...row, schema_version: CURRENT_AUTHORITY_SCHEMA_VERSION })));
      else if (table === "database_upgrades") assert.deepEqual(after[table]?.slice(0, previous.length), previous);
      else assert.deepEqual(after[table]?.map(row => prePreferencesSettingsRow(table, row)), previous.map(row => ({ ...row })));
    }
    assert.equal(after.database_upgrades?.length, (before.database_upgrades?.length ?? 0) + 1);
    assert.equal(digest(protectedPath), protectedBefore); assert.equal(digest(keyPath), keyBefore);
    const directory = join(profile.stateRoot, "backups", "authority"), names = readdirSync(directory).filter(name => name.endsWith(".manifest.json"));
    assert.equal(names.length, 1); const name = names[0]; assert.ok(name);
    const manifestBytes = readFileSync(join(directory, name)), manifest = StoppedAuthorityBackupManifestSchema.parse(JSON.parse(manifestBytes.toString("utf8")));
    const backupPath = join(directory, manifest.backupFileName), backupBytes = readFileSync(backupPath);
    const observed = withReadonlyAuthoritySnapshot(backupPath, database => inspectOpenDatabase(database, sourceVersion));
    for (const record of [manifest, manifest.verification, observed]) {
      assert.equal(record.schemaVersion, sourceVersion); assert.equal(record.installationId, profile.binding.installationId); assert.equal(record.profileId, profile.binding.profileId);
      assert.equal(record.authorityGeneration, sourceBefore.authorityGeneration); assert.equal(record.authorityContentFingerprint, sourceBefore.authorityContentFingerprint);
    }
    assert.equal(manifest.verification.observedFrom, "backup-copy"); assert.equal(manifest.verification.quickCheck, "ok");
    assert.equal(manifest.verification.foreignKeyViolations, 0); assert.deepEqual(manifest.verification.invariantViolations, []); assert.equal(manifest.verification.exactTableRegistry, true);
    assert.equal(manifest.byteSize, backupBytes.length); assert.equal(manifest.sha256, digest(backupPath));
    for (const bytes of [manifestBytes, backupBytes]) for (const secret of [Buffer.from(login.password), Buffer.from(nativeKey), Buffer.from(nativeKey, "base64")]) assert.equal(bytes.includes(secret), false);
    machine = acquireSharedRuntimeAdmission(profile.workspace, profile.lifetime);
    application = await composeDashboardApplication({ lifetimeLock: profile.lifetime, admission: machine, isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0, frontendPortOverride: 0, env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners });
    assert.equal(starts, 1);
    const response = await post(application.port); assert.equal(PublicProfileStateSchema.parse(await response.json()).state, "active"); assert.ok(response.headers.get("set-cookie"));
    await application.stop(); application = undefined; machine = undefined;
    await upgradeRegisteredPersonStores(profile.workspace, profile.lifetime, hostFacts);
    assert.equal(starts, 1);
    const retained = readdirSync(directory).filter(value => value.endsWith(".manifest.json"));
    assert.equal(retained.length, 2); assert.equal(retained.filter(value => value.endsWith(".shutdown.sqlite.manifest.json")).length, 1);
    assert.deepEqual(readFileSync(join(directory, name)), manifestBytes); assert.deepEqual(readFileSync(backupPath), backupBytes);
  } finally { start.mockRestore(); await application?.stop(); machine?.release(); await profile.close(); }
});

it("keeps failed pre-upgrade backups before HTTP, notification producers, account access and source mutation", async () => {
  const profile = await createHistoricalRegisteredProfileFixture({ sourceVersion: 8 }), before = readFileSync(profile.path);
  const notifications = vi.mocked(notificationOwner.createTrustNotifications); notifications.mockClear();
  const backup = vi.spyOn(AuthorityBackupService.prototype, "request").mockRejectedValueOnce(new Error("required-startup-backup-failed"));
  const network = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("account or HR transport forbidden before upgrade"); });
  const start = vi.spyOn(http, "startDashboardHttpServer");
  try {
    await upgradeRegisteredPersonStores(profile.workspace, profile.lifetime, hostFacts);
    await assertStartupHeld(profile.workspace, profile.lifetime, cause => cause instanceof RegisteredPersonUpgradeRefusedError
      && cause.cause instanceof Error && cause.cause.message === "required-startup-backup-failed");
    assert.deepEqual(readFileSync(profile.path), before); assert.equal(readProfileDatabaseBinding(profile.path).schemaVersion, 8);
    assert.equal(start.mock.calls.length, 0); assert.equal(network.mock.calls.length, 0); assert.equal(notifications.mock.calls.length, 0);
    const owner = acquireSharedRuntimeAdmission(profile.workspace, profile.lifetime); owner.release();
  } finally { backup.mockRestore(); network.mockRestore(); start.mockRestore(); await profile.close(); }
});

it("refuses an actual competing shared owner without backup or source effects", async () => {
  const profile = await createHistoricalRegisteredProfileFixture({ sourceVersion: 8 }), owner = acquireSharedRuntimeAdmission(profile.workspace, profile.lifetime), before = readFileSync(profile.path);
  try {
    await assert.rejects(upgradeRegisteredPersonStores(profile.workspace, profile.lifetime, hostFacts), RegisteredPersonUpgradeRefusedError);
    owner.assertLive(); assert.deepEqual(readFileSync(profile.path), before);
    assert.equal(existsSync(join(profile.stateRoot, "backups", "authority")), false); await assertRuntimeLifetimeHeld(profile.lifetime);
  } finally { owner.release(); await profile.close(); }
});

const retainedStartupOwners = new WeakMap<Error, {
  fixture: Awaited<ReturnType<typeof createBoundProfileFixture>>;
  runtime: ReturnType<typeof composeProfileRuntime>;
  blocker: ReturnType<typeof createServer>;
}>();

it("drains startup producers before inventory when the real HTTP listener cannot bind", async () => {
  const controllerLock=await runtimeLifetimeLock();
  const f = await createBoundProfileFixture({ lifetime: controllerLock });
  const runtime = composeProfileRuntime({ admission: f.machine, clock: systemClock, hostFacts: { primaryDisplay: null } });
  const actualHttp = await vi.importActual<typeof http>("../../../../../src/backend/transports/http/http-server.js");
  const actualNotifications = await vi.importActual<typeof notificationOwner>("../../../../../src/backend/app/composition/dashboard/notifications.js");
  const actualInventory = await vi.importActual<typeof credentialInventoryOwner>("../../../../../src/backend/app/composition/profile-credential-inventory.js");
  const createNotifications = actualNotifications.createTrustNotifications, createInventory = actualInventory.composeProfileClosureInventory;
  const startServer = actualHttp.startDashboardHttpServer, blocker = createServer();
  let releaseProducer: (() => void) | undefined, enterDrain: (() => void) | undefined;
  const producerRelease = new Promise<void>(resolve => { releaseProducer = resolve; });
  const drainEntered = new Promise<void>(resolve => { enterDrain = resolve; });
  let producerStopped = false, preparations = 0, starterCalls = 0, stops = 0;
  let startupPrimary: unknown, primary: { error: unknown } | undefined, sourceClosed = true;
  let startup: Promise<Awaited<ReturnType<typeof composeDashboardRuntime>>> | undefined;
  let unexpected: Awaited<ReturnType<typeof composeDashboardRuntime>> | undefined;
  const cleanupFailures: unknown[] = [];
  const notifications = vi.spyOn(notificationOwner, "createTrustNotifications").mockImplementation(input => {
    const owned = createNotifications(input);
    return { ...owned, observer: { ...owned.observer, async stop() {
      const completion = owned.observer.stop(); stops++; enterDrain?.();
      await completion; await producerRelease; producerStopped = true;
    } } };
  });
  const inventory = vi.spyOn(credentialInventoryOwner, "composeProfileClosureInventory").mockImplementation(input => {
    const owned = createInventory(input);
    return { ...owned, async prepare() {
      preparations++; assert.equal(producerStopped, true);
      await owned.prepare();
    } };
  });
  try {
    await new Promise<void>((resolve, reject) => {
      blocker.once("error", reject);
      blocker.listen(0, "127.0.0.1", () => { blocker.removeListener("error", reject); resolve(); });
    });
    const address = blocker.address(); assert.ok(address !== null && typeof address !== "string");
    sourceClosed = false;
    const active = runtime.session.signIn({ ...login, at: systemClock.now().toISOString() });
    assert.ok(active.state === "active");
    const context = runtime.selectedContext(active.token);
    startup = composeDashboardRuntime({ lifetimeLock: controllerLock, admission: f.machine, profile: { runtime, token: active.token }, isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0, frontendPortOverride: 0, env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners,
      httpServerStarter: async input => {
        starterCalls++;
        try { return await startServer({ ...input, port: address.port }); } catch (error) { startupPrimary = error; throw error; }
      } }).then(value => { unexpected = value; return value; });
    void startup.catch(() => undefined);
    await Promise.race([drainEntered, startup]);
    assert.equal(starterCalls, 1); assert.equal(stops, 1);
    assert.ok(startupPrimary instanceof Error); assert.equal(Reflect.get(startupPrimary, "code"), "EADDRINUSE");
    assert.equal(preparations, 0); assert.equal(context.database.getMeta().profileId, active.profileId);
    assert.ok(releaseProducer); releaseProducer();
    let failure: unknown;
    try { await startup; } catch (error) { failure = error; }
    assert.equal(failure, startupPrimary);
    assert.equal(producerStopped, true); assert.equal(preparations, 1);
    assert.throws(() => context.database.getMeta(), { message: "authority database is closed" });
    await assertRuntimeLifetimeHeld(controllerLock);
    sourceClosed = true;
  } catch (error) { primary = { error }; }
  finally {
    releaseProducer?.();
    if (startup !== undefined) {
      try { await startup; } catch (error) { if (error !== startupPrimary) cleanupFailures.push(error); }
    }
    if (unexpected !== undefined) {
      try { await unexpected.stop(); sourceClosed = true; } catch (error) { cleanupFailures.push(error); }
    }
    inventory.mockRestore(); notifications.mockRestore();
    if (blocker.listening) {
      try { await new Promise<void>((resolve, reject) => blocker.close(error => error === undefined ? resolve() : reject(error))); }
      catch (error) { sourceClosed = false; cleanupFailures.push(error); }
    }
    if (sourceClosed) {
      try { await runtime.close(); await f.close(); } catch (error) { sourceClosed = false; cleanupFailures.push(error); }
    }
  }
  const failures = [...(primary === undefined ? [] : [primary.error]), ...cleanupFailures];
  if (failures.length > 0) {
    const failure = failures.length === 1 && failures[0] instanceof Error ? failures[0]
      : new AggregateError(failures, "startup-producer-drain-failed", { cause: failures[0] });
    if (!sourceClosed) retainedStartupOwners.set(failure, { fixture: f, runtime, blocker });
    throw failure;
  }
});

it("keeps current sign-in ordinary with no maintenance authorization", async () => {
  const profile = await createBoundProfileFixture({ sharedMachine: true });
  const session = createProfileSession({ admission: profile.machine, machineRoot: profile.machine.stateRoot });
  try {
    const signed = session.signIn({ ...login, at: systemClock.now().toISOString() });
    assert.equal(signed.state, "active");
    assert.equal("upgrade" in signed, false);
    assert.equal(readProfileDatabaseBinding(profile.path).schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    assert.equal(existsSync(join(profile.stateRoot, "backups", "authority")), false);
  } finally { session.close(); await profile.close(); }
});


for (const scenario of ["key-close", "service-inspection", "binding-inspection", "unproved-close", "closed-publication-refusal"] as const) it(`retains actual startup source custody after ${scenario}`, async () => {
  await runCredentialSourceRetentionCase(`startup-upgrade-${scenario}`);
});

it("preserves a real UNKNOWN parked write, its fenced attempt and stopped worker history through automatic upgrade", async () => {
  const world = createRunRecordServiceTestWorld(), f = await world.fixture();
  let lifetime: RuntimeLifetimeLock | undefined;
  try {
    const running = world.runningRun(f.service, f.request, f.runtimeConfig);
    const intent = world.parkedWriteIntent(f.database, running, { writeIntentId: randomUUID(), code: "unknown", message: "External outcome remains unknown" });
    const parked = requireLifecycleApplied(f.service.workerTransition({ commandId: randomUUID(), runId: running.envelope.runId,
      claim: { workerId: CANONICAL_WORKER_ID, claimGeneration: running.claimGeneration }, lifecycle: { state: "parked-write",
        writeIntentId: intent.writeIntentId, intentGeneration: intent.generation, parkedAt: f.clock.now().toISOString(),
        code: "unknown", message: "External outcome remains unknown" } }));
    assert.equal(parked.lifecycle.state, "parked-write");
    const workspace = f.machine.readInstallationContext()?.workspace; assert.ok(workspace);
    const path = join(f.root, "state.db"), protectedPath = join(f.root, "credentials", "protected.json"), protectedBefore = digest(protectedPath);
    await f.closeController();
    const native = new DatabaseSync(path);
    try {
      native.exec("BEGIN EXCLUSIVE");
      restoreSchema18WorkbookReferenceFixture(native);
      removeEmptySchema18WorkbookCatalog(native);
      removeEmptySchema17OcrReview(native);
      removeSchema16PersonPreferences(native);
      removeSchema15RunPause(native);
      removeEmptyExclusiveSessionLeaseFixture(native);
      restoreEmptyPreMasterWorkbookFixture(native);
      restorePreReadingArtifactRetention(native);
      native.exec("UPDATE database_states SET schema_version=10 WHERE id=1; PRAGMA user_version=10; COMMIT");
    }
    finally { native.close(); }
    const before = rows(path, 10);
    assert.ok((before.write_intents?.length ?? 0) > 0); assert.ok((before.write_attempts?.length ?? 0) > 0);
    lifetime = await RuntimeLifetimeLock.acquire(0);
    await upgradeRegisteredPersonStores(workspace, lifetime, hostFacts);
    const after = rows(path, 10);
    for (const [table, previous] of Object.entries(before)) {
      if (table === "runs") assert.deepEqual(after[table]?.map(row => ({ ...row })), previous.map(row => ({ ...row, pause_state: null })));
      else if (table === "database_states") assert.deepEqual(after[table]?.map(row => ({ ...row })), previous.map(row => ({ ...row, schema_version: CURRENT_AUTHORITY_SCHEMA_VERSION })));
      else if (table === "database_upgrades") assert.deepEqual(after[table]?.slice(0, previous.length), previous);
      else assert.deepEqual(after[table]?.map(row => prePreferencesSettingsRow(table, row)), previous.map(row => ({ ...row })));
    }
    assert.equal(after.database_upgrades?.length, (before.database_upgrades?.length ?? 0) + 1);
    assert.equal(digest(protectedPath), protectedBefore);
  } finally { await lifetime?.close(); await world.cleanup(); }
});

it.each(["missing", "corrupt", "future", "foreign"] as const)("stops established %s person authority without an empty replacement or backup", async state => {
  const profile = await createHistoricalRegisteredProfileFixture({ sourceVersion: 8 });
  const keyPath = join(profile.workspace, ".tracker", "data", "machine", "credential-keys", `${profile.binding.profileId}.json`), keyBefore = readFileSync(keyPath);
  try {
    if (state === "missing") renameSync(profile.path, `${profile.path}.test-owned`);
    else if (state === "corrupt") writeFileSync(profile.path, "invalid SQLite person authority", { mode: 0o600 });
    else if (state === "foreign") {
      const foreign = await createHistoricalRegisteredProfileFixture({ sourceVersion: 8 });
      try { copyFileSync(foreign.path, profile.path); }
      finally { await foreign.close(); }
    }
    else {
      const database = new DatabaseSync(profile.path);
      try {
        database.exec(`PRAGMA user_version=${CURRENT_AUTHORITY_SCHEMA_VERSION + 1}`);
      } finally { database.close(); }
    }
    const before = existsSync(profile.path) ? readFileSync(profile.path) : undefined;
    await upgradeRegisteredPersonStores(profile.workspace, profile.lifetime, hostFacts);
    await assertStartupHeld(profile.workspace, profile.lifetime, cause => cause instanceof RegisteredPersonUpgradeRefusedError);
    assert.deepEqual(existsSync(profile.path) ? readFileSync(profile.path) : undefined, before);
    assert.deepEqual(readFileSync(keyPath), keyBefore); assert.equal(existsSync(join(profile.stateRoot, "backups", "authority")), false);
    await assertRuntimeLifetimeHeld(profile.lifetime);
  } finally { await profile.close(); }
});

function historicalTen(path: string): void {
  const database = new DatabaseSync(path);
  try {
    database.exec("BEGIN EXCLUSIVE");
    restoreSchema18WorkbookReferenceFixture(database);
    removeEmptySchema18WorkbookCatalog(database);
    removeEmptySchema17OcrReview(database);
    removeSchema16PersonPreferences(database);
    removeSchema15RunPause(database);
    removeEmptyExclusiveSessionLeaseFixture(database);
    restoreEmptyPreMasterWorkbookFixture(database);
    restorePreReadingArtifactRetention(database);
    database.exec("UPDATE database_states SET schema_version=10 WHERE id=1; PRAGMA user_version=10; COMMIT");
  }
  finally { database.close(); }
}

for (const move of [false, true]) for (const mode of ["interrupted", "unknown"] as const) it(
  `upgrades ${mode} work and held durable leases intact before current-format crash recovery (fixed layout: ${move})`, async () => {
    const world = createRunRecordServiceTestWorld(), f = await world.interruptedFixture({ nativePaths: move });
    const profileId = f.admission.profileBinding.profileId, workspace = f.machine.readInstallationContext()?.workspace; assert.ok(workspace);
    const intent = mode === "unknown" ? world.parkedWriteIntent(f.database, f.run, { writeIntentId: randomUUID(), code: "unknown", message: "Unresolved external write" }) : undefined;
    const heldWorker = f.database.authority.workerLeases.get(CANONICAL_WORKER_ID); assert.ok(heldWorker && isLiveWorker(heldWorker));
    if (move) {
      const custody = f.database.readProfileResourceCustody(), active = f.database.authority.runtimeConfig.get(); assert.ok(active);
      const snapshot = custody.configSnapshots.find(row => row.configSnapshotId === active.configSnapshotId); assert.ok(snapshot);
      const worker = heldWorker;
      const profileRoot = snapshot.config.paths.browserProfileRoot, profileDirectory = join(profileRoot, "w1", "ucpath");
      const launch = createBrowserRoots(f.admission).beginLaunch({ profileId, profileRoot, profileDirectory, credentialFingerprint: "b".repeat(64),
        owner: { kind: "worker", database: f.database, workerId: CANONICAL_WORKER_ID } });
      mkdirSync(profileDirectory, { recursive: true, mode: 0o700 }); launch.opened();
      f.database.authority.workerControls.observe({ workerId: CANONICAL_WORKER_ID, leaseGeneration: worker.leaseGeneration, sessionId: randomUUID(), system: "ucpath",
        configFingerprint: snapshot.fingerprint, signInFingerprint: "b".repeat(64), browserMode: "headless", profileDirectory,
        acceptDownloads: false, exclusive: true, health: "unknown", observedAt: f.clock.now().toISOString(), openedAt: f.clock.now().toISOString(), profileRevision: 1 });
    }
    const credentialKey = "ac".repeat(32);
    assert.equal(f.database.authority.duoCeremonyLeases.acquire({ credentialKey, workerId: CANONICAL_WORKER_ID, system: "ucpath", now: f.clock.now().toISOString(), ttlMs: 60_000 }).state, "acquired");
    const path = join(f.root, "state.db"), target = move ? realpathSync(mkdtempSync(join(tmpdir(), "startup-upgrade-layout-"))) : undefined;
    let currentPath = path, currentWorkspace = workspace;
    let lifetime: RuntimeLifetimeLock | undefined, machine: RuntimeAdmission | undefined, admission: RuntimeAdmission | undefined, database: AuthorityDatabase | undefined;
    try {
      await f.closeController(); historicalTen(path);
      const before = rows(path, 10);
      assert.ok(before.worker_leases?.some(row => row.worker_id === CANONICAL_WORKER_ID && row.state === heldWorker.lifecycle.state));
      lifetime = await RuntimeLifetimeLock.acquire(0);
      if (target === undefined) await upgradeRegisteredPersonStores(workspace, lifetime, hostFacts, f.clock);
      else {
        await prepareApplicationDataWorkspace(workspace, target, lifetime, hostFacts, f.clock);
        await upgradeRegisteredPersonStores(target, lifetime, hostFacts, f.clock);
        currentWorkspace = target; currentPath = join(target, ".tracker", "data", "profiles", profileId, "state.db");
      }
      const after = rows(currentPath, 10);
      for (const [table, previous] of Object.entries(before)) {
        if (move && table === "browser_sessions") {
          const plan = readFixedLayoutIntent(currentWorkspace)?.profiles.find(row => row.profileId === profileId); assert.ok(plan);
          assert.deepEqual(after[table]?.map(row => ({ ...row })), previous.map(row => {
            const browser = WorkerBrowserObservationSchema.parse(JSON.parse(String(row.payload_json)));
            const binding = plan.browserSnapshots.find(entry => entry.sourceFingerprint === browser.configFingerprint); assert.ok(binding && browser.profileDirectory);
            return { ...row, auth_fingerprint: binding.snapshot.fingerprint, payload_json: canonicalJsonStringify({ ...browser,
              profileDirectory: join(binding.snapshot.config.paths.browserProfileRoot, "w1", "ucpath"), configFingerprint: binding.snapshot.fingerprint }) };
          }));
          continue;
        }
        if (move && ["database_states", "settings", "run_search"].includes(table)) continue;
        if (table === "runs") assert.deepEqual(after[table]?.map(row => ({ ...row })), previous.map(row => ({ ...row, pause_state: null })));
        else if (table === "database_states") assert.deepEqual(after[table]?.map(row => ({ ...row })), previous.map(row => ({ ...row, schema_version: CURRENT_AUTHORITY_SCHEMA_VERSION })));
        else if (table === "database_upgrades" || move && ["commands", "command_audits", "settings_snapshots"].includes(table)) assert.deepEqual(after[table]?.slice(0, previous.length).map(row => prePreferencesSettingsRow(table, row)), previous.map(row => ({ ...row })));
        else assert.deepEqual(after[table]?.map(row => prePreferencesSettingsRow(table, row)), previous.map(row => ({ ...row })));
      }
      await initializeRegisteredPersonStores(currentWorkspace, lifetime, hostFacts, f.clock);
      machine = acquireSharedRuntimeAdmission(currentWorkspace, lifetime); admission = machine.admitProfile(profileId);
      database = AuthorityDatabase.open(admission, { path: currentPath, migrationOwner: "startup-upgrade-recovery", busyTimeoutMs: 250 }, f.clock,
        undefined, undefined, undefined, createCredentialStore({ admission, stateRoot: admission.stateRoot }));
      const recovered = database.authority.runs.get(f.run.envelope.runId); assert.ok(recovered);
      if (intent === undefined) assert.ok(recovered.lifecycle.state === "terminal" && recovered.lifecycle.outcome === "failed");
      else {
        assert.equal(recovered.lifecycle.state, "parked-write");
        assert.deepEqual(database.authority.writeIntents.get(intent.writeIntentId), intent);
      }
      assert.equal(database.authority.workerLeases.get(CANONICAL_WORKER_ID)?.lifecycle.state, "stopped");
    } finally { database?.close(); admission?.release(); machine?.release(); await lifetime?.close(); await world.cleanup(); if (target !== undefined) rmSync(target, { recursive: true, force: true }); }
  },
);

it("upgrades a pending sign-up database before onboarding recovery without publishing the person", async () => {
  const lifetime = await RuntimeLifetimeLock.acquire(0), f = await createBoundProfileFixture({ pending: "onboarding", lifetime });
  const draft = f.draft; assert.ok(draft?.state === "onboarding");
  const profileId = draft.profileId, operationPath = join(f.machine.stateRoot, "machine", "operations", `${draft.operationId}.json`);
  let machine: RuntimeAdmission | undefined, runtime: ReturnType<typeof composeProfileRuntime> | undefined;
  try {
    seedRegisteredSignupBrowser(f.machine, SignUpOperationSchema.parse(JSON.parse(readFileSync(operationPath, "utf8"))));
    await f.closeController(); historicalTen(f.path);
    const operation = readFileSync(operationPath), before = rows(f.path, 10);
    await upgradeRegisteredPersonStores(f.workspace, lifetime, hostFacts);
    assert.deepEqual(readFileSync(operationPath), operation);
    const after = rows(f.path, 10);
    for (const [table, previous] of Object.entries(before)) {
      if (table === "runs") assert.deepEqual(after[table]?.map(row => ({ ...row })), previous.map(row => ({ ...row, pause_state: null })));
      else if (table === "database_states") assert.deepEqual(after[table]?.map(row => ({ ...row })), previous.map(row => ({ ...row, schema_version: CURRENT_AUTHORITY_SCHEMA_VERSION })));
      else if (table === "database_upgrades") assert.deepEqual(after[table]?.slice(0, previous.length), previous);
      else assert.deepEqual(after[table]?.map(row => prePreferencesSettingsRow(table, row)), previous.map(row => ({ ...row })));
    }
    machine = acquireSharedRuntimeAdmission(f.workspace, lifetime);
    assert.equal(machine.readProfileRegistry().profiles.some(row => row.profileId === profileId), false);
    runtime = composeProfileRuntime({ admission: machine, clock: systemClock, hostFacts, onboardingDuo: syntheticOnboardingDuo() });
    await runtime.session.recoverOnboarding();
    assert.equal(existsSync(operationPath), false); assert.equal(existsSync(f.stateRoot), false);
    const resumed = runtime.session.signUp({ ...login, firstName: "Fixture", lastName: "Example", createdAt: new Date().toISOString() });
    assert.equal(resumed.state, "onboarding");
    assert.notEqual("profileId" in resumed ? resumed.profileId : undefined, profileId);
  } finally { await runtime?.close(); machine?.release(); await f.close(); await lifetime.close(); }
});

for (const [phase, move] of [["prepared", false], ["commit-intent", false], ["done", false], ["done", true]] as const) it(
  `converts pending logout ${phase} proof and resumes after interruption following the schema commit (fixed layout: ${move})`, async () => {
    let lifetime = await RuntimeLifetimeLock.acquire(0);
    const f = await createBoundProfileFixture({ lifetime });
    const profileId = f.admission.profileBinding.profileId;
    let source: AuthorityDatabase | undefined, sourceAdmission: RuntimeAdmission | undefined;
    const session = createProfileSession({ machineRoot: f.machine.stateRoot, admission: f.machine, clock: systemClock,
      activity: { hasUnquiescedWork: () => true }, prepareLogout: () => {
        assert.ok(source); return { source: source.capturePendingLogoutSource(), intentFailed(error) { throw error; } };
      } });
    let machine: RuntimeAdmission | undefined;
    let runtime: ReturnType<typeof composeProfileRuntime> | undefined;
    const target = move ? realpathSync(mkdtempSync(join(tmpdir(), "startup-logout-layout-"))) : undefined;
    const convert = vi.spyOn(AuthorityDatabase, "convertStartupUpgradeLogout");
    try {
      const active = session.signIn({ ...login, at: new Date().toISOString() }); assert.ok(active.state === "active");
      sourceAdmission = f.machine.admitProfile(profileId);
      source = AuthorityDatabase.open(sourceAdmission, { path: f.path, migrationOwner: "startup-logout-source", busyTimeoutMs: 250 }, systemClock,
        undefined, undefined, undefined, createCredentialStore({ admission: sourceAdmission, stateRoot: sourceAdmission.stateRoot }));
      const pending = session.logOut(active.token, { at: new Date().toISOString() }); assert.ok(pending.state === "cancelling" && pending.operationId);
      source.close(); historicalTen(f.path);
      let operationPath = join(f.machine.stateRoot, "machine", "operations", `${pending.operationId}.json`);
      const old = LogoutOperationSchema.parse(JSON.parse(readFileSync(operationPath, "utf8")));
      const fingerprint = withReadonlyAuthoritySnapshot(f.path, database => inspectOpenDatabase(database, 10).authorityContentFingerprint);
      const operation = LogoutOperationSchema.parse({ ...old, settlement: { phase, stoppedAt: old.at, processId: process.pid,
        before: phase === "done" ? "a".repeat(64) : fingerprint,
        ...(phase === "prepared" ? {} : { after: phase === "done" ? fingerprint : "b".repeat(64) }), requests: [], workers: [] } });
      f.machine.publishProfileOperation(operation);
      session.close(); sourceAdmission.release(); await f.closeController();
      await lifetime.close(); lifetime = await RuntimeLifetimeLock.acquire(0);
      convert.mockImplementationOnce(() => { throw new Error("interrupted-after-schema-commit"); });
      await upgradeRegisteredPersonStores(f.workspace, lifetime, hostFacts);
      assert.equal(readProfileDatabaseBinding(f.path).schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
      assert.deepEqual(LogoutOperationSchema.parse(JSON.parse(readFileSync(operationPath, "utf8"))), operation);
      convert.mockRestore();
      await upgradeRegisteredPersonStores(f.workspace, lifetime, hostFacts);
      const next = LogoutOperationSchema.parse(JSON.parse(readFileSync(operationPath, "utf8")));
      const { settlement: previousSettlement, ...previousIdentity } = operation, { settlement, ...identity } = next;
      assert.deepEqual(identity, previousIdentity); assert.ok(previousSettlement && settlement);
      const current = withReadonlyAuthoritySnapshot(f.path, database => inspectOpenDatabase(database, CURRENT_AUTHORITY_SCHEMA_VERSION).authorityContentFingerprint);
      assert.deepEqual(settlement.requests, previousSettlement.requests); assert.deepEqual(settlement.workers, previousSettlement.workers);
      assert.equal(settlement.phase, phase === "done" ? "done" : "prepared");
      assert.equal(phase === "done" ? settlement.after : settlement.before, current);
      assert.equal(readdirSync(join(f.stateRoot, "backups", "authority")).filter(name => name.endsWith(".manifest.json")).length, 1);
      let workspace = f.workspace, stateRoot = f.stateRoot;
      if (target !== undefined) {
        await prepareApplicationDataWorkspace(f.workspace, target, lifetime, hostFacts);
        workspace = target; stateRoot = join(target, ".tracker", "data", "profiles", profileId);
        operationPath = join(target, ".tracker", "data", "machine", "operations", `${pending.operationId}.json`);
        const layout = readFixedLayoutIntent(target);
        assert.ok(layout?.phase === "complete");
        const plan = layout.profiles.find(plan => plan.profileId === profileId); assert.ok(plan);
        assert.equal(plan.logout, undefined);
        assert.equal(existsSync(operationPath), false);
      }
      assert.equal(readdirSync(join(stateRoot, "backups", "authority")).filter(name => name.endsWith(".manifest.json")).length, move ? 2 : 1);
      machine = acquireSharedRuntimeAdmission(workspace, lifetime);
      if (move) assert.equal(machine.readProfileRegistry().activeProfileId, null);
      else {
        assert.equal(machine.readProfileRegistry().profiles.find(row => row.profileId === profileId)?.lifecycle, "cancelling");
        runtime = composeProfileRuntime({ admission: machine, clock: systemClock, hostFacts });
        assert.equal(runtime.session.resumeLogout(pending.operationId).state, "cancelling");
        await runtime.awaitClosurePreparation(profileId);
        assert.equal(runtime.session.resumeLogout(pending.operationId).state, "signed-out");
      }
      assert.equal(existsSync(operationPath), false);
      assert.equal(machine.readProfileRegistry().profiles.find(row => row.profileId === profileId)?.lifecycle, "ready");
    } finally { convert.mockRestore(); await runtime?.close(); source?.close(); sourceAdmission?.release(); session.close(); machine?.release(); await f.close(); await lifetime.close(); if (target !== undefined) rmSync(target, { recursive: true, force: true }); }
  },
);
