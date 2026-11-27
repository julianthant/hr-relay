import { AssistantModelPreferenceViewSchema, ASSISTANT_DEFAULT_MODEL, ASSISTANT_DEFAULT_EFFORT } from '../../../../src/models/dashboard/assistant.js';
import assert from "node:assert/strict";
import { it } from "vitest";
import { createDashboardClient } from "../../../../src/dashboard/client/index.js";

const REQUEST = { conversationId: "11111111-1111-4111-8111-111111111111", expectedRevision: 1, messageId: "22222222-2222-4222-8222-222222222222", message: "pause it" };
const NO_REPLY = { kind: "result", result: { state: "no-reply", reason: "ASSISTANT_UNAVAILABLE", canRetry: false, turn: null } };

it("has no Confirm decision and sends the turn-accounting request with its approval pick", async () => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const client = createDashboardClient({ baseUrl: "http://127.0.0.1:3938", fetchImpl: async (url, init) => { calls.push({ url, init }); return Response.json(NO_REPLY); } });
  assert.equal("assistantDecide" in client, false);
  assert.deepEqual(await client.assistantRespond(REQUEST), NO_REPLY);
  assert.equal(calls.length, 1); assert.equal(calls[0]?.url, "http://127.0.0.1:3938/api/v1/assistant/respond");
  const body = calls[0]?.init?.body; if (typeof body !== "string") throw new Error("JSON request body required");
  assert.deepEqual(JSON.parse(body), { ...REQUEST, approvalMode: "ask" });
  assert.equal(new Headers(calls[0]?.init?.headers).get("origin"), "http://127.0.0.1:3938");
});

it("refuses an envelope that is not a served reply or no-reply, and a receipt for another message", async () => {
  const receipt = { conversationId: REQUEST.conversationId, messageId: "33333333-3333-4333-8333-333333333333", ordinal: 1, revision: 2, delivery: "answered" };
  for (const served of [{ kind: "result", result: { state: "answered", text: "Plain text" } }, { kind: "result", result: { state: "unknown", actionId: REQUEST.messageId } },
    { ...NO_REPLY, receipt }]) {
    let calls = 0;
    const client = createDashboardClient({ baseUrl: "http://127.0.0.1:3938", fetchImpl: async () => { calls++; return Response.json(served); } });
    await assert.rejects(() => client.assistantRespond(REQUEST));
    assert.equal(calls, 1);
  }
});

it('reads the strict selected assistant preference only from the authenticated view endpoint', async () => {
  const view = AssistantModelPreferenceViewSchema.parse({ profileId: crypto.randomUUID(), epoch: 2, revision: 3,
    preference: { slug: ASSISTANT_DEFAULT_MODEL, effort: ASSISTANT_DEFAULT_EFFORT } });
  const calls: { url: string; init?: RequestInit }[] = [], abort = new AbortController();
  const client = createDashboardClient({ baseUrl: 'http://relay.test', fetchImpl: async (url, init) => {
    calls.push({ url, ...(init === undefined ? {} : { init }) }); return Response.json(view);
  } });
  assert.ok(typeof client.assistantModelPreference === 'function');
  assert.deepEqual(await client.assistantModelPreference(abort.signal), view);
  assert.equal(calls.length, 1); assert.equal(calls[0]?.url, "http://relay.test/api/v1/assistant/model-preference");
  assert.equal(calls[0]?.init?.method ?? 'GET', 'GET'); assert.equal(calls[0]?.init?.signal, abort.signal);
  assert.equal(calls[0]?.init?.body, undefined);
});
it('refuses malformed or extra preference authority fields without a local default', async () => {
  const view = { profileId: crypto.randomUUID(), epoch: 2, revision: 3,
    preference: { slug: ASSISTANT_DEFAULT_MODEL, effort: ASSISTANT_DEFAULT_EFFORT } };
  for (const invalid of [{ ...view, epoch: -1 }, { ...view, profileId: 'foreign' }, { ...view, revision: undefined }, { ...view, available: true }]) {
    let reads = 0;
    const client = createDashboardClient({ baseUrl: 'http://relay.test', fetchImpl: async () => { reads++; return Response.json(invalid); } });
    const read = client.assistantModelPreference?.bind(client); assert.ok(read);
    await assert.rejects(() => read());
    assert.equal(reads, 1);
  }
});
