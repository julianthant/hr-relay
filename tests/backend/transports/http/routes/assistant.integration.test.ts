import { AssistantModelPreferenceViewSchema } from '../../../../../src/models/dashboard/assistant.js';
import { AssistantActionDecisionSchema, AssistantActionResultSchema } from "../../../../../src/models/dashboard/assistant.js";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { it } from "vitest";
import type { DashboardApp } from "../../../../../src/backend/transports/http/routes/api-types.js";
import { registerAssistantRoutes } from "../../../../../src/backend/transports/http/routes/assistant.js";

it("guards loopback/origin/media before body or inference and bounds request bytes", async () => {
  const app: DashboardApp = new Hono(); let calls = 0;
  registerAssistantRoutes(app, { async respond() { calls++; return { state: "answered", text: "Synthetic", citations: [] }; } });
  const headers = { host: "127.0.0.1:3938", origin: "http://127.0.0.1:3938", "content-type": "application/json" };
  for (const patch of [{ origin: "https://foreign.example" }, { host: "foreign.example" }, { "content-type": "text/plain" }]) {
    const response = await app.request("http://127.0.0.1:3938/api/v1/assistant/respond", { method: "POST", headers: { ...headers, ...patch }, body: "{}" });
    assert.ok(response.status === 403 || response.status === 415);
  }
  assert.equal(calls, 0);
  for (const body of ["malformed", JSON.stringify({ message: "x".repeat(20_001) })]) {
    const response = await app.request("http://127.0.0.1:3938/api/v1/assistant/respond", { method: "POST", headers, body });
    assert.equal(response.status, 400);
  }
  assert.equal(calls, 0);
  const response = await app.request("http://127.0.0.1:3938/api/v1/assistant/respond", { method: "POST", headers, body: JSON.stringify({ message: "Explain" }) });
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal(calls, 1);
});
it("never exposes a thrown service error through framework logs or response", async () => {
  const app: DashboardApp = new Hono();
  registerAssistantRoutes(app, { async respond() { throw new Error("CANARY_PRIVATE_SERVICE_ERROR"); } });
  const response = await app.request("http://127.0.0.1:3938/api/v1/assistant/respond", { method: "POST", headers: {
    host: "127.0.0.1:3938", origin: "http://127.0.0.1:3938", "content-type": "application/json",
  }, body: JSON.stringify({ message: "Explain" }) });
  assert.equal(response.status, 400); assert.equal((await response.text()).includes("CANARY_PRIVATE_SERVICE_ERROR"), false);
});

it("keeps operator confirmation behind the same bounded loopback/media door and accepts only issued identity fields", async () => {
  const app: DashboardApp = new Hono(); let calls = 0;
  registerAssistantRoutes(app, { async respond() { return { state: "refused", code: "ASSISTANT_UNAVAILABLE", message: "Unavailable" }; },
    decide(input) { calls++; return { state: "cancelled", actionId: AssistantActionDecisionSchema.parse(input).actionId }; } });
  const url = "http://127.0.0.1:3938/api/v1/assistant/action";
  const headers = { host: "127.0.0.1:3938", origin: "http://127.0.0.1:3938", "content-type": "application/json" };
  const identity = { chatId: "00000000-0000-4000-8000-000000000001", actionId: "00000000-0000-4000-8000-000000000002", revision: 1, decision: "cancel" };
  for (const patch of [{ origin: "https://foreign.example" }, { host: "foreign.example" }, { "content-type": "text/plain" }]) {
    const response = await app.request(url, { method: "POST", headers: { ...headers, ...patch }, body: JSON.stringify(identity) });
    assert.ok(response.status === 403 || response.status === 415);
  }
  for (const body of ["malformed", JSON.stringify({ ...identity, command: { source: "assistant" } }), "x".repeat(20_001)]) {
    assert.equal((await app.request(url, { method: "POST", headers, body })).status, 400);
  }
  assert.equal(calls, 0);
  const response = await app.request(url, { method: "POST", headers, body: JSON.stringify(identity) });
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(calls, 1); assert.equal(AssistantActionResultSchema.parse(await response.json()).state, "cancelled");
});

it("returns an issued automatic unknown action unchanged without converting it to a generic refusal", async () => {
  const action = { chatId: "00000000-0000-4000-8000-000000000001", actionId: "00000000-0000-4000-8000-000000000002", revision: 1,
    expiresAt: "2099-01-01T00:00:00Z", label: "Mark 25 current notifications read", targetLabel: "25 current notifications", subject: "none" as const, effect: "local-write" as const };
  const result = { state: "unknown" as const, actionId: action.actionId, action };
  const app: DashboardApp = new Hono(); let calls = 0;
  registerAssistantRoutes(app, { async respond() { calls++; return result; } });
  const response = await app.request("http://127.0.0.1:3938/api/v1/assistant/respond", { method: "POST", headers: {
    host: "127.0.0.1:3938", origin: "http://127.0.0.1:3938", "content-type": "application/json",
  }, body: JSON.stringify({ message: "mark notifications read" }) });
  assert.equal(response.status, 200); assert.equal(calls, 1); assert.deepEqual(await response.json(), result);
});


it('serves only the strict selected preference with no-store and a coded unavailable boundary', async () => {
  const view = AssistantModelPreferenceViewSchema.parse({ profileId: '22222222-2222-4222-8222-222222222222', epoch: 3,
    revision: 2, preference: { slug: 'test-public-model', effort: 'medium' } });
  const app: DashboardApp = new Hono(); let reads = 0;
  registerAssistantRoutes(app, { async respond() { throw new Error('unexpected inference'); }, modelPreference() { reads++; return view; } });
  const response = await app.request("http://127.0.0.1:4310/api/v1/assistant/model-preference");
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(AssistantModelPreferenceViewSchema.parse(await response.json()), view); assert.equal(reads, 1);
  const bare = await app.request("http://127.0.0.1:4310/assistant/model-preference");
  assert.equal(bare.status, 404); assert.equal(reads, 1);
  const unavailable: DashboardApp = new Hono(); registerAssistantRoutes(unavailable, undefined);
  const absent = await unavailable.request("http://127.0.0.1:4310/api/v1/assistant/model-preference");
  assert.equal(absent.status, 503); assert.equal(absent.headers.get('cache-control'), 'no-store');
  assert.equal((await absent.text()).includes('ASSISTANT_UNAVAILABLE'), true);
});
it('does not serialize a corrupt preference failure or private details', async () => {
  const app: DashboardApp = new Hono();
  registerAssistantRoutes(app, { async respond() { throw new Error('unexpected inference'); },
    modelPreference() { throw new Error('private preference failure'); } });
  const response = await app.request("http://127.0.0.1:4310/api/v1/assistant/model-preference");
  assert.equal(response.status, 503); assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.text(); assert.equal(body.includes('ASSISTANT_UNAVAILABLE'), true);
  assert.equal(body.includes('private preference failure'), false);
});
