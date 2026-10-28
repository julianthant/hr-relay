import { runtimeLifetimeLock } from "../../support/helpers/backend/runtime-lifetime.js";
import { finishProfileOnboarding } from "../../support/helpers/admission-fixture.js";
import { composeProfileCredentialInitializationInventory, composeProfileCredentialRepairInventory } from "../../../src/backend/app/composition/profile-credential-inventory.js";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { systemClock } from "../../../src/rules/time/clock.js";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { acquireEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { createSyntheticProfileSession as createProfileSession } from "../../support/helpers/admission-fixture.js";
import { createProfileRegistry } from "../../../src/backend/profiles/registry.js";
import { LogoutOperationSchema } from "../../../src/models/profiles/profile.js";

const fields = { email: "fixture@ucsd.edu", password: "disposable-fixture-password", at: "2026-10-22T12:01:00.000Z" };
async function fixture(withForeign = false) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "profile-logout-continuation-")));
  const lifetime = await runtimeLifetimeLock();
  const machine = acquireEntrypointAdmission(root, "shared", lifetime);
  mkdirSync(join(root, rebuildRuntimeIsolation.processLockRoot), { recursive: true, mode: 0o700 });
  let busy = true;
  const owners: ReturnType<typeof createProfileSession>[] = [];
  const open = (observe = true) => {
    const session = createProfileSession({ machineRoot: machine.stateRoot, admission: machine,
      initializationInventory: (child, operation, writer, copies) => composeProfileCredentialInitializationInventory({ machine, admission: child, clock: systemClock, hostFacts: { primaryDisplay: null } })(operation, writer, copies),
      repairInventory: (child, request, writer, copies) => composeProfileCredentialRepairInventory({ machine, admission: child, clock: systemClock, hostFacts: { primaryDisplay: null } })(request, writer, copies),
      ...(observe ? { activity: { hasUnquiescedWork: () => busy } } : {}), backupPaths: () => [], loginDataPaths: () => [] });
    owners.push(session); return session;
  };
  const session = open();
  if (withForeign) {
    const foreign = await finishProfileOnboarding(session, session.signUp({ email: "foreign@ucsd.edu", password: "foreign-fixture-password", firstName: "Other", lastName: "Fixture", createdAt: "2026-10-22T11:59:00.000Z" }));
    assert.equal(foreign.state, "active");
    if (foreign.state !== "active") throw new Error("actual foreign fixture signup required");
    busy = false;
    assert.equal(session.logOut(foreign.token, { at: fields.at }).state, "wiped");
    busy = true;
  }
  const active = await finishProfileOnboarding(session, session.signUp({ ...fields, firstName: "Fixture", lastName: "Operator", createdAt: "2026-10-22T12:00:00.000Z" }));
  assert.equal(active.state, "active");
  if (active.state !== "active") throw new Error("actual fixture signup required");
  const pending = session.logOut(active.token, { at: fields.at });
  assert.equal(pending.state, "cancelling");
  if (pending.state !== "cancelling" || pending.operationId === undefined) throw new Error("actual pending logout required");
  await session.close();
  const credentials = join(machine.stateRoot, "profiles", active.profileId, "credentials", "protected.json");
  return { machine, active, pending, credentials, open, idle() { busy = false; },
    async cleanup() { for (const owner of owners.reverse()) await owner.close(); machine.release(); rmSync(root, { recursive: true, force: true }); } };
}

it("requires a fresh password and normal lockout before issuing a server-only logout continuation", async () => {
  const f = await fixture();
  try {
    const session = f.open(), before = readFileSync(f.credentials);
    assert.equal(session.signIn({ ...fields, password: "wrong" }).state, "cancelling");
    for (let attempt = 0; attempt < 5; attempt++) assert.equal(session.authorizeLogoutContinuation({ ...fields, password: "wrong" }).state, "refused");
    assert.equal(session.authorizeLogoutContinuation(fields).state, "refused");
    assert.equal(session.authorizeLogoutContinuation({ ...fields, email: "foreign@ucsd.edu" }).state, "refused");
    assert.equal(readFileSync(f.credentials).equals(before), true);
    assert.equal(session.logoutOperations().length, 1);
    assert.equal(f.machine.readProfileRegistry().activeProfileId, null);
    const authorized = session.authorizeLogoutContinuation({ ...fields, at: "2026-10-22T12:03:00.000Z" });
    assert.equal(authorized.state, "authorized");
    assert.equal("token" in authorized, false);
    assert.equal("profileId" in authorized, false);
  } finally { await f.cleanup(); }
});

it("consumes exact pending-operation authority once and never grants an ordinary session", async () => {
  const f = await fixture();
  try {
    const session = f.open();
    const authorized = session.authorizeLogoutContinuation(fields);
    assert.equal(authorized.state, "authorized");
    if (authorized.state !== "authorized") throw new Error("genuine continuation required");
    f.idle();
    assert.equal(authorized.resume().state, "wiped");
    assert.equal(authorized.resume().state, "refused");
    assert.equal(session.authorizeLogoutContinuation(fields).state, "refused");
    assert.equal(session.logoutOperations().length, 0);
    assert.equal(f.machine.readProfileRegistry().activeProfileId, null);
    const stale = session.readFile(f.active.token, "credentials/protected.json");
    assert.ok(!(stale instanceof Uint8Array));
    if (!(stale instanceof Uint8Array)) assert.equal(stale.state, "refused");
  } finally { await f.cleanup(); }
});

for (const mutation of ["operation", "epoch", "owner-close"] as const) it(`refuses a logout continuation after ${mutation} changes`, async () => {
  const f = await fixture();
  try {
    const session = f.open(), before = readFileSync(f.credentials);
    const authorized = session.authorizeLogoutContinuation(fields);
    if (authorized.state !== "authorized") throw new Error("genuine continuation required");
    if (mutation === "operation") {
      const path = join(f.machine.stateRoot, "machine", "operations", `${f.pending.operationId}.json`);
      const operation = LogoutOperationSchema.parse(JSON.parse(readFileSync(path, "utf8")));
      f.machine.publishProfileOperation({ ...operation, phase: "incomplete" });
    } else if (mutation === "epoch") createProfileRegistry(f.machine).advanceSession(null);
    else await session.close();
    f.idle();
    assert.equal(authorized.resume().state, "refused");
    assert.equal(readFileSync(f.credentials).equals(before), true);
    assert.equal(session.logoutOperations().length, 1);
  } finally { await f.cleanup(); }
});

it("does not invent cold process or inventory custody after fresh authentication", async () => {
  const f = await fixture();
  try {
    const session = f.open(false), before = readFileSync(f.credentials);
    const authorized = session.authorizeLogoutContinuation(fields);
    if (authorized.state !== "authorized") throw new Error("genuine continuation required");
    assert.equal(authorized.resume().state, "cancelling");
    assert.equal(authorized.resume().state, "refused");
    assert.equal(readFileSync(f.credentials).equals(before), true);
    assert.equal(f.machine.readProfileRegistry().activeProfileId, null);
  } finally { await f.cleanup(); }
});

it("supersedes an older issued continuation without accepting a client operation identity", async () => {
  const f = await fixture();
  try {
    const session = f.open(), before = readFileSync(f.credentials);
    const older = session.authorizeLogoutContinuation(fields), current = session.authorizeLogoutContinuation(fields);
    if (older.state !== "authorized" || current.state !== "authorized") throw new Error("genuine continuations required");
    assert.equal(older.resume().state, "refused");
    assert.equal("operationId" in current, false);
    assert.equal("token" in current, false);
    assert.equal(readFileSync(f.credentials).equals(before), true);
    f.idle();
    assert.equal(current.resume().state, "wiped");
    assert.equal(current.resume().state, "refused");
  } finally { await f.cleanup(); }
});

it("does not authorize a different genuine profile to continue the pending logout", async () => {
  const f = await fixture(true);
  try {
    const session = f.open(), before = readFileSync(f.credentials);
    assert.equal(session.authorizeLogoutContinuation({ email: "foreign@ucsd.edu", password: "foreign-fixture-password", at: fields.at }).state, "refused");
    assert.equal(readFileSync(f.credentials).equals(before), true);
    assert.equal(session.logoutOperations().length, 1);
    assert.equal(session.logoutOperations()[0]?.profileId, f.active.profileId);
  } finally { await f.cleanup(); }
});
