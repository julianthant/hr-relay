import { z } from "zod";
import { canonicalJsonStringify } from "../../../../../src/rules/validation/canonical-json.js";
import { SignUpOperationSchema } from "../../../../../src/models/profiles/profile.js";
import { assertRuntimeLifetimeHeld, runtimeLifetimeLock } from "../../../../support/helpers/backend/runtime-lifetime.js";
import * as profileSessionOwner from "../../../../../src/backend/profiles/profile-session.js";
import * as notificationOwner from "../../../../../src/backend/app/composition/dashboard/notifications.js";
import * as notificationHealthOwner from "../../../../../src/backend/app/composition/dashboard/notification-health.js";
import * as credentialInventoryOwner from "../../../../../src/backend/app/composition/profile-credential-inventory.js";
import * as admissionOwner from "../../../../../src/backend/storage/admission/admission.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it, vi } from "vitest";
import { composeDashboardApplication, composeDashboardRuntime } from "../../../../../src/backend/app/composition/dashboard/compose.js";
import * as http from "../../../../../src/backend/transports/http/http-server.js";
import { acquireSharedRuntimeAdmission, acquireExclusiveRuntimeAdmission, ProfileUpgradeSourceRefusalError, type RuntimeAdmission } from "../../../../../src/backend/storage/admission/admission.js";
import { AuthorityDatabase } from "../../../../../src/backend/storage/sqlite/authority-database.js";
import { readProfileDatabaseBinding } from "../../../../../src/backend/storage/sqlite/profile-local-databases.js";
import { createProfileSession, consumeAuthenticatedProfileUpgrade } from "../../../../../src/backend/profiles/profile-session.js";
import { ProfileSessionRefusedError } from "../../../../../src/backend/profiles/profile-errors.js";
import { createProfileVerifiers } from "../../../../../src/backend/storage/configuration/verifier-store.js";
import { createBoundProfileFixture } from "../../../../support/helpers/admission-fixture.js";
import { systemClock } from "../../../../../src/rules/time/clock.js";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { PublicProfileStateSchema } from "../../../../../src/models/profiles/public-profile.js";
import { RuntimeCustodyUncertainError, composeProfileRuntime } from "../../../../../src/backend/app/composition/storage-compose.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../../src/backend/storage/sqlite/migrations.js";

vi.mock("../../../../../src/backend/transports/http/http-server.js", { spy: true });
vi.mock("../../../../../src/backend/storage/admission/admission.js", async importOriginal => {
  const actual = await importOriginal<typeof admissionOwner>();
  return { ...actual, acquireExclusiveRuntimeAdmission: vi.fn(actual.acquireExclusiveRuntimeAdmission) };
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
  return { ...actual, composeProfileClosureInventory: vi.fn(actual.composeProfileClosureInventory) };
});


import { createHistoricalRegisteredProfileFixture } from "../../../../support/fixtures/storage/historical-incomplete-profile-fixture.js";
import { withReadonlyAuthoritySnapshot } from "../../../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";
import { inspectOpenDatabase } from "../../../../../src/backend/storage/sqlite/backup-inspection.js";
import { StoppedAuthorityBackupManifestSchema } from "../../../../../src/backend/storage/sqlite/recovery-contracts.js";
import { FakeKeyringEntry } from "../../../../support/helpers/credential-keychain-fake.js";
import { runCredentialSourceRetentionCase } from "../../../../support/helpers/credential-source-retention.js";

const login = { email: "fixture@ucsd.edu", password: "disposable-fixture-password" };
const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
async function priorEight(lifetime?: Awaited<ReturnType<typeof runtimeLifetimeLock>>, sourceVersion: 8 | 9 | 10 = 8) {
  const profile = await createHistoricalRegisteredProfileFixture({ sourceVersion, ...(lifetime === undefined ? {} : { lifetime }) });
  const binding = profile.binding;
  const machine = acquireSharedRuntimeAdmission(profile.workspace, profile.lifetime);
  return { profile, binding, machine };
}
function post(port: number) {
  return fetch(`http://127.0.0.1:${port}/api/v1/profile/sign-in`, { method: "POST", headers: {
    "content-type": "application/json", origin: `http://127.0.0.1:${port}`,
  }, body: JSON.stringify(login) });
}

const retainedPositiveOwners = new WeakMap<Error, {
  application: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  fixture: Awaited<ReturnType<typeof priorEight>>;
}>();

it.each([8, 9, 10] as const)("commits authenticated schema %s upgrade, restarts the public shell and requires fresh sign-in", async sourceVersion => {
  const f = await priorEight(undefined, sourceVersion);
  const protectedPath = join(f.profile.stateRoot, "credentials", "protected.json");
  const keyPath = join(f.machine.stateRoot, "machine", "credential-keys", `${f.binding.profileId}.json`);
  const protectedBefore = digest(protectedPath), keyBefore = digest(keyPath);
  const sourceBefore = withReadonlyAuthoritySnapshot(f.profile.path, database => inspectOpenDatabase(database, sourceVersion));
  const nativeKey = new FakeKeyringEntry("Relay", `${f.binding.installationId}:${f.binding.profileId}`).getPassword(); assert.ok(nativeKey);
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
    application = await composeDashboardApplication({ lifetimeLock: f.profile.lifetime, admission: f.machine, isolation: rebuildRuntimeIsolation, backendPortOverride: 0,
      frontendPortOverride: 0, env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners });
    const response = await post(application.port);
    assert.deepEqual(PublicProfileStateSchema.parse(await response.json()), { state: "refused", code: "PROFILE_UPGRADE_STARTING" });
    assert.equal(response.headers.has("set-cookie"), false);
    await Promise.race([restarted, application.failure]);
    assert.equal(starts, 2);
    assert.equal(readProfileDatabaseBinding(f.profile.path).schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    assert.equal(digest(protectedPath), protectedBefore); assert.equal(digest(keyPath), keyBefore);
    const backupRoot = join(f.profile.stateRoot, "backups", "authority");
    const manifests = readdirSync(backupRoot).filter(name => name.endsWith(".manifest.json")); assert.equal(manifests.length, 1);
    const manifestName = manifests[0]; assert.ok(manifestName);
    const manifestBytes = readFileSync(join(backupRoot, manifestName));
    const manifest = StoppedAuthorityBackupManifestSchema.parse(JSON.parse(manifestBytes.toString("utf8")));
    const backupPath = join(backupRoot, manifest.backupFileName), backupBytes = readFileSync(backupPath);
    const observed = withReadonlyAuthoritySnapshot(backupPath, database => inspectOpenDatabase(database, sourceVersion));
    assert.equal(manifest.schemaVersion, sourceVersion); assert.equal(observed.schemaVersion, sourceVersion);
    for (const record of [manifest, manifest.verification, observed]) {
      assert.equal(record.installationId, f.binding.installationId); assert.equal(record.profileId, f.binding.profileId);
      assert.equal(record.authorityGeneration, sourceBefore.authorityGeneration);
      assert.equal(record.authorityContentFingerprint, sourceBefore.authorityContentFingerprint);
    }
    assert.equal(manifest.verification.observedFrom, "backup-copy"); assert.equal(manifest.verification.quickCheck, "ok");
    assert.equal(manifest.verification.foreignKeyViolations, 0); assert.deepEqual(manifest.verification.invariantViolations, []);
    assert.equal(manifest.verification.exactTableRegistry, true);
    assert.equal(manifest.byteSize, backupBytes.length); assert.equal(manifest.sha256, digest(backupPath));
    for (const bytes of [manifestBytes, backupBytes]) for (const secret of [Buffer.from(login.password), Buffer.from(nativeKey), Buffer.from(nativeKey, "base64")]) {
      assert.equal(bytes.includes(secret), false);
    }
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
        try { await f.profile.close(); } catch (error) { closureProved = false; cleanupFailures.push(error); }
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
  const f = await priorEight();
  const actualHttp = await vi.importActual<typeof http>("../../../../../src/backend/transports/http/http-server.js");
  const actualNotifications = await vi.importActual<typeof notificationOwner>("../../../../../src/backend/app/composition/dashboard/notifications.js");
  const actualHealth = await vi.importActual<typeof notificationHealthOwner>("../../../../../src/backend/app/composition/dashboard/notification-health.js");
  const actualInventory = await vi.importActual<typeof credentialInventoryOwner>("../../../../../src/backend/app/composition/profile-credential-inventory.js");
  const startServer = actualHttp.startDashboardHttpServer;
  const createNotifications = actualNotifications.createTrustNotifications;
  const readHealth = actualHealth.readNotificationHealth;
  const createInventory = actualInventory.composeProfileClosureInventory;
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
  const inventory = vi.spyOn(credentialInventoryOwner, "composeProfileClosureInventory").mockImplementation(input => {
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
    application = await composeDashboardApplication({ lifetimeLock: f.profile.lifetime, admission: f.machine, isolation: rebuildRuntimeIsolation, backendPortOverride: 0,
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
        try { await f.profile.close(); } catch (error) { closureProved = false; cleanupFailures.push(error); }
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
  await runCredentialSourceRetentionCase("authenticated-upgrade-key-close");
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

for (const control of ["wrong-password", "locked", "forged", "reused", "verifier-change", "source-replaced"] as const) it(`refuses ${control} without ordinary admission or operation creation`, async () => {
  const f = await priorEight();
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
    const owner = acquireExclusiveRuntimeAdmission(f.profile.workspace, f.profile.lifetime);
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
    assert.equal(consumeAuthenticatedProfileUpgrade(authorization, owner), f.binding.profileId);
    assert.throws(() => consumeAuthenticatedProfileUpgrade(authorization, owner), error => error instanceof ProfileSessionRefusedError && error.code === "PROFILE_UPGRADE_UNAVAILABLE");
    proved = true;
  } finally { if (proved) { session.close(); exclusive?.release(); f.machine.release(); await f.profile.close(); } }
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

it("surfaces an actual restart failure after exclusive readback without claiming an authenticated session", async () => {
  const controllerLock=await runtimeLifetimeLock();
  const f = await priorEight(controllerLock);
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
    application = await composeDashboardApplication({ lifetimeLock: controllerLock, admission: f.machine, isolation: rebuildRuntimeIsolation, backendPortOverride: 0,
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
    await assertRuntimeLifetimeHeld(controllerLock);
    proved = true;
  } finally { start.mockRestore(); if (proved) { f.machine.release(); await f.profile.close(); } }
});

it("preserves an existing canonical applying operation and refuses ready prior upgrade authority", async () => {
  const f = await priorEight();
  const { onboarding: _onboarding, ...source } = f.profile.signupOperation, operation = SignUpOperationSchema.parse(source);
  const path = join(f.machine.stateRoot, "machine", "operations", `${operation.operationId}.json`);
  const controlPath = join(f.profile.workspace, ".tracker", "control", "profile-registry.json"), controlBefore = readFileSync(controlPath);
  const control = z.looseObject({ operations: z.array(z.unknown()) }).parse(JSON.parse(controlBefore.toString("utf8")));
  assert.deepEqual(control.operations, []);
  f.machine.release();
  writeFileSync(path, JSON.stringify(operation), { mode: 0o600, flag: "wx" });
  writeFileSync(controlPath, JSON.stringify({ ...control, operations: [{ operationId: operation.operationId,
    digest: createHash("sha256").update(canonicalJsonStringify(operation)).digest("hex") }] }));
  const before = readFileSync(path), machine = acquireSharedRuntimeAdmission(f.profile.workspace, f.profile.lifetime);
  const session = createProfileSession({ admission: machine, machineRoot: machine.stateRoot });
  let proved = false;
  try {
    assert.throws(() => session.signIn({ ...login, at: systemClock.now().toISOString() }), error => error instanceof ProfileUpgradeSourceRefusalError && error.code === "PROFILE_UPGRADE_UNAVAILABLE");
    assert.deepEqual(readFileSync(path), before);
    assert.equal(readProfileDatabaseBinding(f.profile.path).schemaVersion, 8);
    proved = true;
  } finally { if (proved) { session.close(); machine.release(); unlinkSync(path); writeFileSync(controlPath, controlBefore); await f.profile.close(); } }
});

it("rejects a genuine foreign installation after authentication without granting either profile admission", async () => {
  const f = await priorEight(), foreign = await createBoundProfileFixture();
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
  } finally { if (proved) { session.close(); f.machine.release(); await f.profile.close(); await foreign.close(); } }
});

it("retains a real competing shared owner and surfaces exclusive reacquisition refusal before backup or migration", async () => {
  const controllerLock=await runtimeLifetimeLock();
  const f = await priorEight(controllerLock), before = digest(f.profile.path);
  const actual = await vi.importActual<typeof http>("../../../../../src/backend/transports/http/http-server.js");
  let held: RuntimeAdmission | undefined, starts = 0;
  const start = vi.spyOn(http, "startDashboardHttpServer").mockImplementation(async input => {
    starts++;
    const listener = await actual.startDashboardHttpServer(input);
    return Object.freeze({ ...listener, async close() {
      await listener.close();
      held = acquireSharedRuntimeAdmission(f.profile.workspace, f.profile.lifetime);
    } });
  });
  let application: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined, proved = false;
  try {
    application = await composeDashboardApplication({ lifetimeLock: controllerLock, admission: f.machine, isolation: rebuildRuntimeIsolation, backendPortOverride: 0, env: {} });
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
    await assertRuntimeLifetimeHeld(controllerLock);
    proved = true;
  } finally { start.mockRestore(); if (proved) { held?.release(); f.machine.release(); await f.profile.close(); } }
});

it("refuses replacement of the exact encrypted v4 source across admission turnover and restores only its owned fixture bytes", async () => {
  const f = await priorEight();
  const session = createProfileSession({ admission: f.machine, machineRoot: f.machine.stateRoot });
  const path = join(f.profile.stateRoot, "credentials", "protected.json"), retained = join(f.profile.workspace, ".retained-protected-source");
  const before = digest(path), original = lstatSync(path);
  let owner: RuntimeAdmission | undefined, replaced = false, proved = false;
  try {
    const result = session.signIn({ ...login, at: systemClock.now().toISOString() }); assert.ok("upgrade" in result);
    session.close(); f.machine.release();
    owner = acquireExclusiveRuntimeAdmission(f.profile.workspace, f.profile.lifetime);
    renameSync(path, retained); copyFileSync(retained, path); replaced = true;
    const exclusive = owner;
    assert.throws(() => consumeAuthenticatedProfileUpgrade(result.upgrade, exclusive), { message: "runtime-control: profile-upgrade-handoff-authority-changed" });
    assert.equal(digest(path), before); assert.equal(digest(retained), before);
    assert.equal(readProfileDatabaseBinding(f.profile.path).schemaVersion, 8);
    proved = true;
  } finally {
    if (proved) {
      if (replaced) renameSync(retained, path);
      assert.equal(digest(path), before);
      const restored = lstatSync(path);
      assert.equal(restored.dev, original.dev); assert.equal(restored.ino, original.ino); assert.equal(restored.mode, original.mode); assert.equal(restored.uid, original.uid);
      session.close(); owner?.release(); f.machine.release(); await f.profile.close();
    }
  }
});

for (const control of ["head-replaced", "operation-injected"] as const) it(`retains captured canonical authority and refuses ${control} across release`, async () => {
  const f = await priorEight();
  const session = createProfileSession({ admission: f.machine, machineRoot: f.machine.stateRoot });
  const directory = join(f.machine.stateRoot, "machine", control === "head-replaced" ? "credential-keys" : "credential-operations");
  const path = join(directory, `${f.binding.profileId}.json`), retained = join(f.profile.workspace, ".retained-upgrade-authority");
  const before = digest(f.profile.path), headPath = join(f.machine.stateRoot, "machine", "credential-keys", `${f.binding.profileId}.json`);
  const headBefore = readFileSync(headPath), protectedPath = join(f.profile.stateRoot, "credentials", "protected.json"), protectedBefore = readFileSync(protectedPath);
  let exclusive: RuntimeAdmission | undefined, proved = false;
  let restore: (() => void) | undefined;
  try {
    const result = session.signIn({ ...login, at: systemClock.now().toISOString() }); assert.ok("upgrade" in result);
    session.close(); f.machine.release();
    const owner = acquireExclusiveRuntimeAdmission(f.profile.workspace, f.profile.lifetime); exclusive = owner;
    if (control === "head-replaced") {
      const original = lstatSync(path), originalDigest = digest(path);
      assert.equal(existsSync(retained), false);
      renameSync(path, retained); copyFileSync(retained, path);
      restore = () => {
        assert.equal(digest(path), originalDigest); assert.equal(digest(retained), originalDigest);
        renameSync(retained, path);
        const restored = lstatSync(path);
        assert.equal(restored.dev, original.dev); assert.equal(restored.ino, original.ino); assert.equal(restored.mode, original.mode); assert.equal(restored.uid, original.uid);
      };
    } else {
      assert.equal(existsSync(path), false);
      const created = !existsSync(directory);
      if (created) mkdirSync(directory, { mode: 0o700 });
      const directoryIdentity = lstatSync(directory);
      writeFileSync(path, "{}", { mode: 0o600, flag: "wx" });
      const injected = lstatSync(path), injectedDigest = digest(path);
      restore = () => {
        const current = lstatSync(path);
        assert.equal(current.dev, injected.dev); assert.equal(current.ino, injected.ino); assert.equal(current.mode, injected.mode); assert.equal(current.uid, injected.uid); assert.equal(digest(path), injectedDigest);
        unlinkSync(path);
        if (created) {
          const currentDirectory = lstatSync(directory);
          assert.equal(currentDirectory.dev, directoryIdentity.dev); assert.equal(currentDirectory.ino, directoryIdentity.ino); assert.equal(currentDirectory.mode, directoryIdentity.mode); assert.equal(currentDirectory.uid, directoryIdentity.uid);
          assert.deepEqual(readdirSync(directory), []); rmdirSync(directory);
        }
      };
    }
    assert.throws(() => consumeAuthenticatedProfileUpgrade(result.upgrade, owner), { message: control === "head-replaced"
      ? "runtime-control: profile-upgrade-handoff-authority-changed" : "runtime-control: profile-stopped-upgrade-credential-operation-pending" });
    assert.equal(digest(f.profile.path), before);
    assert.deepEqual(readFileSync(headPath), headBefore); assert.deepEqual(readFileSync(protectedPath), protectedBefore);
    assert.equal(existsSync(join(f.profile.stateRoot, "backups", "authority")), false);
    assert.ok(restore); restore(); restore = undefined;
    owner.readProfileRegistry(); proved = true;
  } finally { if (proved) { session.close(); exclusive?.release(); f.machine.release(); await f.profile.close(); } }
});

for (const control of ["verifier", "key", "source"] as const) it(`releases the acquired exclusive owner after HTTP ${control} revalidation refusal`, async () => {
  const controllerLock=await runtimeLifetimeLock();
  const f = await priorEight(controllerLock), before = digest(f.profile.path);
  const actualAdmission = await vi.importActual<typeof admissionOwner>("../../../../../src/backend/storage/admission/admission.js");
  const actualHttp = await vi.importActual<typeof http>("../../../../../src/backend/transports/http/http-server.js");
  let exclusive: RuntimeAdmission | undefined, acquisitions = 0, starts = 0;
  let restore: (() => void) | undefined;
  const acquire = vi.spyOn(admissionOwner, "acquireExclusiveRuntimeAdmission").mockImplementation((workspace, lifetime) => {
    const owner = actualAdmission.acquireExclusiveRuntimeAdmission(workspace, lifetime);
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
    application = await composeDashboardApplication({ lifetimeLock: controllerLock, admission: f.machine, isolation: rebuildRuntimeIsolation, backendPortOverride: 0, env: {} });
    const response = await post(application.port);
    assert.deepEqual(PublicProfileStateSchema.parse(await response.json()), { state: "refused", code: "PROFILE_UPGRADE_STARTING" });
    assert.equal(response.headers.has("set-cookie"), false);
    let failure: unknown;
    try { await application.failure; } catch (error) { failure = error; }
    assert.ok(failure instanceof RuntimeCustodyUncertainError);
    assert.equal(failure.errors.length, 1);
    assert.equal(failure.cause, failure.errors[0]);
    assert.ok(failure.cause instanceof Error);
    assert.equal(failure.cause.message, control === "source" ? "profile-upgrade-handoff-source-changed" : "runtime-control: profile-upgrade-handoff-authority-changed");
    const acquired = exclusive; assert.ok(acquired); assert.throws(() => acquired.assertLive(), { message: "runtime-admission: missing or released admission" });
    await assert.rejects(application.stop(), error => error === failure);
    assert.equal(acquisitions, 1); assert.equal(starts, 1);
    assert.equal(digest(f.profile.path), before); assert.equal(readProfileDatabaseBinding(f.profile.path).schemaVersion, 8);
    await assertRuntimeLifetimeHeld(controllerLock);
    restore?.(); restore = undefined;
    const fresh = actualAdmission.acquireExclusiveRuntimeAdmission(f.profile.workspace, f.profile.lifetime);
    fresh.assertExclusive(); fresh.release();
    proved = true;
  } finally {
    acquire.mockRestore(); start.mockRestore();
    if (proved) { f.machine.release(); await f.profile.close(); }
  }
});

for (const stage of ["service-inspection", "binding-consume"] as const) it(`retains exact exclusive custody after genuine ${stage} snapshot disposal uncertainty`, async () => {
  await runCredentialSourceRetentionCase(`authenticated-upgrade-${stage}`);
});

for (const fault of ["unproved-close", "closed-publication-refusal"] as const) it(`retains actual stopped source creation evidence for ${fault}`, async () => {
  await runCredentialSourceRetentionCase(`authenticated-upgrade-${fault}`);
});
