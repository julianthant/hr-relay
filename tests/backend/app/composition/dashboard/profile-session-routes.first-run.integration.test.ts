import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, it, vi } from "vitest";
import * as dashboardRunners from "../../../../../src/backend/app/preflight/dashboard-runners.js";
import * as httpServer from "../../../../../src/backend/transports/http/http-server.js";
import * as accounts from "../../../../../src/backend/accounts/chatgpt-account-service.js";
import { composeDashboardApplication } from "../../../../../src/backend/app/composition/dashboard/compose.js";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { PublicProfileStateSchema } from "../../../../../src/models/profiles/public-profile.js";
import { ProfileRegistryDocumentSchema } from "../../../../../src/models/profiles/profile.js";
import { ProfileSessionRefusedError } from "../../../../../src/backend/profiles/profile-errors.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";
import { syntheticOnboardingDuo } from "../../../../support/helpers/admission-fixture.js";
import { publicProfileShellFixture as fixture, readyPublicSignUp } from "../../../../support/helpers/backend/public-profile-shell.js";
import { assertRuntimeLifetimeHeld } from "../../../../support/helpers/backend/runtime-lifetime.js";
import type { DashboardComposeInput } from "../../../../../src/backend/app/composition/dashboard/runtime-contracts.js";

vi.mock("../../../../../src/backend/app/preflight/dashboard-runners.js", { spy: true });
vi.mock("../../../../../src/backend/transports/http/http-server.js", { spy: true });
vi.mock("../../../../../src/backend/accounts/chatgpt-account-service.js", { spy: true });

beforeEach(async () => {
  const [originalRunners, originalHttp, originalAccounts] = await Promise.all([
    vi.importActual<typeof dashboardRunners>("../../../../../src/backend/app/preflight/dashboard-runners.js"),
    vi.importActual<typeof httpServer>("../../../../../src/backend/transports/http/http-server.js"),
    vi.importActual<typeof accounts>("../../../../../src/backend/accounts/chatgpt-account-service.js"),
  ]);
  vi.mocked(dashboardRunners.createDashboardPreflightRunners).mockReset().mockImplementation(originalRunners.createDashboardPreflightRunners);
  vi.mocked(httpServer.startDashboardHttpServer).mockReset().mockImplementation(originalHttp.startDashboardHttpServer);
  vi.mocked(accounts.createChatGptAccountService).mockReset().mockImplementation(originalAccounts.createChatGptAccountService);
});

it("serves the original local startup report at Finish and replays it without checks or remote connection calls", async () => {
  const f = await fixture();
  const actualAccounts = await vi.importActual<typeof accounts>("../../../../../src/backend/accounts/chatgpt-account-service.js");
  const checkConnection = vi.fn(async () => { throw new Error("signup must not check ChatGPT remotely"); });
  vi.spyOn(accounts, "createChatGptAccountService").mockImplementation(input => ({ ...actualAccounts.createChatGptAccountService(input), checkConnection }));
  const reports: Parameters<NonNullable<DashboardComposeInput["onInitialPreflight"]>>[0][] = [];
  let runtime: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  try {
    runtime = await composeDashboardApplication({ lifetimeLock: f.lifetime, admission: f.machine, isolation: rebuildRuntimeIsolation, repoRoot: f.root,
      backendPortOverride: 0, frontendPortOverride: 0, onboardingDuo: syntheticOnboardingDuo(), env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners,
      onInitialPreflight: report => { reports.push(report); } });
    const base = `http://127.0.0.1:${runtime.port}`, ready = await readyPublicSignUp(base);
    assert.equal(reports.length, 0);
    const finished = await ready.finish(), active = PublicProfileStateSchema.parse(await finished.json());
    assert.equal(active.state, "active");
    if (active.state !== "active") throw new Error("active signup required");
    assert.deepEqual(active.firstRunCheck, { scope: "local-startup", profileId: active.profileId, epoch: active.epoch, state: "passed", report: reports[0] });
    assert.deepEqual(reports[0]?.requestedCapabilities, ["dashboard.serve"]);
    assert.equal(reports.length, 1); assert.equal(checkConnection.mock.calls.length, 0);
    const completion = f.machine.readProfileRegistry().profiles[0]?.registration.onboardingCompletion;
    const replay = await ready.finish();
    assert.equal(replay.status, finished.status); assert.deepEqual(await replay.json(), active);
    assert.equal(replay.headers.get("set-cookie"), finished.headers.get("set-cookie"));
    assert.equal(reports.length, 1); assert.equal(checkConnection.mock.calls.length, 0);
    assert.deepEqual(f.machine.readProfileRegistry().profiles[0]?.registration.onboardingCompletion, completion);
    const sessionCookie = finished.headers.get("set-cookie")?.split(";", 1)[0]; assert.ok(sessionCookie);
    const ordinary = PublicProfileStateSchema.parse(await (await fetch(`${base}/api/v1/profile/state`, { headers: { cookie: sessionCookie } })).json());
    assert.deepEqual(ordinary, { state: "active", profileId: active.profileId, epoch: active.epoch, duoState: active.duoState });
    const foreign = await ready.post("/api/v1/profile/onboarding/complete", { operationId: ready.draft.operationId }, "relay-profile-onboarding=foreign");
    assert.deepEqual(await foreign.json(), { state: "refused", code: "PROFILE_SESSION_STALE" });
    assert.equal(reports.length, 1);
    const logout = await ready.post("/api/v1/profile/logout", {}, sessionCookie); assert.equal(logout.status, 200);
    assert.deepEqual(await (await ready.finish()).json(), { state: "refused", code: "PROFILE_SESSION_STALE" });
  } finally { await runtime?.stop(); vi.restoreAllMocks(); f.machine.release(); rmSync(f.root, { recursive: true, force: true }); }
});

it("a refused dashboard start after Finish keeps the published profile signed in and resumes it without a password", async () => {
  const f = await fixture();
  const actual = await vi.importActual<typeof dashboardRunners>("../../../../../src/backend/app/preflight/dashboard-runners.js");
  let refuse = true, probes = 0;
  const reports: Parameters<NonNullable<DashboardComposeInput["onInitialPreflight"]>>[0][] = [];
  const spy = vi.spyOn(dashboardRunners, "createDashboardPreflightRunners").mockImplementation(input => {
    const composed = actual.createDashboardPreflightRunners(input);
    return { ...composed, runners: composed.runners.map(runner => runner.check !== "ports.available" ? runner : { ...runner,
      async run(context) { probes++; return refuse ? { check: runner.check, state: "unhealthy" as const, summary: "fixture frontend owner refused", impact: "fixture start refused" } : runner.run(context); } }) };
  });
  let runtime: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  try {
    runtime = await composeDashboardApplication({ lifetimeLock: f.lifetime, admission: f.machine, isolation: rebuildRuntimeIsolation, repoRoot: f.root,
      backendPortOverride: 0, frontendPortOverride: 0, onboardingDuo: syntheticOnboardingDuo(), env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners,
      onInitialPreflight: report => { reports.push(report); } });
    const base = `http://127.0.0.1:${String(runtime.port)}`;
    const { post, cookie, finish, draft } = await readyPublicSignUp(base);
    const failed = await finish();
    assert.equal(failed.status, 500);
    const body = PublicProfileStateSchema.parse(await failed.json()), registry = f.machine.readProfileRegistry();
    assert.deepEqual(body, { state: "error", code: "INTERNAL_FAILURE", firstRunCheck: { scope: "local-startup", profileId: draft.profileId,
      epoch: registry.sessionGeneration, state: "failed", report: reports[0] } });
    assert.equal(reports[0]?.results.some(result => result.status === "fail" && result.check === "ports.available"), true);
    assert.ok(registry.profiles[0]?.registration.onboardingCompletion);
    const replay = await finish(); assert.equal(replay.status, 500); assert.deepEqual(await replay.json(), body);
    assert.equal(probes, 1); assert.equal(reports.length, 1); assert.equal(replay.headers.get("set-cookie"), null);
    const state = await fetch(`${base}/api/v1/profile/state`, { headers: { cookie } });
    assert.equal(state.status, 200);
    assert.deepEqual(PublicProfileStateSchema.parse(await state.json()), { state: "signed-out", signUpRequired: false, resumable: true });
    refuse = false;
    const login = await post("/api/v1/profile/resume", {});
    const resumed = PublicProfileStateSchema.parse(await login.json()); assert.equal(resumed.state, "active");
    if (resumed.state !== "active") throw new Error("resumed profile required");
    assert.equal(resumed.profileId, draft.profileId);
    assert.equal(resumed.epoch, registry.sessionGeneration + 1);
    const afterResume = await finish();
    assert.deepEqual(await afterResume.json(), { state: "refused", code: "PROFILE_SESSION_STALE" });
    assert.equal(probes, 2); assert.equal(reports.length, 2);
    const session = login.headers.get("set-cookie")?.split(";", 1)[0]; assert.ok(session);
    assert.equal((await fetch(`${base}/api/v1/bootstrap`, { headers: { cookie: session, origin: base } })).status, 200);
    const registryPath = join(f.machine.stateRoot, "machine", "profiles.json"), registration = f.machine.readProfileRegistry().profiles[0]?.registration;
    const stopping = runtime; runtime = undefined;
    await stopping.stop();
    assert.throws(() => f.machine.assertLive());
    await assertRuntimeLifetimeHeld(f.lifetime);
    const retained = ProfileRegistryDocumentSchema.parse(JSON.parse(readFileSync(registryPath, "utf8")));
    assert.equal(retained.profiles.length, 1); assert.deepEqual(retained.profiles[0]?.registration, registration);
    await assert.rejects(fetch(`${base}/api/v1/profile/state`));
  } finally { spy.mockRestore(); await runtime?.stop(); f.machine.release(); rmSync(f.root, { recursive: true, force: true }); }
});

for (const phase of ["before-report", "after-report"] as const) it(`retains an unavailable or passed check when mounting fails ${phase}`, async () => {
  const f = await fixture();
  let probes = 0;
  if (phase === "before-report") {
    const actual = await vi.importActual<typeof dashboardRunners>("../../../../../src/backend/app/preflight/dashboard-runners.js");
    vi.spyOn(dashboardRunners, "createDashboardPreflightRunners").mockImplementation(input => {
      const composed = actual.createDashboardPreflightRunners(input);
      return { ...composed, runners: composed.runners.map(runner => runner.check !== "ports.available" ? runner : { ...runner,
        async run() { probes++; throw new Error("fixture local check could not complete"); } }) };
    });
  } else {
    const actual = await vi.importActual<typeof httpServer>("../../../../../src/backend/transports/http/http-server.js");
    vi.spyOn(httpServer, "startDashboardHttpServer").mockImplementation(async input => {
      const listener = await actual.startDashboardHttpServer(input);
      return { ...listener, mount() { probes++; throw new ProfileSessionRefusedError("PROFILE_AUTHORITY_UNAVAILABLE"); } };
    });
  }
  let runtime: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  const reports: Parameters<NonNullable<DashboardComposeInput["onInitialPreflight"]>>[0][] = [];
  try {
    runtime = await composeDashboardApplication({ lifetimeLock: f.lifetime, admission: f.machine, isolation: rebuildRuntimeIsolation, repoRoot: f.root,
      backendPortOverride: 0, frontendPortOverride: 0, onboardingDuo: syntheticOnboardingDuo(), env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners,
      onInitialPreflight: report => { reports.push(report); } });
    const ready = await readyPublicSignUp(`http://127.0.0.1:${runtime.port}`), response = await ready.finish();
    const body = PublicProfileStateSchema.parse(await response.json());
    assert.deepEqual(body, { state: phase === "before-report" ? "error" : "refused", code: phase === "before-report" ? "INTERNAL_FAILURE" : "PROFILE_AUTHORITY_UNAVAILABLE",
      firstRunCheck: { scope: "local-startup", profileId: ready.draft.profileId, epoch: f.machine.readProfileRegistry().sessionGeneration,
        ...(phase === "before-report" ? { state: "unavailable", code: "PROFILE_FIRST_RUN_CHECK_UNAVAILABLE" } : { state: "passed", report: reports[0] }) } });
    assert.equal(response.status, phase === "before-report" ? 500 : 409);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(reports.length, phase === "before-report" ? 0 : 1);
    const replay = await ready.finish(); assert.equal(replay.status, response.status); assert.deepEqual(await replay.json(), body); assert.equal(probes, 1);
  } finally { await runtime?.stop(); vi.restoreAllMocks(); f.machine.release(); rmSync(f.root, { recursive: true, force: true }); }
});

it("leaves unfinished Duo setup as an uncompleted refusal without a first-run result", async () => {
  const f = await fixture(), onInitialPreflight = vi.fn();
  let runtime: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  try {
    runtime = await composeDashboardApplication({ lifetimeLock: f.lifetime, admission: f.machine, isolation: rebuildRuntimeIsolation, repoRoot: f.root,
      backendPortOverride: 0, frontendPortOverride: 0, onboardingDuo: syntheticOnboardingDuo(), env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners, onInitialPreflight });
    const base = `http://127.0.0.1:${runtime.port}`;
    const signup = await fetch(`${base}/api/v1/profile/sign-up`, { method: "POST", headers: { origin: base, "content-type": "application/json" },
      body: JSON.stringify({ firstName: "Fixture", lastName: "Operator", email: "fixture@ucsd.edu", password: "disposable-fixture-password" }) });
    const draft = PublicProfileStateSchema.parse(await signup.json()); assert.equal(draft.state, "onboarding");
    if (draft.state !== "onboarding") throw new Error("unfinished draft required");
    const cookie = signup.headers.get("set-cookie")?.split(";", 1)[0]; assert.ok(cookie);
    for (let attempt = 0; attempt < 2; attempt++) {
      const response: Response = await fetch(`${base}/api/v1/profile/onboarding/complete`, { method: "POST", headers: { origin: base, "content-type": "application/json", cookie },
        body: JSON.stringify({ operationId: draft.operationId }) });
      assert.equal(response.status, 409); assert.deepEqual(await response.json(), { state: "refused", code: "PROFILE_AUTHORITY_UNAVAILABLE" });
    }
    assert.equal(onInitialPreflight.mock.calls.length, 0); assert.deepEqual(f.machine.readProfileRegistry().profiles, []);
    const current = PublicProfileStateSchema.parse(await (await fetch(`${base}/api/v1/profile/state`, { headers: { cookie } })).json());
    assert.equal(current.state, "onboarding");
  } finally { await runtime?.stop(); f.machine.release(); rmSync(f.root, { recursive: true, force: true }); }
});
