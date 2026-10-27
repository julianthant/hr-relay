import sourceFiles from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { AuthoritySourceClosureUnprovedError } from "../../../../../src/backend/storage/source-closure.js";
import * as credentialOwner from '../../../../../src/backend/storage/configuration/credential-store.js';
import * as profileSessionOwner from "../../../../../src/backend/profiles/profile-session.js";
import * as notificationOwner from "../../../../../src/backend/app/composition/dashboard/notifications.js";
import * as notificationHealthOwner from "../../../../../src/backend/app/composition/dashboard/notification-health.js";
import * as credentialInventoryOwner from "../../../../../src/backend/app/composition/profile-credential-inventory.js";
import * as runtimeLocks from "../../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import * as readonlySource from "../../../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";
import * as admissionOwner from "../../../../../src/backend/storage/admission/admission.js";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it, vi } from "vitest";
import { composeDashboardApplication, composeDashboardRuntime } from "../../../../../src/backend/app/composition/dashboard/compose.js";
import * as http from "../../../../../src/backend/transports/http/http-server.js";
import { acquireSharedRuntimeAdmission, acquireExclusiveRuntimeAdmission, ProfileUpgradeSourceRefusalError, type RuntimeAdmission } from "../../../../../src/backend/storage/admission/admission.js";
import { AuthorityDatabase, inspectNativeAuthority } from "../../../../../src/backend/storage/sqlite/authority-database.js";
import { readProfileDatabaseBinding } from "../../../../../src/backend/storage/sqlite/profile-local-databases.js";
import { createProfileSession, consumeAuthenticatedProfileUpgrade } from "../../../../../src/backend/profiles/profile-session.js";
import { ProfileSessionRefusedError } from "../../../../../src/backend/profiles/profile-errors.js";
import { createProfileVerifiers } from "../../../../../src/backend/profiles/verifier-store.js";
import { createBoundProfileFixture, boundProfileCredentials } from "../../../../support/helpers/admission-fixture.js";
import { createSettingsApplicationExecutor } from "../../../../../src/backend/runs/commands/settings-service.js";
import { executeSettingsCommand } from "../../../../../src/backend/runs/commands/command-kernel.js";
import { readSettings, readBootSettings } from "../../../../../src/backend/runtime/settings/settings-runtime.js";
import { resolveConfigWithProvenance } from "../../../../../src/backend/app/config/resolve.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint } from "../../../../../src/models/config/settings.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../../src/rules/identity/ids.js";
import { systemClock } from "../../../../../src/rules/time/clock.js";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { SignUpOperationSchema } from "../../../../../src/models/profiles/profile.js";
import { PublicProfileStateSchema } from "../../../../../src/models/profiles/public-profile.js";
import { RuntimeCustodyUncertainError, composeProfileRuntime } from "../../../../../src/backend/app/composition/storage-compose.js";
import { runtimeProcessLockIsActive } from "../../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../../src/backend/storage/sqlite/migrations.js";

vi.mock("../../../../../src/backend/transports/http/http-server.js", { spy: true });
vi.mock("../../../../../src/backend/storage/admission/admission.js", async importOriginal => {
  const actual = await importOriginal<typeof admissionOwner>();
  return { ...actual, acquireExclusiveRuntimeAdmission: vi.fn(actual.acquireExclusiveRuntimeAdmission) };
});
vi.mock("../../../../../src/backend/storage/sqlite/runtime-process-locks.js", async importOriginal => {
  const actual = await importOriginal<typeof runtimeLocks>();
  return { ...actual, acquireRuntimeRestoreAdmission: vi.fn(actual.acquireRuntimeRestoreAdmission) };
});
vi.mock("../../../../../src/backend/profiles/profile-session.js", async importOriginal => {
  const actual = await importOriginal<typeof profileSessionOwner>();
  return { ...actual, consumeAuthenticatedProfileUpgrade: vi.fn(actual.consumeAuthenticatedProfileUpgrade) };
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
  return { ...actual, composeProfileCredentialInventory: vi.fn(actual.composeProfileCredentialInventory) };
});

const createSnapshot = readonlySource.createReadonlyAuthoritySnapshot;
const inspectStopped = AuthorityDatabase.inspectStoppedUpgrade.bind(AuthorityDatabase);

const login = { email: "fixture@example.edu", password: "disposable-fixture-password" };
const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
function priorEight() {
  const profile = createBoundProfileFixture();
  const binding = profile.admission.profileBinding;
  const credentials = boundProfileCredentials(profile.admission);
  const database = AuthorityDatabase.open(profile.admission, { path: profile.path, busyTimeoutMs: 250, migrationOwner: "selected-profile-runtime" }, systemClock, undefined, undefined, undefined, credentials);
  try {
    const patch = { "actor.label": { set: "Upgrade fixture" } };
    const resolveSettings = (value: unknown) => resolveConfigWithProvenance(value, { primaryDisplay: null }, systemClock,
      { stateRoot: profile.stateRoot, artifactRoot: profile.admission.artifactRoot });
    database.withAuthorityTransaction(repositories => {
      const initial = readBootSettings(repositories);
      assert.equal(repositories.runtimeConfig.get(), undefined);
      const resolved = resolveSettings(initial.settings);
      repositories.runtimeConfig.initialize({ configSnapshotId: randomUUID(), revision: initial.revision,
        fingerprint: resolved.fingerprint, capturedAt: systemClock.now().toISOString(), capturedBy: LOCAL_OPERATOR_ACTOR_ID,
        config: resolved.config, provenance: resolved.provenance });
    });
    const settings = createSettingsApplicationExecutor(resolveSettings, credentials);
    const result = executeSettingsCommand({ authority: database, clock: systemClock, ids: { uuid: randomUUID }, settings }, {
      commandId: randomUUID(), family: "settings", type: "apply-settings", requestedAt: systemClock.now().toISOString(), requestedBy: LOCAL_OPERATOR_ACTOR_ID,
      source: "settings-surface", target: { expectedRevision: readSettings(database.authority).revision },
      payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch },
    });
    assert.equal(result.state, "applied");
  } finally { database.close(); }
  profile.admission.release();
  // Synthetic current-to-prior8 layout; not prior-producer proof.
  const raw = new DatabaseSync(profile.path);
  try {
    raw.exec("PRAGMA foreign_keys=ON");
    assert.equal(raw.prepare("SELECT count(*) AS count FROM assistant_model_preference").get()?.count, 0);
    raw.exec("BEGIN EXCLUSIVE; DROP TABLE assistant_model_preference; UPDATE database_states SET schema_version=8 WHERE id=1; PRAGMA user_version=8; COMMIT");
    const prior = inspectNativeAuthority(raw, 8);
    assert.equal(prior.schemaVersion, 8);
    assert.equal(prior.installationId, binding.installationId);
    assert.equal(prior.profileId, binding.profileId);
  } finally { raw.close(); }

  profile.machine.release();
  const machine = acquireSharedRuntimeAdmission(profile.workspace);
  return { profile, binding, machine };
}
function post(port: number) {
  return fetch(`http://127.0.0.1:${port}/api/v1/profile/sign-in`, { method: "POST", headers: {
    "content-type": "application/json", origin: `http://127.0.0.1:${port}`,
  }, body: JSON.stringify(login) });
}

const retainedPositiveOwners = new WeakMap<Error, {
  application: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  fixture: ReturnType<typeof priorEight>;
}>();

it("commits authenticated refusal, stops, upgrades with backup, restarts the public shell and requires fresh sign-in", async () => {
  const f = priorEight();
  const protectedPath = join(f.profile.stateRoot, "credentials", "protected.json");
  const keyPath = join(f.machine.stateRoot, "machine", "credential-keys", `${f.binding.profileId}.json`);
  const protectedBefore = digest(protectedPath), keyBefore = digest(keyPath);
  const actual = await vi.importActual<typeof http>("../../../../../src/backend/transports/http/http-server.js");
  let starts = 0, resolveRestart: (() => void) | undefined;
  const restarted = new Promise<void>(resolve => { resolveRestart = resolve; });
  const start = vi.spyOn(http, "startDashboardHttpServer").mockImplementation(async input => {
    const listener = await actual.startDashboardHttpServer(input);
    starts++;
    if (starts === 2) resolveRestart?.();
    return listener;
  });
  let application: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  let primary: { error: unknown } | undefined;
  let closureProved = false;
  const cleanupFailures: unknown[] = [];
  try {
    application = await composeDashboardApplication({ admission: f.machine, isolation: rebuildRuntimeIsolation, backendPortOverride: 0,
      frontendPortOverride: 0, env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners });
    const response = await post(application.port);
    assert.deepEqual(PublicProfileStateSchema.parse(await response.json()), { state: "refused", code: "PROFILE_UPGRADE_STARTING" });
    assert.equal(response.headers.has("set-cookie"), false);
    await Promise.race([restarted, application.failure]);
    assert.equal(starts, 2);
    assert.equal(readProfileDatabaseBinding(f.profile.path).schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    assert.equal(digest(protectedPath), protectedBefore); assert.equal(digest(keyPath), keyBefore);
    assert.ok(readdirSync(join(f.profile.stateRoot, "backups", "authority")).some(name => name.endsWith(".manifest.json")));
    const signedOut = await fetch(`http://127.0.0.1:${application.port}/api/v1/profile/state`);
    assert.deepEqual(PublicProfileStateSchema.parse(await signedOut.json()), { state: "signed-out" });
    const fresh = await post(application.port);
    assert.equal(PublicProfileStateSchema.parse(await fresh.json()).state, "active");
    assert.ok(fresh.headers.get("set-cookie"));
    await application.stop(); application = undefined;
  } catch (error) { primary = { error }; }
  finally {
    try { start.mockRestore(); } catch (error) { cleanupFailures.push(error); }
    try {
      if (application !== undefined) { await application.stop(); closureProved = true; }
      else if (primary === undefined) closureProved = true;
    } catch (error) { cleanupFailures.push(error); }
    if (closureProved) {
      try { f.machine.release(); } catch (error) { closureProved = false; cleanupFailures.push(error); }
      if (closureProved) {
        try { f.profile.close(); } catch (error) { closureProved = false; cleanupFailures.push(error); }
      }
    }
  }
  const failures = [...(primary === undefined ? [] : [primary.error]), ...cleanupFailures];
  if (failures.length > 0) {
    const failure = failures.length === 1 && failures[0] instanceof Error ? failures[0]
      : new AggregateError(failures, "authenticated-upgrade-positive-failed", { cause: failures[0] });
    if (!closureProved) retainedPositiveOwners.set(failure, { application, fixture: f });
    throw failure;
  }
});

it("drains the actual notification health writer before preparing profile inventory", async () => {
  const f = priorEight();
  const actualHttp = await vi.importActual<typeof http>("../../../../../src/backend/transports/http/http-server.js");
  const actualNotifications = await vi.importActual<typeof notificationOwner>("../../../../../src/backend/app/composition/dashboard/notifications.js");
  const actualHealth = await vi.importActual<typeof notificationHealthOwner>("../../../../../src/backend/app/composition/dashboard/notification-health.js");
  const actualInventory = await vi.importActual<typeof credentialInventoryOwner>("../../../../../src/backend/app/composition/profile-credential-inventory.js");
  const startServer = actualHttp.startDashboardHttpServer;
  const createNotifications = actualNotifications.createTrustNotifications;
  const readHealth = actualHealth.readNotificationHealth;
  const createInventory = actualInventory.composeProfileCredentialInventory;
  let resolveRestart: (() => void) | undefined, resolveReading: (() => void) | undefined;
  let releaseReading: (() => void) | undefined, resolveDrain: (() => void) | undefined;
  const restarted = new Promise<void>(resolve => { resolveRestart = resolve; });
  const readingEntered = new Promise<void>(resolve => { resolveReading = resolve; });
  const readingRelease = new Promise<void>(resolve => { releaseReading = resolve; });
  const drainEntered = new Promise<void>(resolve => { resolveDrain = resolve; });
  let starts = 0, preparations = 0;
  let writerDatabase: AuthorityDatabase | undefined, readingFailure: { error: unknown } | undefined;
  const health = vi.spyOn(notificationHealthOwner, "readNotificationHealth").mockImplementation(async input => {
    try {
      const reading = await readHealth(input);
      assert.equal(input.database.getMeta().profileId, f.binding.profileId);
      assert.equal(reading.backupFailed, false);
      assert.equal(reading.integrityFailed, false);
      assert.equal(writerDatabase, undefined);
      writerDatabase = input.database;
      assert.equal(writerDatabase.authority.notificationHealth.get("wal-growth"), undefined);
      resolveReading?.();
      await readingRelease;
      return reading;
    } catch (error) { readingFailure = { error }; resolveReading?.(); throw error; }
  });
  const notifications = vi.spyOn(notificationOwner, "createTrustNotifications").mockImplementation(input => {
    const owned = createNotifications(input);
    return { ...owned, observer: { ...owned.observer, stop() {
      const completion = owned.observer.stop();
      resolveDrain?.();
      return completion;
    } } };
  });
  const inventory = vi.spyOn(credentialInventoryOwner, "composeProfileCredentialInventory").mockImplementation(input => {
    const owned = createInventory(input);
    return { ...owned, async prepare() {
      preparations++;
      assert.equal(input.database, writerDatabase);
      const written = input.database.authority.notificationHealth.get("wal-growth");
      assert.ok(written);
      assert.equal(written.samples.length, 1);
      await owned.prepare();
    } };
  });
  const start = vi.spyOn(http, "startDashboardHttpServer").mockImplementation(async input => {
    const listener = await startServer(input);
    starts++;
    if (starts === 2) resolveRestart?.();
    return listener;
  });
  let application: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  let primary: { error: unknown } | undefined, closureProved = false;
  const cleanupFailures: unknown[] = [];
  try {
    application = await composeDashboardApplication({ admission: f.machine, isolation: rebuildRuntimeIsolation, backendPortOverride: 0,
      frontendPortOverride: 0, env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners });
    const response = await post(application.port);
    assert.deepEqual(PublicProfileStateSchema.parse(await response.json()), { state: "refused", code: "PROFILE_UPGRADE_STARTING" });
    await Promise.race([restarted, application.failure]);
    assert.equal(starts, 2);
    assert.ok(readdirSync(join(f.profile.stateRoot, "backups", "authority")).some(name => name.endsWith(".manifest.json")));
    const signed = await post(application.port);
    assert.equal(PublicProfileStateSchema.parse(await signed.json()).state, "active");
    await readingEntered;
    if (readingFailure !== undefined) throw readingFailure.error;
    assert.ok(writerDatabase);
    const stopping = application.stop();
    void stopping.catch(() => undefined);
    await drainEntered;
    assert.equal(preparations, 0);
    assert.equal(writerDatabase.authority.notificationHealth.get("wal-growth"), undefined);
    assert.ok(releaseReading); releaseReading();
    await stopping;
    application = undefined;
    closureProved = true;
    assert.equal(preparations, 1);
  } catch (error) { primary = { error }; }
  finally {
    releaseReading?.();
    try {
      if (application !== undefined) { await application.stop(); closureProved = true; }
    } catch (error) { cleanupFailures.push(error); }
    start.mockRestore(); inventory.mockRestore(); notifications.mockRestore(); health.mockRestore();
    if (closureProved) {
      try { f.machine.release(); } catch (error) { closureProved = false; cleanupFailures.push(error); }
      if (closureProved) {
        try { f.profile.close(); } catch (error) { closureProved = false; cleanupFailures.push(error); }
      }
    }
  }
  const failures = [...(primary === undefined ? [] : [primary.error]), ...cleanupFailures];
  if (failures.length > 0) {
    const failure = failures.length === 1 && failures[0] instanceof Error ? failures[0]
      : new AggregateError(failures, "notification-writer-drain-failed", { cause: failures[0] });
    if (!closureProved) retainedPositiveOwners.set(failure, { application, fixture: f });
    throw failure;
  }
});

it("retains credential source custody when authenticated upgrade capture cannot close its real key descriptor", async () => {
  const f = priorEight();
  const keyPath = join(f.machine.stateRoot, "machine", "credential-keys", `${f.binding.profileId}.json`);
  const keyIdentity = lstatSync(keyPath), root = join(f.profile.workspace, rebuildRuntimeIsolation.processLockRoot);
  const captureReady = credentialOwner.captureReadyUpgradeCredentialSource;
  const acquireProcess = runtimeLocks.acquireRuntimeProcessLock;
  const actualHttp = await vi.importActual<typeof http>('../../../../../src/backend/transports/http/http-server.js');
  const startServer = actualHttp.startDashboardHttpServer, actualClose = sourceFiles.closeSync;
  const sourceTree = () => readdirSync(f.machine.stateRoot, { recursive: true, encoding: 'utf8' }).sort().map(name => {
    const path = join(f.machine.stateRoot, name), info = lstatSync(path);
    return { name, dev: info.dev, ino: info.ino, mode: info.mode, uid: info.uid,
      ...(info.isFile() ? { digest: digest(path) } : {}) };
  });
  const before = sourceTree(), injected = new Error('authenticated-credential-source-close-refused');
  let phase = false, captures = 0, closes = 0, starts = 0, transportClosed = false;
  let descriptor: number | undefined, serverRole: ReturnType<typeof acquireProcess> | undefined;
  let capturedFailure: unknown;
  const capture = vi.spyOn(credentialOwner, 'captureReadyUpgradeCredentialSource').mockImplementation((...args) => {
    captures++; phase = true;
    try { return captureReady(...args); }
    catch (error) { capturedFailure = error; throw error; }
    finally { phase = false; }
  });
  const processOwner = vi.spyOn(runtimeLocks, 'acquireRuntimeProcessLock').mockImplementation((...args) => {
    const owner = acquireProcess(...args);
    if (owner.name === 'server') { assert.equal(serverRole, undefined); serverRole = owner; }
    return owner;
  });
  const close = vi.spyOn(sourceFiles, 'closeSync').mockImplementation(fd => {
    if (phase) {
      const identity = sourceFiles.fstatSync(fd);
      if (identity.dev === keyIdentity.dev && identity.ino === keyIdentity.ino) {
        assert.equal(descriptor, undefined); descriptor = fd; closes++; throw injected;
      }
    }
    actualClose(fd);
  });
  syncBuiltinESMExports();
  const start = vi.spyOn(http, 'startDashboardHttpServer').mockImplementation(async input => {
    const listener = await startServer(input); starts++;
    return { ...listener, async close() { await listener.close(); transportClosed = true; } };
  });
  let application: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  let primary: { error: unknown } | undefined, released = false;
  const cleanupFailures: unknown[] = [];
  try {
    application = await composeDashboardApplication({ admission: f.machine, isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0, frontendPortOverride: 0, env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners });
    const liveBefore = sourceTree();
    for (const original of before) assert.deepEqual(liveBefore.find(entry => entry.name === original.name), original);
    const response = await post(application.port);
    assert.equal(response.status, 500);
    assert.deepEqual(PublicProfileStateSchema.parse(await response.json()), { state: 'error', code: 'INTERNAL_FAILURE' });
    assert.equal(response.headers.has('set-cookie'), false);
    assert.equal(captures, 1); assert.equal(closes, 1); assert.equal(starts, 1);
    assert.ok(descriptor !== undefined); assert.ok(serverRole);
    assert.equal(sourceFiles.fstatSync(descriptor).dev, keyIdentity.dev);
    assert.equal(sourceFiles.fstatSync(descriptor).ino, keyIdentity.ino);
    f.machine.assertLive(); assert.equal(runtimeProcessLockIsActive(root, 'server'), true);
    const stopped = application.stop(); assert.equal(application.stop(), stopped);
    let failure: unknown;
    try { await stopped; } catch (error) { failure = error; }
    assert.ok(failure instanceof RuntimeCustodyUncertainError);
    assert.equal(failure.errors.length, 1); assert.equal(failure.errors[0], failure.cause);
    assert.equal(failure.cause, capturedFailure);
    assert.ok(failure.cause instanceof AuthoritySourceClosureUnprovedError);
    assert.deepEqual(failure.cause.errors, [injected]); assert.equal(failure.cause.cause, injected);
    await assert.rejects(application.stop(), error => error === failure);
    assert.equal(transportClosed, true); assert.equal(starts, 1); assert.equal(closes, 1);
    f.machine.assertLive(); assert.equal(runtimeProcessLockIsActive(root, 'server'), true);
    assert.throws(() => acquireExclusiveRuntimeAdmission(f.profile.workspace));
    assert.deepEqual(sourceTree(), liveBefore);
    assert.equal(sourceFiles.fstatSync(descriptor).dev, keyIdentity.dev);
    assert.equal(sourceFiles.fstatSync(descriptor).ino, keyIdentity.ino);
    capture.mockRestore(); processOwner.mockRestore(); close.mockRestore(); syncBuiltinESMExports(); start.mockRestore();
    actualClose(descriptor);
    const held = descriptor;
    assert.throws(() => sourceFiles.fstatSync(held), error => error instanceof Error && Reflect.get(error, 'code') === 'EBADF');
    assert.deepEqual(sourceTree(), liveBefore);
    serverRole.release(); assert.equal(runtimeProcessLockIsActive(root, 'server'), false);
    f.machine.release(); f.profile.close(); released = true;
  } catch (error) { primary = { error }; }
  finally {
    capture.mockRestore(); processOwner.mockRestore(); close.mockRestore(); syncBuiltinESMExports(); start.mockRestore();
    if (!released && application !== undefined) {
      try { await application.stop(); } catch (error) { if (primary?.error !== error) cleanupFailures.push(error); }
    }
  }
  const failures = [...(primary === undefined ? [] : [primary.error]), ...cleanupFailures];
  if (failures.length > 0) {
    const failure = failures.length === 1 && failures[0] instanceof Error ? failures[0]
      : new AggregateError(failures, 'credential-source-custody-test-failed', { cause: failures[0] });
    if (!released) retainedPositiveOwners.set(failure, { application, fixture: f });
    throw failure;
  }
});

const retainedStartupOwners = new WeakMap<Error, {
  fixture: ReturnType<typeof createBoundProfileFixture>;
  runtime: ReturnType<typeof composeProfileRuntime>;
  blocker: ReturnType<typeof createServer>;
}>();

it("drains startup producers before inventory when the real HTTP listener cannot bind", async () => {
  const f = createBoundProfileFixture();
  const runtime = composeProfileRuntime({ admission: f.machine, clock: systemClock, hostFacts: { primaryDisplay: null },
    processLockRoot: join(f.workspace, rebuildRuntimeIsolation.processLockRoot) });
  const actualHttp = await vi.importActual<typeof http>("../../../../../src/backend/transports/http/http-server.js");
  const actualNotifications = await vi.importActual<typeof notificationOwner>("../../../../../src/backend/app/composition/dashboard/notifications.js");
  const actualInventory = await vi.importActual<typeof credentialInventoryOwner>("../../../../../src/backend/app/composition/profile-credential-inventory.js");
  const createNotifications = actualNotifications.createTrustNotifications, createInventory = actualInventory.composeProfileCredentialInventory;
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
  const inventory = vi.spyOn(credentialInventoryOwner, "composeProfileCredentialInventory").mockImplementation(input => {
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
    startup = composeDashboardRuntime({ admission: f.machine, profile: { runtime, token: active.token }, isolation: rebuildRuntimeIsolation,
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
    assert.equal(runtimeProcessLockIsActive(join(f.workspace, rebuildRuntimeIsolation.processLockRoot), "server"), false);
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
      try { await runtime.close(); f.close(); } catch (error) { sourceClosed = false; cleanupFailures.push(error); }
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

for (const control of ["wrong-password", "locked", "forged", "reused", "verifier-change", "source-replaced"] as const) it(`refuses ${control} without ordinary admission or operation creation`, () => {
  const f = priorEight();
  let exclusive: RuntimeAdmission | undefined;
  let proved = false;
  const session = createProfileSession({ admission: f.machine, machineRoot: f.machine.stateRoot });
  const operations = join(f.machine.stateRoot, "machine", "operations");
  const before = readdirSync(operations);
  try {
    const verifiers = createProfileVerifiers(f.machine.stateRoot);
    if (control === "locked") for (let index = 0; index < 20; index++) verifiers.recordFailure(f.binding.profileId, Date.now());
    const result = session.signIn({ ...login, password: control === "wrong-password" ? "not-the-fixture-password" : login.password,
      at: systemClock.now().toISOString() });
    assert.equal(result.state, "refused");
    assert.deepEqual(readdirSync(operations), before);
    assert.equal(readProfileDatabaseBinding(f.profile.path).schemaVersion, 8);
    if (control === "wrong-password" || control === "locked") {
      assert.equal("upgrade" in result, false);
      assert.ok("code" in result); assert.equal(result.code, "PROFILE_SIGN_IN_REFUSED");
      proved = true; return;
    }
    assert.ok("upgrade" in result);
    const authorization = result.upgrade;
    if (control === "verifier-change") verifiers.recordFailure(f.binding.profileId, Date.now());
    if (control === "source-replaced") {
      const replacement = `${f.profile.path}.replacement`; copyFileSync(f.profile.path, replacement); renameSync(replacement, f.profile.path);
    }
    session.close(); f.machine.release();
    const owner = acquireExclusiveRuntimeAdmission(f.profile.workspace);
    exclusive = owner;
    if (control === "forged") {
      assert.throws(() => consumeAuthenticatedProfileUpgrade({ ...authorization }, owner), error => error instanceof ProfileSessionRefusedError && error.code === "PROFILE_UPGRADE_UNAVAILABLE");
      proved = true; return;
    }
    if (control === "verifier-change" || control === "source-replaced") {
      assert.throws(() => consumeAuthenticatedProfileUpgrade(authorization, owner), { message: control === "verifier-change"
        ? "runtime-control: profile-upgrade-handoff-authority-changed" : "profile-upgrade-handoff-source-changed" });
      proved = true; return;
    }
    assert.equal(consumeAuthenticatedProfileUpgrade(authorization, owner).phase, "runtime");
    assert.throws(() => consumeAuthenticatedProfileUpgrade(authorization, owner), error => error instanceof ProfileSessionRefusedError && error.code === "PROFILE_UPGRADE_UNAVAILABLE");
    proved = true;
  } finally { if (proved) { session.close(); exclusive?.release(); f.machine.release(); f.profile.close(); } }
});

it("keeps current sign-in ordinary with no maintenance authorization", () => {
  const profile = createBoundProfileFixture({ sharedMachine: true });
  const session = createProfileSession({ admission: profile.machine, machineRoot: profile.machine.stateRoot });
  try {
    const signed = session.signIn({ ...login, at: systemClock.now().toISOString() });
    assert.equal(signed.state, "active");
    assert.equal("upgrade" in signed, false);
    assert.equal(readProfileDatabaseBinding(profile.path).schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    assert.equal(existsSync(join(profile.stateRoot, "backups", "authority")), false);
  } finally { session.close(); profile.close(); }
});

it("surfaces an actual restart failure after exclusive readback without claiming an authenticated session", async () => {
  const f = priorEight();
  const actual = await vi.importActual<typeof http>("../../../../../src/backend/transports/http/http-server.js");
  const injected = new Error("upgrade restart injected");
  let starts = 0;
  const start = vi.spyOn(http, "startDashboardHttpServer").mockImplementation(async input => {
    starts++; if (starts === 2) throw injected;
    return actual.startDashboardHttpServer(input);
  });
  let application: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  let proved = false;
  try {
    application = await composeDashboardApplication({ admission: f.machine, isolation: rebuildRuntimeIsolation, backendPortOverride: 0,
      frontendPortOverride: 0, env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners });
    const response = await post(application.port);
    assert.deepEqual(PublicProfileStateSchema.parse(await response.json()), { state: "refused", code: "PROFILE_UPGRADE_STARTING" });
    assert.equal(response.headers.has("set-cookie"), false);
    let failure: unknown;
    try { await application.failure; } catch (error) { failure = error; }
    assert.ok(failure instanceof RuntimeCustodyUncertainError);
    assert.equal(failure.errors.length, 1); assert.equal(failure.errors[0], injected); assert.equal(failure.cause, injected);
    await assert.rejects(application.stop(), error => error === failure);
    assert.equal(starts, 2);
    assert.equal(readProfileDatabaseBinding(f.profile.path).schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    assert.equal(runtimeProcessLockIsActive(join(f.profile.workspace, rebuildRuntimeIsolation.processLockRoot), "server"), false);
    proved = true;
  } finally { start.mockRestore(); if (proved) { f.machine.release(); f.profile.close(); } }
});

it("preserves an existing canonical applying operation and refuses ready prior upgrade authority", () => {
  const f = priorEight();
  const session = createProfileSession({ admission: f.machine, machineRoot: f.machine.stateRoot });
  const row = f.machine.readProfileRegistry().profiles.find(value => value.profileId === f.binding.profileId); assert.ok(row);
  const operation = SignUpOperationSchema.parse({ schemaVersion: 1, kind: "sign-up", operationId: randomUUID(), profileId: row.profileId,
    commandId: randomUUID(), writeId: randomUUID(), emailKey: createProfileVerifiers(f.machine.stateRoot).emailKeyFor(login.email),
    firstName: row.firstName, lastName: row.lastName, createdAt: systemClock.now().toISOString(), commandFingerprint: "c".repeat(64), phase: "applying" });
  f.machine.publishProfileOperation(operation);
  const path = join(f.machine.stateRoot, "machine", "operations", `${operation.operationId}.json`), before = readFileSync(path);
  let proved = false;
  try {
    assert.throws(() => session.signIn({ ...login, at: systemClock.now().toISOString() }), error => error instanceof ProfileUpgradeSourceRefusalError && error.code === "PROFILE_UPGRADE_UNAVAILABLE");
    assert.deepEqual(readFileSync(path), before);
    assert.equal(readProfileDatabaseBinding(f.profile.path).schemaVersion, 8);
    proved = true;
  } finally { if (proved) { f.machine.publishProfileOperation(operation.operationId); session.close(); f.machine.release(); f.profile.close(); } }
});

it("rejects a genuine foreign installation after authentication without granting either profile admission", () => {
  const f = priorEight(), foreign = createBoundProfileFixture();
  const session = createProfileSession({ admission: f.machine, machineRoot: f.machine.stateRoot });
  let proved = false;
  try {
    const result = session.signIn({ ...login, at: systemClock.now().toISOString() }); assert.ok("upgrade" in result);
    session.close(); f.machine.release();
    assert.throws(() => consumeAuthenticatedProfileUpgrade(result.upgrade, foreign.machine), { message: "runtime-control: profile-upgrade-handoff-installation-changed" });
    assert.equal(readProfileDatabaseBinding(f.profile.path).schemaVersion, 8);
    assert.equal(readProfileDatabaseBinding(foreign.path).schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    assert.equal(existsSync(join(f.profile.stateRoot, "backups", "authority")), false);
    proved = true;
  } finally { if (proved) { session.close(); f.machine.release(); f.profile.close(); foreign.close(); } }
});

it("retains a real competing shared owner and surfaces exclusive reacquisition refusal before backup or migration", async () => {
  const f = priorEight(), before = digest(f.profile.path);
  const actual = await vi.importActual<typeof http>("../../../../../src/backend/transports/http/http-server.js");
  let held: RuntimeAdmission | undefined, starts = 0;
  const start = vi.spyOn(http, "startDashboardHttpServer").mockImplementation(async input => {
    starts++;
    const listener = await actual.startDashboardHttpServer(input);
    return Object.freeze({ ...listener, async close() {
      await listener.close();
      held = acquireSharedRuntimeAdmission(f.profile.workspace);
    } });
  });
  let application: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined, proved = false;
  try {
    application = await composeDashboardApplication({ admission: f.machine, isolation: rebuildRuntimeIsolation, backendPortOverride: 0, env: {} });
    const response = await post(application.port);
    assert.deepEqual(PublicProfileStateSchema.parse(await response.json()), { state: "refused", code: "PROFILE_UPGRADE_STARTING" });
    let failure: unknown;
    try { await application.failure; } catch (error) { failure = error; }
    assert.ok(failure instanceof RuntimeCustodyUncertainError);
    assert.equal(failure.errors.length, 1);
    const primary: unknown = failure.errors[0]; assert.ok(primary instanceof Error);
    assert.equal(primary.message, "runtime-control: installation lease busy"); assert.equal(failure.cause, primary);
    await assert.rejects(application.stop(), error => error === failure);
    assert.ok(held); held.assertLive();
    assert.equal(starts, 1); assert.equal(digest(f.profile.path), before);
    assert.equal(readProfileDatabaseBinding(f.profile.path).schemaVersion, 8);
    assert.equal(existsSync(join(f.profile.stateRoot, "backups", "authority")), false);
    assert.equal(runtimeProcessLockIsActive(join(f.profile.workspace, rebuildRuntimeIsolation.processLockRoot), "server"), false);
    proved = true;
  } finally { start.mockRestore(); if (proved) { held?.release(); f.machine.release(); f.profile.close(); } }
});

it("refuses replacement of the exact encrypted v4 source across admission turnover and restores only its owned fixture bytes", () => {
  const f = priorEight();
  const session = createProfileSession({ admission: f.machine, machineRoot: f.machine.stateRoot });
  const path = join(f.profile.stateRoot, "credentials", "protected.json"), retained = join(f.profile.workspace, ".retained-protected-source");
  const before = digest(path), original = lstatSync(path);
  let owner: RuntimeAdmission | undefined, replaced = false, proved = false;
  try {
    const result = session.signIn({ ...login, at: systemClock.now().toISOString() }); assert.ok("upgrade" in result);
    session.close(); f.machine.release();
    owner = acquireExclusiveRuntimeAdmission(f.profile.workspace);
    renameSync(path, retained); copyFileSync(retained, path); replaced = true;
    const exclusive = owner;
    assert.throws(() => consumeAuthenticatedProfileUpgrade(result.upgrade, exclusive), { message: "profile-upgrade-handoff-credential-changed" });
    assert.equal(digest(path), before); assert.equal(digest(retained), before);
    assert.equal(readProfileDatabaseBinding(f.profile.path).schemaVersion, 8);
    proved = true;
  } finally {
    if (proved) {
      if (replaced) renameSync(retained, path);
      assert.equal(digest(path), before);
      const restored = lstatSync(path);
      assert.equal(restored.dev, original.dev); assert.equal(restored.ino, original.ino); assert.equal(restored.mode, original.mode); assert.equal(restored.uid, original.uid);
      session.close(); owner?.release(); f.machine.release(); f.profile.close();
    }
  }
});

for (const control of ["key", "erasure-head"] as const) it(`retains exact ${control} identity across release and refuses any substituted authority`, () => {
  const f = priorEight();
  const session = createProfileSession({ admission: f.machine, machineRoot: f.machine.stateRoot });
  const journalDirectory = join(f.machine.stateRoot, "machine", "erasures");
  const path = control === "key" ? join(f.machine.stateRoot, "machine", "credential-keys", `${f.binding.profileId}.json`)
    : join(journalDirectory, `${f.binding.profileId}.json`);
  const retained = join(f.profile.workspace, ".retained-upgrade-authority");
  const before = digest(f.profile.path);
  let exclusive: RuntimeAdmission | undefined, proved = false;
  let restore: (() => void) | undefined;
  try {
    const result = session.signIn({ ...login, at: systemClock.now().toISOString() }); assert.ok("upgrade" in result);
    session.close(); f.machine.release();
    const owner = acquireExclusiveRuntimeAdmission(f.profile.workspace); exclusive = owner;
    let expected: string;
    if (existsSync(path)) {
      const original = lstatSync(path), originalDigest = digest(path);
      assert.equal(existsSync(retained), false);
      renameSync(path, retained); copyFileSync(retained, path);
      expected = control === "key" ? "credential-key-custody-changed" : "credential-erasure-head-changed";
      restore = () => {
        assert.equal(digest(path), originalDigest); assert.equal(digest(retained), originalDigest);
        renameSync(retained, path);
        const restored = lstatSync(path);
        assert.equal(restored.dev, original.dev); assert.equal(restored.ino, original.ino); assert.equal(restored.mode, original.mode); assert.equal(restored.uid, original.uid);
      };
    } else {
      assert.equal(control, "erasure-head");
      const created = !existsSync(journalDirectory);
      if (created) mkdirSync(journalDirectory, { mode: 0o700 });
      const directory = lstatSync(journalDirectory);
      writeFileSync(path, "{}", { mode: 0o600, flag: "wx" });
      const injected = lstatSync(path), injectedDigest = digest(path);
      expected = "credential-erasure-head-missing";
      restore = () => {
        const current = lstatSync(path);
        assert.equal(current.dev, injected.dev); assert.equal(current.ino, injected.ino); assert.equal(current.mode, injected.mode); assert.equal(current.uid, injected.uid); assert.equal(digest(path), injectedDigest);
        unlinkSync(path);
        if (created) {
          const currentDirectory = lstatSync(journalDirectory);
          assert.equal(currentDirectory.dev, directory.dev); assert.equal(currentDirectory.ino, directory.ino); assert.equal(currentDirectory.mode, directory.mode); assert.equal(currentDirectory.uid, directory.uid);
          assert.deepEqual(readdirSync(journalDirectory), []); rmdirSync(journalDirectory);
        }
      };
    }
    assert.throws(() => consumeAuthenticatedProfileUpgrade(result.upgrade, owner), { message: expected });
    assert.equal(digest(f.profile.path), before);
    assert.equal(existsSync(join(f.profile.stateRoot, "backups", "authority")), false);
    assert.ok(restore); restore(); restore = undefined;
    owner.readProfileRegistry();
    proved = true;
  } finally { if (proved) { session.close(); exclusive?.release(); f.machine.release(); f.profile.close(); } }
});

for (const control of ["verifier", "key", "source"] as const) it(`releases the acquired exclusive owner after HTTP ${control} revalidation refusal`, async () => {
  const f = priorEight(), before = digest(f.profile.path);
  const actualAdmission = await vi.importActual<typeof admissionOwner>("../../../../../src/backend/storage/admission/admission.js");
  const actualHttp = await vi.importActual<typeof http>("../../../../../src/backend/transports/http/http-server.js");
  let exclusive: RuntimeAdmission | undefined, acquisitions = 0, starts = 0;
  let restore: (() => void) | undefined;
  const acquire = vi.spyOn(admissionOwner, "acquireExclusiveRuntimeAdmission").mockImplementation(workspace => {
    const owner = actualAdmission.acquireExclusiveRuntimeAdmission(workspace);
    exclusive = owner; acquisitions++;
    if (control === "verifier") createProfileVerifiers(owner.stateRoot).recordFailure(f.binding.profileId, Date.now());
    else {
      const path = control === "source" ? f.profile.path : join(owner.stateRoot, "machine", "credential-keys", `${f.binding.profileId}.json`);
      const retained = join(f.profile.workspace, "handoff-retained-source");
      const original = lstatSync(path), bytes = readFileSync(path);
      renameSync(path, retained); copyFileSync(retained, path);
      restore = () => {
        assert.deepEqual(readFileSync(path), bytes); assert.deepEqual(readFileSync(retained), bytes);
        renameSync(retained, path);
        const current = lstatSync(path);
        assert.equal(current.dev, original.dev); assert.equal(current.ino, original.ino);
        assert.equal(current.mode, original.mode); assert.equal(current.uid, original.uid);
      };
    }
    return owner;
  });
  const start = vi.spyOn(http, "startDashboardHttpServer").mockImplementation(input => {
    starts++; return actualHttp.startDashboardHttpServer(input);
  });
  let application: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined, proved = false;
  try {
    application = await composeDashboardApplication({ admission: f.machine, isolation: rebuildRuntimeIsolation, backendPortOverride: 0, env: {} });
    const response = await post(application.port);
    assert.deepEqual(PublicProfileStateSchema.parse(await response.json()), { state: "refused", code: "PROFILE_UPGRADE_STARTING" });
    assert.equal(response.headers.has("set-cookie"), false);
    let failure: unknown;
    try { await application.failure; } catch (error) { failure = error; }
    assert.ok(failure instanceof RuntimeCustodyUncertainError);
    assert.equal(failure.errors.length, 1);
    assert.equal(failure.cause, failure.errors[0]);
    assert.ok(failure.cause instanceof Error);
    assert.equal(failure.cause.message, control === "verifier" ? "runtime-control: profile-upgrade-handoff-authority-changed"
      : control === "key" ? "credential-key-custody-changed" : "profile-upgrade-handoff-source-changed");
    const acquired = exclusive; assert.ok(acquired); assert.throws(() => acquired.assertLive(), { message: "runtime-admission: missing or released admission" });
    await assert.rejects(application.stop(), error => error === failure);
    assert.equal(acquisitions, 1); assert.equal(starts, 1);
    assert.equal(digest(f.profile.path), before); assert.equal(readProfileDatabaseBinding(f.profile.path).schemaVersion, 8);
    assert.equal(runtimeProcessLockIsActive(join(f.profile.workspace, rebuildRuntimeIsolation.processLockRoot), "server"), false);
    restore?.(); restore = undefined;
    const fresh = actualAdmission.acquireExclusiveRuntimeAdmission(f.profile.workspace);
    fresh.assertExclusive(); fresh.release();
    proved = true;
  } finally {
    acquire.mockRestore(); start.mockRestore();
    if (proved) { f.machine.release(); f.profile.close(); }
  }
});

for (const stage of ["service-inspection", "binding-consume"] as const) it(`retains exact exclusive custody after genuine ${stage} snapshot disposal uncertainty`, async () => {
  const f = priorEight(), before = digest(f.profile.path);
  const actualAdmission = await vi.importActual<typeof admissionOwner>("../../../../../src/backend/storage/admission/admission.js");
  const actualLocks = await vi.importActual<typeof runtimeLocks>("../../../../../src/backend/storage/sqlite/runtime-process-locks.js");
  const actualHttp = await vi.importActual<typeof http>("../../../../../src/backend/transports/http/http-server.js");
  const actualProfileSession = await vi.importActual<typeof profileSessionOwner>("../../../../../src/backend/profiles/profile-session.js");
  let phase: typeof stage | undefined;
  const inspect = vi.spyOn(AuthorityDatabase, "inspectStoppedUpgrade").mockImplementation((...args) => {
    const prior = phase; phase = "service-inspection";
    try { return inspectStopped(...args); } finally { phase = prior; }
  });
  const consume = vi.spyOn(profileSessionOwner, "consumeAuthenticatedProfileUpgrade").mockImplementation((authorization, owner) => {
    const prior = phase; phase = "binding-consume";
    try { return actualProfileSession.consumeAuthenticatedProfileUpgrade(authorization, owner); } finally { phase = prior; }
  });
  const injected = new Error("held-upgrade-source-disposal");
  let exclusive: RuntimeAdmission | undefined, heldRestore: ReturnType<typeof runtimeLocks.acquireRuntimeRestoreAdmission> | undefined;
  let dispose: (() => void) | undefined, snapshotPath: string | undefined, disposalAttempts = 0, acquisitions = 0, starts = 0;
  const acquire = vi.spyOn(admissionOwner, "acquireExclusiveRuntimeAdmission").mockImplementation(workspace => {
    const owner = actualAdmission.acquireExclusiveRuntimeAdmission(workspace); exclusive = owner; acquisitions++; return owner;
  });
  const restore = vi.spyOn(runtimeLocks, "acquireRuntimeRestoreAdmission").mockImplementation((input, clock) => {
    const owner = actualLocks.acquireRuntimeRestoreAdmission(input, clock); heldRestore = owner; return owner;
  });
  const snapshot = vi.spyOn(readonlySource, "createReadonlyAuthoritySnapshot").mockImplementation(path => {
    const source = createSnapshot(path);
    if (phase !== stage || path !== f.profile.path || dispose !== undefined) return source;
    snapshotPath = source.path;
    dispose = () => source.dispose();
    return { ...source, dispose() { disposalAttempts++; throw injected; } };
  });
  const start = vi.spyOn(http, "startDashboardHttpServer").mockImplementation(input => {
    starts++; return actualHttp.startDashboardHttpServer(input);
  });
  let application: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined, proved = false;
  try {
    application = await composeDashboardApplication({ admission: f.machine, isolation: rebuildRuntimeIsolation, backendPortOverride: 0, env: {} });
    const response = await post(application.port);
    assert.deepEqual(PublicProfileStateSchema.parse(await response.json()), { state: "refused", code: "PROFILE_UPGRADE_STARTING" });
    assert.equal(response.headers.has("set-cookie"), false);
    let failure: unknown;
    try { await application.failure; } catch (error) { failure = error; }
    assert.ok(failure instanceof RuntimeCustodyUncertainError); assert.equal(failure.errors.length, 1);
    assert.ok(failure.cause instanceof AuthoritySourceClosureUnprovedError, failure);
    const closure = failure.cause;
    if (stage === "service-inspection") {
      assert.equal(closure.errors.length, 1); assert.ok(closure.cause instanceof AuthoritySourceClosureUnprovedError);
      assert.equal(closure.errors[0], closure.cause);
      assert.deepEqual(closure.cause.errors, [injected]); assert.equal(closure.cause.cause, injected);
      assert.ok(heldRestore); runtimeLocks.assertRuntimeRestoreAdmission(heldRestore, join(f.profile.workspace, rebuildRuntimeIsolation.processLockRoot));
    } else {
      assert.deepEqual(closure.errors, [injected]); assert.equal(closure.cause, injected);
      assert.equal(heldRestore, undefined);
    }
    assert.ok(exclusive); exclusive.assertExclusive();
    assert.equal(disposalAttempts, 1); assert.equal(acquisitions, 1); assert.equal(starts, 1);
    assert.ok(snapshotPath); assert.equal(existsSync(snapshotPath), true);
    assert.throws(() => actualAdmission.acquireSharedRuntimeAdmission(f.profile.workspace));
    const stopped = application.stop();
    assert.equal(application.stop(), stopped); await assert.rejects(stopped, error => error === failure);
    exclusive.assertExclusive();
    if (stage === "service-inspection") {
      assert.ok(heldRestore); runtimeLocks.assertRuntimeRestoreAdmission(heldRestore, join(f.profile.workspace, rebuildRuntimeIsolation.processLockRoot));
    } else assert.equal(heldRestore, undefined);
    assert.equal(disposalAttempts, 1); assert.equal(acquisitions, 1); assert.equal(starts, 1);
    assert.ok(snapshotPath); assert.equal(existsSync(snapshotPath), true);
    assert.equal(digest(f.profile.path), before); assert.equal(readProfileDatabaseBinding(f.profile.path).schemaVersion, 8);
    assert.ok(dispose); dispose(); dispose = undefined;
    assert.equal(existsSync(snapshotPath), false);
    heldRestore?.release(); exclusive.release();
    proved = true;
  } finally {
    acquire.mockRestore(); restore.mockRestore(); snapshot.mockRestore(); start.mockRestore(); inspect.mockRestore(); consume.mockRestore();
    if (proved) { f.machine.release(); f.profile.close(); }
  }
});

for (const fault of ["unproved-close", "closed-link-refusal"] as const) it(`retains actual restore creation evidence for ${fault}`, async () => {
  const f = priorEight(), before = digest(f.profile.path);
  const actualAdmission = await vi.importActual<typeof admissionOwner>("../../../../../src/backend/storage/admission/admission.js");
  const actualLocks = await vi.importActual<typeof runtimeLocks>("../../../../../src/backend/storage/sqlite/runtime-process-locks.js");
  const actualHttp = await vi.importActual<typeof http>("../../../../../src/backend/transports/http/http-server.js");
  const actualWrite = sourceFiles.writeFileSync, actualClose = sourceFiles.closeSync;
  const actualUnlink = sourceFiles.unlinkSync, actualLink = sourceFiles.linkSync;
  const primary = new Error("restore-link-refused"), closeFailure = new Error("restore-sync-close-refused"), unlinkFailure = new Error("restore-temp-unlink-refused");
  const root = join(f.profile.workspace, rebuildRuntimeIsolation.processLockRoot);
  let exclusive: RuntimeAdmission | undefined, phase = false, temporary: { path: string; identity: ReturnType<typeof lstatSync>; digest: string } | undefined;
  let processBaseline: string[] | undefined, descriptor: number | undefined, closes = 0, unlinks = 0, links = 0, acquisitions = 0, restores = 0, starts = 0;
  const acquire = vi.spyOn(admissionOwner, "acquireExclusiveRuntimeAdmission").mockImplementation(workspace => {
    const owner = actualAdmission.acquireExclusiveRuntimeAdmission(workspace); exclusive = owner; acquisitions++; return owner;
  });
  const restore = vi.spyOn(runtimeLocks, "acquireRuntimeRestoreAdmission").mockImplementation((input, clock) => {
    restores++; processBaseline = readdirSync(root).sort(); phase = true;
    try { return actualLocks.acquireRuntimeRestoreAdmission(input, clock); } finally { phase = false; }
  });
  const write = vi.spyOn(sourceFiles, "writeFileSync").mockImplementation((path, data, options) => {
    actualWrite(path, data, options);
    if (phase && typeof path === "string" && dirname(path) === root && path.endsWith(".tmp")) temporary = { path, identity: lstatSync(path), digest: digest(path) };
  });
  syncBuiltinESMExports();
  const close = vi.spyOn(sourceFiles, "closeSync").mockImplementation(fd => {
    if (phase && temporary !== undefined) {
      const identity = sourceFiles.fstatSync(fd);
      assert.ok(temporary.identity);
      if (identity.dev === temporary.identity.dev && identity.ino === temporary.identity.ino) {
        descriptor = fd; closes++;
        if (fault === "unproved-close") throw closeFailure;
      }
    }
    actualClose(fd);
  });
  syncBuiltinESMExports();
  const unlink = vi.spyOn(sourceFiles, "unlinkSync").mockImplementation(path => {
    if (temporary !== undefined && path === temporary.path) { unlinks++; throw unlinkFailure; }
    actualUnlink(path);
  });
  syncBuiltinESMExports();
  const link = vi.spyOn(sourceFiles, "linkSync").mockImplementation((source, destination) => {
    if (phase && temporary !== undefined && source === temporary.path) { links++; if (fault === "closed-link-refusal") throw primary; }
    actualLink(source, destination);
  });
  syncBuiltinESMExports();
  const start = vi.spyOn(http, "startDashboardHttpServer").mockImplementation(input => { starts++; return actualHttp.startDashboardHttpServer(input); });
  let application: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined, proved = false;
  try {
    application = await composeDashboardApplication({ admission: f.machine, isolation: rebuildRuntimeIsolation, backendPortOverride: 0, env: {} });
    const response = await post(application.port);
    assert.deepEqual(PublicProfileStateSchema.parse(await response.json()), { state: "refused", code: "PROFILE_UPGRADE_STARTING" });
    assert.equal(response.headers.has("set-cookie"), false);
    let failure: unknown;
    try { await application.failure; } catch (error) { failure = error; }
    assert.ok(failure instanceof RuntimeCustodyUncertainError); assert.equal(failure.errors.length, 1); assert.equal(failure.errors[0], failure.cause);
    const owner = exclusive, evidence = temporary, baseline = processBaseline, heldFD = descriptor;
    assert.ok(owner); assert.ok(evidence); assert.ok(baseline); assert.ok(heldFD !== undefined);
    assert.ok(evidence.identity);
    if (fault === "unproved-close") {
      assert.ok(failure.cause instanceof AuthoritySourceClosureUnprovedError);
      assert.equal(failure.cause.errors.length, 1); assert.ok(failure.cause.cause instanceof AuthoritySourceClosureUnprovedError);
      assert.equal(failure.cause.errors[0], failure.cause.cause);
      assert.deepEqual(failure.cause.cause.errors, [closeFailure]); assert.equal(failure.cause.cause.cause, closeFailure);
      owner.assertExclusive(); assert.equal(unlinks, 0); assert.equal(links, 0);
      assert.equal(sourceFiles.fstatSync(heldFD).dev, evidence.identity.dev); assert.equal(sourceFiles.fstatSync(heldFD).ino, evidence.identity.ino);
    } else {
      assert.ok(failure.cause instanceof AggregateError); assert.equal(failure.cause instanceof AuthoritySourceClosureUnprovedError, false);
      assert.deepEqual(failure.cause.errors, [primary, unlinkFailure]); assert.equal(failure.cause.cause, primary);
      assert.throws(() => owner.assertLive(), { message: "runtime-admission: missing or released admission" });
      assert.equal(unlinks, 1); assert.equal(links, 1);
      const closed = heldFD;
      assert.throws(() => sourceFiles.fstatSync(closed), error => error instanceof Error && Reflect.get(error, "code") === "EBADF");
    }
    assert.equal(closes, 1); assert.equal(acquisitions, 1); assert.equal(restores, 1); assert.equal(starts, 1);
    const stopped = application.stop(); assert.equal(application.stop(), stopped); await assert.rejects(stopped, error => error === failure);
    assert.equal(closes, 1); assert.equal(restores, 1); assert.equal(starts, 1); assert.equal(unlinks, fault === "unproved-close" ? 0 : 1);
    assert.deepEqual(readdirSync(root).sort(), [...baseline, basename(evidence.path)].sort());
    const retained = lstatSync(evidence.path), retainedDigest = digest(evidence.path);
    assert.equal(retained.dev, evidence.identity.dev); assert.equal(retained.ino, evidence.identity.ino); assert.equal(retained.mode, evidence.identity.mode);
    assert.equal(retained.uid, evidence.identity.uid); assert.equal(retained.nlink, evidence.identity.nlink);
    assert.equal(retained.size, evidence.identity.size); assert.equal(retained.mtimeMs, evidence.identity.mtimeMs); assert.equal(retained.ctimeMs, evidence.identity.ctimeMs);
    assert.equal(retainedDigest, evidence.digest);
    assert.equal(digest(f.profile.path), before); assert.equal(readProfileDatabaseBinding(f.profile.path).schemaVersion, 8);
    acquire.mockRestore(); restore.mockRestore(); write.mockRestore(); syncBuiltinESMExports(); close.mockRestore(); syncBuiltinESMExports(); unlink.mockRestore(); syncBuiltinESMExports(); link.mockRestore(); syncBuiltinESMExports(); start.mockRestore();
    const heldDescriptor = heldFD;
    if (fault === "unproved-close") {
      owner.assertExclusive(); actualClose(heldDescriptor);
      assert.throws(() => sourceFiles.fstatSync(heldDescriptor), error => error instanceof Error && Reflect.get(error, "code") === "EBADF");
    }
    const current = lstatSync(evidence.path);
    assert.equal(current.dev, retained.dev); assert.equal(current.ino, retained.ino); assert.equal(current.mode, retained.mode);
    assert.equal(digest(evidence.path), retainedDigest); actualUnlink(evidence.path);
    assert.deepEqual(readdirSync(root).sort(), baseline);
    if (fault === "unproved-close") owner.release();
    assert.equal(digest(f.profile.path), before); proved = true;
  } finally {
    acquire.mockRestore(); restore.mockRestore(); write.mockRestore(); syncBuiltinESMExports(); close.mockRestore(); syncBuiltinESMExports(); unlink.mockRestore(); syncBuiltinESMExports(); link.mockRestore(); syncBuiltinESMExports(); start.mockRestore();
    if (proved) { f.machine.release(); f.profile.close(); }
  }
});
