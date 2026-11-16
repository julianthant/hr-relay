import assert from "node:assert/strict";
import { Hono } from "hono";
import { it } from "vitest";
import { ChatGptResourceClosureUnprovedError } from "../../../../../src/backend/accounts/chatgpt-account-service.js";
import { registerChatGptAccountRoutes } from "../../../../../src/backend/transports/http/routes/chatgpt-account.js";
import type { DashboardApp } from "../../../../../src/backend/transports/http/routes/api-types.js";
import { ChatGptAccountStatusSchema } from "../../../../../src/models/dashboard/chatgpt-account.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { chatGptFixture } from "../../../../support/helpers/chatgpt-account-fixtures.js";
const path = "http://127.0.0.1/api/v1/settings/chatgpt-account";
const checkedAt = "2026-10-12T12:00:00.000Z";
it("serves automatic account status on GET, caches checks and removes the manual POST", async () => {
  const f = await chatGptFixture(), app: DashboardApp = new Hono();
  registerChatGptAccountRoutes(app, { clock: f.clock, chatGptAccount: f.service });
  try {
    const signedOut = ChatGptAccountStatusSchema.parse(await (await app.request(path)).json());
    assert.deepEqual(signedOut.account, { state: "signed-out" });
    assert.deepEqual(signedOut.usage, { state: "unavailable", reason: "signed-out" });
    await f.connected();
    const response = await app.request(path);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(ChatGptAccountStatusSchema.parse(await response.json()).connection, { state: "completed", checkedAt, failureCode: null });
    await app.request(path);
    assert.equal(f.calls.filter(call => call.url.endsWith("/models")).length, 1);
    assert.equal(f.calls.filter(call => call.url.endsWith("/responses")).length, 0);
    assert.equal((await app.request(`${path}/check-connection`, { method: "POST" })).status, 404);
  } finally { await f.cleanup(); }
});
for (const kind of ["closure", "unknown"] as const) it(`serves explicit ${kind} failure with request signal and no private details`, async () => {
  const app: DashboardApp = new Hono(), clock = manualClock(new Date(checkedAt)), abort = new AbortController();
  let observed: AbortSignal | undefined;
  registerChatGptAccountRoutes(app, { clock, chatGptAccount: {
    readStatus: async signal => { observed = signal; if (kind === "closure") throw new ChatGptResourceClosureUnprovedError(new Error("private")); throw new Error("private"); },
    refreshAccount: async () => { throw new Error("unexpected refresh"); },
    signIn: async () => { throw new Error("unexpected sign-in"); },
  } });
  const request = new Request(path, { signal: abort.signal });
  const result = ChatGptAccountStatusSchema.parse(await (await app.request(request)).json());
  assert.equal(observed, request.signal);
  assert.equal(result.account.state, "unavailable");
  assert.deepEqual(result.connection, { state: "uncertain", checkedAt, failureCode: kind === "closure" ? "CHATGPT_RESOURCE_CLOSURE_UNPROVED" : "CHATGPT_CONNECTION_FAILED" });
  assert.deepEqual(result.usage, { state: "unavailable", reason: "unavailable" });
  assert.doesNotMatch(JSON.stringify(result), /private/u);
});
