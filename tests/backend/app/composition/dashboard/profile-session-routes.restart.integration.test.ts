import assert from "node:assert/strict";
import { copyFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { it } from "vitest";
import { composeDashboardApplication } from "../../../../../src/backend/app/composition/dashboard/profile-session-routes.js";
import { acquireEntrypointAdmission } from "../../../../../src/backend/storage/admission/bootstrap-admission.js";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { createDashboardClient } from "../../../../../src/dashboard/client/index.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { createBoundProfileFixture } from "../../../../support/helpers/admission-fixture.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";
import { createProfileSession } from "../../../../../src/backend/profiles/profile-session.js";
import { createCredentialStore } from "../../../../../src/backend/storage/configuration/credential-store.js";
import { AuthoritySourceClosureUnprovedError } from "../../../../../src/backend/storage/source-closure.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH, ProtectedSettingsApplyInputSchema, type ProtectedSettingsApplyInput } from "../../../../../src/models/config/protected-settings.js";

const fields = { email: "fixture@ucsd.edu", password: "disposable-fixture-password", at: "2026-11-04T12:00:00.000Z" };

for (const mode of ["signin", "resume"] as const) for (const fault of ["username", "password", "missing", "read", "closure"] as const) {
  it(`keeps the selected profile after ${mode} fails at ${fault}, without admitting refused custody`, async () => {
    const f = await createBoundProfileFixture(), profileId = f.admission.profileBinding.profileId;
    const injected = fault === "closure" ? new AuthoritySourceClosureUnprovedError([new Error("synthetic closure failure")]) : new Error("synthetic credential read failure");
    let failing = true, closures = 0;
    const session = createProfileSession({ machineRoot: f.machine.stateRoot, admission: f.machine,
      credentialsFor: owner => {
        if (failing && (fault === "read" || fault === "closure")) throw injected;
        return createCredentialStore({ admission: owner, stateRoot: owner.stateRoot });
      },
      closeStorage: () => { closures++; },
    });
    const save = (entries: ProtectedSettingsApplyInput["entries"]) => {
      const owner = f.machine.admitProfile(profileId);
      try {
        const store = createCredentialStore({ admission: owner, stateRoot: owner.stateRoot });
        assert.equal(store.apply(ProtectedSettingsApplyInputSchema.parse({ commandId: randomUUID(), writeId: randomUUID(),
          commandFingerprint: "a".repeat(64), expectedRevision: store.read().revision,
          protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, updatedAt: fields.at, entries })).state, "applied");
      } finally { owner.release(); }
    };
    try {
      if (fault === "username") save({ ucpathUserId: { set: "other@ucsd.edu" } });
      if (fault === "password") save({ ucpathPassword: { set: "different-fixture-password" } });
      if (fault === "missing") save({ ucpathPassword: { clear: true } });
      const attempt = () => mode === "signin" ? session.signIn(fields) : session.resumeSignedInProfile({ at: fields.at });
      if (fault === "read" || fault === "closure") assert.throws(attempt, error => error === injected);
      else assert.equal(attempt().state, "refused");
      assert.equal(f.machine.readProfileRegistry().activeProfileId, profileId);
      assert.deepEqual(session.logoutOperations(), []);
      if (fault === "closure") {
        assert.equal(closures, 0, "unproved credential custody must remain held");
        return;
      }
      failing = false;
      save({ ucpathUserId: { set: fields.email }, ucpathPassword: { set: fields.password } });
      assert.equal(session.resumeSignedInProfile({ at: fields.at }).state, "active");
    } finally { session.close(); await f.close(); }
  });
}

it("preserves the selection and refuses each attempt while prior runtime closure is unproved", async () => {
  const f = await createBoundProfileFixture();
  const before = f.machine.readProfileRegistry();
  let closed = false;
  const session = createProfileSession({ machineRoot: f.machine.stateRoot, admission: f.machine,
    sessionChange: () => closed ? { state: "closed" } : { state: "refused", code: "PROFILE_TRANSITION_BLOCKED", message: "Synthetic closure remains unproved." } });
  try {
    for (const attempt of [() => session.signIn(fields), () => session.resumeSignedInProfile({ at: fields.at })]) {
      assert.equal(attempt().state, "refused");
      assert.deepEqual(f.machine.readProfileRegistry(), before);
    }
    closed = true;
    assert.equal(session.resumeSignedInProfile({ at: fields.at }).state, "active");
  } finally { session.close(); await f.close(); }
});

it("keeps the saved session through wrong passwords, unknown usernames and loss of process-local tokens", async () => {
  const f = await createBoundProfileFixture(), before = f.machine.readProfileRegistry();
  const lost = createProfileSession({ machineRoot: f.machine.stateRoot, admission: f.machine });
  const restarted = createProfileSession({ machineRoot: f.machine.stateRoot, admission: f.machine });
  try {
    for (const credentials of [{ ...fields, password: "wrong-fixture-password" }, { ...fields, email: "unknown@ucsd.edu" }]) {
      assert.equal(lost.signIn(credentials).state, "refused");
      assert.deepEqual(f.machine.readProfileRegistry(), before);
    }
    assert.equal(restarted.resumeSignedInProfile({ at: fields.at }).state, "active");
    assert.equal(f.machine.readProfileRegistry().activeProfileId, before.activeProfileId);
  } finally { restarted.close(); lost.close(); await f.close(); }
});

it.each(["logout", "delete-account"] as const)("only explicit %s ends a session across browser replacement and real restarts", async ending => {
  const f = await createBoundProfileFixture({ sharedMachine: true }), clock = manualClock(new Date("2026-11-04T12:00:00Z"));
  const otherCheckout = join(f.workspace, "other-checkout"); mkdirSync(otherCheckout);
  for (const checkout of [f.workspace, otherCheckout]) {
    for (const name of ["package.json", "package-lock.json"]) copyFileSync(name, join(checkout, name));
  }
  let repoRoot = f.workspace;
  let machine = f.machine, app: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  let origin = "", cookie: string | undefined, spawns = 0;
  const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => {
    const response = await fetch(`${origin}${new URL(url).pathname}`, { ...init,
      headers: { ...init?.headers, origin, ...(cookie === undefined ? {} : { cookie }) } });
    const next = response.headers.get("set-cookie"); if (next !== null) cookie = next.split(";", 1)[0];
    return response;
  } });
  const start = async () => {
    const running = await composeDashboardApplication({ admission: machine, lifetimeLock: f.lifetime, repoRoot, isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0, frontendPortOverride: 0, clock, env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners,
      workerProcess: { spawn() { spawns++; throw new Error("planning must not spawn a worker"); } } });
    origin = `http://127.0.0.1:${running.port}`;
    return running;
  };
  try {
    app = await start();
    const first = await client.signInProfile({ email: "fixture@ucsd.edu", password: "disposable-fixture-password" });
    assert.equal(first.state, "active"); if (first.state !== "active") throw new Error("actual initial sign-in required");
    await client.bootstrap(); assert.ok(cookie); const oldCookie = cookie;
    cookie = undefined;
    await assert.rejects(client.bootstrap());
    assert.deepEqual(await client.readProfileSession(), { state: "signed-out", signUpRequired: false, resumable: true });
    assert.deepEqual(await client.resumeProfile(), first);
    await client.bootstrap();
    await app?.stop(); app = undefined;
    machine = acquireEntrypointAdmission(f.workspace, "shared", f.lifetime);
    repoRoot = otherCheckout;
    app = await start();
    cookie = undefined;
    await assert.rejects(client.bootstrap());
    assert.deepEqual(await client.readProfileSession(), { state: "signed-out", signUpRequired: false, resumable: true });
    const resumed = await client.resumeProfile();
    assert.equal(resumed.state, "active"); if (resumed.state !== "active") throw new Error("current resume authority required");
    assert.equal(resumed.profileId, first.profileId); assert.ok(resumed.epoch > first.epoch); assert.notEqual(cookie, oldCookie);
    await client.bootstrap();
    for (const rejectedCookie of [oldCookie, oldCookie.replace(/=.*/u, "=foreign")]) {
      const response = await fetch(`${origin}/api/v1/bootstrap`, { headers: { cookie: rejectedCookie } });
      assert.equal(response.status, 401); assert.deepEqual(await response.json(), { state: "refused", code: "PROFILE_SESSION_STALE" });
    }
    for (const input of [
      { workflowId: "person-lookup", submissions: [{ emplId: "10873698" }], dryRun: false },
      { workflowId: "separations", submissions: [{ documentNumber: "4510" }], dryRun: true },
    ]) assert.deepEqual((await client.submitStartPlan({ ...input, browserMode: "headless", captureBrowserScreenshots: false })).refused, []);
    assert.equal(spawns, 0);
    await app?.stop(); app = undefined;
    machine = acquireEntrypointAdmission(f.workspace, "shared", f.lifetime);
    repoRoot = f.workspace;
    app = await start(); cookie = undefined;
    assert.deepEqual(await client.readProfileSession(), { state: "signed-out", signUpRequired: false, resumable: true });
    const final = await client.resumeProfile();
    assert.equal(final.state, "active"); if (final.state !== "active") throw new Error("final resume required");
    await client.bootstrap();
    assert.ok(cookie); const browserA = cookie;
    cookie = undefined;
    assert.deepEqual(await client.readProfileSession(), { state: "signed-out", signUpRequired: false, resumable: true });
    assert.deepEqual(await client.resumeProfile(), final);
    assert.ok(cookie); const browserB = cookie;
    const browsers = [browserA, browserB];
    assert.deepEqual(await Promise.all(browsers.map(async browserCookie =>
      (await fetch(`${origin}/api/v1/bootstrap`, { headers: { cookie: browserCookie } })).status)), [200, 200]);
    const foreign = await fetch(`${origin}/api/v1/profile/resume`, { method: "POST", headers: { origin: "https://foreign.invalid", "content-type": "application/json" }, body: "{}" });
    assert.equal(foreign.status, 403); assert.equal(foreign.headers.get("set-cookie"), null);
    assert.equal(machine.readProfileRegistry().activeProfileId, final.profileId);
    assert.equal((await (ending === "logout" ? client.logOutProfile()
      : client.deleteProfileAccount({ confirmed: true, expectedProfileId: final.profileId, expectedEpoch: final.epoch }))).state, "signed-out");
    assert.equal(machine.readProfileRegistry().activeProfileId, null);
    assert.deepEqual(await Promise.all(browsers.map(async browserCookie =>
      (await fetch(`${origin}/api/v1/bootstrap`, { headers: { cookie: browserCookie } })).status)), [401, 401]);
    assert.equal((await client.readProfileSession()).state, "signed-out");
    assert.deepEqual(await client.resumeProfile(), { state: "refused", code: "PROFILE_SIGN_IN_REFUSED" });
    await assert.rejects(client.bootstrap());
  } finally { await app?.stop(); await f.close(); }
});
