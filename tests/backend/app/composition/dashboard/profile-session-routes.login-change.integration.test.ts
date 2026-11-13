import assert from "node:assert/strict";
import fs, { readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { afterEach, it, vi } from "vitest";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { composeDashboardApplication } from "../../../../../src/backend/app/composition/dashboard/compose.js";
import { ProfileLoginChangeResultSchema, PublicProfileStateSchema } from "../../../../../src/models/profiles/public-profile.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";
import { syntheticOnboardingDuo } from "../../../../support/helpers/admission-fixture.js";
import { publicProfileShellFixture as fixture, readyPublicSignUp } from "../../../../support/helpers/backend/public-profile-shell.js";

afterEach(() => { vi.restoreAllMocks(); syncBuiltinESMExports(); });

it("serves password and username changes to the signed-in session only, and the changed login signs in after logout", async () => {
  const f = await fixture();
  let runtime: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  try {
    runtime = await composeDashboardApplication({ lifetimeLock: f.lifetime, admission: f.machine, isolation: rebuildRuntimeIsolation, repoRoot: f.root,
      backendPortOverride: 0, onboardingDuo: syntheticOnboardingDuo(), env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners });
    const base = `http://127.0.0.1:${String(runtime.port)}`, { post, finish } = await readyPublicSignUp(base);
    const finished = await finish();
    assert.equal(PublicProfileStateSchema.parse(await finished.json()).state, "active");
    const cookie = finished.headers.get("set-cookie")?.split(";", 1)[0]; assert.ok(cookie);
    const change = async (path: string, body: unknown, session?: string) => {
      const response = await post(`/api/v1/profile/account/${path}`, body, session);
      const json: unknown = await response.json();
      return { status: response.status, body: json };
    };

    assert.deepEqual(await change("password", { currentPassword: "disposable-fixture-password", newPassword: "changed-fixture-password" }),
      { status: 409, body: { state: "refused", code: "PROFILE_SESSION_STALE" } });
    const foreign = await fetch(`${base}/api/v1/profile/account/password`, { method: "POST", headers: { origin: "http://foreign.invalid", "content-type": "application/json", cookie },
      body: JSON.stringify({ currentPassword: "disposable-fixture-password", newPassword: "changed-fixture-password" }) });
    assert.deepEqual([foreign.status, await foreign.json()], [403, { state: "refused", code: "PROFILE_SESSION_STALE" }]);
    assert.equal((await change("password", { currentPassword: "disposable-fixture-password", newPassword: "" }, cookie)).status, 400);
    assert.equal((await change("password", { currentPassword: "disposable-fixture-password", newPassword: "p".repeat(161) }, cookie)).status, 400);
    for (const broken of ["line\nbreak", "carriage\rreturn"]) assert.equal((await change("password", { currentPassword: "disposable-fixture-password", newPassword: broken }, cookie)).status, 400);
    assert.equal((await change("username", { currentPassword: "disposable-fixture-password", newUsername: `${"u".repeat(152)}@ucsd.edu` }, cookie)).status, 400);
    assert.deepEqual(await change("password", { currentPassword: "not-the-password", newPassword: "changed-fixture-password" }, cookie),
      { status: 200, body: { state: "refused", code: "PROFILE_CURRENT_PASSWORD_REFUSED" } });

    const password = await change("password", { currentPassword: "disposable-fixture-password", newPassword: "changed-fixture-password" }, cookie);
    assert.deepEqual(password, { status: 200, body: ProfileLoginChangeResultSchema.parse({ state: "changed" }) });
    assert.deepEqual(await change("username", { currentPassword: "changed-fixture-password", newUsername: "FIXTURE@ucsd.edu" }, cookie),
      { status: 200, body: { state: "refused", code: "PROFILE_USERNAME_REFUSED" } });
    const username = await change("username", { currentPassword: "changed-fixture-password", newUsername: "fixture.changed@ucsd.edu" }, cookie);
    assert.deepEqual(username, { status: 200, body: { state: "changed" } });
    assert.equal(PublicProfileStateSchema.parse(await (await fetch(`${base}/api/v1/profile/state`, { headers: { cookie } })).json()).state, "active");

    const longest = "p".repeat(160);
    assert.deepEqual(await change("password", { currentPassword: "changed-fixture-password", newPassword: longest }, cookie), { status: 200, body: { state: "changed" } });
    assert.equal(PublicProfileStateSchema.parse(await (await post("/api/v1/profile/logout", {}, cookie)).json()).state, "signed-out");
    const old = PublicProfileStateSchema.parse(await (await post("/api/v1/profile/sign-in", { email: "fixture@ucsd.edu", password: "disposable-fixture-password" })).json());
    assert.deepEqual(old, { state: "refused", code: "PROFILE_SIGN_IN_REFUSED" });
    const signedIn = PublicProfileStateSchema.parse(await (await post("/api/v1/profile/sign-in", { email: "fixture.changed@ucsd.edu", password: longest })).json());
    assert.equal(signedIn.state, "active");
  } finally { await runtime?.stop(); f.machine.release(); rmSync(f.root, { recursive: true, force: true }); }
});

it("keeps the session after an unsettled change and settles it on the same application's next change, without logging out", async () => {
  const f = await fixture();
  let runtime: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  try {
    runtime = await composeDashboardApplication({ lifetimeLock: f.lifetime, admission: f.machine, isolation: rebuildRuntimeIsolation, repoRoot: f.root,
      backendPortOverride: 0, onboardingDuo: syntheticOnboardingDuo(), env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners });
    const base = `http://127.0.0.1:${String(runtime.port)}`, { post, finish } = await readyPublicSignUp(base);
    const finished = await finish();
    assert.equal(PublicProfileStateSchema.parse(await finished.json()).state, "active");
    const cookie = finished.headers.get("set-cookie")?.split(";", 1)[0]; assert.ok(cookie);

    // The verifier swap fails, then the one write-back that follows fails before it starts.
    const rename = fs.renameSync, open = fs.openSync;
    let failNextCredentialOpen = false;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(to).endsWith("profile-verifiers.json")) { failNextCredentialOpen = true; throw new Error("injected replacement failure"); }
      rename(from, to);
    });
    vi.spyOn(fs, "openSync").mockImplementation((path, flags, mode) => {
      if (failNextCredentialOpen && String(path).includes("/credentials/")) { failNextCredentialOpen = false; throw new Error("injected write-back failure"); }
      return open(path, flags, mode);
    });
    syncBuiltinESMExports();
    const unsettled = await post("/api/v1/profile/account/username", { currentPassword: "disposable-fixture-password", newUsername: "fixture.changed@ucsd.edu" }, cookie);
    vi.restoreAllMocks(); syncBuiltinESMExports();
    assert.deepEqual([unsettled.status, await unsettled.json()], [200, { state: "refused", code: "PROFILE_LOGIN_CHANGE_UNSETTLED" }]);
    assert.equal(unsettled.headers.get("set-cookie"), null);
    assert.equal(PublicProfileStateSchema.parse(await (await fetch(`${base}/api/v1/profile/state`, { headers: { cookie } })).json()).state, "active");

    const retried = await post("/api/v1/profile/account/password", { currentPassword: "disposable-fixture-password", newPassword: "changed-fixture-password" }, cookie);
    assert.deepEqual(await retried.json(), { state: "changed" });
    assert.equal(PublicProfileStateSchema.parse(await (await post("/api/v1/profile/logout", {}, cookie)).json()).state, "signed-out");
    assert.deepEqual(PublicProfileStateSchema.parse(await (await post("/api/v1/profile/sign-in", { email: "fixture.changed@ucsd.edu", password: "changed-fixture-password" })).json()),
      { state: "refused", code: "PROFILE_SIGN_IN_REFUSED" });
    const signedIn = await post("/api/v1/profile/sign-in", { email: "fixture@ucsd.edu", password: "changed-fixture-password" });
    assert.equal(PublicProfileStateSchema.parse(await signedIn.json()).state, "active");
  } finally { await runtime?.stop(); f.machine.release(); rmSync(f.root, { recursive: true, force: true }); }
});

it("answers an unknown outcome when a landed swap's flush and read-back both fail, and logs no secret", async () => {
  const f = await fixture();
  let runtime: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  try {
    runtime = await composeDashboardApplication({ lifetimeLock: f.lifetime, admission: f.machine, isolation: rebuildRuntimeIsolation, repoRoot: f.root,
      backendPortOverride: 0, onboardingDuo: syntheticOnboardingDuo(), env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners });
    const base = `http://127.0.0.1:${String(runtime.port)}`, { post, finish } = await readyPublicSignUp(base);
    const finished = await finish();
    assert.equal(PublicProfileStateSchema.parse(await finished.json()).state, "active");
    const cookie = finished.headers.get("set-cookie")?.split(";", 1)[0]; assert.ok(cookie);

    const rename = fs.renameSync, flush = fs.fsyncSync, read = fs.readFileSync;
    let failFlush = false, failRead = false;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => { rename(from, to); if (String(to).endsWith("profile-verifiers.json")) failFlush = true; });
    vi.spyOn(fs, "fsyncSync").mockImplementation(descriptor => {
      if (failFlush) { failFlush = false; failRead = true; throw new Error("injected flush failure"); }
      flush(descriptor);
    });
    vi.spyOn(fs, "readFileSync").mockImplementation(((path: fs.PathOrFileDescriptor, options?: unknown) => {
      if (failRead && String(path).endsWith("profile-verifiers.json")) { failRead = false; throw new Error("injected readback failure"); }
      return Reflect.apply(read, fs, options === undefined ? [path] : [path, options]) as unknown;
    }) as typeof fs.readFileSync);
    syncBuiltinESMExports();
    const unknown = await post("/api/v1/profile/account/password", { currentPassword: "disposable-fixture-password", newPassword: "changed-fixture-password" }, cookie);
    vi.restoreAllMocks(); syncBuiltinESMExports();
    assert.deepEqual([unknown.status, await unknown.json()], [200, { state: "unknown", code: "PROFILE_LOGIN_CHANGE_UNKNOWN" }]);
    for (const name of readdirSync(f.machine.stateRoot, { recursive: true }).map(String)) {
      const path = join(f.machine.stateRoot, name);
      if (statSync(path).isFile()) assert.equal(readFileSync(path).includes("changed-fixture-password"), false, name);
    }
    assert.equal(PublicProfileStateSchema.parse(await (await post("/api/v1/profile/logout", {}, cookie)).json()).state, "signed-out");
    const signedIn = await post("/api/v1/profile/sign-in", { email: "fixture@ucsd.edu", password: "changed-fixture-password" });
    assert.equal(PublicProfileStateSchema.parse(await signedIn.json()).state, "active");
  } finally { await runtime?.stop(); f.machine.release(); rmSync(f.root, { recursive: true, force: true }); }
});

it("keeps a landed change's result and marks its diagnostics unrecorded when the fault log cannot be written", async () => {
  const f = await fixture();
  let runtime: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  try {
    runtime = await composeDashboardApplication({ lifetimeLock: f.lifetime, admission: f.machine, isolation: rebuildRuntimeIsolation, repoRoot: f.root,
      backendPortOverride: 0, onboardingDuo: syntheticOnboardingDuo(), env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners });
    const base = `http://127.0.0.1:${String(runtime.port)}`, { post, finish } = await readyPublicSignUp(base);
    const finished = await finish();
    assert.equal(PublicProfileStateSchema.parse(await finished.json()).state, "active");
    const cookie = finished.headers.get("set-cookie")?.split(";", 1)[0]; assert.ok(cookie);

    const rename = fs.renameSync, flush = fs.fsyncSync, append = fs.appendFileSync;
    let failFlush = false, failAppend = false;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => { rename(from, to); if (String(to).endsWith("profile-verifiers.json")) failFlush = true; });
    vi.spyOn(fs, "fsyncSync").mockImplementation(descriptor => {
      if (failFlush) { failFlush = false; failAppend = true; throw new Error("injected flush failure"); }
      flush(descriptor);
    });
    vi.spyOn(fs, "appendFileSync").mockImplementation((...args: Parameters<typeof fs.appendFileSync>) => {
      if (failAppend) { failAppend = false; throw new Error("injected fault log failure"); }
      append(...args);
    });
    syncBuiltinESMExports();
    const changed = await post("/api/v1/profile/account/password", { currentPassword: "disposable-fixture-password", newPassword: "changed-fixture-password" }, cookie);
    vi.restoreAllMocks(); syncBuiltinESMExports();
    assert.deepEqual([changed.status, await changed.json()], [200, { state: "changed", durability: "unconfirmed", diagnostics: "unrecorded" }]);
    assert.equal(PublicProfileStateSchema.parse(await (await post("/api/v1/profile/logout", {}, cookie)).json()).state, "signed-out");
    const signedIn = await post("/api/v1/profile/sign-in", { email: "fixture@ucsd.edu", password: "changed-fixture-password" });
    assert.equal(PublicProfileStateSchema.parse(await signedIn.json()).state, "active");
  } finally { await runtime?.stop(); f.machine.release(); rmSync(f.root, { recursive: true, force: true }); }
});
