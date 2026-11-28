import assert from "node:assert/strict";
import { Hono } from "hono";
import { it } from "vitest";
import { ChatGptResourceClosureUnprovedError } from "../../../../../src/backend/accounts/chatgpt-account-service.js";
import { CHATGPT_OCR_MODEL } from "../../../../../src/backend/processing/providers/chatgpt-ocr-adapter.js";
import { registerChatGptAccountRoutes } from "../../../../../src/backend/transports/http/routes/chatgpt-account.js";
import type { DashboardApp } from "../../../../../src/backend/transports/http/routes/api-types.js";
import { ChatGptAccountStatusSchema } from "../../../../../src/models/dashboard/chatgpt-account.js";
import { ERROR_CATALOG } from "../../../../../src/models/failures/error-catalog.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { chatGptFixture } from "../../../../support/helpers/chatgpt-account-fixtures.js";
const path = "http://127.0.0.1/api/v1/settings/chatgpt-account";
const checkedAt = "2026-10-12T12:00:00.000Z";
const headers = { host: "127.0.0.1", origin: "http://127.0.0.1", "content-type": "application/json" };
const check = (app: DashboardApp, body = "{}", init: RequestInit = {}) => app.request(`${path}/check`, { method: "POST", headers, body, ...init });
it("checks the account only on the guarded POST and serves what it found on GET", async () => {
  const f = await chatGptFixture(), app: DashboardApp = new Hono();
  registerChatGptAccountRoutes(app, { clock: f.clock, chatGptAccount: f.service });
  try {
    const signedOut = ChatGptAccountStatusSchema.parse(await (await app.request(path)).json());
    assert.deepEqual(signedOut.account, { state: "signed-out" });
    assert.deepEqual(signedOut.usage, { state: "unavailable", reason: "signed-out" });
    await f.connected();
    const unchecked = ChatGptAccountStatusSchema.parse(await (await app.request(path)).json());
    assert.equal(unchecked.account.state, "connected");
    assert.deepEqual(unchecked.connection, { state: "unchecked", checkedAt: null, failureCode: null });
    assert.deepEqual(unchecked.usage, { state: "available", resetAt: null });
    assert.equal(f.calls.filter(call => call.url.endsWith("/models")).length, 0);
    const response = await check(app);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const checked = ChatGptAccountStatusSchema.parse(await response.json());
    assert.deepEqual(checked.connection, { state: "completed", checkedAt, failureCode: null });
    assert.deepEqual(await (await app.request(path)).json(), checked);
    assert.deepEqual(await (await check(app)).json(), checked);
    assert.equal(f.calls.filter(call => call.url.endsWith("/models")).length, 1);
    assert.equal(f.calls.filter(call => call.url.endsWith("/responses")).length, 0);
    assert.equal((await app.request(`${path}/check-connection`, { method: "POST" })).status, 404);
  } finally { await f.cleanup(); }
});

it("rechecks a revoked session even while the previous successful evidence is fresh", async () => {
  const f = await chatGptFixture(), app: DashboardApp = new Hono();
  registerChatGptAccountRoutes(app, { clock: f.clock, chatGptAccount: f.service });
  try {
    await f.connected();
    const ready = ChatGptAccountStatusSchema.parse(await (await check(app)).json());
    assert.equal(ready.connection.state, "completed");
    f.setModelsHook(async () => Response.json({ detail: "withheld" }, { status: 401 }));
    assert.equal(f.service.readStatus().connection.state, "completed");
    const result = ChatGptAccountStatusSchema.parse(await (await check(app, '{"fresh":true}')).json());
    assert.equal(f.calls.filter(call => call.url.endsWith("/models")).length, 2);
    assert.equal(result.connection.failureCode, "CHATGPT_ACCOUNT_EXPIRED");
    assert.deepEqual(f.service.readStatus(), result);
  } finally { await f.cleanup(); }
});

it("serves fixed OCR model availability from the same fresh account check", async () => {
  const f = await chatGptFixture(), app: DashboardApp = new Hono();
  registerChatGptAccountRoutes(app, { clock: f.clock, chatGptAccount: f.service, chatGptOcrModel: CHATGPT_OCR_MODEL });
  try {
    await f.connected();
    const fresh = async () => ChatGptAccountStatusSchema.parse(await (await check(app, '{"fresh":true}')).json());
    const ready = await fresh();
    assert.equal(ready.ocrModelAvailable, true);
    f.setModels({ models: [{ slug: "gpt-5", display_name: "Other model", visibility: "list" }] });
    const missing = await fresh();
    assert.equal(missing.account.state, "connected");
    assert.equal(missing.connection.state, "completed");
    assert.equal(missing.usage.state, "available");
    assert.equal(missing.ocrModelAvailable, false);
    const passive = ChatGptAccountStatusSchema.parse(await (await app.request(path)).json());
    assert.equal(passive.ocrModelAvailable, undefined);
    assert.equal(f.calls.filter(call => call.url.endsWith("/models")).length, 2);
  } finally { await f.cleanup(); }
});

for (const kind of ["closure", "unknown"] as const) it(`checks with the request signal and serves explicit ${kind} failure with no private details`, async () => {
  const app: DashboardApp = new Hono(), clock = manualClock(new Date(checkedAt)), abort = new AbortController();
  let observed: AbortSignal | undefined;
  registerChatGptAccountRoutes(app, { clock, chatGptAccount: {
    readStatus: () => { throw new Error("unexpected status read"); },
    checkStatus: async signal => { observed = signal; if (kind === "closure") throw new ChatGptResourceClosureUnprovedError(new Error("private")); throw new Error("private"); },
    signIn: async () => { throw new Error("unexpected sign-in"); },
    signOut: async () => { throw new Error("unexpected sign-out"); },
  } });
  const request = new Request(`${path}/check`, { method: "POST", headers, body: "{}", signal: abort.signal });
  const result = ChatGptAccountStatusSchema.parse(await (await app.request(request)).json());
  assert.equal(observed, request.signal);
  assert.equal(result.account.state, "unavailable");
  assert.deepEqual(result.connection, { state: "uncertain", checkedAt, failureCode: kind === "closure" ? "CHATGPT_RESOURCE_CLOSURE_UNPROVED" : "CHATGPT_CONNECTION_FAILED" });
  assert.deepEqual(result.usage, { state: "unavailable", reason: "unavailable" });
  assert.doesNotMatch(JSON.stringify(result), /private/u);
});

it("refuses a check the guard or its empty body does not admit, before the account is read", async () => {
  const f = await chatGptFixture(), app: DashboardApp = new Hono(); let checks = 0;
  registerChatGptAccountRoutes(app, { clock: f.clock, chatGptAccount: { ...f.service, checkStatus: signal => { checks++; return f.service.checkStatus(signal); } } });
  try {
    assert.equal((await check(app, "{}", { headers: { "content-type": "application/json" } })).status, 403);
    assert.equal((await check(app, "{}", { headers: { ...headers, "content-type": "text/plain" } })).status, 415);
    for (const body of ["", "not json", '{"force":true}', "[]"]) {
      const response = await check(app, body);
      assert.equal(response.status, 200, body);
      const status = ChatGptAccountStatusSchema.parse(await response.json());
      assert.deepEqual(status.account, { state: "unavailable", code: "CHATGPT_AUTH_INVALID", message: ERROR_CATALOG.CHATGPT_AUTH_INVALID.text });
      assert.deepEqual(status.connection, { state: "refused", checkedAt, failureCode: "CHATGPT_AUTH_INVALID" });
    }
    assert.equal(checks, 0);
  } finally { await f.cleanup(); }
});
