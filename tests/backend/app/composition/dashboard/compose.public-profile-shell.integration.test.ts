import { assertRuntimeLifetimeHeld, runtimeLifetimeLock } from "../../../../support/helpers/backend/runtime-lifetime.js";
import { request as httpRequest } from "node:http";
import { randomBytes, createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { ProfileSessionRefusedError } from "../../../../../src/backend/profiles/profile-errors.js";
import { ProfileOnboardingDuoProviderError } from "../../../../../src/backend/runtime/browser/onboarding-duo-provider.js";
import { DashboardStreamHub } from "../../../../../src/backend/transports/http/subscriptions/dashboard-stream.js";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, vi } from "vitest";
import * as httpServer from "../../../../../src/backend/transports/http/http-server.js";
import { AuthoritySourceClosureUnprovedError, createBrowserSourceRecovery } from "../../../../../src/backend/storage/source-closure.js";
import * as storageCompose from "../../../../../src/backend/app/composition/storage-compose.js";
import * as debugEvents from "../../../../../src/backend/logs/debug-events.js";

vi.mock("../../../../../src/backend/transports/http/http-server.js", { spy: true });
vi.mock("../../../../../src/backend/app/composition/storage-compose.js", { spy: true });
import { composeDashboardApplication } from "../../../../../src/backend/app/composition/dashboard/compose.js";
import { publicProfileShellFixture as fixture, readyPublicSignUp } from "../../../../support/helpers/backend/public-profile-shell.js";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { PublicProfileStateSchema } from "../../../../../src/models/profiles/public-profile.js";
import { FrontendBootstrapWireSchema } from "../../../../../src/models/dashboard/bootstrap.js";
import { ProfileVerifierDocumentSchema, SignUpOperationSchema } from "../../../../../src/models/profiles/profile.js";
import type { DraftDuoCapability, ProfileOnboardingDuoProvider } from "../../../../../src/backend/profiles/onboarding-duo.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";
import { syntheticOnboardingDuo } from "../../../../support/helpers/admission-fixture.js";

async function finishPublicSignUp(base: string): Promise<Response> {
  return (await readyPublicSignUp(base)).finish();
}

for (const scenario of [{ action: "complete", withCause: true, unknownFirst: true }, { action: "cancel", withCause: true, unknownFirst: true },
  ...(["cancel", "complete"] as const).flatMap(action => [false, true].map(withCause => ({ action, withCause, unknownFirst: false })))])
  it(`recovers exact public browser custody before ${scenario.action} (cause=${scenario.withCause}, Unknown=${scenario.unknownFirst})`, async () => {
    const f = await fixture(), primary = new AuthoritySourceClosureUnprovedError([new Error("synthetic native browser closure unproved")]);
    const sourceRecovery = createBrowserSourceRecovery(); sourceRecovery.retain(primary);
    const synthetic = syntheticOnboardingDuo();
    let recovered = false, closes = 0, generation = 4, firstAttempt = scenario.unknownFirst, reopens = 0, recoveryFailed = false;
    const probeFailure = new AuthoritySourceClosureUnprovedError([new Error("synthetic owned native probe remained busy")]);
    const runtime = await composeDashboardApplication({ admission: f.machine, lifetimeLock: f.lifetime, isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0, frontendPortOverride: 0, env: {}, onboardingDuo: { ...synthetic,
        browserState() { return recovered ? { state: "open", generation } : recoveryFailed ? { state: "failed", generation, code: "DUO_SETUP_FILES_BUSY" } : { state: "closed", generation }; },
        async start(...args) { if (firstAttempt) { firstAttempt = false; await args[2](new ProfileOnboardingDuoProviderError("unknown", "worker")); } else await synthetic.start(...args); },
        async closeBrowser() { closes++; return recovered ? { state: "closed" } : { state: "uncertain", ...(scenario.withCause ? { cause: primary } : {}) }; },
        async recoverBrowser(owner, expected) {
          owner.assertCurrent(); assert.equal(expected, generation); reopens++;
          if (scenario.unknownFirst && reopens === 1) { recoveryFailed = true; sourceRecovery.retain(probeFailure); throw probeFailure; }
          await sourceRecovery.prove(async () => { recovered = true; }); generation++;
        },
      } });
    const base = `http://127.0.0.1:${runtime.port}`;
    const post = (path: string, body: unknown, cookie?: string) => fetch(`${base}/api/v1/profile/${path}`, { method: "POST", headers: {
      origin: base, "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
    let failure: unknown, stage = "signup";
    try {
      let cookie: string | undefined, draft;
      if (scenario.unknownFirst) {
        const signup = await post("sign-up", { firstName: "Held", lastName: "Fixture", email: "held-fixture@ucsd.edu", password: "disposable-held-fixture" });
        draft = PublicProfileStateSchema.parse(await signup.json()); cookie = signup.headers.get("set-cookie")?.split(";", 1)[0];
      } else { const ready = await readyPublicSignUp(base); draft = ready.draft; cookie = ready.cookie; }
      assert.ok(cookie); assert.equal(draft.state, "onboarding"); if (draft.state !== "onboarding") throw new Error("draft required");
      const call = (action: string, extra = {}) => { stage = action; return post(`onboarding/${action}`, { operationId: draft.operationId, ...extra }, cookie); };
      if (scenario.unknownFirst) {
        const start = await call("duo/start", { method: "key" }); assert.equal(start.status, 200);
        assert.equal(PublicProfileStateSchema.parse(await start.json()).state, "onboarding");
      } else assert.equal((await call("duo/browser")).status, 200);
      const operationPath = join(f.machine.stateRoot, "machine", "operations", `${draft.operationId}.json`);
      const credentialPath = join(f.machine.stateRoot, "machine", "duo-credentials", `${draft.profileId}.json`);
      stage = "retain credential bytes";
      const credentials = readFileSync(credentialPath);
      const failed = await call(scenario.unknownFirst ? "cancel" : scenario.action);
      assert.equal(failed.status, 409); assert.deepEqual(await failed.json(), { state: "refused", code: "BROWSER_CLOSURE_UNPROVED" });
      const held = readFileSync(operationPath);
      for (const action of ["cancel", "complete", "duo/browser", "duo/portal", "duo/start"]) {
        const refused = await call(action, action === "duo/start" ? { method: "key" } : {});
        assert.equal(refused.status, 409, action); assert.deepEqual(await refused.json(), { state: "refused", code: "BROWSER_CLOSURE_UNPROVED" });
      }
      assert.equal(closes, 1); assert.deepEqual(readFileSync(operationPath), held); assert.deepEqual(readFileSync(credentialPath), credentials);
      assert.deepEqual(f.machine.readProfileRegistry().profiles, []);
      const current = PublicProfileStateSchema.parse(await (await fetch(`${base}/api/v1/profile/state`, { headers: { cookie } })).json());
      assert.equal(current.state, "onboarding");
      const foreign = await post("onboarding/duo/reopen", { operationId: draft.operationId, generation }, "relay-profile-onboarding=foreign");
      assert.equal(foreign.status, 409); assert.equal(recovered, false);
      if (scenario.unknownFirst) {
        const blocked = await call("duo/reopen", { generation }); assert.equal(blocked.status, 409);
        assert.deepEqual(await blocked.json(), { state: "refused", code: "DUO_SETUP_FILES_BUSY" });
        assert.equal(recovered, false); assert.deepEqual(readFileSync(operationPath), held); assert.deepEqual(readFileSync(credentialPath), credentials);
      }
      const reopen = await call("duo/reopen", { generation }); assert.equal(reopen.status, 200);
      if (scenario.unknownFirst) {
        const history = SignUpOperationSchema.parse(JSON.parse(readFileSync(operationPath, "utf8"))).onboarding?.attempts[0]; assert.ok(history);
        assert.equal(history.state, "unknown"); assert.ok(history.failure); assert.ok(history.providerClosedAt);
        if (scenario.action === "complete") for (const method of ["key", "touch"]) {
          const pending = PublicProfileStateSchema.parse(await (await call("duo/start", { method })).json());
          assert.equal(pending.state, "onboarding"); if (pending.state !== "onboarding") throw new Error("attempt required");
          assert.equal((await call("duo/confirm", { method, attemptId: pending.methods[method as "key" | "touch"].attemptId, operatorConfirmed: true })).status, 200);
        }
      }
      const done = await call(scenario.action); assert.equal(done.status, 200);
      const result = PublicProfileStateSchema.parse(await done.json()); assert.equal(result.state, scenario.action === "cancel" ? "signed-out" : "active");
    } catch (error) { failure = new Error(`public recovery failed at ${stage}`, { cause: error }); }
    finally {
      try { await runtime.stop(); } catch (error) { failure = failure === undefined ? error : new AggregateError([failure, error], "public recovery and cleanup failed"); }
      try { f.machine.release(); } catch (error) { failure = failure === undefined ? error : new AggregateError([failure, error], "public recovery admission cleanup failed"); }
      rmSync(f.root, { recursive: true, force: true });
    }
    if (failure !== undefined) throw failure instanceof Error ? failure : new Error("public-recovery-fixture-failed", { cause: failure });
  });

for (const closeFails of [false, true]) it(`preserves startup recovery failure and ${closeFails ? "unproved" : "proved"} profile closure under the held controller`, async () => {
  const controllerLock=await runtimeLifetimeLock();
  const f = await fixture(controllerLock), primary = new Error("fixture recovery failed"), cleanup = new Error("fixture profile close failed");
  const actual = await vi.importActual<typeof storageCompose>("../../../../../src/backend/app/composition/storage-compose.js");
  let profile: ReturnType<typeof storageCompose.composeProfileRuntime> | undefined;
  const spy = vi.spyOn(storageCompose, "composeProfileRuntime").mockImplementation(input => {
    const current = actual.composeProfileRuntime(input); profile = current;
    return { ...current, session: { ...current.session, async recoverOnboarding() { throw primary; } },
      async close() { if (closeFails) throw cleanup; await current.close(); } };
  });
  try {
    await assert.rejects(composeDashboardApplication({ lifetimeLock: controllerLock, admission: f.machine, isolation: rebuildRuntimeIsolation,
      repoRoot: f.root, backendPortOverride: 0, frontendPortOverride: 0, env: {} }), error => {
      if (!closeFails) { assert.equal(error, primary); return true; }
      assert.ok(error instanceof storageCompose.RuntimeCustodyUncertainError);
      assert.deepEqual(error.errors, [primary, cleanup]); return true;
    });
    await assertRuntimeLifetimeHeld(controllerLock);
  } finally {
    spy.mockRestore(); await profile?.close();
    f.machine.release(); rmSync(f.root, { recursive: true });
  }
});

it("serves public profile state without minting a selected profile, actor or authority database", async () => {
  const f = await fixture();
  let runtime: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  try {

    runtime = await composeDashboardApplication({ lifetimeLock: f.lifetime, admission: f.machine, isolation: rebuildRuntimeIsolation, repoRoot: f.root,
      backendPortOverride: 0, frontendPortOverride: 0, env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners });
    const base = `http://127.0.0.1:${String(runtime.port)}`;
    const response = await fetch(`${base}/api/v1/profile/state`);
    assert.deepEqual(PublicProfileStateSchema.parse(await response.json()), { state: "signed-out", signUpRequired: true });
    assert.equal(response.headers.get("set-cookie"), null);
    const proxyHost = `localhost:${String(rebuildRuntimeIsolation.frontendPort)}`;
    const proxyRequest = (path: string, host: string, body?: string) => new Promise<{ status: number | undefined; body: unknown }>((resolve, reject) => {
      const request = httpRequest(`${base}${path}`, { method: body === undefined ? "GET" : "POST",
        headers: { host, origin: `http://${host}`, ...(body === undefined ? {} : { "content-type": "application/json" }) } }, response => {
        const bytes: Buffer[] = [];
        response.on("data", (chunk: Buffer) => { bytes.push(chunk); });
        response.on("error", reject);
        response.on("end", () => { try { resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(bytes).toString("utf8")) as unknown }); } catch (error) { reject(new Error("fixture public response is not JSON", { cause: error })); } });
      });
      request.on("error", reject); request.end(body);
    });
    const proxyState = await proxyRequest("/api/v1/profile/state", proxyHost);
    assert.equal(proxyState.status, 200); assert.deepEqual(proxyState.body, { state: "signed-out", signUpRequired: true });
    const invalidProfile = await proxyRequest("/api/v1/profile/sign-up", proxyHost, "{}");
    assert.equal(invalidProfile.status, 400); assert.deepEqual(invalidProfile.body, { state: "error", code: "SCHEMA_INVALID" });
    const foreignHost = `localhost:${String(rebuildRuntimeIsolation.frontendPort + 1)}`;
    assert.equal((await proxyRequest("/api/v1/profile/state", foreignHost)).status, 403);
    assert.equal((await fetch(`${base}/api/v1/bootstrap`)).status, 401);
    assert.equal(existsSync(join(f.machine.stateRoot, "state.db")), false);
    assert.equal(f.machine.readProfileRegistry().profiles.length, 0);
    assert.equal(f.machine.readProfileRegistry().activeProfileId, null);
    for (const headers of [
      { origin: "http://foreign.invalid", "content-type": "application/json" },
      { origin: base, "content-type": "text/plain" },
    ]) {
      const denied = await fetch(`${base}/api/v1/profile/sign-up`, { method: "POST", headers, body: "not a credential envelope" });
      assert.ok(denied.status === 403 || denied.status === 415);
      assert.equal(f.machine.readProfileRegistry().profiles.length, 0);
    }
  } finally { await runtime?.stop(); f.machine.release(); rmSync(f.root, { recursive: true, force: true }); }
});

it("records unknown profile failure name, code and source frames without message values and stops cleanly", async () => {
  const f = await fixture();
  const actual = await vi.importActual<typeof storageCompose>("../../../../../src/backend/app/composition/storage-compose.js");
  const sensitive = "disposable-private-value fixture@example.edu";
  const error = Object.assign(new TypeError(sensitive), { code: "SYNTHETIC_PROFILE_FAILURE" });
  error.stack = `TypeError: ${sensitive}\n    at login (/repo/src/backend/profiles/profile-session.ts:454:3)\n    at ${sensitive}\n    at private (/private/${sensitive}:1:2)`;
  error.cause = error;
  const spy = vi.spyOn(storageCompose, "composeProfileRuntime").mockImplementation(input => {
    const current = actual.composeProfileRuntime(input);
    return { ...current, session: { ...current.session, signIn() { throw error; } } };
  });
  let app: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  try {
    app = await composeDashboardApplication({ lifetimeLock: f.lifetime, admission: f.machine, isolation: rebuildRuntimeIsolation,
      repoRoot: f.root, backendPortOverride: 0, frontendPortOverride: 0, env: {} });
    const base = `http://127.0.0.1:${app.port}`;
    const response = await fetch(`${base}/api/v1/profile/sign-in`, { method: "POST", headers: { origin: base, "content-type": "application/json" },
      body: JSON.stringify({ email: "fixture@ucsd.edu", password: "disposable-fixture-password" }) });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { state: "error", code: "INTERNAL_FAILURE" });
    const log = readFileSync(join(f.machine.stateRoot, "logs", "boot.jsonl"), "utf8");
    assert.ok(log.includes("TypeError")); assert.ok(log.includes("SYNTHETIC_PROFILE_FAILURE"));
    assert.ok(log.includes("src/backend/profiles/profile-session.ts:454:3"));
    assert.equal(log.includes(sensitive), false);
    assert.equal(log.includes("disposable-fixture-password"), false);
    await app.stop(); app = undefined;
  } finally { spy.mockRestore(); await app?.stop(); f.machine.release(); rmSync(f.root, { recursive: true, force: true }); }
});

it("uses a real verifier and selected session cookie, rejects foreign browser captures and performs canonical logout with an open subscription", async () => {
  const temporary = mkdtempSync(join(realpathSync(tmpdir()), "public-profile-temp-alias-"));
  const priorEnvironment = { TMPDIR: process.env.TMPDIR, TMP: process.env.TMP, TEMP: process.env.TEMP };
  using _environment = { [Symbol.dispose]() {
    for (const key of ["TMPDIR", "TMP", "TEMP"] as const) {
      const value = priorEnvironment[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  } };
  const physicalTemp = join(temporary, "physical"), aliasedTemp = join(temporary, "alias");
  mkdirSync(physicalTemp, { mode: 0o700 });
  symlinkSync(physicalTemp, aliasedTemp, "dir");
  for (const key of ["TMPDIR", "TMP", "TEMP"] as const) process.env[key] = aliasedTemp;
  const f = await fixture();
  let runtime: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  try {
    const keyCapture: { capability?: DraftDuoCapability } = {};
    let providerActive = false, closedAttempts = 0;
    const onboardingDuo: ProfileOnboardingDuoProvider = {
      async showBrowser(owner) { owner.assertCurrent(); },
      async openPortal(owner) { owner.assertCurrent(); },
      async closeBrowser() { return { state: "closed" }; },
      async start(attempt, bind, _reportFailure) {
        assert.equal(providerActive, false); providerActive = true;
        const capability = await bind({ contextId: randomBytes(16).toString("hex"), tabId: attempt.method === "key" ? 1 : 2,
          origin: "https://fixture.duosecurity.com", rpId: "duosecurity.com" });
        const credentialId = attempt.method === "key" ? "Zml4dHVyZS1zb2Z0d2FyZS1rZXk" : "fixture-native-touch";
        if (attempt.method === "key") {
          keyCapture.capability = capability;
          const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
          await capability.persistPending({ credentialId,
            privateKeyPkcs8: pair.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
            publicKeySpki: pair.publicKey.export({ type: "spki", format: "der" }).toString("base64"),
            transport: "usb", isResidentCredential: false, createdAt: new Date().toISOString() });
        }
        await capability.recordCeremony({ credentialId, requestId: randomUUID(),
          mechanism: attempt.method === "key" ? "fast-duo" : "native-platform", softwareInterceptionDisabled: attempt.method === "touch" });
        if (attempt.method === "touch") await capability.recordPortalAcceptance({ credentialId, requestId: randomUUID(), acceptance: "portal-accepted" });
      },
      async cancel() { providerActive = false; closedAttempts += 1; return { state: "closed" }; },
    };
    runtime = await composeDashboardApplication({ lifetimeLock: f.lifetime, admission: f.machine, isolation: rebuildRuntimeIsolation, repoRoot: f.root,
      backendPortOverride: 0, frontendPortOverride: 0, onboardingDuo, env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners });
    assert.ok(runtime.port > 0);
    const base = `http://127.0.0.1:${String(runtime.port)}`;
    const post = (path: string, body: unknown, cookie?: string) => fetch(`${base}${path}`, { method: "POST",
      headers: { origin: base, "content-type": "application/json", ...(cookie === undefined ? {} : { cookie }) }, body: JSON.stringify(body) });
    const signup = await post("/api/v1/profile/sign-up", { firstName: "Fixture", lastName: "Operator", email: "fixture@ucsd.edu", password: "disposable-fixture-password" });
    const draft = PublicProfileStateSchema.parse(await signup.json()); assert.equal(draft.state, "onboarding");
    if (draft.state !== "onboarding") throw new Error("fixture actual signup draft required");
    assert.equal(draft.methods.key.state, "idle"); assert.equal(draft.methods.touch.state, "idle");
    assert.equal(draft.methods.key.state, "idle"); assert.equal(draft.methods.touch.state, "idle");
    const draftHeader = signup.headers.get("set-cookie"); assert.ok(draftHeader);
    const draftCookie = draftHeader.split(";", 1)[0]; assert.ok(draftCookie);
    assert.match(draftHeader, /HttpOnly/u); assert.match(draftHeader, /SameSite=Strict/u);
    assert.equal((await fetch(`${base}/api/v1/bootstrap`, { headers: { cookie: draftCookie } })).status, 401);
    assert.equal(f.machine.readProfileRegistry().profiles.length, 0);
    assert.equal(f.machine.readProfileRegistry().activeProfileId, null);
    assert.equal(ProfileVerifierDocumentSchema.parse(JSON.parse(readFileSync(join(f.machine.stateRoot, "machine", "profile-verifiers.json"), "utf8"))).profiles.length, 0);
    assert.equal((await post("/api/v1/profile/onboarding/complete", { operationId: draft.operationId }, draftCookie)).status, 409);
    assert.equal((await post("/api/v1/profile/onboarding/duo/start", { operationId: randomUUID(), method: "key" }, draftCookie)).status, 409);
    assert.equal((await post("/api/v1/profile/onboarding/duo/start", { operationId: draft.operationId, method: "key" }, "relay-profile-onboarding=foreign")).status, 409);
    const key = PublicProfileStateSchema.parse(await (await post("/api/v1/profile/onboarding/duo/start", { operationId: draft.operationId, method: "key" }, draftCookie)).json());
    assert.equal(key.state, "onboarding");
    if (key.state !== "onboarding") throw new Error("fixture key draft required");
    assert.equal(key.methods.key.state, "pending"); assert.equal(key.methods.key.portalAccepted, false); assert.equal(key.step, "duo");
    const confirmedKey = PublicProfileStateSchema.parse(await (await post("/api/v1/profile/onboarding/duo/confirm", {
      operationId: draft.operationId, method: "key", attemptId: key.methods.key.attemptId, operatorConfirmed: true }, draftCookie)).json());
    if (confirmedKey.state !== "onboarding") throw new Error("fixture confirmed key draft required");
    assert.equal(confirmedKey.methods.key.state, "complete"); assert.equal(confirmedKey.methods.key.portalAccepted, false);
    assert.ok(keyCapture.capability);
    const request = { requestId: randomUUID(), credentialId: "Zml4dHVyZS1zb2Z0d2FyZS1rZXk", origin: "https://fixture.duosecurity.com", rpId: "duosecurity.com" as const, challenge: "AQID" };
    const assertion = await keyCapture.capability.signAssertion(request);
    assert.ok(assertion.signCount > 0);
    await assert.rejects(keyCapture.capability.signAssertion(request), { code: "DUO_CREDENTIAL_CONFLICT" });
    const touch = PublicProfileStateSchema.parse(await (await post("/api/v1/profile/onboarding/duo/start", { operationId: draft.operationId, method: "touch" }, draftCookie)).json());
    if (touch.state !== "onboarding" || touch.methods.touch.attemptId === undefined) throw new Error("fixture touch draft required");
    assert.equal(closedAttempts, 1);
    assert.equal(touch.methods.touch.state, "complete");
    const ready = PublicProfileStateSchema.parse(await (await post("/api/v1/profile/onboarding/duo/confirm", {
      operationId: draft.operationId, method: "touch", attemptId: touch.methods.touch.attemptId, operatorConfirmed: true }, draftCookie)).json());
    assert.equal(ready.state, "onboarding");
    if (ready.state !== "onboarding") throw new Error("fixture Ready draft required");
    assert.equal(ready.step, "ready"); assert.equal(f.machine.readProfileRegistry().profiles.length, 0);
    const finished = await post("/api/v1/profile/onboarding/complete", { operationId: draft.operationId }, draftCookie);
    const active = PublicProfileStateSchema.parse(await finished.json()); assert.equal(active.state, "active");
    if (active.state !== "active") throw new Error("fixture actual completed signup required");
    assert.ok(f.machine.readProfileRegistry().profiles[0]?.registration.onboardingCompletion);
    const header = finished.headers.get("set-cookie"); assert.ok(header); assert.match(header, /HttpOnly/u); assert.match(header, /SameSite=Strict/u);
    const cookie = header.split(";", 1)[0]; assert.ok(cookie);
    assert.equal(JSON.stringify(active).includes(cookie.slice(cookie.indexOf("=") + 1)), false);
    const bootstrap = await fetch(`${base}/api/v1/bootstrap`, { headers: { cookie, origin: base } });
    assert.equal(bootstrap.status, 200);
    assert.equal(FrontendBootstrapWireSchema.parse(await bootstrap.json()).actor.label, "Fixture Operator");
    assert.equal((await fetch(`${base}/api/v1/bootstrap`)).status, 401);
    for (const path of ["/api/v1/bootstrap", "/events", "/artifacts/foreign"]) {
      assert.equal((await fetch(`${base}${path}`, { headers: { cookie: "relay-profile-session=foreign" } })).status, 401);
    }
    assert.equal((await fetch(`${base}/api/v1/bootstrap`, { headers: { cookie, origin: "http://foreign.invalid" } })).status, 401);
    assert.equal((await fetch(`${base}/api/v1/profile/state`, { headers: { cookie } })).status, 200);
    assert.equal(existsSync(join(f.machine.stateRoot, "profiles", active.profileId, "state.db")), true);
    const profileRoot = join(f.machine.stateRoot, "profiles", active.profileId);
    const credentialPaths = [join(profileRoot, "credentials", "protected.json"), join(profileRoot, "credentials", "chatgpt-account.json"),
      join(f.machine.stateRoot, "machine", "duo-credentials", `${active.profileId}.json`), join(f.machine.stateRoot, "machine", "credential-keys", `${active.profileId}.json`)];
    const retainedCredentials = credentialPaths.map(path => createHash("sha256").update(readFileSync(path)).digest("hex"));
    const events = await fetch(`${base}/events/v1?topics=dashboard-day:2026-11-05`, { headers: { cookie } });
    assert.equal(events.status, 200);
    const eventReader = events.body?.getReader(); assert.ok(eventReader);
    assert.equal((await eventReader.read()).done, false);
    const logout = PublicProfileStateSchema.parse(await (await post("/api/v1/profile/logout", {}, cookie)).json());
    assert.deepEqual(logout, { state: "signed-out", signUpRequired: false });
    try { await eventReader.cancel(); }
    catch (error) { assert.ok(error instanceof Error); assert.match(error.message, /terminated|aborted|closed/u); }
    assert.equal(f.machine.readProfileRegistry().activeProfileId, null);
    assert.equal(f.machine.readProfileRegistry().profiles.find(row => row.profileId === active.profileId)?.credentialState, "saved");
    assert.deepEqual(credentialPaths.map(path => createHash("sha256").update(readFileSync(path)).digest("hex")), retainedCredentials);
    assert.equal((await fetch(`${base}/api/v1/bootstrap`, { headers: { cookie } })).status, 401);
    const login = await post("/api/v1/profile/sign-in", { email: "fixture@ucsd.edu", password: "disposable-fixture-password" });
    const restored = PublicProfileStateSchema.parse(await login.json()); assert.equal(restored.state, "active");
    assert.notEqual(login.headers.get("set-cookie"), header);
    assert.equal((await fetch(`${base}/api/v1/bootstrap`, { headers: { cookie } })).status, 401);
  } finally {
    await runtime?.stop();
    f.machine.release();
    rmSync(f.root, { recursive: true, force: true });
    rmSync(temporary, { recursive: true });
  }
});

it("drains two subscribed tabs before revocation and refuses subscription reconnects during and after logout", async () => {
  const f = await fixture(undefined, "shared"), drained = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const composeProfile = (await vi.importActual<typeof storageCompose>("../../../../../src/backend/app/composition/storage-compose.js")).composeProfileRuntime;
  let context: ReturnType<ReturnType<typeof composeProfile>["selectedContext"]> | undefined;
  const profileFactory = vi.spyOn(storageCompose, "composeProfileRuntime").mockImplementation(input => {
    const profile = composeProfile(input);
    return { ...profile, selectedContext(token) { context = profile.selectedContext(token); return context; } };
  });
  const actualStart = (await vi.importActual<typeof httpServer>("../../../../../src/backend/transports/http/http-server.js")).startDashboardHttpServer;
  const createWriter = debugEvents.createDebugEventWriter;
  const finalDiagnostics: number[] = [];
  const logging = vi.spyOn(debugEvents, "createDebugEventWriter").mockImplementation(input => {
    const writer = createWriter(input);
    return { emit(event, ...args) {
      const result = writer.emit(event, ...args);
      if (typeof event === "object" && event !== null && Reflect.get(event, "category") === "sse" && Reflect.get(event, "phase") === "settled") {
        finalDiagnostics.push(f.machine.readProfileRegistry().sessionGeneration);
      }
      return result;
    } };
  });
  const start = vi.spyOn(httpServer, "startDashboardHttpServer").mockImplementation(async input => {
    const listener = await actualStart(input);
    return { ...listener, mount(app, accepts) {
      const mount = listener.mount(app, accepts);
      return { async close() { await mount.close(); drained.resolve(); await release.promise; } };
    } };
  });
  let runtime: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined, logout: Promise<Response> | undefined;
  const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
  try {
    runtime = await composeDashboardApplication({ lifetimeLock: f.lifetime, admission: f.machine, isolation: rebuildRuntimeIsolation, repoRoot: f.root,
      backendPortOverride: 0, frontendPortOverride: 0, onboardingDuo: syntheticOnboardingDuo(), env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners });
    const base = `http://127.0.0.1:${runtime.port}`, signedUp = await finishPublicSignUp(base);
    assert.equal(PublicProfileStateSchema.parse(await signedUp.json()).state, "active");
    const cookie = signedUp.headers.get("set-cookie")?.split(";", 1)[0]; assert.ok(cookie);
    assert.ok(context);
    const custody = context.database.readProfileResourceCustody();
    assert.deepEqual(custody.runs, []); assert.deepEqual(custody.slots, []); assert.deepEqual(custody.browsers, []);
    const epoch = f.machine.readProfileRegistry().sessionGeneration;
    const subscribe = () => fetch(`${base}/events/v1?topics=dashboard-day:2026-11-05`, { headers: { cookie } });
    for (let tab = 0; tab < 2; tab++) {
      const response = await subscribe(); assert.equal(response.status, 200);
      const reader = response.body?.getReader(); assert.ok(reader); readers.push(reader);
      assert.equal((await reader.read()).done, false);
    }
    logout = fetch(`${base}/api/v1/profile/logout`, { method: "POST", headers: { cookie, origin: base, "content-type": "application/json" }, body: "{}" });
    await drained.promise;
    assert.deepEqual(finalDiagnostics, [epoch, epoch]);
    assert.equal(f.machine.readProfileRegistry().sessionGeneration, epoch);
    const reconnect = await subscribe(); assert.equal(reconnect.status, 401);
    assert.deepEqual(await reconnect.json(), { state: "refused", code: "PROFILE_SESSION_STALE" });
    release.resolve();
    const result = await logout; assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { state: "signed-out", signUpRequired: false });
    assert.equal(f.machine.readProfileRegistry().sessionGeneration, epoch + 1);
    const after = await subscribe(); assert.equal(after.status, 401);
    assert.deepEqual(await after.json(), { state: "refused", code: "PROFILE_SESSION_STALE" });
    assert.deepEqual(finalDiagnostics, [epoch, epoch]);
    await runtime.stop(); runtime = undefined;
  } finally {
    release.resolve(); await logout;
    for (const reader of readers) {
      try { await reader.cancel(); }
      catch (error) { assert.ok(error instanceof Error); assert.match(error.message, /terminated|aborted|closed/u); }
    }
    await runtime?.stop(); start.mockRestore(); logging.mockRestore(); profileFactory.mockRestore(); f.machine.release(); rmSync(f.root, { recursive: true, force: true });
  }
});

it("aborts an unpublished pre-enrollment draft through erasure before accepting changed Details", async () => {
  const f = await fixture();
  let runtime: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  try {
    runtime = await composeDashboardApplication({ lifetimeLock: f.lifetime, admission: f.machine, isolation: rebuildRuntimeIsolation, repoRoot: f.root,
      backendPortOverride: 0, frontendPortOverride: 0, env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners });
    const base = `http://127.0.0.1:${String(runtime.port)}`;
    const post = (path: string, body: unknown, cookie?: string) => fetch(`${base}${path}`, { method: "POST",
      headers: { origin: base, "content-type": "application/json", ...(cookie === undefined ? {} : { cookie }) }, body: JSON.stringify(body) });
    const signup = await post("/api/v1/profile/sign-up", { firstName: "Fixture", lastName: "Operator", email: "fixture@ucsd.edu", password: "disposable-fixture-password" });
    const draft = PublicProfileStateSchema.parse(await signup.json());
    if (draft.state !== "onboarding") throw new Error("fixture unpublished draft required");
    const header = signup.headers.get("set-cookie"); assert.ok(header);
    const cookie = header.split(";", 1)[0]; assert.ok(cookie);
    assert.equal(f.machine.readProfileRegistry().profiles.length, 0);
    const cancelled = await post("/api/v1/profile/onboarding/cancel", { operationId: draft.operationId }, cookie);
    assert.equal(cancelled.status, 200); assert.deepEqual(PublicProfileStateSchema.parse(await cancelled.json()), { state: "signed-out" });
    assert.equal(f.machine.readProfileRegistry().profiles.length, 0); assert.equal(f.machine.readProfileRegistry().activeProfileId, null);
    assert.equal(existsSync(join(f.machine.stateRoot, "machine", "credential-keys", `${draft.profileId}.json`)), false);
    assert.equal(existsSync(join(f.machine.stateRoot, "machine", "operations", `${draft.operationId}.json`)), false);
    assert.equal(existsSync(join(f.machine.stateRoot, "machine", "erasures", `${draft.profileId}.json`)), false);
    assert.equal(existsSync(join(f.machine.stateRoot, "profiles", draft.profileId)), false);
    assert.equal((await fetch(`${base}/api/v1/bootstrap`, { headers: { cookie } })).status, 401);
    const replacement = PublicProfileStateSchema.parse(await (await post("/api/v1/profile/sign-up", {
      firstName: "Changed", lastName: "Details", email: "changed@ucsd.edu", password: "new-disposable-fixture-password" })).json());
    assert.equal(replacement.state, "onboarding");
    if (replacement.state !== "onboarding") throw new Error("fixture replacement draft required");
    assert.notEqual(replacement.profileId, draft.profileId); assert.notEqual(replacement.operationId, draft.operationId);
    assert.equal(f.machine.readProfileRegistry().profiles.length, 0);
  } finally { await runtime?.stop(); f.machine.release(); rmSync(f.root, { recursive: true, force: true }); }
});

for (const scenario of ["idle-tab", "in-flight", "ordinary-500"] as const) it(`cleanly stops the public shell after ${scenario} while awaiting admitted cleanup`, async () => {
  const f = await fixture(), entered = Promise.withResolvers<void>(), cancelled = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const actualStart = (await vi.importActual<typeof httpServer>("../../../../../src/backend/transports/http/http-server.js")).startDashboardHttpServer;
  const start = vi.spyOn(httpServer, "startDashboardHttpServer").mockImplementation(async input => {
    input.app.get("/gate11-ordinary-failure", () => { const error = new Error("fixture handled request failure"); error.cause = error; throw error; });
    input.app.get("/gate11-tab", async c => {
      entered.resolve();
      if (scenario === "in-flight") {
        c.req.raw.signal.addEventListener("abort", () => cancelled.resolve(), { once: true });
        await release.promise; return new Response(null, { status: 204 });
      }
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new Uint8Array([1])); },
        async cancel() { cancelled.resolve(); await release.promise; },
      }), { headers: { "content-type": "text/event-stream" } });
    });
    return actualStart(input);
  });
  let runtime: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined, held: Promise<unknown> | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, stopping: Promise<void> | undefined;
  try {
    runtime = await composeDashboardApplication({ lifetimeLock: f.lifetime, admission: f.machine, isolation: rebuildRuntimeIsolation, repoRoot: f.root,
      backendPortOverride: 0, frontendPortOverride: 0, env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners });
    const base = `http://127.0.0.1:${String(runtime.port)}`;
    if (scenario === "ordinary-500") {
      const failed = await fetch(`${base}/gate11-ordinary-failure`); assert.equal(failed.status, 500);
      assert.deepEqual(await failed.json(), { state: "error", code: "INTERNAL_FAILURE" });
      const live = await fetch(`${base}/api/v1/profile/state`); assert.equal(live.status, 200); await live.arrayBuffer();
    } else {
      held = fetch(`${base}/gate11-tab`).then(async response => {
        reader = response.body?.getReader(); assert.ok(reader);
        if (scenario === "idle-tab") assert.equal((await reader.read()).done, false);
      }).catch((error: unknown) => error);
      await entered.promise;
      if (scenario === "idle-tab") await held;
    }
    let terminal = false;
    stopping = runtime.stop(); assert.equal(runtime.stop(), stopping);
    const observed = stopping.then(() => { terminal = true; return undefined; }, (error: unknown) => { terminal = true; return error; });
    if (scenario !== "ordinary-500") {
      await cancelled.promise; assert.equal(terminal, false);
      f.machine.assertLive(); await assertRuntimeLifetimeHeld(f.lifetime);
    }
    release.resolve();
    assert.equal(await observed, undefined, "settled ordinary requests must not poison shutdown custody");
    await held;
    assert.throws(() => f.machine.assertLive());
    await assertRuntimeLifetimeHeld(f.lifetime);
    await assert.rejects(fetch(`${base}/api/v1/profile/state`));
    await runtime.stop();
  } finally {
    release.resolve(); await held;
    if (reader !== undefined) { try { await reader.cancel(); } catch (error) { assert.ok(error instanceof Error); assert.match(error.message, /terminated|aborted|closed/u); } }
    start.mockRestore(); f.machine.release(); rmSync(f.root, { recursive: true, force: true });
  }
});

for (const fault of ["prior-custody", "wrapped-source-custody", "profile-close"] as const) it(`fences and drains real public transfers before retaining ${fault} shutdown failure`, async () => {
  const controllerLock=await runtimeLifetimeLock();
  const f = await fixture(controllerLock), primary = new Error("fixture custody failure");
  const entered = Promise.withResolvers<void>(), aborted = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const actualStart = (await vi.importActual<typeof httpServer>("../../../../../src/backend/transports/http/http-server.js")).startDashboardHttpServer;
  const actualProfile = (await vi.importActual<typeof storageCompose>("../../../../../src/backend/app/composition/storage-compose.js")).composeProfileRuntime;
  let profileForCleanup: ReturnType<typeof actualProfile> | undefined;
  let runtime: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  let outcome: Promise<unknown> | undefined;
  let observedFailure: unknown;
  let injectedCloseCalls = 0;
  const start = vi.spyOn(httpServer, "startDashboardHttpServer").mockImplementation(async input => {
    input.app.get("/held-public-transition", async c => {
      c.req.raw.signal.addEventListener("abort", () => { aborted.resolve(); }, { once: true });
      entered.resolve(); await release.promise; return new Response(null, { status: 204 });
    });
    input.app.get("/prior-custody-fault", () => {
      if (fault === "wrapped-source-custody") throw new Error("fixture request wrapper", { cause: new AggregateError([new AuthoritySourceClosureUnprovedError([primary])]) });
      throw new storageCompose.RuntimeCustodyUncertainError([primary]);
    });
    return actualStart(input);
  });
  const compose = vi.spyOn(storageCompose, "composeProfileRuntime").mockImplementation(input => {
    const profile = actualProfile(input); profileForCleanup = profile;
    return fault === "profile-close" ? { ...profile, async close() { injectedCloseCalls++; throw primary; } } : profile;
  });
  try {
    runtime = await composeDashboardApplication({ lifetimeLock: controllerLock, admission: f.machine, isolation: rebuildRuntimeIsolation, repoRoot: f.root,
      backendPortOverride: 0, frontendPortOverride: 0, env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners });
    const base = `http://127.0.0.1:${String(runtime.port)}`;
    if (fault !== "profile-close") {
      const response = await fetch(`${base}/prior-custody-fault`);
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { state: "error", code: "RUNTIME_CUSTODY_UNCERTAIN" });
    }
    outcome = fetch(`${base}/held-public-transition`).catch((error: unknown) => error);
    await entered.promise;
    let terminal = false;
    const stopping = runtime.stop();
    assert.equal(runtime.stop(), stopping);
    const result = stopping.then(() => { terminal = true; throw new Error("fixture shutdown must refuse"); }, (error: unknown) => {
      terminal = true; observedFailure = error;
    });
    await aborted.promise;
    assert.equal(terminal, false, "profile/lock release cannot precede the admitted public task");
    f.machine.assertLive();
    await assertRuntimeLifetimeHeld(controllerLock);
    release.resolve(); await result; await outcome;
    assert.ok(observedFailure instanceof storageCompose.RuntimeCustodyUncertainError);
    if (fault === "profile-close") {
      const reasons = new Map([
        ["dashboard response closed before finish", "response-closed-before-finish"],
        ["dashboard transfer failure had no local observer", "transfer-observer-missing"],
        ["dashboard shutdown observed transfer cleanup failures", "transport-cleanup-unproved"],
        ["profile-work-drain-unproved", "profile-work-drain-unproved"],
        ["profile-resource-custody-unavailable", "profile-resource-custody-unavailable"],
      ]);
      const project = (value: unknown, depth = 0): unknown => {
        if (depth > 4) return "depth-bound";
        if (!(value instanceof Error)) return { unknownType: typeof value };
        const name = ["Error", "AggregateError", "RuntimeCustodyUncertainError", "DashboardResponseClosedError", "DashboardShutdownError", "AbortError", "TypeError"].includes(value.name) ? value.name : "unknown-error";
        return { name, reason: reasons.get(value.message) ?? { unknownSha256: createHash("sha256").update(value.name).update("\0").update(value.message).digest("hex") },
          ...(value instanceof AggregateError ? { errors: value.errors.slice(0, 8).map((error: unknown) => project(error, depth + 1)) } : {}) };
      };
      assert.equal(injectedCloseCalls, 1, `shutdown must reach the injected profile-close failure; ${JSON.stringify(project(observedFailure))}`);
    }
    const retainsPrimary = (value: unknown): boolean => value === primary || value instanceof AggregateError && value.errors.some(retainsPrimary)
      || value instanceof Error && value.cause !== undefined && retainsPrimary(value.cause);
    assert.equal(retainsPrimary(observedFailure), true, "original closure failure must survive nested custody aggregation");
    await assert.rejects(fetch(`${base}/api/v1/profile/state`));
    f.machine.assertLive();
    await assertRuntimeLifetimeHeld(controllerLock);
    await assert.rejects(runtime.stop(), error => error === observedFailure);
  } finally {
    release.resolve(); await outcome;
    await profileForCleanup?.close();
    start.mockRestore(); compose.mockRestore();
    f.machine.release(); rmSync(f.root, { recursive: true, force: true });
  }
});

for (const fault of ["prior-custody", "transport-cancellation"] as const) it(`drains genuine selected producers despite ${fault} while retaining profile custody`, async () => {
  const controllerLock=await runtimeLifetimeLock();
  const f = await fixture(controllerLock), primary = new Error("fixture selected custody failure");
  const entered = Promise.withResolvers<void>(), aborted = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const actualStart = (await vi.importActual<typeof httpServer>("../../../../../src/backend/transports/http/http-server.js")).startDashboardHttpServer;
  const actualProfile = (await vi.importActual<typeof storageCompose>("../../../../../src/backend/app/composition/storage-compose.js")).composeProfileRuntime;
  let profile!: ReturnType<typeof actualProfile>;
  let context: ReturnType<typeof profile.selectedContext> | undefined;
  let token: string | undefined, preparations = 0, finalCloses = 0;
  const timers = vi.spyOn(globalThis, "setInterval"), clears = vi.spyOn(globalThis, "clearInterval");
  const dashboardHubClose = vi.spyOn(DashboardStreamHub.prototype, "close");
  vi.spyOn(storageCompose, "composeProfileRuntime").mockImplementation(input => {
    profile = actualProfile(input);
    return { ...profile,
      selectedContext(value) { token = value; context = profile.selectedContext(value); return context; },
      async awaitClosurePreparation(id) { await profile.awaitClosurePreparation(id); preparations++; },
      async close() { finalCloses++; await profile.close(); },
    };
  });
  vi.spyOn(httpServer, "startDashboardHttpServer").mockImplementation(async input => {
    input.app.get("/prior-selected-fault", () => { throw new storageCompose.RuntimeCustodyUncertainError([primary]); });
    input.app.get("/held-selected-stop", async c => {
      c.req.raw.signal.addEventListener("abort", () => { aborted.resolve(); }, { once: true });
      entered.resolve(); await release.promise; return new Response(null, { status: 204 });
    });
    input.app.get("/throwing-selected-stream", () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array([1])); }, cancel() { throw primary; },
    })));
    return actualStart(input);
  });
  let runtime: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined, held: Promise<unknown> | undefined;
  try {
    runtime = await composeDashboardApplication({ lifetimeLock: controllerLock, admission: f.machine, isolation: rebuildRuntimeIsolation, repoRoot: f.root,
      backendPortOverride: 0, frontendPortOverride: 0, onboardingDuo: syntheticOnboardingDuo(), env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners });
    const base = `http://127.0.0.1:${String(runtime.port)}`;
    const signup = await finishPublicSignUp(base);
    assert.equal(PublicProfileStateSchema.parse(await signup.json()).state, "active");
    assert.ok(context !== undefined && token !== undefined);
    context.database.getMeta(); profile.assertCurrent(token);
    if (fault === "prior-custody") {
      const response = await fetch(`${base}/prior-selected-fault`); assert.equal(response.status, 500); await response.arrayBuffer();
    } else {
      const response = await fetch(`${base}/throwing-selected-stream`), reader = response.body?.getReader();
      assert.ok(reader); assert.equal((await reader.read()).done, false);
    }
    held = fetch(`${base}/held-selected-stop`).catch((error: unknown) => error); await entered.promise;
    const ownedTimers = timers.mock.results.filter(result => result.type === "return").map(result => result.value);
    assert.ok(ownedTimers.length >= 2);
    let terminal = false;
    const stopped = runtime.stop();
    const outcome = stopped.then(() => { terminal = true; throw new Error("fixture shutdown must refuse"); }, (error: unknown) => { terminal = true; return error; });
    await aborted.promise; assert.equal(terminal, false); assert.equal(finalCloses, 0);
    release.resolve(); const error = await outcome; await held;
    assert.ok(error instanceof storageCompose.RuntimeCustodyUncertainError);
    const retainsPrimary = (value: unknown): boolean => value === primary || value instanceof AggregateError && value.errors.some(retainsPrimary)
      || value instanceof Error && value.cause !== undefined && retainsPrimary(value.cause);
    assert.equal(retainsPrimary(error), true);
    assert.ok(preparations > 0, "actual selected activity cancellation and preparation completed");
    assert.ok(dashboardHubClose.mock.calls.length > 0);
    assert.ok(ownedTimers.every(timer => clears.mock.calls.some(call => call[0] === timer)));
    assert.equal(finalCloses, 0, "unproved transport or prior custody cannot close the profile database");
    context.database.getMeta();
    assert.throws(() => profile.assertCurrent(token!), error => error instanceof ProfileSessionRefusedError && error.code === "PROFILE_SESSION_STALE");
    f.machine.assertLive();
    await assertRuntimeLifetimeHeld(controllerLock);
    await assert.rejects(runtime.stop(), current => current === error);
    await assert.rejects(fetch(`${base}/api/v1/profile/state`));
  } finally {
    release.resolve(); await held;
    if (profile !== undefined) await profile.close();
    vi.restoreAllMocks(); f.machine.release(); rmSync(f.root, { recursive: true, force: true });
  }
});


it("revokes retained selected producers before a genuine in-flight public transport drains", async () => {
  const f = await fixture(), entered = Promise.withResolvers<void>(), aborted = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const crossed = Promise.withResolvers<unknown>();
  const actualProfile = (await vi.importActual<typeof storageCompose>("../../../../../src/backend/app/composition/storage-compose.js")).composeProfileRuntime;
  const actualStart = (await vi.importActual<typeof httpServer>("../../../../../src/backend/transports/http/http-server.js")).startDashboardHttpServer;
  let profile: ReturnType<typeof actualProfile> | undefined;
  let context: ReturnType<ReturnType<typeof actualProfile>["selectedContext"]> | undefined, token: string | undefined;
  vi.spyOn(storageCompose, "composeProfileRuntime").mockImplementation(input => {
    const actual = actualProfile(input); profile = actual;
    return { ...actual, selectedContext(value) { token = value; context = actual.selectedContext(value); return context; } };
  });
  vi.spyOn(httpServer, "startDashboardHttpServer").mockImplementation(async input => {
    input.app.get("/held-public-revocation", async c => {
      c.req.raw.signal.addEventListener("abort", () => aborted.resolve(), { once: true });
      entered.resolve(); await release.promise;
      try { assert.ok(context); context.settings.read(); crossed.resolve("ordinary access survived"); }
      catch (error) { crossed.resolve(error); }
      return new Response(null, { status: 204 });
    });
    return actualStart(input);
  });
  let runtime: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined, held: Promise<unknown> | undefined, stopping: Promise<void> | undefined;
  try {
    runtime = await composeDashboardApplication({ lifetimeLock: f.lifetime, admission: f.machine, isolation: rebuildRuntimeIsolation, repoRoot: f.root,
      backendPortOverride: 0, frontendPortOverride: 0, onboardingDuo: syntheticOnboardingDuo(), env: {} });
    const base = `http://127.0.0.1:${String(runtime.port)}`;
    const signup = await finishPublicSignUp(base);
    assert.equal(PublicProfileStateSchema.parse(await signup.json()).state, "active");
    assert.ok(profile !== undefined && context !== undefined && token !== undefined);
    const owner = profile, selected = context, capturedToken = token;
    owner.assertCurrent(capturedToken); selected.settings.read(); selected.protectedSecrets.read();
    const epoch = f.machine.readProfileRegistry().sessionGeneration;
    held = fetch(`${base}/held-public-revocation`).catch((error: unknown) => error); await entered.promise;
    stopping = runtime.stop(); assert.equal(runtime.stop(), stopping);
    await aborted.promise;
    assert.throws(() => owner.assertCurrent(capturedToken), ProfileSessionRefusedError);
    assert.throws(() => selected.settings.read(), ProfileSessionRefusedError);
    assert.throws(() => selected.protectedSecrets.read(), ProfileSessionRefusedError);
    await assert.rejects(selected.accountAuthority.readAuthority(), ProfileSessionRefusedError);
    selected.database.getMeta(); selected.admission.assertLive(); f.machine.assertLive();
    assert.equal(f.machine.readProfileRegistry().sessionGeneration, epoch);
    release.resolve(); await stopping; await held;
    assert.ok(await crossed.promise instanceof ProfileSessionRefusedError);
  } finally {
    release.resolve(); await stopping; await held;
    if (profile !== undefined) await profile.close();
    vi.restoreAllMocks(); f.machine.release(); rmSync(f.root, { recursive: true, force: true });
  }
});

it("publishes a sign-up whose methods both finished from Duo's success heading", async () => {
  const f = await fixture();
  const onboardingDuo: ProfileOnboardingDuoProvider = { ...syntheticOnboardingDuo(), async start(attempt, bind) {
    const capability = await bind({ contextId: randomBytes(16).toString("hex"), tabId: attempt.method === "key" ? 1 : 2, origin: "https://fixture.duosecurity.com", rpId: "duosecurity.com" });
    const credentialId = randomBytes(32).toString("base64url"), requestId = randomUUID(), pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    await capability.persistPending({ credentialId, privateKeyPkcs8: pair.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
      publicKeySpki: pair.publicKey.export({ type: "spki", format: "der" }).toString("base64"),
      transport: attempt.method === "key" ? "usb" : "internal", isResidentCredential: attempt.method === "touch",
      ...(attempt.method === "touch" ? { initialSignCount: 1 } : {}), createdAt: new Date().toISOString() });
    await capability.recordCeremony({ credentialId, requestId, mechanism: attempt.method === "key" ? "fast-duo" : "chromium-platform", softwareInterceptionDisabled: attempt.method === "touch" });
    await capability.recordPortalAcceptance({ credentialId, requestId, acceptance: "portal-accepted" });
  } };
  let runtime: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  try {
    runtime = await composeDashboardApplication({ lifetimeLock: f.lifetime, admission: f.machine, isolation: rebuildRuntimeIsolation, repoRoot: f.root,
      backendPortOverride: 0, frontendPortOverride: 0, onboardingDuo, env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners });
    const { finish } = await readyPublicSignUp(`http://127.0.0.1:${String(runtime.port)}`, "detected");
    assert.equal(PublicProfileStateSchema.parse(await (await finish()).json()).state, "active");
    const completion = f.machine.readProfileRegistry().profiles[0]?.registration.onboardingCompletion;
    assert.ok(completion);
    assert.equal(completion.key.confirmation, "portal-accepted");
    assert.equal(completion.touch.operatorConfirmedAt, undefined);
  } finally { await runtime?.stop(); f.machine.release(); rmSync(f.root, { recursive: true, force: true }); }
});
