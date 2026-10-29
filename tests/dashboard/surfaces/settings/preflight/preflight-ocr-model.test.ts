// @vitest-environment jsdom
import assert from "node:assert/strict";
import { it, vi } from "vitest";
import type { ChatGptAccountQueries } from "../../../../../src/dashboard/client/queries/chatgpt-account-queries.js";
import { createServedChatGptAccountPort } from "../../../../../src/dashboard/surfaces/settings/general/chatgpt-account-model.js";
import { createServedPreflightOcrPort } from "../../../../../src/dashboard/surfaces/settings/preflight/preflight-ocr-model.js";
import { ChatGptAccountStateSchema, ChatGptSignInStartSchema } from "../../../../../src/models/dashboard/chatgpt-account.js";
import { ERROR_CATALOG } from "../../../../../src/models/failures/error-catalog.js";
const account = ChatGptAccountStateSchema.parse({ state: "connected", name: "Synthetic", email: "synthetic@example.com", expiresAt: "2099-01-01T13:00:00.000Z", planUsage: "enabled" });
const attemptId = "00000000-0000-4000-8000-000000000001";
const started = ChatGptSignInStartSchema.parse({ state: "started", attemptId, authorizationUrl: "https://auth.openai.com/api/accounts/authorize?state=synthetic", expiresAt: "2099-01-01T12:05:00.000Z" });
function setup(overrides: Partial<ChatGptAccountQueries> = {}) {
  const calls: string[] = [];
  const client: ChatGptAccountQueries = {
    chatGptAccount: async () => ({ state: "signed-out" }),
    startChatGptSignIn: async () => started,
    completeChatGptSignIn: async () => ({ state: "completed", attemptId, account }),
    cancelChatGptSignIn: async () => ({ state: "cancelled", attemptId }),
    signOutChatGpt: async () => ({ state: "signed-out", remoteRevocation: "confirmed" }),
    testChatGptOcr: async () => { calls.push("ocr"); return { state: "completed", model: "Synthetic OCR" }; },
    ...overrides,
  };
  const identity = createServedChatGptAccountPort(client, { open: () => ({ navigate() {}, close() {} }) });
  const ocr = createServedPreflightOcrPort(client, identity);
  return { account: identity, port: ocr, calls, dispose: () => { ocr.dispose(); identity.dispose(); } };
}
it("never auto-tests during sign-in and dispatches one OCR call despite duplicate clicks", async () => {
  const result = Promise.withResolvers<Awaited<ReturnType<ChatGptAccountQueries["testChatGptOcr"]>>>();
  let calls = 0;
  const f = setup({ testChatGptOcr: () => { calls++; return result.promise; } });
  try {
    await f.account.refresh(); await f.account.signIn({ usePlan: true }); assert.equal(calls, 0);
    const testing = f.port.testOcr(); await f.port.testOcr();
    assert.equal(calls, 1); assert.deepEqual(f.port.getSnapshot(), { state: "loading" });
    result.resolve({ state: "completed", model: "Synthetic OCR" }); await testing;
    assert.deepEqual(f.port.getSnapshot(), { state: "completed", model: "Synthetic OCR" });
    assert.equal(f.account.getSnapshot().state, "connected");
  } finally { f.dispose(); }
});

for (const state of ["refused", "uncertain"] as const) it(`retains exact OCR ${state} without redispatch or fabricated success`, async () => {
  let calls = 0;
  const f = setup({ chatGptAccount: async () => account, testChatGptOcr: async () => { calls++; return { state, code: "CHATGPT_OCR_INVALID", message: ERROR_CATALOG.CHATGPT_OCR_INVALID.text }; } });
  try {
    await f.account.refresh(); await f.port.testOcr();
    assert.equal(f.port.getSnapshot().state, state); assert.equal(calls, 1);
    if (state === "uncertain") { await f.port.testOcr(); assert.equal(calls, 1); }
  } finally { f.dispose(); }
});

it("keeps a lost OCR response uncertain with fixed catalog text and no retry", async () => {
  let calls = 0;
  const f = setup({ chatGptAccount: async () => account, testChatGptOcr: async () => { calls++; throw new Error("synthetic-private-transport-detail"); } });
  try {
    await f.account.refresh(); await f.port.testOcr(); await f.port.testOcr();
    assert.equal(calls, 1); assert.deepEqual(f.port.getSnapshot(), { state: "uncertain", code: "CHATGPT_OCR_FAILED", message: ERROR_CATALOG.CHATGPT_OCR_FAILED.text });
    assert.equal(JSON.stringify(f.port.getSnapshot()).includes("synthetic-private"), false);
  } finally { f.dispose(); }
});

for (const change of ["refresh", "dispose"] as const) it(`aborts and ignores an OCR result after ${change}`, async () => {
  const result = Promise.withResolvers<Awaited<ReturnType<ChatGptAccountQueries["testChatGptOcr"]>>>();
  let signal: AbortSignal | undefined;
  let calls = 0;
  const f = setup({ chatGptAccount: async () => account, testChatGptOcr: value => { signal = value; calls++; return result.promise; } });
  try {
    await f.account.refresh(); const testing = f.port.testOcr();
    assert.equal(calls, 1);
    if (change === "refresh") await f.account.refresh(); else f.dispose();
    assert.equal(signal?.aborted, true);
    const before = f.port.getSnapshot();
    result.resolve({ state: "completed", model: "Stale model" }); await testing;
    assert.equal(f.port.getSnapshot(), before);
  } finally { f.dispose(); }
});

it("bounds a hung OCR call as uncertain and aborts its signal without redispatch", async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  let calls = 0;
  const f = setup({ chatGptAccount: async () => account, testChatGptOcr: value => { signal = value; calls++; return new Promise<never>(() => {}); } });
  try {
    await f.account.refresh(); const testing = f.port.testOcr();
    await vi.advanceTimersByTimeAsync(120_000); await testing;
    assert.equal(signal?.aborted, true); assert.equal(calls, 1);
    assert.equal(f.port.getSnapshot().state, "uncertain"); await f.port.testOcr(); assert.equal(calls, 1);
  } finally { f.dispose(); vi.useRealTimers(); }
});

it("does not test absent, expired, disabled, limited or unavailable account authority", async () => {
  const views = [
    { state: "signed-out" }, { state: "expired" },
    { ...account, planUsage: "disabled" }, { ...account, planUsage: "limit-reached" },
    { state: "unavailable", code: "CHATGPT_AUTH_UNAVAILABLE", message: ERROR_CATALOG.CHATGPT_AUTH_UNAVAILABLE.text },
  ];
  for (const view of views) {
    const f = setup({ chatGptAccount: async () => ChatGptAccountStateSchema.parse(view) });
    try { await f.account.refresh(); await f.port.testOcr(); assert.equal(f.calls.includes("ocr"), false); }
    finally { f.dispose(); }
  }
});


it("retains uncertain lockout after account refresh instead of permitting another inference", async () => {
  let calls = 0;
  const f = setup({ chatGptAccount: async () => account, testChatGptOcr: async () => { calls++; throw new Error("lost response"); } });
  try {
    await f.account.refresh(); await f.port.testOcr();
    const uncertain = f.port.getSnapshot();
    await f.account.refresh(); await f.port.testOcr();
    assert.equal(f.port.getSnapshot(), uncertain); assert.equal(calls, 1);
  } finally { f.dispose(); }
});

it("does not dispatch OCR while an account refresh is pending", async () => {
  const read = Promise.withResolvers<typeof account>();
  let reads = 0, calls = 0;
  const f = setup({ chatGptAccount: () => ++reads === 1 ? Promise.resolve(account) : read.promise,
    testChatGptOcr: async () => { calls++; return { state: "completed", model: "Synthetic OCR" }; } });
  try {
    await f.account.refresh();
    const refreshing = f.account.refresh();
    assert.equal(f.port.getSnapshot().state, "disabled");
    await f.port.testOcr(); assert.equal(calls, 0);
    read.resolve(account); await refreshing;
    assert.equal(f.port.getSnapshot().state, "idle");
  } finally { read.resolve(account); f.dispose(); }
});

it("aborts pending OCR when an account sign-out starts", async () => {
  const result = Promise.withResolvers<Awaited<ReturnType<ChatGptAccountQueries["testChatGptOcr"]>>>();
  const signOut = Promise.withResolvers<Awaited<ReturnType<ChatGptAccountQueries["signOutChatGpt"]>>>();
  let signal: AbortSignal | undefined;
  const f = setup({ chatGptAccount: async () => account, testChatGptOcr: value => { signal = value; return result.promise; }, signOutChatGpt: () => signOut.promise });
  try {
    await f.account.refresh(); const testing = f.port.testOcr();
    const signingOut = f.account.signOut(); assert.equal(signal?.aborted, true);
    const before = f.port.getSnapshot();
    result.resolve({ state: "completed", model: "Stale OCR" }); await testing;
    assert.equal(f.port.getSnapshot(), before);
    signOut.resolve({ state: "signed-out", remoteRevocation: "confirmed" }); await signingOut;
    assert.equal(f.port.getSnapshot().state, "uncertain");
  } finally { result.resolve({ state: "completed", model: "Stale OCR" }); signOut.resolve({ state: "signed-out", remoteRevocation: "confirmed" }); f.dispose(); }
});

it("does not use retained connected identity when the current account read is unavailable", async () => {
  let reads = 0, calls = 0;
  const f = setup({ chatGptAccount: async () => { if (++reads === 1) return account; throw new Error("unavailable"); },
    testChatGptOcr: async () => { calls++; return { state: "completed", model: "Synthetic OCR" }; } });
  try {
    await f.account.refresh(); await f.account.refresh();
    assert.equal(f.account.getSnapshot().state, "unavailable");
    const retained = f.account.getSnapshot();
    assert.ok("account" in retained); assert.equal(retained.account?.state, "connected");
    await f.port.testOcr(); assert.equal(calls, 0); assert.equal(f.port.getSnapshot().state, "disabled");
  } finally { f.dispose(); }
});
