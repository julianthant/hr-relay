import { AssistantModelPreferenceViewSchema, ASSISTANT_DEFAULT_MODEL, ASSISTANT_DEFAULT_EFFORT } from '../../../../src/models/dashboard/assistant.js';
import assert from "node:assert/strict";
import { it } from "vitest";
import { createDashboardClient } from "../../../../src/dashboard/client/index.js";

it("uses the existing authenticated transport for exact opaque action decisions without command or model authority", async () => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const client = createDashboardClient({ baseUrl: "http://127.0.0.1:3938", fetchImpl: async (url, init) => {
    calls.push({ url, init });
    return Response.json({ state: "applied", actionId: "00000000-0000-4000-8000-000000000002" });
  } });
  const decide = client.assistantDecide?.bind(client); assert.ok(decide);
  const identity = { chatId: "00000000-0000-4000-8000-000000000001", actionId: "00000000-0000-4000-8000-000000000002", revision: 1, decision: "confirm" as const };
  assert.equal((await decide(identity)).state, "applied");
  assert.equal(calls.length, 1); assert.equal(calls[0].url, "http://127.0.0.1:3938/api/v1/assistant/action");
  const body = calls[0].init?.body; assert.equal(typeof body, "string"); if (typeof body !== "string") throw new Error("JSON request body required");
  assert.deepEqual(JSON.parse(body), identity);
  assert.equal(new Headers(calls[0].init?.headers).get("origin"), "http://127.0.0.1:3938");
  await assert.rejects(() => decide({ ...identity, revision: 0 }));
  assert.equal(calls.length, 1);
});
it("retains a lost confirmation response as an error and never retries the action", async () => {
  let calls = 0;
  const client = createDashboardClient({ baseUrl: "http://127.0.0.1:3938", fetchImpl: async () => { calls++; throw new Error("synthetic lost response"); } });
  const decide = client.assistantDecide?.bind(client); assert.ok(decide);
  await assert.rejects(() => decide({ chatId: "00000000-0000-4000-8000-000000000001", actionId: "00000000-0000-4000-8000-000000000002", revision: 1, decision: "confirm" }));
  assert.equal(calls, 1);
});

it("refuses a successful-looking decision for a different action without retry", async () => {
  let calls = 0;
  const client = createDashboardClient({ baseUrl: "http://127.0.0.1:3938", fetchImpl: async () => { calls++; return Response.json({ state: "applied", actionId: "00000000-0000-4000-8000-000000000003" }); } });
  const decide = client.assistantDecide?.bind(client); assert.ok(decide);
  await assert.rejects(() => decide({ chatId: "00000000-0000-4000-8000-000000000001", actionId: "00000000-0000-4000-8000-000000000002", revision: 1, decision: "confirm" }), /assistant-action-response-mismatch/u);
  assert.equal(calls, 1);
});

it("preserves the exact issued automatic unknown identity and refuses a mismatched readback identity", async () => {
  const action = { chatId: "00000000-0000-4000-8000-000000000001", actionId: "00000000-0000-4000-8000-000000000002", revision: 1,
    expiresAt: "2099-01-01T00:00:00Z", label: "Mark 25 current notifications read", targetLabel: "25 current notifications", subject: "none", effect: "local-write" };
  let mismatch = false, calls = 0;
  const client = createDashboardClient({ baseUrl: "http://127.0.0.1:3938", fetchImpl: async () => {
    calls++; return Response.json({ state: "unknown", actionId: mismatch ? "00000000-0000-4000-8000-000000000003" : action.actionId, action });
  } });
  const result = await client.assistantRespond({ message: "mark notifications read" });
  assert.equal(result.state, "unknown"); if (result.state !== "unknown") throw new Error("unknown identity required");
  assert.deepEqual(result.action, action); mismatch = true;
  await assert.rejects(() => client.assistantRespond({ message: "mark notifications read" }));
  assert.equal(calls, 2);
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
