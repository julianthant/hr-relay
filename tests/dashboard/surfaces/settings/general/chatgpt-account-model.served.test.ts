// @vitest-environment jsdom
import assert from "node:assert/strict";
import { it, vi } from "vitest";
import type { ChatGptAccountQueries } from "../../../../../src/dashboard/client/queries/chatgpt-account-queries.js";
import { createServedChatGptAccountPort, type ChatGptAuthorizationWindow } from "../../../../../src/dashboard/surfaces/settings/general/chatgpt-account-model.js";
import { ChatGptAccountStateSchema, ChatGptSignInStartSchema, type ChatGptAccountView, type ChatGptSignInCompletion } from "../../../../../src/models/dashboard/chatgpt-account.js";
import { ERROR_CATALOG } from "../../../../../src/models/failures/error-catalog.js";
const attemptId = "00000000-0000-4000-8000-000000000001";
const account = ChatGptAccountStateSchema.parse({ state: "connected", name: "Synthetic", email: "synthetic@example.com", expiresAt: "2026-10-12T13:00:00.000Z", planUsage: "enabled" });
const started = ChatGptSignInStartSchema.parse({ state: "started", attemptId, authorizationUrl: "https://auth.openai.com/api/accounts/authorize?state=synthetic", expiresAt: "2026-10-12T12:05:00.000Z" });
function setup(overrides: Partial<ChatGptAccountQueries> = {}, open?: () => ChatGptAuthorizationWindow | undefined) {
  const calls: string[] = [];
  const queries: ChatGptAccountQueries = {
    chatGptAccount: async () => { calls.push("read"); return { state: "signed-out" }; },
    startChatGptSignIn: async () => { calls.push("start"); return started; },
    completeChatGptSignIn: async () => { calls.push("complete"); return { state: "completed", attemptId, account }; },
    cancelChatGptSignIn: async () => { calls.push("cancel"); return { state: "cancelled", attemptId }; },
    signOutChatGpt: async () => { calls.push("out"); return { state: "signed-out", remoteRevocation: "confirmed" }; }, ...overrides,
  };
  const popup = { navigate: (url: string) => { calls.push(`navigate:${url}`); }, close: () => { calls.push("close"); } };
  const port = createServedChatGptAccountPort(queries, { nowMs: () => Date.parse("2026-10-12T12:00:00.000Z"), open: open ?? (() => { calls.push("open"); return popup; }) });
  return { port, calls };
}
it("opens synchronously, retains expiry and plan state, and never writes browser storage", async () => {
  const storageBefore = { local: localStorage.length, session: sessionStorage.length };
  const f = setup(); try {
    assert.deepEqual(f.port.getSnapshot(), { state: "loading" });
    await f.port.refresh(); assert.equal(f.port.getResource().state, "empty");
    const signing = f.port.signIn({ usePlan: true });
    assert.deepEqual(f.calls.slice(0, 3), ["read", "open", "start"]);
    await signing; assert.deepEqual(f.port.getSnapshot(), account);
    assert.equal(f.port.getResource().state, "loaded");
    assert.equal(f.calls.filter(call => call === "start").length, 1);
    await f.port.signOut(); assert.equal(f.port.getResource().state, "empty");
    assert.deepEqual({ local: localStorage.length, session: sessionStorage.length }, storageBefore);
  } finally { f.port.dispose(); }
});
it("preserves failed, refused and uncertain outcomes with one uncertain state read and no redispatch", async () => {
  const f = setup({ completeChatGptSignIn: async () => { throw new Error("synthetic lost response"); } });
  try {
    await f.port.refresh(); await f.port.signIn({ usePlan: true });
    assert.equal(f.port.getResource().state, "uncertain");
    assert.equal(f.calls.filter(call => call === "read").length, 2);
    assert.equal(f.calls.filter(call => call === "start").length, 1);
  } finally { f.port.dispose(); }
  const refused = setup({ startChatGptSignIn: async () => ({ state: "refused", code: "CHATGPT_AUTH_BUSY", message: ERROR_CATALOG.CHATGPT_AUTH_BUSY.text }) });
  try { await refused.port.refresh(); await refused.port.signIn({ usePlan: true }); assert.equal(refused.port.getResource().state, "refused"); assert.equal(refused.calls.filter(call => call === "read").length, 1); } finally { refused.port.dispose(); }
  const failed = setup({ chatGptAccount: async () => { throw new Error("secret diagnostic"); } });
  try { await failed.port.refresh(); assert.equal(failed.port.getResource().state, "failed"); assert.doesNotMatch(JSON.stringify(failed.port.getSnapshot()), /secret/u); } finally { failed.port.dispose(); }
});
it("retains local signed-out authority and warns on unconfirmed remote revocation", async () => {
  const f = setup({ signOutChatGpt: async () => ({ state: "signed-out", remoteRevocation: "unconfirmed" }) });
  try {
    await f.port.refresh(); await f.port.signOut();
    assert.deepEqual(f.port.getResource(), { state: "empty", account: { state: "signed-out" }, warning: "CHATGPT_REVOCATION_UNCONFIRMED" });
    assert.deepEqual(f.port.getSnapshot(), { state: "unavailable", message: ERROR_CATALOG.CHATGPT_REVOCATION_UNCONFIRMED.text });
  } finally { f.port.dispose(); }
});
it("refuses a blocked popup before dispatch and cancels once when navigation fails", async () => {
  const blocked = setup({}, () => undefined);
  try { await blocked.port.refresh(); await blocked.port.signIn({ usePlan: true }); assert.deepEqual(blocked.calls, ["read"]); assert.equal(blocked.port.getResource().state, "refused"); } finally { blocked.port.dispose(); }
  let closed = 0;
  const failed = setup({}, () => ({ navigate: () => { throw new Error("popup closed"); }, close: () => { closed++; } }));
  try { await failed.port.refresh(); await failed.port.signIn({ usePlan: true }); assert.deepEqual(failed.calls, ["read", "start", "cancel"]); assert.equal(closed, 1); assert.equal(failed.port.getResource().state, "refused"); } finally { failed.port.dispose(); }
});
it("suppresses stale reads and completion settlements and resumes the original signing-in attempt", async () => {
  const old = Promise.withResolvers<ChatGptAccountView>(); let reads = 0;
  const stale = setup({ chatGptAccount: () => ++reads === 1 ? old.promise : Promise.resolve(account) });
  try { const first = stale.port.refresh(); const second = stale.port.refresh(); assert.equal(first, second); old.resolve(account); await first; assert.deepEqual(stale.port.getSnapshot(), account); assert.equal(reads, 1); } finally { stale.port.dispose(); }
  const completion = Promise.withResolvers<ChatGptSignInCompletion>();
  const resumed = setup({ chatGptAccount: async () => ({ state: "signing-in", attemptId, expiresAt: started.expiresAt, account: { state: "signed-out" } }), completeChatGptSignIn: id => { assert.equal(id, attemptId); return completion.promise; } });
  const refreshing = resumed.port.refresh(); for (let tick = 0; tick < 4; tick++) await Promise.resolve(); assert.deepEqual(resumed.port.getResource(), { state: "loading", attemptId });
  resumed.port.dispose(); completion.resolve({ state: "completed", attemptId, account }); await refreshing;
  assert.deepEqual(resumed.port.getSnapshot(), { state: "loading" }); assert.equal(resumed.calls.includes("start"), false);
});
it("reads current state once at connected expiry without starting sign-in", async () => {
  vi.useFakeTimers(); let reads = 0, now = Date.parse("2026-10-12T12:59:59.000Z");
  const queries: ChatGptAccountQueries = { chatGptAccount: async () => { reads++; return reads === 1 ? account : { state: "expired" }; }, startChatGptSignIn: async () => started, completeChatGptSignIn: async () => ({ state: "completed", attemptId, account }), cancelChatGptSignIn: async () => ({ state: "cancelled", attemptId }), signOutChatGpt: async () => ({ state: "signed-out", remoteRevocation: "confirmed" }) };
  const port = createServedChatGptAccountPort(queries, { nowMs: () => now });
  try { await port.refresh(); now += 1000; await vi.advanceTimersByTimeAsync(1000); assert.equal(reads, 2); assert.deepEqual(port.getSnapshot(), { state: "expired" }); } finally { port.dispose(); vi.useRealTimers(); }
});

it("closes its owned popup immediately on disposal while completion is pending", async () => {
  const completion = Promise.withResolvers<ChatGptSignInCompletion>();
  const f = setup({ completeChatGptSignIn: () => completion.promise });
  await f.port.refresh();
  const signing = f.port.signIn({ usePlan: true });
  await Promise.resolve();
  assert.equal(f.calls.includes("close"), false);
  f.port.dispose();
  assert.equal(f.calls.filter(call => call === "close").length, 1);
  completion.resolve({ state: "completed", attemptId, account }); await signing;
  assert.equal(f.calls.filter(call => call === "close").length, 1);
  assert.deepEqual(f.port.getSnapshot(), { state: "signed-out" });
});

it("bounds account snapshots and retains the exact verified account on refresh failure", async () => {
  vi.useFakeTimers();
  let reads = 0;
  const f = setup({ chatGptAccount: () => ++reads === 1 ? Promise.resolve(account) : new Promise(() => {}) });
  try {
    await f.port.refresh();
    const first = f.port.refresh(), second = f.port.refresh(); assert.equal(first, second);
    assert.deepEqual(f.port.getSnapshot(), account);
    await vi.advanceTimersByTimeAsync(10_000); await first;
    const resource = f.port.getResource(); assert.equal(resource.state, "failed");
    assert.ok("account" in resource); assert.deepEqual(resource.account, account); assert.equal(reads, 2);
  } finally { f.port.dispose(); vi.useRealTimers(); }
});
it("preserves the five-minute OAuth wait then settles a hung completion as uncertain without redispatch", async () => {
  vi.useFakeTimers();
  const f = setup({ completeChatGptSignIn: () => new Promise(() => {}) });
  try {
    await f.port.refresh();
    let settled = false;
    const signing = f.port.signIn({ usePlan: true }).then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(300_000); assert.equal(settled, false); assert.equal(f.calls.includes("close"), false);
    await vi.advanceTimersByTimeAsync(10_000); await signing;
    assert.equal(f.port.getResource().state, "uncertain"); assert.equal(f.calls.filter(call => call === "start").length, 1);
    assert.equal(f.calls.filter(call => call === "read").length, 2); assert.equal(f.calls.filter(call => call === "close").length, 1);
  } finally { f.port.dispose(); vi.useRealTimers(); }
});
