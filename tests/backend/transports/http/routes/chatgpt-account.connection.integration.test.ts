import assert from "node:assert/strict";
import { Hono } from "hono";
import { it } from "vitest";
import { ChatGptAccountError, ChatGptResourceClosureUnprovedError } from "../../../../../src/backend/accounts/chatgpt-account-service.js";
import { registerChatGptAccountRoutes } from "../../../../../src/backend/transports/http/routes/chatgpt-account.js";
import type { DashboardApp } from "../../../../../src/backend/transports/http/routes/api-types.js";
import { operatorMutationIngressGuard } from "../../../../../src/backend/transports/http/routes/operator-mutation-ingress.js";
import { ChatGptConnectionResultSchema } from "../../../../../src/models/dashboard/chatgpt-account.js";
import { WireErrorSchema } from "../../../../../src/models/dashboard/primitives.js";
import { ERROR_CATALOG } from "../../../../../src/models/failures/error-catalog.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { chatGptFixture } from "../../../../support/helpers/chatgpt-account-fixtures.js";

const path = "http://127.0.0.1/api/v1/settings/chatgpt-account/check-connection";
const checkId = "00000000-0000-4000-8000-000000000001";
const checkedAt = "2026-10-12T12:00:00.000Z";
const headers = { host: "127.0.0.1", origin: "http://127.0.0.1", "content-type": "application/json" };

it("serves one remotely checked result keyed to the explicit request and preserves signed-out refusal", async () => {
  const f = await chatGptFixture(), app: DashboardApp = new Hono();
  app.use("/api/v1/settings/chatgpt-account/check-connection", operatorMutationIngressGuard);
  registerChatGptAccountRoutes(app, { clock: f.clock, chatGptAccount: f.service });
  const request = () => app.request(path, { method: "POST", headers, body: JSON.stringify({ checkId }) });
  try {
    const refused = ChatGptConnectionResultSchema.parse(await (await request()).json());
    assert.deepEqual(refused, { state: "refused", checkId, checkedAt, code: "CHATGPT_ACCOUNT_EXPIRED", message: ERROR_CATALOG.CHATGPT_ACCOUNT_EXPIRED.text });
    await f.connected();
    assert.equal(f.calls.filter(call => call.url.endsWith("/models")).length, 0);
    const response = await request();
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(ChatGptConnectionResultSchema.parse(await response.json()), { state: "completed", checkId, checkedAt });
    assert.equal(f.calls.filter(call => call.url.endsWith("/models")).length, 1);
    assert.equal(f.calls.filter(call => call.url.endsWith("/responses")).length, 0);
  } finally { await f.cleanup(); }
});

it("admits Host, Origin and JSON before body parsing or service effects and rejects malformed identity", async () => {
  const app: DashboardApp = new Hono(), clock = manualClock(new Date(checkedAt));
  let effects = 0;
  app.use("/api/v1/settings/chatgpt-account/check-connection", operatorMutationIngressGuard);
  registerChatGptAccountRoutes(app, { clock, chatGptAccount: {
    checkConnection: async () => { effects++; return { checkedAt }; },
    refreshAccount: async () => { throw new Error("unexpected account read"); },
    signIn: async () => { throw new Error("unexpected sign-in"); },
    signOut: async () => { throw new Error("unexpected sign-out"); },
  } });
  for (const [patch, status] of [[{ host: "foreign.example" }, 403], [{ origin: "https://foreign.example" }, 403], [{ "content-type": "text/plain" }, 415]] as const) {
    const response = await app.request(path, { method: "POST", headers: { ...headers, ...patch }, body: "invalid JSON" });
    assert.equal(response.status, status);
    assert.equal(WireErrorSchema.parse(await response.json()).state, "error");
  }
  for (const body of ["invalid JSON", "{}", JSON.stringify({ checkId: "invalid" }), JSON.stringify({ checkId, checks: [] })]) {
    const response = await app.request(path, { method: "POST", headers, body });
    assert.equal(response.status, 400);
    assert.equal(WireErrorSchema.parse(await response.json()).code, "SCHEMA_INVALID");
  }
  assert.equal(effects, 0);
});

for (const failure of ["closure", "diagnostics", "unknown", "cancelled"] as const)
  it(`retains ${failure} failure and exact request signal without private details`, async () => {
    const app: DashboardApp = new Hono(), clock = manualClock(new Date(checkedAt)), abort = new AbortController();
    let observed: AbortSignal | undefined;
    app.use("/api/v1/settings/chatgpt-account/check-connection", operatorMutationIngressGuard);
    registerChatGptAccountRoutes(app, { clock, chatGptAccount: {
      checkConnection: async signal => {
        observed = signal;
        if (failure === "closure") throw new ChatGptResourceClosureUnprovedError(new Error("private cause"));
        if (failure === "diagnostics") throw new ChatGptAccountError("CHATGPT_DIAGNOSTICS_UNAVAILABLE");
        if (failure === "cancelled") throw new ChatGptAccountError("CHATGPT_CONNECTION_CANCELLED");
        throw new Error("private cause");
      },
      refreshAccount: async () => { throw new Error("unexpected account read"); },
      signIn: async () => { throw new Error("unexpected sign-in"); },
      signOut: async () => { throw new Error("unexpected sign-out"); },
    } });
    const request = new Request(path, { method: "POST", headers, body: JSON.stringify({ checkId }), signal: abort.signal });
    const result = ChatGptConnectionResultSchema.parse(await (await app.request(request)).json());
    assert.equal(observed, request.signal);
    const code = failure === "closure" ? "CHATGPT_RESOURCE_CLOSURE_UNPROVED" : failure === "diagnostics" ? "CHATGPT_DIAGNOSTICS_UNAVAILABLE"
      : failure === "cancelled" ? "CHATGPT_CONNECTION_CANCELLED" : "CHATGPT_CONNECTION_FAILED";
    assert.deepEqual(result, { state: failure === "closure" || failure === "unknown" ? "uncertain" : "refused", checkId, checkedAt, code, message: ERROR_CATALOG[code].text });
  });
