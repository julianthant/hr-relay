import { z } from "zod";
import assert from "node:assert/strict";
import { it } from "vitest";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";

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
  const draft = { state: "onboarding", operationId: "00000000-0000-4000-8000-000000000001",
    profileId: "00000000-0000-4000-8000-000000000002", step: "ready",
    methods: { key: { ...method, portalAccepted: false }, touch: method } };
  let value = draft;
  const client = createDashboardClient({ baseUrl: "http://localhost:3938", fetchImpl: async () => Response.json(value) });
  const state = await client.readProfileSession();
  assert.equal(state.state, "onboarding");
  if (state.state === "onboarding") { assert.equal(state.methods.key.portalAccepted, false); assert.equal(state.methods.key.state, "complete"); }
  value = { ...draft, methods: { ...draft.methods, touch: { ...method, portalAccepted: false } } };
  await assert.rejects(client.readProfileSession());
});
