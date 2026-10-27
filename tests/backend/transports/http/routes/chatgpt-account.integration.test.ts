import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { Hono } from "hono";
import { it } from "vitest";
import { chatGptFixture } from "../../../../support/helpers/chatgpt-account-fixtures.js";
import { registerChatGptAccountRoutes } from "../../../../../src/backend/transports/http/routes/chatgpt-account.js";
import type { DashboardApp } from "../../../../../src/backend/transports/http/routes/api-types.js";
import { operatorMutationIngressGuard } from "../../../../../src/backend/transports/http/routes/operator-mutation-ingress.js";
import { ChatGptSignInCompletionSchema, ChatGptSignInStartSchema } from "../../../../../src/models/dashboard/chatgpt-account.js";
import { ChatGptResourceClosureUnprovedError } from "../../../../../src/backend/accounts/chatgpt-account-service.js";
import { ERROR_CATALOG } from "../../../../../src/models/failures/error-catalog.js";
import type { ChatGptAuthorization } from "../../../../../src/backend/accounts/chatgpt-account-service.js";
const path = "/api/v1/settings/chatgpt-account";
async function setup() {
  const fixture = await chatGptFixture();
  let authorization: ChatGptAuthorization | undefined;
  const app: DashboardApp = new Hono();
  app.use("/api/v1/settings/chatgpt-account/sign-in", operatorMutationIngressGuard);
  app.use("/api/v1/settings/chatgpt-account/sign-in/:attemptId/cancel", operatorMutationIngressGuard);
  app.use("/api/v1/settings/chatgpt-account/sign-out", operatorMutationIngressGuard);
  registerChatGptAccountRoutes(app, { chatGptAccount: { ...fixture.service, signIn: async input => { authorization = await fixture.service.signIn(input); return authorization; } } });
  const request = (suffix = "", input?: unknown) => app.request(`http://127.0.0.1${path}${suffix}`, input === undefined ? undefined : { method: "POST", headers: { host: "127.0.0.1", origin: "http://127.0.0.1", "content-type": "application/json" }, body: JSON.stringify(input) });
  return { ...fixture, app, request, authorization: () => { assert.ok(authorization); return authorization; } };
}
it("serves token-free account lifecycle with original PKCE, state and nonce binding", async () => {
  const f = await setup(); try {
    assert.deepEqual(await (await f.request()).json(), { state: "signed-out" });
    const started = ChatGptSignInStartSchema.parse(await (await f.request("/sign-in", { usePlan: true })).json());
    assert.notEqual(started.attemptId, new URL(started.authorizationUrl).searchParams.get("state"));
    const pending = await (await f.request()).json() as { state: string; authorizationUrl: string; expiresAt: string };
    assert.equal(pending.state, "signing-in"); assert.equal(pending.authorizationUrl, started.authorizationUrl);
    assert.equal(pending.expiresAt, started.expiresAt);
    assert.equal((await f.callback(f.authorization(), { state: "wrong" })).status, 400);
    await f.callback(f.authorization());
    const completion = ChatGptSignInCompletionSchema.parse(await (await f.request(`/sign-in/${started.attemptId}`)).json());
    assert.equal(completion.state, "completed");
    assert.doesNotMatch(JSON.stringify(completion), /synthetic-access|synthetic-refresh|idToken|code_verifier/u);
    assert.equal((await f.request()).headers.get("cache-control"), "no-store");
    assert.deepEqual(await (await f.request("/sign-out", {})).json(), { state: "signed-out", remoteRevocation: "confirmed" });
    assert.deepEqual(await (await f.request()).json(), { state: "signed-out" });
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
    assert.deepEqual(await (await f.request()).json(), { state: "signed-out" });
  } finally { await f.cleanup(); }
});
it("keeps local sign-out authoritative when remote revocation is unconfirmed", async () => {
  const f = await setup(); try {
    await f.connected(); f.setRevocation(503);
    assert.deepEqual(await (await f.request("/sign-out", {})).json(), { state: "signed-out", remoteRevocation: "unconfirmed" });
    assert.deepEqual(await (await f.request()).json(), { state: "signed-out" });
  } finally { await f.cleanup(); }
});

it("keeps typed OCR resource closure uncertainty distinct and exposes only its defined operator text", async () => {
  const app: DashboardApp = new Hono();
  registerChatGptAccountRoutes(app, { chatGptOcrTest: { testOcr: async () => { throw new ChatGptResourceClosureUnprovedError(new Error("synthetic private cause")); } } });
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
    assert.equal((await (await f.request()).json() as { state: string }).state, "signing-in");
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
    assert.equal((await (await f.request()).json() as { state: string }).state, "connected");
  } finally { await f.cleanup(); }
});
