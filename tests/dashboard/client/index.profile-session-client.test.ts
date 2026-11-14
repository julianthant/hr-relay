import { z } from "zod";
import assert from "node:assert/strict";
import { it } from "vitest";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { DuoReenrolStateSchema, type DeleteProfileAccountRequest } from "../../../src/models/profiles/public-profile.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { healthyDashboardPreflightReport } from "../../support/fixtures/preflight-seams.js";

it("keeps real profile responses and fixed failures distinct without retry or token projection", async () => {
  const requests: { path: string; origin: unknown; body: unknown }[] = [];
  const client = createDashboardClient({ baseUrl: "http://127.0.0.1:5174", fetchImpl: async (url, init) => {
    requests.push({ path: new URL(url).pathname, origin: new Headers(init?.headers).get("origin"), body: init?.body });
    return Response.json({ state: "error", code: "RUNTIME_CUSTODY_UNCERTAIN" }, { status: 500 });
  } });
  assert.deepEqual(await client.logOutProfile(), { state: "error", code: "RUNTIME_CUSTODY_UNCERTAIN" });
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], { path: "/api/v1/profile/logout", origin: "http://127.0.0.1:5174", body: "{}" });
});

it("preserves first-run report and unavailable results through the shared completion parser", async () => {
  const profileId = "00000000-0000-4000-8000-000000000001", operationId = "00000000-0000-4000-8000-000000000002";
  const report = healthyDashboardPreflightReport(manualClock(new Date("2026-11-08T12:00:00Z")));
  const firstRunCheck = { scope: "local-startup", profileId, epoch: 7, state: "passed", report };
  for (const body of [
    { state: "active", profileId, epoch: 7, duoState: "ready", firstRunCheck },
    { state: "error", code: "RUNTIME_CUSTODY_UNCERTAIN", firstRunCheck },
    { state: "error", code: "INTERNAL_FAILURE", firstRunCheck: { scope: "local-startup", profileId, epoch: 7, state: "unavailable", code: "PROFILE_FIRST_RUN_CHECK_UNAVAILABLE" } },
  ]) {
    const fetchImpl = async () => Response.json(body, { status: body.state === "active" ? 200 : 500 });
    const client = createDashboardClient({ baseUrl: "http://127.0.0.1:5174", fetchImpl });
    assert.deepEqual(await client.completeProfileOnboarding({ operationId }), body);
  }
});

it("returns the parsed refused body for a 403 profile state", async () => {
  const client = createDashboardClient({ baseUrl: "http://127.0.0.1:5174", fetchImpl: async () => Response.json({ state: "refused", code: "DASHBOARD_FRONTEND_NOT_OWNED" }, { status: 403 }) });
  assert.deepEqual(await client.readProfileSession(), { state: "refused", code: "DASHBOARD_FRONTEND_NOT_OWNED" });
});

it("refuses foreign public session payloads instead of treating them as login success", async () => {
  const client = createDashboardClient({ baseUrl: "http://127.0.0.1:5174", fetchImpl: async () => Response.json({ state: "active", token: "client-supplied" }) });
  await assert.rejects(client.readProfileSession());
});


it("keeps onboarding commands in the canonical transport with validated scoped bodies", async () => {
  const operationId = "00000000-0000-4000-8000-000000000001", attemptId = "00000000-0000-4000-8000-000000000002";
  const calls: { path: string; body: unknown }[] = [];
  const client = createDashboardClient({ baseUrl: "http://localhost:3938", fetchImpl: async (url, init) => {
    calls.push({ path: new URL(url).pathname, body: JSON.parse(z.string().parse(init?.body)) });
    return Response.json({ state: "signed-out" });
  } });
  await client.startProfileOnboardingDuo({ operationId, method: "key" });
  await client.confirmProfileOnboardingDuo({ operationId, method: "touch", attemptId, operatorConfirmed: true });
  await client.cancelProfileOnboardingDuo({ operationId, method: "key", attemptId });
  await client.completeProfileOnboarding({ operationId });
  await client.cancelProfileOnboarding({ operationId });
  assert.deepEqual(calls, [
    { path: "/api/v1/profile/onboarding/duo/start", body: { operationId, method: "key" } },
    { path: "/api/v1/profile/onboarding/duo/confirm", body: { operationId, method: "touch", attemptId, operatorConfirmed: true } },
    { path: "/api/v1/profile/onboarding/duo/cancel", body: { operationId, method: "key", attemptId } },
    { path: "/api/v1/profile/onboarding/complete", body: { operationId } },
    { path: "/api/v1/profile/onboarding/cancel", body: { operationId } },
  ]);
  await assert.rejects(client.completeProfileOnboarding({ operationId: "invalid" }));
  assert.equal(calls.length, 5);
});


it("accepts an explicitly confirmed software ceremony without inventing portal acceptance", async () => {
  const method = { state: "complete", ceremonyObserved: true, portalAccepted: true, operatorConfirmed: true, exactCredentialRequestObserved: false };
  const draft = { browser: { state: "open" as const, generation: 1 }, state: "onboarding", operationId: "00000000-0000-4000-8000-000000000001",
    profileId: "00000000-0000-4000-8000-000000000002", step: "ready",
    methods: { key: { ...method, portalAccepted: false }, touch: method } };
  let value = draft;
  const client = createDashboardClient({ baseUrl: "http://localhost:3938", fetchImpl: async () => Response.json(value) });
  const state = await client.readProfileSession();
  assert.equal(state.state, "onboarding");
  if (state.state === "onboarding") { assert.equal(state.methods.key.portalAccepted, false); assert.equal(state.methods.key.state, "complete"); }
  value = { ...draft, methods: { ...draft.methods, touch: { ...method, portalAccepted: false } } };
  assert.equal((await client.readProfileSession()).state, "onboarding");
  value = { ...draft, methods: { ...draft.methods, touch: { ...method, portalAccepted: false, operatorConfirmed: false } } };
  await assert.rejects(client.readProfileSession());
});

it("requires explicit confirmation for account deletion and carries empty-machine guidance", async () => {
  const calls: { path: string; body: unknown }[] = [];
  const client = createDashboardClient({ baseUrl: "http://localhost:3938", fetchImpl: async (url, init) => {
    calls.push({ path: new URL(url).pathname, body: JSON.parse(z.string().parse(init?.body)) });
    return Response.json({ state: "signed-out", signUpRequired: true });
  } });
  const request = { confirmed: true, expectedProfileId: "00000000-0000-4000-8000-000000000001", expectedEpoch: 7 } as const;
  for (const invalid of [
    { ...request, confirmed: false }, { confirmed: true },
    { confirmed: true, expectedEpoch: 7 }, { confirmed: true, expectedProfileId: request.expectedProfileId },
    { ...request, expectedProfileId: "foreign" }, { ...request, expectedEpoch: 0 },
    { ...request, expectedEpoch: -1 }, { ...request, expectedEpoch: 1.5 },
    { ...request, expectedEpoch: Number.MAX_SAFE_INTEGER + 1 }, { ...request, expectedEpoch: "7" },
  ]) await assert.rejects(client.deleteProfileAccount(invalid as DeleteProfileAccountRequest));
  assert.equal(calls.length, 0);
  assert.deepEqual(await client.deleteProfileAccount(request), { state: "signed-out", signUpRequired: true });
  assert.deepEqual(calls, [{ path: "/api/v1/profile/delete-account", body: request }]);
});

it("posts a password and a username change to their routes and returns the served result, including a refused body", async () => {
  const seen: { path: string; body: unknown }[] = [];
  const results = [{ state: "changed" }, { state: "refused", code: "PROFILE_USERNAME_TAKEN" }];
  const client = createDashboardClient({ baseUrl: "http://127.0.0.1:5174", fetchImpl: async (url, init) => {
    seen.push({ path: new URL(url).pathname, body: init?.body });
    return Response.json(results[seen.length - 1], { status: 200 });
  } });
  assert.deepEqual(await client.changeProfilePassword({ currentPassword: "a", newPassword: "b" }), { state: "changed" });
  assert.deepEqual(await client.changeProfileUsername({ currentPassword: "a", newUsername: "x@ucsd.edu" }), { state: "refused", code: "PROFILE_USERNAME_TAKEN" });
  assert.deepEqual(seen, [
    { path: "/api/v1/profile/account/password", body: JSON.stringify({ currentPassword: "a", newPassword: "b" }) },
    { path: "/api/v1/profile/account/username", body: JSON.stringify({ currentPassword: "a", newUsername: "x@ucsd.edu" }) },
  ]);
});

it("posts a details change and returns the served account or the refusal", async () => {
  const seen: { path: string; body: unknown }[] = [];
  const account = { name: "Sam Rivera", initials: "SR", timekeeper: "Sam Rivera", lastSignedInAt: "2026-11-01T10:00:00Z" };
  const results = [{ state: "changed", account }, { state: "refused", code: "PROFILE_INITIALS_REFUSED" }];
  const client = createDashboardClient({ baseUrl: "http://127.0.0.1:5174", fetchImpl: async (url, init) => {
    seen.push({ path: new URL(url).pathname, body: init?.body });
    return Response.json(results[seen.length - 1], { status: 200 });
  } });
  assert.deepEqual(await client.changeProfileDetails({ initials: "SR" }), { state: "changed", account });
  assert.deepEqual(await client.changeProfileDetails({ initials: "!" }), { state: "refused", code: "PROFILE_INITIALS_REFUSED" });
  assert.equal(seen[0]?.path, "/api/v1/profile/account/details");
  assert.equal(seen[0]?.body, JSON.stringify({ initials: "SR" }));
  await assert.rejects(client.changeProfileDetails({}));
});

it("posts Duo re-enrolment commands to their routes and parses only a served re-enrolment state", async () => {
  const operationId = "00000000-0000-4000-8000-000000000001", attemptId = "00000000-0000-4000-8000-000000000002";
  const profileId = "00000000-0000-4000-8000-000000000003";
  const idle = { state: "idle", ceremonyObserved: false, portalAccepted: false, operatorConfirmed: false, exactCredentialRequestObserved: false };
  const served = DuoReenrolStateSchema.parse({ state: "duo-reenrol", operationId, profileId, step: "duo", methods: { key: idle, touch: idle },
    browser: { state: "checking", generation: 0 } });
  const calls: { path: string; body: unknown }[] = [];
  const client = createDashboardClient({ baseUrl: "http://127.0.0.1:3938", fetchImpl: async (url, init) => {
    calls.push({ path: new URL(url).pathname, body: JSON.parse(z.string().parse(init?.body)) });
    return Response.json(served);
  } });
  assert.deepEqual(await client.beginProfileDuoReenrol(), served);
  assert.deepEqual(await client.readProfileDuoReenrol({ operationId }), served);
  assert.deepEqual(await client.showProfileDuoReenrolBrowser({ operationId }), served);
  assert.deepEqual(await client.reopenProfileDuoReenrolBrowser({ operationId, generation: 2 }), served);
  assert.deepEqual(await client.openProfileDuoReenrolPortal({ operationId }), served);
  assert.deepEqual(await client.startProfileDuoReenrol({ operationId, method: "key" }), served);
  assert.deepEqual(await client.confirmProfileDuoReenrol({ operationId, method: "touch", attemptId, operatorConfirmed: true }), served);
  assert.deepEqual(await client.cancelProfileDuoReenrolAttempt({ operationId, method: "key", attemptId }), served);
  assert.deepEqual(calls, [
    { path: "/api/v1/profile/duo/reenrol/begin", body: {} },
    { path: "/api/v1/profile/duo/reenrol/read", body: { operationId } },
    { path: "/api/v1/profile/duo/reenrol/browser", body: { operationId } },
    { path: "/api/v1/profile/duo/reenrol/reopen", body: { operationId, generation: 2 } },
    { path: "/api/v1/profile/duo/reenrol/portal", body: { operationId } },
    { path: "/api/v1/profile/duo/reenrol/start", body: { operationId, method: "key" } },
    { path: "/api/v1/profile/duo/reenrol/confirm", body: { operationId, method: "touch", attemptId, operatorConfirmed: true } },
    { path: "/api/v1/profile/duo/reenrol/cancel-attempt", body: { operationId, method: "key", attemptId } },
  ]);
  for (const malformed of [
    { state: "duo-reenrol" },
    { ...served, extra: true },
    { ...served, step: "ready" },
    { state: "refused", code: "PROFILE_SESSION_STALE" },
    { state: "error", code: "SCHEMA_INVALID", message: "no", retryable: false },
  ]) {
    const refusing = createDashboardClient({ baseUrl: "http://127.0.0.1:3938", fetchImpl: async () => Response.json(malformed) });
    await assert.rejects(refusing.readProfileDuoReenrol({ operationId }));
  }
  await assert.rejects(client.readProfileDuoReenrol({ operationId: "not-a-uuid" }));
  assert.equal(calls.length, 8);
});

it("parses commit and cancel as the active profile, including a served refusal", async () => {
  const operationId = "00000000-0000-4000-8000-000000000001";
  const active = { state: "active", profileId: "00000000-0000-4000-8000-000000000003", epoch: 4, duoState: "ready" };
  const calls: { path: string; body: unknown }[] = [];
  const bodies = [active, { state: "refused", code: "PROFILE_DUO_REENROL_UNCERTAIN" }];
  const client = createDashboardClient({ baseUrl: "http://127.0.0.1:3938", fetchImpl: async (url, init) => {
    calls.push({ path: new URL(url).pathname, body: JSON.parse(z.string().parse(init?.body)) });
    return Response.json(bodies[calls.length - 1]);
  } });
  assert.deepEqual(await client.commitProfileDuoReenrol({ operationId }), active);
  assert.deepEqual(await client.cancelProfileDuoReenrol({ operationId }), { state: "refused", code: "PROFILE_DUO_REENROL_UNCERTAIN" });
  assert.deepEqual(calls, [
    { path: "/api/v1/profile/duo/reenrol/commit", body: { operationId } },
    { path: "/api/v1/profile/duo/reenrol/cancel", body: { operationId } },
  ]);
  await assert.rejects(client.commitProfileDuoReenrol({ operationId: "not-a-uuid" }));
  const malformed = createDashboardClient({ baseUrl: "http://127.0.0.1:3938", fetchImpl: async () => Response.json({ state: "active", token: "secret" }) });
  await assert.rejects(malformed.cancelProfileDuoReenrol({ operationId }));
});
