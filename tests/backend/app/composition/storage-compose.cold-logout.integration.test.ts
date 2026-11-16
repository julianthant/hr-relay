import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs, { copyFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { it, vi } from "vitest";
import { composeProfileRuntime, initializeRegisteredPersonStores } from "../../../../src/backend/app/composition/storage-compose.js";
import * as settingsMaintenance from "../../../../src/backend/storage/maintenance/protected-settings-upgrade.js";
import { CredentialMaintenanceHold } from "../../../../src/backend/storage/configuration/canonical-credential-store.js";
import { createProfileRegistry } from "../../../../src/backend/profiles/registry.js";
import { captureProfileCredentialFixture, installPredecessorProfileCredentials } from "../../../support/helpers/predecessor-profile-credentials.js";
import { createProfileSession } from "../../../../src/backend/profiles/profile-session.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { createCanonicalCredentials } from "../../../../src/backend/storage/configuration/canonical-credential-store.js";
import { ChatGptCredentialRecordSchema, createChatGptCredentialRepository } from "../../../../src/backend/storage/configuration/chatgpt-credential-repository.js";
import { createCredentialStore } from "../../../../src/backend/storage/configuration/credential-store.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH, ProtectedSettingsApplyInputSchema } from "../../../../src/models/config/protected-settings.js";
import { LogoutOperationSchema } from "../../../../src/models/profiles/profile.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { runLogoutSettlementCase } from "../../../support/helpers/credential-source-retention.js";
import { createBoundProfileFixture, finishProfileOnboarding, syntheticOnboardingDuo } from "../../../support/helpers/admission-fixture.js";
import { composeDashboardApplication } from "../../../../src/backend/app/composition/dashboard/profile-session-routes.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { readLocalDebugLog } from "../../../../src/backend/storage/events/local-debug-log.js";
import { healthyRuntimePreflightRunners } from "../../../support/fixtures/preflight-seams.js";
import { PublicProfileStateSchema } from "../../../../src/models/profiles/public-profile.js";
import { StorageMaintenanceCustodyUnavailableError } from "../../../../src/backend/storage/maintenance/custody-availability.js";

const fields = { email: "fixture@ucsd.edu", password: "disposable-fixture-password", at: "2026-10-21T12:01:00.000Z" };

async function fixture(phase: "admitted" | "cancelling" | "incomplete" = "cancelling") {
  const f = await createBoundProfileFixture(), clock = manualClock(new Date(fields.at));
  const credentials = createCredentialStore({ admission: f.admission, stateRoot: f.stateRoot });
  assert.equal(credentials.apply(ProtectedSettingsApplyInputSchema.parse({ commandId: randomUUID(), writeId: randomUUID(),
    commandFingerprint: "a".repeat(64), expectedRevision: credentials.read().revision, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
    updatedAt: fields.at, entries: { ucpathUserId: { set: fields.email }, ucpathPassword: { set: fields.password } } })).state, "applied");
  await createChatGptCredentialRepository({ admission: f.admission, stateRoot: f.stateRoot }).withLock(async tx => tx.replace(ChatGptCredentialRecordSchema.parse({
    schemaVersion: 1, revision: 1, hostId: `urn:uuid:${randomUUID()}`, clientId: "oaiapp_synthetic",
    registration: { subject: "synthetic", name: "Synthetic Operator", email: "synthetic@example.edu" },
    session: { accessToken: "synthetic-access", refreshToken: "synthetic-refresh", idToken: "synthetic-id", expiresAt: "2026-10-21T13:00:00.000Z",
      earliestRefreshAt: null, scopes: ["offline_access", "resource.invoke", "chatgpt.tokens.use.direct"], usePlan: true, usage: "available" },
  }), null));
  const canonical = createCanonicalCredentials(f.admission);
  const records = ["protected", "duo", "chatgpt"] as const;
  const values = records.map(kind => { const record = canonical.readRecord(kind); assert.ok(record); return record; });
  const session = createProfileSession({ machineRoot: f.machine.stateRoot, admission: f.machine,
    activity: { hasUnquiescedWork: () => true },
    prepareLogout: () => {
      assert.ok(database);
      return { source: database.capturePendingLogoutSource(), intentFailed(error: unknown): never { throw error; } };
    } });
  const active = session.signIn(fields);
  assert.equal(active.state, "active"); if (active.state !== "active") throw new Error("fixture activation refused");
  const owner = f.machine.admitProfile(active.profileId);
  const database = AuthorityDatabase.open(owner, { path: f.path, openMode: "read-write", migrationOwner: "cold-logout", busyTimeoutMs: 250 }, clock, undefined, undefined, undefined,
    createCredentialStore({ admission: owner, stateRoot: owner.stateRoot }));
  const binding = database.getMeta(), source = database.capturePendingLogoutSource();
  const paths = [join(f.stateRoot, "credentials", "protected.json"), join(f.stateRoot, "credentials", "chatgpt-account.json"),
    join(f.machine.stateRoot, "machine", "duo-credentials", `${active.profileId}.json`),
    join(f.machine.stateRoot, "machine", "credential-keys", `${active.profileId}.json`)];
  const retained = paths.map(path => ({ path, bytes: readFileSync(path) }));
  const interruption = new Error("synthetic logout intent interruption"), unlink = fs.unlinkSync;
  const fault = phase === "admitted" ? vi.spyOn(fs, "unlinkSync").mockImplementation(target => {
    unlink(target);
    if (String(target) !== join(f.workspace, ".tracker", "control", "profile-publication.json")) return;
    const directory = join(f.machine.stateRoot, "machine", "operations"), names = readdirSync(directory).filter(name => name.endsWith(".json"));
    assert.equal(names.length, 1); assert.ok(names[0]);
    const operation = LogoutOperationSchema.parse(JSON.parse(readFileSync(join(directory, names[0]), "utf8")));
    assert.equal(operation.profileId, active.profileId); assert.equal(operation.phase, "admitted");
    throw interruption;
  }) : undefined;
  syncBuiltinESMExports();
  try {
    if (phase === "admitted") assert.throws(() => session.logOut(active.token, { at: fields.at }), error => error === interruption);
    else assert.equal(session.logOut(active.token, { at: fields.at }).state, "cancelling");
  } finally { fault?.mockRestore(); syncBuiltinESMExports(); }
  const pending = session.logoutOperations()[0]; assert.ok(pending);
  const operationPath = join(f.machine.stateRoot, "machine", "operations", `${pending.operationId}.json`);
  const readOperation = () => LogoutOperationSchema.parse(JSON.parse(readFileSync(operationPath, "utf8")));
  if (phase === "incomplete") f.machine.publishProfileOperation({ ...readOperation(), phase });
  const operation = readOperation();
  assert.equal(operation.sessionGeneration, active.epoch);
  assert.deepEqual(operation.source, source);
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    session.close(); database.close(); owner.release(); await f.closeController(); stopped = true;
  };
  return { f, clock, active, database, operation, operationPath, readOperation, binding, retained,
    assertRetained() { for (const item of retained) assert.deepEqual(readFileSync(item.path), item.bytes); },
    async restart(mode: "exclusive" | "shared" = "exclusive", startup = false) {
      await stop();
      const lifetime = await RuntimeLifetimeLock.acquire(f.lifetime.port);
      if (startup) await initializeRegisteredPersonStores(f.workspace, lifetime, { primaryDisplay: null }, clock);
      const machine = acquireEntrypointAdmission(f.workspace, mode, lifetime);
      const runtime = composeProfileRuntime({ admission: machine, clock, hostFacts: { primaryDisplay: null } });
      return { machine, runtime, lifetime, async close() { await runtime.close(); machine.release(); await lifetime.close(); await f.close(); } };
    },
    async close() { await stop(); await f.close(); }, records, values };
}

it("finishes cold logout under shared dashboard admission, signs in again and shuts down cleanly", async () => {
  const f = await fixture(), stopped = await f.restart("shared");
  try {
    const authorized = stopped.runtime.session.authorizeLogoutContinuation(fields);
    assert.equal(authorized.state, "authorized");
    if (authorized.state !== "authorized") throw new Error("fixture continuation refused");
    assert.equal(authorized.resume().state, "cancelling");
    await stopped.runtime.awaitClosurePreparation(f.active.profileId);
    assert.equal(stopped.runtime.session.resumeLogout(f.operation.operationId).state, "signed-out");
    assert.equal(stopped.runtime.session.signIn(fields).state, "active");
    f.assertRetained();
    await stopped.runtime.close("shutdown");
  } finally { await stopped.close(); }
});

for (const interrupted of [false, true]) it(`settles a boot-observed unfinished logout before shared dashboard admission, interrupted conversion=${interrupted}`, async () => {
  const f = await fixture();
  const failure = interrupted ? vi.spyOn(settingsMaintenance, "upgradeProtectedSettings").mockRejectedValueOnce(new Error("synthetic interruption after logout settlement")) : undefined;
  const stopped = await f.restart("shared", true);
  failure?.mockRestore();
  let machine = stopped.machine, runtime = stopped.runtime;
  try {
    assert.equal(existsSync(f.operationPath), false);
    assert.equal(machine.readProfileRegistry().profiles[0]?.lifecycle, "ready");
    if (interrupted) {
      assert.throws(() => runtime.session.signIn(fields), { code: "PROFILE_STARTUP_CONVERSION_REFUSED" });
      f.assertRetained(); await runtime.close("shutdown"); machine.release();
      await initializeRegisteredPersonStores(f.f.workspace, stopped.lifetime, { primaryDisplay: null }, f.clock);
      machine = acquireEntrypointAdmission(f.f.workspace, "shared", stopped.lifetime);
      runtime = composeProfileRuntime({ admission: machine, clock: f.clock, hostFacts: { primaryDisplay: null } });
    }
    assert.equal(runtime.session.signIn(fields).state, "active");
    f.assertRetained();
  } finally { failure?.mockRestore(); await runtime.close("shutdown"); machine.release(); await stopped.close(); }
});

it("serves the unfinished logout after restart, truthfully refuses signup, continues login and stops the shared application", async () => {
  const f = await fixture(), stopped = await f.restart("shared");
  for (const name of ["package.json", "package-lock.json"]) copyFileSync(name, join(f.f.workspace, name));
  let app: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  try {
    app = await composeDashboardApplication({ admission: stopped.machine, lifetimeLock: stopped.lifetime, repoRoot: f.f.workspace,
      isolation: rebuildRuntimeIsolation, backendPortOverride: 0, frontendPortOverride: 0, clock: f.clock, env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners });
    const base = `http://127.0.0.1:${app.port}`;
    const post = async (path: string, body: unknown) => {
      const response = await fetch(`${base}/api/v1/profile/${path}`, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify(body) });
      return { status: response.status, body: PublicProfileStateSchema.parse(await response.json()) };
    };
    assert.deepEqual(await (await fetch(`${base}/api/v1/profile/state`)).json(), { state: "signed-out", signUpRequired: false, logoutIncomplete: true });
    assert.deepEqual(await post("sign-up", { email: fields.email, password: fields.password, firstName: "New", lastName: "Fixture" }), {
      status: 200, body: { state: "refused", code: "PROFILE_LOGOUT_INCOMPLETE" },
    });
    assert.equal((await post("sign-in", { email: fields.email, password: fields.password })).body.state, "cancelling");
    await vi.waitFor(async () => {
      const result = await post("sign-in", { email: fields.email, password: fields.password });
      assert.equal(result.status, 200); assert.equal(result.body.state, "active");
    });
    assert.equal(existsSync(f.operationPath), false); f.assertRetained();
    await app.stop(); app = undefined;
  } finally { await app?.stop(); await stopped.close(); }
});

it("closes shared runtime after an ordinary failed cold job while preserving unfinished logout evidence", async () => {
  const f = await fixture(), stopped = await f.restart("shared"), primary = new Error("synthetic pre-open failure");
  const failure = vi.spyOn(AuthorityDatabase, "resumePendingLogout").mockRejectedValueOnce(primary);
  try {
    const authorized = stopped.runtime.session.authorizeLogoutContinuation(fields);
    assert.equal(authorized.state, "authorized");
    if (authorized.state !== "authorized") throw new Error("fixture continuation refused");
    assert.equal(authorized.resume().state, "cancelling");
    await assert.rejects(stopped.runtime.awaitClosurePreparation(f.active.profileId), error => error === primary);
    await stopped.runtime.close("shutdown");
    assert.equal(existsSync(f.operationPath), true); f.assertRetained();
  } finally { failure.mockRestore(); await stopped.close(); }
});

it("reports an ordinary pre-open cold job failure, permits a fresh login continuation and stops cleanly", async () => {
  const f = await fixture(), stopped = await f.restart("shared"), primary = new Error("synthetic pre-open refusal");
  const failure = vi.spyOn(AuthorityDatabase, "resumePendingLogout").mockRejectedValueOnce(primary);
  try {
    const begin = () => {
      const authorized = stopped.runtime.session.authorizeLogoutContinuation(fields);
      assert.equal(authorized.state, "authorized");
      if (authorized.state !== "authorized") throw new Error("fixture continuation refused");
      return authorized.resume();
    };
    assert.equal(begin().state, "cancelling");
    await assert.rejects(stopped.runtime.awaitClosurePreparation(f.active.profileId), error => error === primary);
    assert.throws(begin, error => error === primary);
    failure.mockRestore();
    assert.equal(begin().state, "cancelling");
    await stopped.runtime.awaitClosurePreparation(f.active.profileId);
    assert.equal(stopped.runtime.session.resumeLogout(f.operation.operationId).state, "signed-out");
    assert.equal(stopped.runtime.session.signIn(fields).state, "active");
    await stopped.runtime.close("shutdown");
  } finally { failure.mockRestore(); await stopped.close(); }
});

it("returns the real schema-4 login hold over HTTP and closes the application after that failed attempt", async () => {
  const f = await createBoundProfileFixture(), source = captureProfileCredentialFixture(f.admission);
  for (const name of ["package.json", "package-lock.json"]) copyFileSync(name, join(f.workspace, name));
  createProfileRegistry(f.machine).advanceSession(null);
  await f.closeController(); installPredecessorProfileCredentials(source, "FX");
  const bytes = readFileSync(join(f.stateRoot, "credentials", "protected.json")), lifetime = await RuntimeLifetimeLock.acquire(0);
  const machine = acquireEntrypointAdmission(f.workspace, "shared", lifetime);
  let app: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  try {
    app = await composeDashboardApplication({ admission: machine, lifetimeLock: lifetime, repoRoot: f.workspace,
      isolation: rebuildRuntimeIsolation, backendPortOverride: 0, frontendPortOverride: 0, env: {} });
    const base = `http://127.0.0.1:${app.port}`, generation = machine.readProfileRegistry().sessionGeneration;
    const response = await fetch(`${base}/api/v1/profile/sign-in`, { method: "POST", headers: { origin: base, "content-type": "application/json" },
      body: JSON.stringify({ email: fields.email, password: fields.password }) });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { state: "error", code: "CREDENTIAL_CONVERSION_REQUIRED" });
    assert.equal(machine.readProfileRegistry().activeProfileId, null);
    assert.equal(machine.readProfileRegistry().sessionGeneration, generation + 2);
    const log = readFileSync(join(machine.stateRoot, "logs", "boot.jsonl"), "utf8");
    assert.ok(log.includes("CredentialMaintenanceHold")); assert.ok(log.includes("CREDENTIAL_CONVERSION_REQUIRED"));
    assert.equal(log.includes(fields.email), false); assert.equal(log.includes(fields.password), false);
    if (process.platform === "win32") await assert.rejects(app.stop(), StorageMaintenanceCustodyUnavailableError);
    else await app.stop();
    app = undefined;
    assert.deepEqual(readFileSync(join(f.stateRoot, "credentials", "protected.json")), bytes);
  } finally { await app?.stop(); machine.release(); await lifetime.close(); await f.close(); }
});

it("keeps schema-4 login refused until stopped startup converts a ready saved profile with no logout operation", async () => {
  const f = await createBoundProfileFixture(), clock = manualClock(new Date(fields.at));
  const source = captureProfileCredentialFixture(f.admission), profileId = f.admission.profileBinding.profileId;
  createProfileRegistry(f.machine).advanceSession(null);
  const otherFields = { email: "other@ucsd.edu", password: "disposable-other-password", at: fields.at };
  const setup = createProfileSession({ machineRoot: f.machine.stateRoot, admission: f.machine, clock, onboardingDuo: syntheticOnboardingDuo() });
  await finishProfileOnboarding(setup, setup.signUp({ ...otherFields, firstName: "Other", lastName: "Fixture", createdAt: fields.at }));
  setup.close(); createProfileRegistry(f.machine).advanceSession(null);
  await f.closeController();
  installPredecessorProfileCredentials(source, "FX");
  const lifetime = await RuntimeLifetimeLock.acquire(0);
  let machine = acquireEntrypointAdmission(f.workspace, "shared", lifetime);
  let runtime = composeProfileRuntime({ admission: machine, clock, hostFacts: { primaryDisplay: null } });
  try {
    assert.equal(machine.readProfileRegistry().profiles[0]?.credentialState, "saved");
    assert.equal(runtime.session.logoutOperations().length, 0);
    const generation = machine.readProfileRegistry().sessionGeneration;
    assert.throws(() => runtime.session.signIn(fields), error => error instanceof CredentialMaintenanceHold && error.code === "CREDENTIAL_CONVERSION_REQUIRED");
    assert.equal(machine.readProfileRegistry().activeProfileId, null);
    assert.equal(machine.readProfileRegistry().sessionGeneration, generation + 2);
    await runtime.close("shutdown"); machine.release();
    const bytes = readFileSync(join(f.stateRoot, "credentials", "protected.json"));
    const failure = vi.spyOn(settingsMaintenance, "upgradeProtectedSettings").mockRejectedValueOnce(new Error("synthetic closed conversion failure"));
    try { await initializeRegisteredPersonStores(f.workspace, lifetime, { primaryDisplay: null }, clock); }
    finally { failure.mockRestore(); }
    const boot = readLocalDebugLog(join(f.workspace, rebuildRuntimeIsolation.stateRoot));
    assert.equal(boot.state, "present");
    assert.equal(boot.records.some(record => record.payload.kind === "debug" && record.payload.event.area === "profile-startup-settings-upgrade"), true);
    assert.doesNotMatch(JSON.stringify(boot.records), /synthetic closed conversion failure/u);
    assert.deepEqual(readFileSync(join(f.stateRoot, "credentials", "protected.json")), bytes);
    machine = acquireEntrypointAdmission(f.workspace, "shared", lifetime);
    runtime = composeProfileRuntime({ admission: machine, clock, hostFacts: { primaryDisplay: null } });
    assert.throws(() => runtime.session.signIn(fields), { code: "PROFILE_STARTUP_CONVERSION_REFUSED" });
    const other = runtime.session.signIn(otherFields);
    assert.equal(other.state, "active");
    if (other.state !== "active") throw new Error("unaffected profile login refused");
    await runtime.drainForLogout(other.token);
    const logout = runtime.session.logOut(other.token, { at: fields.at });
    assert.equal(logout.state, "cancelling");
    if (logout.state !== "cancelling" || logout.operationId === undefined) throw new Error("unaffected profile logout refused");
    await runtime.awaitClosurePreparation(other.profileId);
    assert.equal(runtime.session.resumeLogout(logout.operationId).state, "signed-out");
    await runtime.close("shutdown"); machine.release();
    await initializeRegisteredPersonStores(f.workspace, lifetime, { primaryDisplay: null }, clock);
    machine = acquireEntrypointAdmission(f.workspace, "shared", lifetime);
    runtime = composeProfileRuntime({ admission: machine, clock, hostFacts: { primaryDisplay: null } });
    const active = runtime.session.signIn(fields);
    assert.equal(active.state, "active");
    if (active.state !== "active") throw new Error("converted fixture login refused");
    assert.equal(active.profileId, profileId);
    const canonical = createCanonicalCredentials(runtime.selectedContext(active.token).admission).readRecord("protected");
    assert.ok(canonical);
    assert.equal(Reflect.get(Object(canonical.value), "schemaVersion"), 5);
  } finally { await runtime.close("shutdown"); machine.release(); await lifetime.close(); await f.close(); }
});

for (const phase of ["admitted", "cancelling", "incomplete"] as const) it(`finishes genuine cold Logout2 ${phase} while retaining every canonical credential`, async () => {
  const f = await fixture(phase), stopped = await f.restart();
  try {
    assert.throws(() => stopped.runtime.selectedContext(f.active.token));
    const authorized = stopped.runtime.session.authorizeLogoutContinuation(fields);
    assert.equal(authorized.state, "authorized"); if (authorized.state !== "authorized") throw new Error("fresh verifier refused continuation");
    assert.equal(authorized.resume().state, "cancelling");
    assert.equal(authorized.resume().state, "refused");
    await stopped.runtime.awaitClosurePreparation(f.active.profileId);
    assert.equal(stopped.runtime.session.resumeLogout(f.operation.operationId).state, "signed-out");
    assert.equal(existsSync(f.operationPath), false);
    const registry = stopped.machine.readProfileRegistry(), row = registry.profiles.find(value => value.profileId === f.active.profileId);
    assert.equal(registry.activeProfileId, null); assert.equal(registry.sessionGeneration, f.active.epoch + 1);
    assert.equal(row?.credentialState, "saved"); assert.equal(row?.lifecycle, "ready");
    f.assertRetained();
    assert.throws(() => stopped.runtime.selectedContext(f.active.token));
    const active = stopped.runtime.session.signIn(fields);
    assert.equal(active.state, "active"); if (active.state !== "active") throw new Error("retained credentials did not allow sign-in");
    const context = stopped.runtime.selectedContext(active.token), canonical = createCanonicalCredentials(context.admission);
    assert.deepEqual(f.records.map(kind => canonical.readRecord(kind)), f.values);
    assert.equal(context.database.getMeta().installationId, f.binding.installationId);
    assert.equal(context.database.getMeta().profileId, f.active.profileId);
    f.assertRetained();
  } finally { await stopped.close(); }
});

it("refuses a second composition under the same live controller before a stopped database open", async () => {
  const f = await fixture(), runtime = composeProfileRuntime({ admission: f.f.machine, clock: f.clock, hostFacts: { primaryDisplay: null } });
  const resume = vi.spyOn(AuthorityDatabase, "resumePendingLogout");
  try {
    const before = readFileSync(f.f.path), operation = readFileSync(f.operationPath);
    const authorized = runtime.session.authorizeLogoutContinuation(fields);
    assert.equal(authorized.state, "authorized"); if (authorized.state !== "authorized") throw new Error("fresh verifier refused continuation");
    assert.throws(() => authorized.resume(), /profile-logout-cold-source-unobserved/u);
    assert.equal(authorized.resume().state, "refused"); assert.equal(resume.mock.calls.length, 0);
    assert.deepEqual(readFileSync(f.f.path), before); assert.deepEqual(readFileSync(f.operationPath), operation);
    f.assertRetained();
    assert.equal(f.database.getMeta().profileId, f.active.profileId);
  } finally { resume.mockRestore(); await runtime.close(); await f.close(); }
});

for (const dimension of ["sessionGeneration", "source", "operationId"] as const) it(`binds genuine cold boot observation to immutable ${dimension}`, async () => {
  const f = await fixture(), stopped = await f.restart();
  try {
    stopped.machine.assertColdPendingLogout(f.operation);
    const changed = LogoutOperationSchema.parse({ ...f.operation,
      ...(dimension === "sessionGeneration" ? { sessionGeneration: f.operation.sessionGeneration + 1 }
        : dimension === "source" ? { source: { database: { ...f.operation.source.database, inode: (BigInt(f.operation.source.database.inode) + 1n).toString() } } }
          : { operationId: randomUUID() }) });
    const before = readFileSync(f.f.path), operation = readFileSync(f.operationPath);
    assert.throws(() => stopped.machine.assertColdPendingLogout(changed), /profile-logout-cold-source-unobserved/u);
    assert.deepEqual(readFileSync(f.f.path), before); assert.deepEqual(readFileSync(f.operationPath), operation); f.assertRetained();
  } finally { await stopped.close(); }
});

it("does not issue ordinary authority from an incorrect cold verifier", async () => {
  const f = await fixture(), stopped = await f.restart();
  try {
    const operation = readFileSync(f.operationPath), before = readFileSync(f.f.path);
    assert.equal(stopped.runtime.session.authorizeLogoutContinuation({ ...fields, password: "incorrect-synthetic-password" }).state, "refused");
    assert.throws(() => stopped.runtime.selectedContext(f.active.token));
    assert.deepEqual(readFileSync(f.operationPath), operation); assert.deepEqual(readFileSync(f.f.path), before); f.assertRetained();
  } finally { await stopped.close(); }
});

it("keeps the actual old database open while revoking its ordinary source-capture capability", async () => {
  const f = await fixture();
  try {
    assert.equal(f.database.getMeta().profileId, f.active.profileId);
    const operation = readFileSync(f.operationPath), bytes = readFileSync(f.f.path);
    assert.throws(() => f.database.capturePendingLogoutSource());
    assert.deepEqual(readFileSync(f.operationPath), operation); assert.deepEqual(readFileSync(f.f.path), bytes); f.assertRetained();
    const registry = f.f.machine.readProfileRegistry();
    assert.equal(registry.sessionGeneration, f.operation.sessionGeneration + 1); assert.equal(registry.activeProfileId, null);
  } finally { await f.close(); }
});

it("does not transfer a genuine boot observation to an operation published after that boot", async () => {
  const f = await fixture(), stopped = await f.restart();
  try {
    const changed = LogoutOperationSchema.parse({ ...f.operation, at: "2026-10-21T12:02:00.000Z" });
    stopped.machine.publishProfileOperation(changed);
    const operation = readFileSync(f.operationPath), bytes = readFileSync(f.f.path);
    assert.throws(() => stopped.machine.assertColdPendingLogout(changed), /profile-logout-cold-source-unobserved/u);
    assert.throws(() => stopped.machine.assertColdPendingLogout(f.operation), /profile-logout-cold-source-changed/u);
    assert.deepEqual(readFileSync(f.operationPath), operation); assert.deepEqual(readFileSync(f.f.path), bytes); f.assertRetained();
  } finally { await stopped.close(); }
});

for (const boundary of ["prepared", "commit-intent", "after-commit", "done", "ready", "unlink", "writer-close", "third-image", "unknown-copy", "live-process", "browser-root", "key-replacement", "snapshot-disposal", "process-observation", "unknown", "browser-busy", "browser-unproved", "process-root-copy", "exited-process"] as const)
  it(`proves native Logout2 ${boundary} custody in an owned child before cleanup`, async () => {
    await runLogoutSettlementCase(boundary);
  });
