import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { composeProfileRuntime } from "../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { createProfileSession } from "../../../src/backend/profiles/profile-session.js";
import { createProfileRegistry } from "../../../src/backend/profiles/registry.js";
import { acquireEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { RuntimeLifetimeLock } from "../../../src/backend/storage/admission/lifetime-lock.js";
import { createCredentialStore } from "../../../src/backend/storage/configuration/credential-store.js";
import { AuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import { LogoutOperationSchema } from "../../../src/models/profiles/profile.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { finishProfileOnboarding, syntheticOnboardingDuo } from "../../support/helpers/admission-fixture.js";

const fields = { email: "fixture@ucsd.edu", password: "disposable-fixture-password", at: "2026-10-22T12:01:00.000Z" };
async function fixture(withForeign = false) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "profile-logout-continuation-")));
  const originalLifetime = await RuntimeLifetimeLock.acquire(0), clock = manualClock(new Date(fields.at));
  const originalMachine = acquireEntrypointAdmission(root, "exclusive", originalLifetime);
  mkdirSync(join(root, rebuildRuntimeIsolation.processLockRoot), { recursive: true, mode: 0o700 });
  if (withForeign) {
    const runtime = composeProfileRuntime({ admission: originalMachine, clock, hostFacts: { primaryDisplay: null },
      onboardingDuo: syntheticOnboardingDuo(() => "foreign@ucsd.edu") });
    try {
      const foreign = await finishProfileOnboarding(runtime.session, runtime.session.signUp({ email: "foreign@ucsd.edu", password: "foreign-fixture-password",
        firstName: "Other", lastName: "Fixture", createdAt: "2026-10-22T11:59:00.000Z" }));
      assert.equal(foreign.state, "active"); if (foreign.state !== "active") throw new Error("actual foreign fixture signup required");
      const pending = runtime.session.logOut(foreign.token, { at: fields.at });
      assert.equal(pending.state, "cancelling"); if (pending.state !== "cancelling" || pending.operationId === undefined) throw new Error("foreign logout intent required");
      await runtime.awaitClosurePreparation(foreign.profileId);
      assert.equal(runtime.session.resumeLogout(pending.operationId).state, "signed-out");
    } finally { await runtime.close(); }
  }
  const source = createProfileSession({ machineRoot: originalMachine.stateRoot, admission: originalMachine, clock,
    onboardingDuo: syntheticOnboardingDuo(() => fields.email),
    activity: { hasUnquiescedWork: () => true },
    prepareLogout: () => {
      assert.ok(database);
      return { source: database.capturePendingLogoutSource(), intentFailed(error: unknown): never { throw error; } };
    } });
  const active = await finishProfileOnboarding(source, source.signUp({ ...fields, firstName: "Fixture", lastName: "Operator", createdAt: "2026-10-22T12:00:00.000Z" }));
  assert.equal(active.state, "active"); if (active.state !== "active") throw new Error("actual fixture signup required");
  const sourceOwner = originalMachine.admitProfile(active.profileId);
  const database = AuthorityDatabase.open(sourceOwner, { path: join(sourceOwner.stateRoot, "state.db"), openMode: "read-write" }, clock,
    undefined, undefined, undefined, createCredentialStore({ admission: sourceOwner, stateRoot: sourceOwner.stateRoot }));
  const pending = source.logOut(active.token, { at: fields.at });
  assert.equal(pending.state, "cancelling"); if (pending.state !== "cancelling" || pending.operationId === undefined) throw new Error("actual pending logout required");
  await source.closeOnboarding(); source.close(); database.close(); sourceOwner.release(); originalMachine.release(); await originalLifetime.close();
  const lifetime = await RuntimeLifetimeLock.acquire(originalLifetime.port), machine = acquireEntrypointAdmission(root, "exclusive", lifetime);
  const owners: { close(): Promise<void> }[] = [];
  const runtimeBySession = new Map<ReturnType<typeof createProfileSession>, ReturnType<typeof composeProfileRuntime>>();
  const open = (observe = true) => {
    if (observe) {
      const runtime = composeProfileRuntime({ admission: machine, clock, hostFacts: { primaryDisplay: null } });
      owners.push(runtime); runtimeBySession.set(runtime.session, runtime); return runtime.session;
    }
    const session = createProfileSession({ machineRoot: machine.stateRoot, admission: machine, clock });
    owners.push({ async close() { await session.closeOnboarding(); session.close(); } }); return session;
  };
  const credentials = join(machine.stateRoot, "profiles", active.profileId, "credentials", "protected.json");
  const retained = [credentials, join(machine.stateRoot, "profiles", active.profileId, "credentials", "chatgpt-account.json"),
    join(machine.stateRoot, "machine", "duo-credentials", `${active.profileId}.json`),
    join(machine.stateRoot, "machine", "credential-keys", `${active.profileId}.json`)].map(path => ({ path, bytes: readFileSync(path) }));
  return { machine, active, pending, credentials, open,
    assertRetained() { for (const item of retained) assert.deepEqual(readFileSync(item.path), item.bytes); },
    async finish(session: ReturnType<typeof createProfileSession>, authorization: ReturnType<ReturnType<typeof createProfileSession>["authorizeLogoutContinuation"]>) {
      if (authorization.state !== "authorized") throw new Error("genuine continuation required");
      assert.equal(authorization.resume().state, "cancelling");
      const runtime = runtimeBySession.get(session); assert.ok(runtime);
      await runtime.awaitClosurePreparation(active.profileId);
      assert.ok(pending.operationId);
      assert.equal(session.resumeLogout(pending.operationId).state, "signed-out");
    },
    async cleanup() { for (const owner of owners.reverse()) await owner.close(); machine.release(); await lifetime.close(); rmSync(root, { recursive: true, force: true }); } };
}

it("requires a fresh password and normal lockout before issuing a server-only logout continuation", async () => {
  const f = await fixture();
  try {
    const session = f.open();
    assert.equal(session.signIn({ ...fields, password: "wrong" }).state, "cancelling");
    for (let attempt = 0; attempt < 5; attempt++) assert.equal(session.authorizeLogoutContinuation({ ...fields, password: "wrong" }).state, "refused");
    assert.equal(session.authorizeLogoutContinuation(fields).state, "refused");
    assert.equal(session.authorizeLogoutContinuation({ ...fields, email: "foreign@ucsd.edu" }).state, "refused");
    f.assertRetained();
    assert.equal(session.logoutOperations().length, 1); assert.equal(f.machine.readProfileRegistry().activeProfileId, null);
    const authorized = session.authorizeLogoutContinuation({ ...fields, at: "2026-10-22T12:03:00.000Z" });
    assert.equal(authorized.state, "authorized"); assert.equal("token" in authorized, false); assert.equal("profileId" in authorized, false);
  } finally { await f.cleanup(); }
});

it("consumes exact pending-operation authority once and never grants an ordinary session", async () => {
  const f = await fixture();
  try {
    const session = f.open(), authorized = session.authorizeLogoutContinuation(fields);
    assert.equal(authorized.state, "authorized"); if (authorized.state !== "authorized") throw new Error("genuine continuation required");
    await f.finish(session, authorized);
    assert.equal(authorized.resume().state, "refused"); assert.equal(session.authorizeLogoutContinuation(fields).state, "refused");
    assert.equal(session.logoutOperations().length, 0); assert.equal(f.machine.readProfileRegistry().activeProfileId, null); f.assertRetained();
    const stale = session.readFile(f.active.token, "credentials/protected.json");
    assert.ok(!(stale instanceof Uint8Array)); if (!(stale instanceof Uint8Array)) assert.equal(stale.state, "refused");
  } finally { await f.cleanup(); }
});

for (const mutation of ["operation", "epoch", "owner-close"] as const) it(`refuses a logout continuation after ${mutation} changes`, async () => {
  const f = await fixture();
  try {
    const session = f.open(), authorized = session.authorizeLogoutContinuation(fields);
    if (authorized.state !== "authorized") throw new Error("genuine continuation required");
    if (mutation === "operation") {
      const path = join(f.machine.stateRoot, "machine", "operations", `${f.pending.operationId}.json`);
      const operation = LogoutOperationSchema.parse(JSON.parse(readFileSync(path, "utf8")));
      f.machine.publishProfileOperation({ ...operation, phase: "incomplete" });
    } else if (mutation === "epoch") createProfileRegistry(f.machine).advanceSession(null);
    else session.close();
    assert.equal(authorized.resume().state, "refused"); f.assertRetained(); assert.equal(session.logoutOperations().length, 1);
  } finally { await f.cleanup(); }
});

it("does not invent cold process or inventory custody after fresh authentication", async () => {
  const f = await fixture();
  try {
    const session = f.open(false), authorized = session.authorizeLogoutContinuation(fields);
    if (authorized.state !== "authorized") throw new Error("genuine continuation required");
    assert.equal(authorized.resume().state, "cancelling"); assert.equal(authorized.resume().state, "refused");
    f.assertRetained(); assert.equal(f.machine.readProfileRegistry().activeProfileId, null);
  } finally { await f.cleanup(); }
});

it("supersedes an older issued continuation without accepting a client operation identity", async () => {
  const f = await fixture();
  try {
    const session = f.open(), older = session.authorizeLogoutContinuation(fields), current = session.authorizeLogoutContinuation(fields);
    if (older.state !== "authorized" || current.state !== "authorized") throw new Error("genuine continuations required");
    assert.equal(older.resume().state, "refused"); assert.equal("operationId" in current, false); assert.equal("token" in current, false); f.assertRetained();
    await f.finish(session, current); assert.equal(current.resume().state, "refused"); f.assertRetained();
  } finally { await f.cleanup(); }
});

it("does not authorize a different genuine profile to continue the pending logout", async () => {
  const f = await fixture(true);
  try {
    const session = f.open();
    assert.equal(session.authorizeLogoutContinuation({ email: "foreign@ucsd.edu", password: "foreign-fixture-password", at: fields.at }).state, "refused");
    f.assertRetained(); assert.equal(session.logoutOperations().length, 1); assert.equal(session.logoutOperations()[0]?.profileId, f.active.profileId);
  } finally { await f.cleanup(); }
});
