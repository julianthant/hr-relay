import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { it } from "vitest";
import { createProfileVerifiers } from "../../../../../src/backend/storage/configuration/verifier-store.js";
import { createDashboardClient } from "../../../../../src/dashboard/client/index.js";
import { composeDashboardApplication } from "../../../../../src/backend/app/composition/dashboard/compose.js";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { PublicProfileStateSchema } from "../../../../../src/models/profiles/public-profile.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";
import { syntheticOnboardingDuo } from "../../../../support/helpers/admission-fixture.js";
import { publicProfileShellFixture, readyPublicSignUp } from "../../../../support/helpers/backend/public-profile-shell.js";

it("completes authenticated onboarding without sending a host cookie", async () => {
  const fixture = await publicProfileShellFixture();
  let runtime: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  try {
    runtime = await composeDashboardApplication({
      lifetimeLock: fixture.lifetime, admission: fixture.machine, isolation: rebuildRuntimeIsolation, repoRoot: fixture.root,
      backendPortOverride: 0, onboardingDuo: syntheticOnboardingDuo(), env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners,
    });
    const origin = `http://127.0.0.1:${runtime.port}`;
    const onboarding = await readyPublicSignUp(origin);
    const response = await onboarding.finish();
    assert.equal(response.status, 200);
    assert.equal(PublicProfileStateSchema.parse(await response.json()).state, "active");
    assert.equal(response.headers.has("set-cookie"), false);
    const registry = fixture.machine.readProfileRegistry(), epoch = registry.sessionGeneration;
    assert.ok(registry.activeProfileId);
    const binding = { installationId: registry.installationId, profileId: registry.activeProfileId, epoch, origin };
    const proof = response.headers.get("x-relay-resume");
    const verifiers = createProfileVerifiers(fixture.machine.stateRoot);
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
