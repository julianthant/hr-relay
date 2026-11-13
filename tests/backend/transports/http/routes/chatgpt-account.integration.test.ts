import { manualClock } from "../../../../../src/rules/time/clock.js";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { Hono } from "hono";
import { it } from "vitest";
import { chatGptFixture } from "../../../../support/helpers/chatgpt-account-fixtures.js";
import { registerChatGptAccountRoutes, type ChatGptAccountRouteDeps } from "../../../../../src/backend/transports/http/routes/chatgpt-account.js";
import type { DashboardApp } from "../../../../../src/backend/transports/http/routes/api-types.js";
import { operatorMutationIngressGuard } from "../../../../../src/backend/transports/http/routes/operator-mutation-ingress.js";
import { ChatGptAccountStatusSchema, ChatGptSignInCompletionSchema, ChatGptSignInStartSchema, ChatGptAccountStateSchema, type ChatGptAccountState } from "../../../../../src/models/dashboard/chatgpt-account.js";
import { ChatGptResourceClosureUnprovedError } from "../../../../../src/backend/accounts/chatgpt-account-service.js";
import { ERROR_CATALOG } from "../../../../../src/models/failures/error-catalog.js";
import { WireErrorSchema } from "../../../../../src/models/dashboard/primitives.js";
import type { ChatGptAuthorization } from "../../../../../src/backend/accounts/chatgpt-account-service.js";
const path = "/api/v1/settings/chatgpt-account";

it("preserves the original typed closure refusal even when the current account is connected", async () => {
  const completion = Promise.withResolvers<ChatGptAccountState>();
  const app: DashboardApp = new Hono();
  let reads = 0;
  registerChatGptAccountRoutes(app, { clock: manualClock(new Date("2026-10-12T12:00:00.000Z")), chatGptAccount: {
    readStatus: async () => { throw new Error("unexpected status read"); },
    refreshAccount: async () => { reads++; return ChatGptAccountStateSchema.parse({ state: "connected", name: "Synthetic", email: "synthetic@example.com", expiresAt: "2099-01-01T00:00:00.000Z", planUsage: "enabled" }); },
    signIn: async () => ({ authorizationUrl: "https://auth.openai.com/api/accounts/authorize", expiresAt: "2099-01-01T00:00:00.000Z", completion: completion.promise, cancel: async () => {} }),
  } });
  const started = ChatGptSignInStartSchema.parse(await (await app.request(`http://127.0.0.1${path}/sign-in`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"usePlan":true}' })).json());
  completion.reject(new ChatGptResourceClosureUnprovedError(new Error("PRIVATE_CLOSURE_CANARY")));
  for (let replay = 0; replay < 2; replay++) {
    const result = ChatGptSignInCompletionSchema.parse(await (await app.request(`http://127.0.0.1${path}/sign-in/${started.attemptId}`)).json());
    assert.deepEqual(result, { state: "uncertain", attemptId: started.attemptId, code: "CHATGPT_RESOURCE_CLOSURE_UNPROVED", message: ERROR_CATALOG.CHATGPT_RESOURCE_CLOSURE_UNPROVED.text });
    assert.equal(reads, 0);
  }
});

async function setup(debugEvents?: ChatGptAccountRouteDeps["debugEvents"]) {
  const fixture = await chatGptFixture();
  let authorization: ChatGptAuthorization | undefined;
  const app: DashboardApp = new Hono();
  app.use("/api/v1/settings/chatgpt-account/sign-in", operatorMutationIngressGuard);
  app.use("/api/v1/settings/chatgpt-account/sign-in/:attemptId/cancel", operatorMutationIngressGuard);
  registerChatGptAccountRoutes(app, { clock: fixture.clock, debugEvents, chatGptAccount: { ...fixture.service, signIn: async input => { authorization = await fixture.service.signIn(input); return authorization; } } });
  const request = (suffix = "", input?: unknown) => app.request(`http://127.0.0.1${path}${suffix}`, input === undefined ? undefined : { method: "POST", headers: { host: "127.0.0.1", origin: "http://127.0.0.1", "content-type": "application/json" }, body: JSON.stringify(input) });
  return { ...fixture, app, request, authorization: () => { assert.ok(authorization); return authorization; } };
}
it("retains asynchronous diagnostic failure for named readback without rejecting an unobserved completion", async () => {
  let diagnosticAttempts = 0;
  const f = await setup({ emit() { diagnosticAttempts++; throw new Error("PRIVATE_DIAGNOSTIC_CAUSE"); } });
  try {
    const started = ChatGptSignInStartSchema.parse(await (await f.request("/sign-in", { usePlan: true })).json());
    await f.callback(f.authorization(), { error: "access_denied" });
    await new Promise(resolve => setImmediate(resolve));
    for (let read = 0; read < 2; read++) {
      const response = await f.request(`/sign-in/${started.attemptId}`);
      assert.equal(response.status, 500);
      assert.deepEqual(WireErrorSchema.parse(await response.json()), { state: "error", code: "LOGGING_UNAVAILABLE",
        message: ERROR_CATALOG.LOGGING_UNAVAILABLE.text, retryable: false });
    }
    assert.equal(diagnosticAttempts, 1);
    assert.deepEqual(ChatGptAccountStatusSchema.parse(await (await f.request()).json()).account, { state: "signed-out" });
  } finally { await f.cleanup(); }
});
it("serves token-free account lifecycle with original PKCE, state and nonce binding", async () => {
  const f = await setup(); try {
    assert.deepEqual(ChatGptAccountStatusSchema.parse(await (await f.request()).json()).account, { state: "signed-out" });
    const started = ChatGptSignInStartSchema.parse(await (await f.request("/sign-in", { usePlan: true })).json());
    assert.notEqual(started.attemptId, new URL(started.authorizationUrl).searchParams.get("state"));
    const pending = ChatGptAccountStatusSchema.parse(await (await f.request()).json()).account;
    if (pending.state !== "signing-in") throw new Error("expected pending sign-in");
    assert.equal(pending.state, "signing-in"); assert.equal(pending.authorizationUrl, started.authorizationUrl);
    assert.equal(pending.expiresAt, started.expiresAt);
    assert.equal((await f.callback(f.authorization(), { state: "wrong" })).status, 400);
    await f.callback(f.authorization());
    const completion = ChatGptSignInCompletionSchema.parse(await (await f.request(`/sign-in/${started.attemptId}`)).json());
    assert.equal(completion.state, "completed");
    assert.doesNotMatch(JSON.stringify(completion), /synthetic-access|synthetic-refresh|idToken|code_verifier/u);
    assert.equal((await f.request()).headers.get("cache-control"), "no-store");
  } finally { await f.cleanup(); }
});

it("renews expired Settings reads instead of publishing sign-in-again state", async () => {
  const f = await setup();
  try {
    await f.connected(); f.clock.advanceWall(3_600_000);
    assert.deepEqual(f.service.readAccount(), { state: "expired" });
    const result = ChatGptAccountStatusSchema.parse(await (await f.request()).json()).account;
    assert.equal(result.state, "connected");
    if (result.state !== "connected") throw new Error("renewed Settings account required");
    assert.equal(Date.parse(result.expiresAt), f.clock.nowMs() + 3_600_000);
    assert.equal(f.repository.read()?.session?.refreshToken, "synthetic-refresh-2");
    assert.equal(f.calls.filter(call => call.url.endsWith("/responses")).length, 0);
  } finally { await f.cleanup(); }
});

it("keeps a temporary renewal failure unavailable instead of asserting that reconnection is required", async () => {
  const f = await setup();
  try {
    await f.connected(); f.clock.advanceWall(3_600_000); f.setTokenStatus(503);
    const before = f.repository.read(), result = ChatGptAccountStatusSchema.parse(await (await f.request()).json()).account;
    assert.deepEqual(result, { state: "unavailable", code: "CHATGPT_AUTH_UNAVAILABLE", message: ERROR_CATALOG.CHATGPT_AUTH_UNAVAILABLE.text });
    assert.deepEqual(f.repository.read(), before);
  } finally { await f.cleanup(); }
});

it("refuses bad JSON input, cross-origin writes, stale attempts and overlapping starts", async () => {
  const f = await setup(); try {
    assert.equal((await f.app.request(`http://127.0.0.1${path}/sign-in`, { method: "POST", body: "{}" })).status, 403);
    assert.equal((await (await f.request("/sign-in", { usePlan: true, token: "synthetic" })).json() as { state: string }).state, "refused");
    const started = ChatGptSignInStartSchema.parse(await (await f.request("/sign-in", { usePlan: true })).json());
    assert.equal((await (await f.request("/sign-in", { usePlan: true })).json() as { code: string }).code, "CHATGPT_AUTH_BUSY");
    assert.equal((await f.request("/sign-in/00000000-0000-4000-8000-000000000099")).status, 400);
    assert.equal((await (await f.request(`/sign-in/${started.attemptId}/cancel`, {})).json() as { state: string }).state, "cancelled");
    assert.equal((await (await f.request(`/sign-in/${started.attemptId}`)).json() as { code: string }).code, "CHATGPT_AUTH_CANCELLED");
    const next = ChatGptSignInStartSchema.parse(await (await f.request("/sign-in", { usePlan: false })).json());
    assert.equal((await f.request(`/sign-in/${started.attemptId}`)).status, 400);
    await f.request(`/sign-in/${next.attemptId}/cancel`, {});
  } finally { await f.cleanup(); }
});
for (const failure of ["nonce", "expiry", "denial"] as const) it(`keeps ${failure} refusal distinct without a token response`, async () => {
  const f = await setup(); try {
    const started = ChatGptSignInStartSchema.parse(await (await f.request("/sign-in", { usePlan: true })).json());
    if (failure === "nonce") f.setClaims({ nonce: "wrong" });
    if (failure === "expiry") f.clock.advanceWall(300_000);
    await f.callback(f.authorization(), failure === "denial" ? { error: "access_denied" } : {});
    const result = ChatGptSignInCompletionSchema.parse(await (await f.request(`/sign-in/${started.attemptId}`)).json());
    assert.equal(result.state, "refused");
    assert.deepEqual(ChatGptAccountStatusSchema.parse(await (await f.request()).json()).account, { state: "signed-out" });
  } finally { await f.cleanup(); }
});
it("keeps typed OCR resource closure uncertainty distinct and exposes only its defined operator text", async () => {
  const app: DashboardApp = new Hono();
  registerChatGptAccountRoutes(app, { clock: manualClock(new Date("2026-10-12T12:00:00.000Z")), chatGptOcrTest: { testOcr: async () => { throw new ChatGptResourceClosureUnprovedError(new Error("synthetic private cause")); } } });
  const response = await app.request(`http://127.0.0.1${path}/test-ocr`, { method: "POST",
    headers: { host: "127.0.0.1", origin: "http://127.0.0.1", "content-type": "application/json" }, body: "{}" });
  assert.deepEqual(await response.json(), { state: "uncertain", code: "CHATGPT_RESOURCE_CLOSURE_UNPROVED", message: ERROR_CATALOG.CHATGPT_RESOURCE_CLOSURE_UNPROVED.text });
});

for (const alreadyAborted of [false, true]) it(`ends only the completion GET wait when its request is ${alreadyAborted ? "already aborted" : "aborted while pending"}`, async () => {
  const f = await setup();
  try {
    const started = ChatGptSignInStartSchema.parse(await (await f.request("/sign-in", { usePlan: true })).json());
    const cancellation = new AbortController(), reason = new Error("synthetic completion request ended");
    if (alreadyAborted) cancellation.abort(reason);
    let settled = false;
    const waiting = Promise.resolve(f.app.request(new Request(`http://127.0.0.1${path}/sign-in/${started.attemptId}`, { signal: cancellation.signal })))
      .then(response => { settled = true; return response; });
    if (!alreadyAborted) {
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(settled, false);
      cancellation.abort(reason);
    }
    const response = await waiting;
    assert.equal(response.status, 400);
    assert.equal((await response.json() as { code: string }).code, "CHATGPT_AUTH_UNAVAILABLE");
    assert.equal(cancellation.signal.reason, reason);
    assert.equal(ChatGptAccountStatusSchema.parse(await (await f.request()).json()).account.state, "signing-in");
    await f.callback(f.authorization());
    const completed = ChatGptSignInCompletionSchema.parse(await (await f.request(`/sign-in/${started.attemptId}`)).json());
    assert.equal(completed.state, "completed");
  } finally { await f.cleanup(); }
});

it("refuses an already completed authorization result when the completion GET aborts before its awaited return", async () => {
  const f = await setup();
  try {
    const started = ChatGptSignInStartSchema.parse(await (await f.request("/sign-in", { usePlan: true })).json());
    await f.callback(f.authorization());
    const completed = ChatGptSignInCompletionSchema.parse(await (await f.request(`/sign-in/${started.attemptId}`)).json());
    assert.equal(completed.state, "completed");
    const cancellation = new AbortController(), reason = new Error("synthetic completion response cancelled");
    const request = new Request(`http://127.0.0.1${path}/sign-in/${started.attemptId}`, { signal: cancellation.signal });
    assert.equal(getEventListeners(request.signal, "abort").length, 0);
    const waiting = Promise.resolve(f.app.request(request));
    assert.equal(getEventListeners(request.signal, "abort").length, 1);
    cancellation.abort(reason);
    const response = await waiting;
    assert.equal(response.status, 400);
    assert.equal((await response.json() as { code: string }).code, "CHATGPT_AUTH_UNAVAILABLE");
    assert.equal(request.signal.reason, reason);
    assert.equal(getEventListeners(request.signal, "abort").length, 0);
    const current = ChatGptSignInCompletionSchema.parse(await (await f.request(`/sign-in/${started.attemptId}`)).json());
    assert.equal(current.state, "completed");
    assert.equal(ChatGptAccountStatusSchema.parse(await (await f.request()).json()).account.state, "connected");
  } finally { await f.cleanup(); }
});
