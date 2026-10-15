import assert from "node:assert/strict";
import { it } from "vitest";
import { createDashboardClient } from "../../../../src/dashboard/client/index.js";
const attemptId = "00000000-0000-4000-8000-000000000001";
it("uses the one typed client for strict account lifecycle requests without persistence", async () => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const client = createDashboardClient({ baseUrl: "http://127.0.0.1:3938", fetchImpl: async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/cancel")) return Response.json({ state: "cancelled", attemptId });
    if (url.endsWith("/sign-out")) return Response.json({ state: "signed-out", remoteRevocation: "unconfirmed" });
    if (url.endsWith(`/sign-in/${attemptId}`)) return Response.json({ state: "completed", attemptId, account: { state: "signed-out" } });
    if (url.endsWith("/sign-in")) return Response.json({ state: "started", attemptId, authorizationUrl: "https://auth.openai.com/api/accounts/authorize?state=synthetic", expiresAt: "2026-10-12T12:05:00.000Z" });
    return Response.json({ state: "signed-out" });
  } });
  assert.deepEqual(await client.chatGptAccount(), { state: "signed-out" });
  assert.equal((await client.startChatGptSignIn({ usePlan: true })).state, "started");
  assert.equal((await client.completeChatGptSignIn(attemptId)).state, "completed");
  assert.equal((await client.cancelChatGptSignIn(attemptId)).state, "cancelled");
  assert.equal((await client.signOutChatGpt()).state, "signed-out");
  assert.deepEqual(calls.map(call => call.init?.method ?? "GET"), ["GET", "POST", "GET", "POST", "POST"]);
  for (const call of calls.filter(call => call.init?.method === "POST")) assert.equal(new Headers(call.init?.headers).get("origin"), "http://127.0.0.1:3938");
});
it("rejects token-bearing, wrong-attempt and foreign authorization responses without retry", async () => {
  for (const body of [
    { state: "completed", attemptId: "00000000-0000-4000-8000-000000000002", account: { state: "signed-out" } },
    { state: "completed", attemptId, account: { state: "signed-out", accessToken: "synthetic" } },
  ]) {
    let calls = 0;
    const client = createDashboardClient({ baseUrl: "http://127.0.0.1", fetchImpl: async () => { calls++; return Response.json(body); } });
    await assert.rejects(client.completeChatGptSignIn(attemptId), { kind: "schema" }); assert.equal(calls, 1);
  }
  const client = createDashboardClient({ baseUrl: "http://127.0.0.1", fetchImpl: async () => Response.json({ state: "started", attemptId, authorizationUrl: "https://foreign.example/", expiresAt: "2026-10-12T12:05:00.000Z" }) });
  await assert.rejects(client.startChatGptSignIn({ usePlan: true }), { kind: "schema" });
});
