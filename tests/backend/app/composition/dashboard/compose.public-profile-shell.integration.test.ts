import { request as httpRequest } from "node:http";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { runSecureEnvironmentBootstrap } from "../../../../../src/backend/app/bootstrap/secure-env-bootstrap.js";
import { ProfileSessionRefusedError } from "../../../../../src/backend/profiles/profile-session.js";
import { DashboardStreamHub } from "../../../../../src/backend/transports/http/subscriptions/dashboard-stream.js";
import { RunLogsStreamHub } from "../../../../../src/backend/transports/http/subscriptions/run-logs-stream.js";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, vi } from "vitest";
import * as httpServer from "../../../../../src/backend/transports/http/http-server.js";
import * as storageCompose from "../../../../../src/backend/app/composition/storage-compose.js";
import * as processLocks from "../../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { runtimeProcessLockIsActive } from "../../../../../src/backend/storage/sqlite/runtime-process-locks.js";

vi.mock("../../../../../src/backend/transports/http/http-server.js", { spy: true });
vi.mock("../../../../../src/backend/app/composition/storage-compose.js", { spy: true });
vi.mock("../../../../../src/backend/storage/sqlite/runtime-process-locks.js", { spy: true });
import { composeDashboardApplication } from "../../../../../src/backend/app/composition/dashboard/compose.js";
import { acquireEntrypointAdmission } from "../../../../../src/backend/storage/admission/bootstrap-admission.js";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { PublicProfileStateSchema } from "../../../../../src/models/profiles/public-profile.js";
import { FrontendBootstrapWireSchema } from "../../../../../src/models/dashboard/bootstrap.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "public-profile-shell-")));
  for (const name of ["package.json", "package-lock.json"]) copyFileSync(name, join(root, name));
  const machine = acquireEntrypointAdmission(root, "exclusive");
  mkdirSync(join(root, rebuildRuntimeIsolation.processLockRoot), { recursive: true, mode: 0o700 });
  return { root, machine };
}

for (const boundary of ["profile-construction", "listener-start"] as const) it(`retains genuine machine and server custody when ${boundary} startup cleanup cannot release its role claim`, async () => {
  const f = fixture(), argv = [...process.argv];
  const processLockRoot = join(f.root, rebuildRuntimeIsolation.processLockRoot);
  const injected = new Error("fixture profile construction failed");
  const occupied = createServer();
  let port = 0, primary: unknown;
  let held: processLocks.RuntimeProcessLockHandle | undefined;
  let claimPath: string | undefined, originalClaim: Buffer | undefined;
  let profileCloses = 0;
  const actualLocks = await vi.importActual<typeof processLocks>("../../../../../src/backend/storage/sqlite/runtime-process-locks.js");
  const actualHttp = await vi.importActual<typeof httpServer>("../../../../../src/backend/transports/http/http-server.js");
  const actualStorage = await vi.importActual<typeof storageCompose>("../../../../../src/backend/app/composition/storage-compose.js");
  const locks = vi.spyOn(processLocks, "acquireRuntimeProcessLock").mockImplementation((input, clock, hooks) => {
    const owner = actualLocks.acquireRuntimeProcessLock(input, clock, hooks);
    assert.equal(owner.name, "server"); held = owner;
    return owner;
  });
  const start = vi.spyOn(httpServer, "startDashboardHttpServer").mockImplementation(async input => {
    try { return await actualHttp.startDashboardHttpServer({ ...input, port }); }
    catch (error) { primary = error; throw error; }
  });
  const compose = vi.spyOn(storageCompose, "composeProfileRuntime").mockImplementation(input => {
    const profile = actualStorage.composeProfileRuntime(input);
    return { ...profile, async close() { profileCloses++; await profile.close(); } };
  });
  const env: NodeJS.ProcessEnv = { get HRAUTO_HOST_PRIMARY_DISPLAY() {
    assert.ok(held);
    claimPath = join(processLockRoot, "server-claims", `${String(held.generation)}.claim.json`);
    originalClaim = readFileSync(claimPath);
    const record = actualLocks.RuntimeProcessLockFileSchema.parse(JSON.parse(originalClaim.toString("utf8")));
    writeFileSync(claimPath, JSON.stringify({ ...record, acquiredAt: new Date(Date.parse(record.acquiredAt) - 1).toISOString() }), { mode: 0o600 });
    if (boundary === "profile-construction") { primary = injected; throw injected; }
    return "none";
  } };
  try {
    if (boundary === "listener-start") {
      await new Promise<void>((resolve, reject) => { occupied.once("error", reject); occupied.listen(0, "127.0.0.1", resolve); });
      const address = occupied.address(); assert.ok(address !== null && typeof address !== "string"); port = address.port;
    }
    await assert.rejects(runSecureEnvironmentBootstrap(["cli", "dashboard"], {
      acquireAdmission: () => f.machine,
      assertEnvironment: () => undefined,
      runCli: async admission => { await composeDashboardApplication({ admission, isolation: rebuildRuntimeIsolation,
        repoRoot: f.root, backendPortOverride: 0, frontendPortOverride: 0, env }); },
    }), error => {
      assert.ok(error instanceof storageCompose.RuntimeCustodyUncertainError);
      assert.equal(error.errors.length, 2);
      assert.equal(error.errors[0], primary);
      assert.equal(error.cause, primary);
      const releaseFailure: unknown = error.errors[1]; assert.ok(releaseFailure instanceof Error);
      assert.equal(releaseFailure.message, "server-claim-custody-lost");
      if (boundary === "listener-start") assert.ok(primary instanceof Error && "code" in primary && primary.code === "EADDRINUSE");
      else assert.equal(primary, injected);
      return true;
    });
    assert.equal(profileCloses, boundary === "listener-start" ? 1 : 0);
    f.machine.assertLive();
    assert.equal(actualLocks.runtimeProcessLockIsActive(processLockRoot, "server"), true);
    assert.ok(claimPath);
    assert.equal(existsSync(join(processLockRoot, "server-claims", `${String(held?.generation)}-${held?.acquisitionId}.release.json`)), false);
  } finally {
    process.argv.splice(0, process.argv.length, ...argv);
    if (claimPath !== undefined && originalClaim !== undefined) writeFileSync(claimPath, originalClaim, { mode: 0o600 });
    held?.release();
    if (occupied.listening) await new Promise<void>((resolve, reject) => occupied.close(error => error === undefined ? resolve() : reject(error)));
    locks.mockRestore(); start.mockRestore(); compose.mockRestore();
    vi.restoreAllMocks();
    f.machine.release(); rmSync(f.root, { recursive: true, force: true });
  }
});

it("serves public profile state without minting a selected profile, actor or authority database", async () => {
  const f = fixture();
  let runtime: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  try {
    runtime = await composeDashboardApplication({ admission: f.machine, isolation: rebuildRuntimeIsolation, repoRoot: f.root,
      backendPortOverride: 0, frontendPortOverride: 0, env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners });
    const base = `http://127.0.0.1:${String(runtime.port)}`;
    const response = await fetch(`${base}/api/v1/profile/state`);
    assert.deepEqual(PublicProfileStateSchema.parse(await response.json()), { state: "signed-out" });
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
    assert.equal(proxyState.status, 200); assert.deepEqual(proxyState.body, { state: "signed-out" });
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

it("uses a real verifier and selected session cookie, rejects foreign browser captures and performs canonical logout", async () => {
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
  const f = fixture();
  let runtime: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  try {
    runtime = await composeDashboardApplication({ admission: f.machine, isolation: rebuildRuntimeIsolation, repoRoot: f.root,
      backendPortOverride: 0, frontendPortOverride: 0, env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners });
    assert.ok(runtime.port > 0);
    const base = `http://127.0.0.1:${String(runtime.port)}`;
    const post = (path: string, body: unknown, cookie?: string) => fetch(`${base}${path}`, { method: "POST",
      headers: { origin: base, "content-type": "application/json", ...(cookie === undefined ? {} : { cookie }) }, body: JSON.stringify(body) });
    const signup = await post("/api/v1/profile/sign-up", { firstName: "Fixture", lastName: "Operator", email: "fixture@ucsd.edu", password: "disposable-fixture-password" });
    const active = PublicProfileStateSchema.parse(await signup.json()); assert.equal(active.state, "active");
    if (active.state !== "active") throw new Error("fixture actual signup required");
    const header = signup.headers.get("set-cookie"); assert.ok(header); assert.match(header, /HttpOnly/u); assert.match(header, /SameSite=Strict/u);
    const cookie = header.split(";", 1)[0]; assert.ok(cookie);
    assert.equal(JSON.stringify(active).includes(cookie.slice(cookie.indexOf("=") + 1)), false);
    const bootstrap = await fetch(`${base}/api/v1/bootstrap`, { headers: { cookie, origin: base } });
    assert.equal(bootstrap.status, 200);
    FrontendBootstrapWireSchema.parse(await bootstrap.json());
    assert.equal((await fetch(`${base}/api/v1/bootstrap`)).status, 401);
    for (const path of ["/api/v1/bootstrap", "/events", "/artifacts/foreign"]) {
      assert.equal((await fetch(`${base}${path}`, { headers: { cookie: "relay-profile-session=foreign" } })).status, 401);
    }
    assert.equal((await fetch(`${base}/api/v1/bootstrap`, { headers: { cookie, origin: "http://foreign.invalid" } })).status, 401);
    assert.equal((await fetch(`${base}/api/v1/profile/state`, { headers: { cookie } })).status, 200);
    assert.equal(existsSync(join(f.machine.stateRoot, "profiles", active.profileId, "state.db")), true);
    const logout = PublicProfileStateSchema.parse(await (await post("/api/v1/profile/logout", {}, cookie)).json());
    assert.deepEqual(logout, { state: "signed-out" });
    assert.equal(f.machine.readProfileRegistry().activeProfileId, null);
    assert.equal(f.machine.readProfileRegistry().profiles.find(row => row.profileId === active.profileId)?.credentialState, "wiped");
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

for (const fault of ["prior-request", "profile-close"] as const) it(`fences and drains real public transfers before retaining ${fault} shutdown failure`, async () => {
  const f = fixture(), primary = new Error("fixture custody failure");
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
    input.app.get("/prior-custody-fault", () => { throw primary; });
    return actualStart(input);
  });
  const compose = vi.spyOn(storageCompose, "composeProfileRuntime").mockImplementation(input => {
    const profile = actualProfile(input); profileForCleanup = profile;
    return fault === "profile-close" ? { ...profile, async close() { injectedCloseCalls++; throw primary; } } : profile;
  });
  try {
    runtime = await composeDashboardApplication({ admission: f.machine, isolation: rebuildRuntimeIsolation, repoRoot: f.root,
      backendPortOverride: 0, frontendPortOverride: 0, env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners });
    const base = `http://127.0.0.1:${String(runtime.port)}`;
    if (fault === "prior-request") {
      const response = await fetch(`${base}/prior-custody-fault`);
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { state: "error", code: "INTERNAL_FAILURE" });
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
    assert.equal(runtimeProcessLockIsActive(join(f.root, rebuildRuntimeIsolation.processLockRoot), "server"), true);
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
    const retainsPrimary = (value: unknown): boolean => value === primary || value instanceof AggregateError && value.errors.some(retainsPrimary);
    assert.equal(retainsPrimary(observedFailure), true, "original closure failure must survive nested custody aggregation");
    await assert.rejects(fetch(`${base}/api/v1/profile/state`));
    f.machine.assertLive();
    assert.equal(runtimeProcessLockIsActive(join(f.root, rebuildRuntimeIsolation.processLockRoot), "server"), true);
    await assert.rejects(runtime.stop(), error => error === observedFailure);
  } finally {
    release.resolve(); await outcome;
    await profileForCleanup?.close();
    start.mockRestore(); compose.mockRestore();
    f.machine.release(); rmSync(f.root, { recursive: true, force: true });
  }
});

for (const fault of ["prior-request", "transport-cancellation"] as const) it(`drains genuine selected producers despite ${fault} while retaining profile custody`, async () => {
  const f = fixture(), primary = new Error("fixture selected custody failure");
  const entered = Promise.withResolvers<void>(), aborted = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const actualStart = (await vi.importActual<typeof httpServer>("../../../../../src/backend/transports/http/http-server.js")).startDashboardHttpServer;
  const actualProfile = (await vi.importActual<typeof storageCompose>("../../../../../src/backend/app/composition/storage-compose.js")).composeProfileRuntime;
  let profile!: ReturnType<typeof actualProfile>;
  let context: ReturnType<typeof profile.selectedContext> | undefined;
  let token: string | undefined, preparations = 0, finalCloses = 0;
  const timers = vi.spyOn(globalThis, "setInterval"), clears = vi.spyOn(globalThis, "clearInterval");
  const dashboardHubClose = vi.spyOn(DashboardStreamHub.prototype, "close"), logsHubClose = vi.spyOn(RunLogsStreamHub.prototype, "close");
  vi.spyOn(storageCompose, "composeProfileRuntime").mockImplementation(input => {
    profile = actualProfile(input);
    return { ...profile,
      selectedContext(value) { token = value; context = profile.selectedContext(value); return context; },
      async awaitClosurePreparation(id) { await profile.awaitClosurePreparation(id); preparations++; },
      async close() { finalCloses++; await profile.close(); },
    };
  });
  vi.spyOn(httpServer, "startDashboardHttpServer").mockImplementation(async input => {
    input.app.get("/prior-selected-fault", () => { throw primary; });
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
    runtime = await composeDashboardApplication({ admission: f.machine, isolation: rebuildRuntimeIsolation, repoRoot: f.root,
      backendPortOverride: 0, frontendPortOverride: 0, env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners });
    const base = `http://127.0.0.1:${String(runtime.port)}`;
    const signup = await fetch(`${base}/api/v1/profile/sign-up`, { method: "POST", headers: { origin: base, "content-type": "application/json" },
      body: JSON.stringify({ firstName: "Fixture", lastName: "Operator", email: "fixture@ucsd.edu", password: "disposable-fixture-password" }) });
    assert.equal(PublicProfileStateSchema.parse(await signup.json()).state, "active");
    assert.ok(context !== undefined && token !== undefined);
    context.database.getMeta(); profile.assertCurrent(token);
    if (fault === "prior-request") {
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
    const retainsPrimary = (value: unknown): boolean => value === primary || value instanceof AggregateError && value.errors.some(retainsPrimary);
    assert.equal(retainsPrimary(error), true);
    assert.ok(preparations > 0, "actual selected activity cancellation and preparation completed");
    assert.ok(dashboardHubClose.mock.calls.length > 0 && logsHubClose.mock.calls.length > 0);
    assert.ok(ownedTimers.every(timer => clears.mock.calls.some(call => call[0] === timer)));
    assert.equal(finalCloses, 0, "unproved transport or prior custody cannot close the profile database");
    context.database.getMeta();
    assert.throws(() => profile.assertCurrent(token!), error => error instanceof ProfileSessionRefusedError && error.code === "PROFILE_SESSION_STALE");
    f.machine.assertLive();
    assert.equal(runtimeProcessLockIsActive(join(f.root, rebuildRuntimeIsolation.processLockRoot), "server"), true);
    await assert.rejects(runtime.stop(), current => current === error);
    await assert.rejects(fetch(`${base}/api/v1/profile/state`));
  } finally {
    release.resolve(); await held;
    if (profile !== undefined) await profile.close();
    vi.restoreAllMocks(); f.machine.release(); rmSync(f.root, { recursive: true, force: true });
  }
});


it("revokes retained selected producers before a genuine in-flight public transport drains", async () => {
  const f = fixture(), entered = Promise.withResolvers<void>(), aborted = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
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
    runtime = await composeDashboardApplication({ admission: f.machine, isolation: rebuildRuntimeIsolation, repoRoot: f.root,
      backendPortOverride: 0, frontendPortOverride: 0, env: {} });
    const base = `http://127.0.0.1:${String(runtime.port)}`;
    const signup = await fetch(`${base}/api/v1/profile/sign-up`, { method: "POST", headers: { origin: base, "content-type": "application/json" },
      body: JSON.stringify({ firstName: "Fixture", lastName: "Operator", email: "fixture@ucsd.edu", password: "disposable-fixture-password" }) });
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
