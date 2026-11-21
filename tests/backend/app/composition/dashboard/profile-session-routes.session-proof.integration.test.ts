import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { createServer, request } from "node:http";
import { it, vi } from "vitest";
import type { DashboardComposeInput } from "../../../../../src/backend/app/composition/dashboard/runtime-contracts.js";
import * as startup from "../../../../../src/backend/app/composition/dashboard/runtime-startup.js";
import * as verifierStore from "../../../../../src/backend/storage/configuration/verifier-store.js";
import { AuthorityDatabase } from "../../../../../src/backend/storage/sqlite/authority-database.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { acquireEntrypointAdmission } from "../../../../../src/backend/storage/admission/bootstrap-admission.js";
import { createServedOnboardingPort } from "../../../../../src/dashboard/surfaces/shell/onboarding-model.js";
import { createDashboardClient } from "../../../../../src/dashboard/client/index.js";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { PublicProfileStateSchema } from "../../../../../src/models/profiles/public-profile.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";
import { syntheticOnboardingDuo } from "../../../../support/helpers/admission-fixture.js";
import { publicProfileShellFixture, readyPublicSignUp, composePublicProfileFixtureRuntime as composeDashboardApplication } from "../../../../support/helpers/backend/public-profile-shell.js";

vi.mock("../../../../../src/backend/app/composition/dashboard/runtime-startup.js", { spy: true });
vi.mock("../../../../../src/backend/storage/configuration/verifier-store.js", { spy: true });

function start(fixture: Awaited<ReturnType<typeof publicProfileShellFixture>>, overrides: Partial<DashboardComposeInput> = {}) {
  return composeDashboardApplication({
    admission: fixture.machine, lifetimeLock: fixture.lifetime, isolation: rebuildRuntimeIsolation, repoRoot: fixture.root,
    backendPortOverride: 0, frontendPortOverride: 0, onboardingDuo: syntheticOnboardingDuo(), env: {},
    preflightRunnerFactory: healthyRuntimePreflightRunners, ...overrides,
  });
}

function tabStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

it("completes authenticated onboarding without sending a host cookie", async () => {
  const fixture = await publicProfileShellFixture();
  let runtime: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  try {
    runtime = await start(fixture);
    const origin = `http://127.0.0.1:${runtime.port}`;
    const onboarding = await readyPublicSignUp(runtime);
    const response = await onboarding.finish();
    assert.equal(response.status, 200);
    assert.equal(PublicProfileStateSchema.parse(await response.json()).state, "active");
    assert.equal(response.headers.has("set-cookie"), false);
    const registry = fixture.machine.readProfileRegistry(), epoch = registry.sessionGeneration;
    assert.ok(registry.activeProfileId);
    const binding = { installationId: registry.installationId, profileId: registry.activeProfileId, epoch, origin };
    const proof = response.headers.get("x-relay-resume");
    const verifiers = verifierStore.createProfileVerifiers(fixture.machine.stateRoot);
    assert.ok(proof && verifiers.verifyResumeProof(binding, proof));
    for (const changed of [{ installationId: crypto.randomUUID() }, { profileId: crypto.randomUUID() }, { epoch: epoch + 1 },
      { origin: `http://127.0.0.1:${runtime.port === 65535 ? 65534 : runtime.port + 1}` }]) assert.equal(verifiers.verifyResumeProof({ ...binding, ...changed }, proof), false);
    const fresh = createDashboardClient({ baseUrl: origin, fetchImpl: async (url, init) => {
      const reply = await fetch(url, init);
      if (new URL(url).pathname === "/api/v1/profile/resume" && !new Headers(init?.headers).has("x-relay-resume")) {
        assert.equal(reply.headers.has("x-relay-session"), false);
        assert.equal(reply.headers.has("x-relay-resume"), false);
        assert.equal(reply.headers.has("set-cookie"), false);
      }
      return reply;
    } });
    assert.deepEqual(await fresh.readProfileSession(), { state: "signed-out", signUpRequired: false });
    assert.deepEqual(await fresh.resumeProfile(), { state: "refused", code: "PROFILE_SIGN_IN_REFUSED" });
    await assert.rejects(fresh.bootstrap());
    const login = { email: "fixture@ucsd.edu", password: "disposable-fixture-password" };
    assert.equal((await fresh.signInProfile({ ...login, password: "incorrect-fixture-password" })).state, "refused");
    assert.equal((await fresh.signInProfile(login)).state, "active");
    assert.equal((await fresh.resumeProfile()).state, "active");
    assert.equal(fixture.machine.readProfileRegistry().sessionGeneration, epoch);
    await fresh.bootstrap();
  } finally {
    await runtime?.stop();
    fixture.machine.release();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

it("delivers protected resources only at the dashboard origin and discards a superseded read", async () => {
  const origin = "http://127.0.0.1:31001";
  const image = Promise.withResolvers<Response>(), started = Promise.withResolvers<void>();
  let requests = 0;
  const client = createDashboardClient({ baseUrl: origin, fetchImpl: async (url, init) => {
    requests++;
    assert.equal(new URL(url).origin, origin);
    assert.equal(init?.redirect, "error");
    assert.equal(init?.credentials, "omit");
    if (url.endsWith("/logout")) return Response.json({ state: "signed-out", signUpRequired: false });
    if (url.endsWith("/sign-in")) return Response.json({
      state: "active", profileId: "00000000-0000-4000-8000-000000000001", epoch: 1, duoState: "ready",
    }, { headers: { "x-relay-session": "fixture-session", "x-relay-resume": "fixture-proof" } });
    const headers = new Headers(init?.headers);
    assert.ok(headers.get("x-relay-session") === "fixture-session");
    assert.equal(headers.has("x-relay-resume"), false);
    assert.equal(headers.has("cookie"), false);
    if (url.endsWith("/pending")) { started.resolve(); return image.promise; }
    return new Response("fixture image", { headers: { "content-type": "image/png" } });
  } });
  await client.signInProfile({ email: "fixture@ucsd.edu", password: "disposable-fixture-password" });
  const signal = new AbortController().signal;
  await assert.rejects(client.fetchAuthenticatedResource("http://127.0.0.1:31002/artifacts/v1/image", signal));
  assert.equal(requests, 1);
  const resource = await client.fetchAuthenticatedResource(origin + "/artifacts/v1/image", signal);
  try { assert.equal(await (await fetch(resource.url)).text(), "fixture image"); }
  finally { resource.release(); }
  await assert.rejects(fetch(resource.url));
  const pending = client.fetchAuthenticatedResource(origin + "/artifacts/v1/pending", signal);
  await started.promise;
  await client.logOutProfile();
  image.resolve(new Response("superseded image"));
  await assert.rejects(pending);
});

it("joins two enrolled tabs through state and resume during a cold mount", async () => {
  const fixture = await publicProfileShellFixture();
  let machine = fixture.machine;
  let runtime: Awaited<ReturnType<typeof start>> | undefined;
  const mounting = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const requests: Promise<Response>[] = [];
  try {
    runtime = await start(fixture);
    const port = runtime.port, origin = `http://127.0.0.1:${port}`;
    const enrollment = await (await readyPublicSignUp(runtime)).finish();
    assert.equal(PublicProfileStateSchema.parse(await enrollment.json()).state, "active");
    const proof = enrollment.headers.get("x-relay-resume");
    assert.ok(proof);
    const epoch = machine.readProfileRegistry().sessionGeneration;
    await runtime.stop();
    runtime = undefined;
    machine = acquireEntrypointAdmission(fixture.root, "exclusive", fixture.lifetime);
    const actual = await vi.importActual<typeof startup>("../../../../../src/backend/app/composition/dashboard/runtime-startup.js");
    vi.mocked(startup.composeDashboardRuntime).mockImplementationOnce(async input => {
      mounting.resolve();
      await release.promise;
      return actual.composeDashboardRuntime(input);
    });
    const verified = Promise.withResolvers<void>();
    let observeJoin = false;
    const store = await vi.importActual<typeof verifierStore>("../../../../../src/backend/storage/configuration/verifier-store.js");
    vi.mocked(verifierStore.createProfileVerifiers).mockImplementation(root => {
      const verifiers = store.createProfileVerifiers(root);
      return { ...verifiers, verifyResumeProof(binding, supplied) {
        const valid = verifiers.verifyResumeProof(binding, supplied);
        if (valid && observeJoin) verified.resolve();
        return valid;
      } };
    });
    runtime = await start(fixture, { admission: machine, backendPortOverride: port });
    const state = async () => {
      const response = await fetch(origin + "/api/v1/profile/state", { headers: { origin, "x-relay-resume": proof } });
      return PublicProfileStateSchema.parse(await response.json());
    };
    const resume = (enrolled: boolean) => fetch(origin + "/api/v1/profile/resume", {
      method: "POST", headers: { origin, "content-type": "application/json", ...(enrolled && { "x-relay-resume": proof }) }, body: "{}",
    });
    const denied = await resume(false);
    assert.deepEqual(await denied.json(), { state: "refused", code: "PROFILE_SIGN_IN_REFUSED" });
    for (const header of ["x-relay-session", "x-relay-resume", "set-cookie"]) assert.equal(denied.headers.has(header), false);
    assert.equal(machine.readProfileRegistry().sessionGeneration, epoch);
    const resumable = { state: "signed-out", resumable: true, signUpRequired: false };
    assert.deepEqual(await state(), resumable);
    const firstRequest = resume(true);
    requests.push(firstRequest);
    await Promise.race([mounting.promise, firstRequest.then(() => assert.fail("first resume did not reach mount"))]);
    assert.equal(machine.readProfileRegistry().sessionGeneration, epoch + 1);
    assert.deepEqual(await state(), resumable);
    observeJoin = true;
    const secondRequest = resume(true);
    requests.push(secondRequest);
    await Promise.race([verified.promise, secondRequest.then(() => assert.fail("second resume did not join the mount"))]);
    release.resolve();
    const [first, second] = await Promise.all([firstRequest, secondRequest]);
    for (const response of [first, second]) {
      const session = PublicProfileStateSchema.parse(await response.json());
      assert.ok(session.state === "active" && session.epoch === epoch + 1);
      assert.ok(response.headers.has("x-relay-session") && response.headers.has("x-relay-resume"));
    }
    assert.ok(first.headers.get("x-relay-resume") === second.headers.get("x-relay-resume"));
    assert.deepEqual(await state(), { state: "signed-out", signUpRequired: false });
  } finally {
    release.resolve();
    await Promise.allSettled(requests);
    vi.mocked(verifierStore.createProfileVerifiers).mockReset();
    vi.mocked(startup.composeDashboardRuntime).mockReset();
    await runtime?.stop();
    machine.release();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

it("starts enrolled tabs while the cold mount response is awaiting browser settlement", async () => {
  const fixture = await publicProfileShellFixture();
  const received = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const pending: Promise<unknown>[] = [];
  let runtime: Awaited<ReturnType<typeof start>> | undefined, machine = fixture.machine;
  try {
    runtime = await start(fixture);
    const port = runtime.port, origin = `http://127.0.0.1:${port}`;
    const enrollment = await (await readyPublicSignUp(runtime)).finish();
    const proof = enrollment.headers.get("x-relay-resume");
    assert.ok(proof);
    const epoch = machine.readProfileRegistry().sessionGeneration;
    await runtime.stop();
    runtime = undefined;
    machine = acquireEntrypointAdmission(fixture.root, "exclusive", fixture.lifetime);
    runtime = await start(fixture, { admission: machine, backendPortOverride: port });
    const localStorage = tabStorage();
    localStorage.setItem("relay.profile.resume", proof);
    const tab = (holdResponse: boolean) => {
      const entered = Promise.withResolvers<void>();
      vi.stubGlobal("window", { location: { origin }, localStorage, sessionStorage: tabStorage(), navigator: { locks: {
        request: (key: string, run: () => unknown) => {
          const queued = navigator.locks.request(key, run);
          if (!holdResponse) entered.resolve();
          return queued;
        },
      } } });
      try {
        const client = createDashboardClient({ baseUrl: origin, fetchImpl: async (url, init) => {
          const response = await fetch(url, init);
          if (holdResponse && url.endsWith("/resume")) {
            assert.equal(response.status, 200);
            received.resolve();
            await release.promise;
          } else if (!holdResponse) entered.resolve();
          return response;
        } });
        return { client, entered: entered.promise };
      } finally { vi.unstubAllGlobals(); }
    };
    const first = tab(true), discovered = tab(false);
    const resumable = { state: "signed-out", signUpRequired: false, resumable: true };
    assert.deepEqual(await first.client.readProfileSession(), resumable);
    assert.deepEqual(await discovered.client.readProfileSession(), resumable);
    const mounting = first.client.resumeProfile();
    pending.push(mounting);
    await Promise.race([received.promise, mounting.then(() => assert.fail("cold response was not held"))]);
    assert.equal(machine.readProfileRegistry().sessionGeneration, epoch + 1);
    const arriving = tab(false);
    const discovery = arriving.client.readProfileSession();
    pending.push(discovery);
    await arriving.entered;
    const joining = discovered.client.resumeProfile();
    pending.push(joining);
    release.resolve();
    assert.equal((await mounting).state, "active");
    assert.deepEqual(await discovery, resumable);
    assert.equal((await joining).state, "active");
    assert.equal((await arriving.client.resumeProfile()).state, "active");
    assert.equal(machine.readProfileRegistry().sessionGeneration, epoch + 1);
  } finally {
    release.resolve();
    await Promise.allSettled(pending);
    await runtime?.stop();
    machine.release();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

it.each(["logout", "login before settlement", "login after settlement", "login during deletion"] as const)("recovers the initiating tab through %s", async entry => {
  const fixture = await publicProfileShellFixture();
  let runtime: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  const clock = manualClock(new Date("2026-11-04T12:00:00Z"));
  const settlement = vi.spyOn(AuthorityDatabase.prototype, "settlePendingLogout");
  const actual = await vi.importActual<typeof startup>("../../../../../src/backend/app/composition/dashboard/runtime-startup.js");
  vi.mocked(startup.composeDashboardRuntime).mockImplementationOnce(async input => {
    const mounted = await actual.composeDashboardRuntime(input);
    let held = true;
    return { ...mounted, async detach() {
      if (held && entry === "login before settlement") { held = false; throw new Error("fixture detach delayed"); }
      await mounted.detach();
      if (held) { held = false; throw new Error("fixture closure confirmation delayed"); }
    } };
  });
  try {
    runtime = await start(fixture, { clock });
    const origin = `http://127.0.0.1:${runtime.port}`;
    const enrolled = await (await readyPublicSignUp(runtime)).finish();
    assert.equal(PublicProfileStateSchema.parse(await enrolled.json()).state, "active");
    const localStorage = tabStorage(), sessionStorage = tabStorage();
    const load = () => {
      vi.stubGlobal("window", { location: { origin }, localStorage, sessionStorage,
        navigator: { locks: { request: (_name: string, callback: () => unknown) => callback() } } });
      try { return createDashboardClient({ baseUrl: origin }); } finally { vi.unstubAllGlobals(); }
    };
    const first = load();
    const active = await first.signInProfile({ email: "fixture@ucsd.edu", password: "disposable-fixture-password" });
    assert.ok(active.state === "active");
    const confirmation = { confirmed: true as const, expectedProfileId: active.profileId, expectedEpoch: active.epoch };
    const interruption = entry === "login during deletion" ? await first.deleteProfileAccount(confirmation) : await first.logOutProfile();
    assert.equal(interruption.state, "error");
    const journalOpen = entry === "login before settlement";
    assert.deepEqual(fixture.machine.readPendingLogoutProfileIds(), journalOpen ? [active.profileId] : []);
    const settlementsBeforeLogin = journalOpen ? 0 : 1;
    assert.equal(settlement.mock.calls.length, settlementsBeforeLogin);
    assert.equal(fixture.machine.readProfileRegistry().activeProfileId, null);
    const stranger = createDashboardClient({ baseUrl: origin });
    assert.equal((await stranger.readProfileSession()).state, "signed-out");
    assert.deepEqual(await stranger.logOutProfile(), { state: "refused", code: "PROFILE_SESSION_STALE" });
    const reloaded = load();
    assert.equal((await reloaded.readProfileSession()).state, "cancelling");
    const details = { firstName: "", lastName: "", email: "fixture@ucsd.edu", password: "disposable-fixture-password" };
    const settled: string[] = [];
    const form = createServedOnboardingPort(reloaded, state => settled.push(state.state));
    assert.deepEqual(await stranger.signInProfile({ email: details.email, password: details.password }),
      { state: "refused", code: "PROFILE_TRANSITION_BLOCKED" });
    if (entry === "login during deletion") {
      assert.deepEqual(await form.submit("login", details), { state: "refused", code: "PROFILE_TRANSITION_BLOCKED" });
      assert.equal((await reloaded.readProfileSession()).state, "cancelling");
      assert.deepEqual(await reloaded.logOutProfile(), { state: "refused", code: "PROFILE_LOGOUT_BLOCKED" });
      assert.deepEqual(await reloaded.deleteProfileAccount({ ...confirmation, expectedEpoch: active.epoch + 1 }),
        { state: "refused", code: "PROFILE_SESSION_STALE" });
      assert.ok(fixture.machine.readProfileRegistry().profiles.some(row => row.profileId === active.profileId));
      assert.equal(settlement.mock.calls.length, 1);
      return;
    }
    assert.deepEqual(await reloaded.deleteProfileAccount(confirmation), { state: "refused", code: "PROFILE_LOGOUT_BLOCKED" });
    const signedOut = { state: "signed-out", signUpRequired: false };
    if (entry === "logout") {
      assert.deepEqual(await reloaded.logOutProfile(), signedOut);
    } else {
      const refused = { state: "refused", code: "PROFILE_SIGN_IN_REFUSED" };
      for (let attempt = 0; attempt < 5; attempt++) {
        assert.deepEqual(await form.submit("login", { ...details, password: "incorrect-fixture-password" }), refused);
      }
      assert.deepEqual(await form.submit("login", details), refused);
      assert.equal(settlement.mock.calls.length, settlementsBeforeLogin);
      clock.advanceWall(60_001);
      assert.equal((await reloaded.readProfileSession()).state, "cancelling");
      assert.deepEqual(await form.submit("login", details), signedOut);
      assert.deepEqual(settled, [...Array<string>(6).fill("refused"), "signed-out"]);
    }
    assert.deepEqual(await load().logOutProfile(), { state: "refused", code: "PROFILE_SESSION_STALE" });
    assert.equal(settlement.mock.calls.length, 1);
    assert.equal(fixture.machine.readProfileRegistry().sessionGeneration, active.epoch + 1);
  } finally {
    settlement.mockRestore();
    vi.mocked(startup.composeDashboardRuntime).mockReset();
    await runtime?.stop();
    fixture.machine.release();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

it("admits the owned frontend but refuses its use of the backend origin's active credential", async () => {
  const fixture = await publicProfileShellFixture();
  let runtime: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  const path = "/api/v1/profile/state";
  const frontend = createServer((incoming, outgoing) => {
    if (!runtime || incoming.url !== path || incoming.method !== "GET") { outgoing.writeHead(404).end(); return; }
    const upstream = request({ hostname: "127.0.0.1", port: runtime.port, path, headers: incoming.headers }, response => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(outgoing);
    });
    upstream.on("error", error => outgoing.destroy(error));
    upstream.end();
  });
  try {
    await new Promise<void>((resolve, reject) => { frontend.once("error", reject); frontend.listen(0, "127.0.0.1", resolve); });
    const address = frontend.address();
    assert.ok(address && typeof address === "object");
    let probed = false;
    runtime = await start(fixture, {
      frontendPortOverride: address.port,
      frontendProbe: async ({ port }) => { assert.equal(port, address.port); probed = true; return { state: "owned" }; },
    });
    const origin = `http://127.0.0.1:${runtime.port}`, otherOrigin = `http://127.0.0.1:${address.port}`;
    const enrollment = await (await readyPublicSignUp(runtime)).finish();
    const credential = enrollment.headers.get("x-relay-session");
    assert.ok(credential);
    const stateAt = async (target: string) => {
      const response = await fetch(target + path, { headers: { origin: target, "x-relay-session": credential } });
      assert.equal(response.status, 200);
      return PublicProfileStateSchema.parse(await response.json());
    };
    assert.equal((await stateAt(origin)).state, "active");
    assert.deepEqual(await stateAt(otherOrigin), { state: "signed-out", signUpRequired: false });
    assert.ok(probed);
  } finally {
    await frontend[Symbol.asyncDispose]();
    await runtime?.stop();
    fixture.machine.release();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
