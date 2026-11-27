import { AssistantHistoryResultSchema, AssistantHistoryWireSchema, AssistantModelPreferenceViewSchema } from '../../../../../src/models/dashboard/assistant.js';
import assert from "node:assert/strict";
import { Hono } from "hono";
import { it } from "vitest";
import type { DashboardApp } from "../../../../../src/backend/transports/http/routes/api-types.js";
import { registerAssistantRoutes } from "../../../../../src/backend/transports/http/routes/assistant.js";

const NO_REPLY = { kind: "result", result: { state: "no-reply", reason: "ASSISTANT_UNAVAILABLE", canRetry: false, turn: null } } as const;

it("serves no assistant permission or Confirm action route", async () => {
  const app: DashboardApp = new Hono();
  registerAssistantRoutes(app, { async respond() { throw new Error("unexpected inference"); } });
  for (const path of ["permission", "action"]) for (const method of ["GET", "POST"]) {
    assert.equal((await app.request(`http://127.0.0.1:4310/api/v1/assistant/${path}`, { method })).status, 404);
  }
});

it("serves the account model catalog uncached and refuses without the service", async () => {
  const catalog = { models: [{ slug: "gpt-6.1-sol", displayName: "GPT-6.1 Sol" }] };
  const app: DashboardApp = new Hono();
  registerAssistantRoutes(app, { async respond() { throw new Error("unexpected inference"); }, models() { return catalog; } });
  const response = await app.request("http://127.0.0.1:4310/api/v1/assistant/models");
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), catalog);
  const bare: DashboardApp = new Hono();
  registerAssistantRoutes(bare, { async respond() { throw new Error("unexpected inference"); } });
  assert.equal((await bare.request("http://127.0.0.1:4310/api/v1/assistant/models")).status, 503);
});

it("guards loopback/origin/media before body or inference and bounds request bytes", async () => {
  const app: DashboardApp = new Hono(); let calls = 0;
  registerAssistantRoutes(app, { async respond() { calls++; return NO_REPLY; } });
  const headers = { host: "127.0.0.1:3938", origin: "http://127.0.0.1:3938", "content-type": "application/json" };
  for (const patch of [{ origin: "https://foreign.example" }, { host: "foreign.example" }, { "content-type": "text/plain" }]) {
    const response = await app.request("http://127.0.0.1:3938/api/v1/assistant/respond", { method: "POST", headers: { ...headers, ...patch }, body: "{}" });
    assert.ok(response.status === 403 || response.status === 415);
  }
  assert.equal(calls, 0);
  for (const body of ["malformed", JSON.stringify({ conversationId: "11111111-1111-4111-8111-111111111111", expectedRevision: 1, messageId: "22222222-2222-4222-8222-222222222222", message: "x".repeat(20_001) })]) {
    const response = await app.request("http://127.0.0.1:3938/api/v1/assistant/respond", { method: "POST", headers, body });
    assert.equal(response.status, 400);
  }
  assert.equal(calls, 0);
  const response = await app.request("http://127.0.0.1:3938/api/v1/assistant/respond", { method: "POST", headers, body: JSON.stringify({ conversationId: "11111111-1111-4111-8111-111111111111", expectedRevision: 1, messageId: "22222222-2222-4222-8222-222222222222", message: "Explain" }) });
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal(calls, 1);
});
it("never exposes a thrown service error through framework logs or response", async () => {
  const app: DashboardApp = new Hono();
  registerAssistantRoutes(app, { async respond() { throw new Error("CANARY_PRIVATE_SERVICE_ERROR"); } });
  const response = await app.request("http://127.0.0.1:3938/api/v1/assistant/respond", { method: "POST", headers: {
    host: "127.0.0.1:3938", origin: "http://127.0.0.1:3938", "content-type": "application/json",
  }, body: JSON.stringify({ conversationId: "11111111-1111-4111-8111-111111111111", expectedRevision: 1, messageId: "22222222-2222-4222-8222-222222222222", message: "Explain" }) });
  assert.equal(response.status, 400); assert.equal((await response.text()).includes("CANARY_PRIVATE_SERVICE_ERROR"), false);
});

it("returns a served no-reply envelope unchanged and answers a malformed body with no reply", async () => {
  const app: DashboardApp = new Hono(); let calls = 0;
  registerAssistantRoutes(app, { async respond() { calls++; return NO_REPLY; } });
  const headers = { host: "127.0.0.1:3938", origin: "http://127.0.0.1:3938", "content-type": "application/json" };
  const response = await app.request("http://127.0.0.1:3938/api/v1/assistant/respond", { method: "POST", headers,
    body: JSON.stringify({ conversationId: "11111111-1111-4111-8111-111111111111", expectedRevision: 1, messageId: "22222222-2222-4222-8222-222222222222", message: "pause it" }) });
  assert.equal(response.status, 200); assert.equal(calls, 1); assert.deepEqual(await response.json(), NO_REPLY);
  const malformed = await app.request("http://127.0.0.1:3938/api/v1/assistant/respond", { method: "POST", headers, body: "malformed" });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { kind: "result", result: { state: "no-reply", reason: "ASSISTANT_INVALID", canRetry: false, turn: null } });
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

it("serves history reads with no-store, guards history writes before the body and passes refusals through as data", async () => {
  const chat = "33333333-3333-4333-8333-333333333333";
  const conversation = { id: chat, title: "Chat", revision: 2, draft: "", composer: "", importTotal: 0, importNotice: null, messages: [], sessions: [] };
  const app: DashboardApp = new Hono(); const writes: unknown[] = [];
  registerAssistantRoutes(app, { async respond() { throw new Error("unexpected inference"); },
    historyView: () => ({ chats: [{ id: chat, title: "Chat", revision: 2, createdAt: "2026-11-06T12:00:00.000Z", expiresAt: "2026-12-06T12:00:00.000Z" }], selectedId: chat, needsYou: 0 }),
    conversation: id => id === chat ? conversation : undefined,
    history(input) { writes.push(input); return { state: "refused", code: "ASSISTANT_CONVERSATION_STALE" }; } });
  const list = await app.request("http://127.0.0.1:3938/api/v1/assistant/history");
  assert.equal(list.status, 200); assert.equal(list.headers.get("cache-control"), "no-store"); assert.equal(AssistantHistoryWireSchema.parse(await list.json()).selectedId, chat);
  const read = await app.request(`http://127.0.0.1:3938/api/v1/assistant/conversations/${chat}`);
  assert.equal(read.status, 200); assert.deepEqual(await read.json(), conversation);
  assert.equal((await app.request("http://127.0.0.1:3938/api/v1/assistant/conversations/44444444-4444-4444-8444-444444444444")).status, 404);
  const headers = { host: "127.0.0.1:3938", origin: "http://127.0.0.1:3938", "content-type": "application/json" }, url = "http://127.0.0.1:3938/api/v1/assistant/history";
  const rename = JSON.stringify({ operation: "rename", conversationId: chat, expectedRevision: 1, title: "Renamed" });
  for (const patch of [{ origin: "https://foreign.example" }, { host: "foreign.example" }, { "content-type": "text/plain" }]) {
    assert.ok([403, 415].includes((await app.request(url, { method: "POST", headers: { ...headers, ...patch }, body: rename })).status));
  }
  for (const body of ["malformed", JSON.stringify({ operation: "rename", conversationId: chat, title: "No revision" }), JSON.stringify({ operation: "unknown" }),
    JSON.stringify({ operation: "draft", conversationId: chat, draft: "", composer: "", modelText: "forged" })]) {
    assert.equal((await app.request(url, { method: "POST", headers, body })).status, 400);
  }
  assert.equal(writes.length, 0);
  const refused = await app.request(url, { method: "POST", headers, body: rename });
  assert.equal(refused.status, 200); assert.deepEqual(AssistantHistoryResultSchema.parse(await refused.json()), { state: "refused", code: "ASSISTANT_CONVERSATION_STALE" });
  assert.equal(writes.length, 1);
  const unavailable: DashboardApp = new Hono(); registerAssistantRoutes(unavailable, { async respond() { throw new Error("unexpected inference"); } });
  assert.equal((await unavailable.request(url)).status, 503);
  assert.equal((await unavailable.request(url, { method: "POST", headers, body: rename })).status, 503);
});

it("stages raw attachment bytes behind the opaque door with a counted reader and passes refusals through", async () => {
  const app: DashboardApp = new Hono(); const seen: { name: string; contentType: string | undefined; bytes?: Uint8Array; refused?: string }[] = [];
  registerAssistantRoutes(app, { async respond() { throw new Error("unexpected inference"); },
    async stage(input, signal) {
      const entry: (typeof seen)[number] = { name: input.name, contentType: input.contentType }; seen.push(entry);
      try { entry.bytes = await input.read(8, signal); }
      catch (error) { entry.refused = error instanceof Error ? error.message : "?"; return { state: "refused", code: "ASSISTANT_ATTACHMENT_TOO_LARGE" }; }
      return { state: "staged", attachment: { id: "33333333-3333-4333-8333-333333333333", mediaType: "text/plain", name: input.name, byteLength: entry.bytes.byteLength,
        expiresAt: "2026-11-06T00:15:00.000Z" } };
    } });
  const path = "http://127.0.0.1:3938/api/v1/assistant/conversations/11111111-1111-4111-8111-111111111111/attachments";
  const headers = { host: "127.0.0.1:3938", origin: "http://127.0.0.1:3938", "content-type": "text/plain", "x-relay-file-name": encodeURIComponent("Notes ü.txt") };
  for (const patch of [{ origin: "https://foreign.example" }, { host: "foreign.example" }]) {
    assert.equal((await app.request(path, { method: "POST", headers: { ...headers, ...patch }, body: "12345678" })).status, 403);
  }
  assert.equal(seen.length, 0);
  const staged = await app.request(path, { method: "POST", headers, body: "12345678" });
  assert.equal(staged.status, 201); assert.equal(staged.headers.get("cache-control"), "no-store");
  assert.deepEqual(seen[0], { name: "Notes ü.txt", contentType: "text/plain", bytes: new TextEncoder().encode("12345678") });
  const over = await app.request(path, { method: "POST", headers, body: "123456789" });
  assert.equal(over.status, 422); assert.deepEqual(await over.json(), { state: "refused", code: "ASSISTANT_ATTACHMENT_TOO_LARGE" });
  assert.equal(seen[1]?.refused, "ASSISTANT_ATTACHMENT_TOO_LARGE");
});
