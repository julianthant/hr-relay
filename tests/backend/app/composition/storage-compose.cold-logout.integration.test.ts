import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { it, vi } from "vitest";
import { composeProfileRuntime } from "../../../../src/backend/app/composition/storage-compose.js";
import { createProfileSession } from "../../../../src/backend/profiles/profile-session.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
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
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

const fields = { email: "fixture@ucsd.edu", password: "disposable-fixture-password", at: "2026-10-21T12:01:00.000Z" };

async function fixture(phase: "admitted" | "cancelling" | "incomplete" = "cancelling") {
  const f = await createBoundProfileFixture(), clock = manualClock(new Date(fields.at));
  const credentials = createCredentialStore({ admission: f.admission, stateRoot: f.stateRoot });
  assert.equal(credentials.apply(ProtectedSettingsApplyInputSchema.parse({ commandId: randomUUID(), writeId: randomUUID(),
    commandFingerprint: "a".repeat(64), expectedRevision: credentials.read().revision, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
    updatedAt: fields.at, entries: { ucpathUserId: { set: "synthetic-user" }, ucpathPassword: { set: "synthetic-password" } } })).state, "applied");
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
  const database = AuthorityDatabase.open(owner, { path: f.path, openMode: "read-write" }, clock, undefined, undefined, undefined,
    createCredentialStore({ admission: owner, stateRoot: owner.stateRoot }));
  const binding = database.getMeta(), source = database.capturePendingLogoutSource();
  const paths = [join(f.stateRoot, "credentials", "protected.json"), join(f.stateRoot, "credentials", "chatgpt-account.json"),
    join(f.machine.stateRoot, "machine", "duo-credentials", `${active.profileId}.json`),
    join(f.machine.stateRoot, "machine", "credential-keys", `${active.profileId}.json`)];
  const retained = paths.map(path => ({ path, bytes: readFileSync(path) }));
  const interruption = new Error("synthetic logout intent interruption"), publish = Object.getOwnPropertyDescriptors(RuntimeAdmission.prototype).publishProfileOperation.value;
  assert.ok(publish);
  const fault = phase === "admitted" ? vi.spyOn(RuntimeAdmission.prototype, "publishProfileOperation").mockImplementation(function (this: RuntimeAdmission, operation) {
    publish.call(this, operation);
    if (this === f.machine && typeof operation !== "string" && operation.kind === "logout") throw interruption;
  }) : undefined;
  try {
    if (phase === "admitted") assert.throws(() => session.logOut(active.token, { at: fields.at }), error => error === interruption);
    else assert.equal(session.logOut(active.token, { at: fields.at }).state, "cancelling");
  } finally { fault?.mockRestore(); }
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
    async restart() {
      await stop();
      const lifetime = await RuntimeLifetimeLock.acquire(f.lifetime.port);
      const machine = acquireEntrypointAdmission(f.workspace, "exclusive", lifetime);
      const runtime = composeProfileRuntime({ admission: machine, clock, hostFacts: { primaryDisplay: null } });
      return { machine, runtime, async close() { await runtime.close(); machine.release(); await lifetime.close(); await f.close(); } };
    },
    async close() { await stop(); await f.close(); }, records, values };
}

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
        : dimension === "source" ? { source: { database: { ...f.operation.source.database, inode: f.operation.source.database.inode + 1 } } }
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
