import assert from "node:assert/strict";
import { it } from "vitest";
import { createChatGptAccountService } from "../../../src/backend/accounts/chatgpt-account-service.js";
import { chatGptFixture, completedOcrStream } from "../../support/helpers/chatgpt-account-fixtures.js";

for (const state of ["near-expiry", "expired", "restart"] as const) it(`renews ${state} account reads through the stored rotating refresh token`, async () => {
  const f = await chatGptFixture();
  let restarted: ReturnType<typeof createChatGptAccountService> | undefined;
  try {
    await f.connected(); f.clock.advanceWall(state === "near-expiry" ? 3_540_000 : 3_600_000);
    if (state === "restart") restarted = createChatGptAccountService({ admission: f.admission, stateRoot: f.root, clock: f.clock, fetch: f.transport });
    const service = restarted ?? f.service;
    const account = await service.refreshAccount();
    assert.equal(account.state, "connected");
    if (account.state !== "connected") throw new Error("renewed account required");
    assert.equal(account.planUsage, "enabled"); assert.equal(Date.parse(account.expiresAt), f.clock.nowMs() + 3_600_000);
    assert.equal(f.repository.read()?.session?.refreshToken, "synthetic-refresh-2");
    const refreshes = f.calls.filter(call => call.url.endsWith("/oauth/token") && call.init.body instanceof URLSearchParams && call.init.body.get("grant_type") === "refresh_token");
    assert.equal(refreshes.length, 1); assert.ok(refreshes[0].init.body instanceof URLSearchParams);
    assert.equal(refreshes[0].init.body.get("refresh_token"), "synthetic-refresh-1");
    assert.equal(f.calls.filter(call => call.url.endsWith("/responses") || call.url.endsWith("/models")).length, 0);
    await service.refreshAccount(); assert.equal(f.repository.read()?.session?.refreshToken, "synthetic-refresh-2");
  } finally { await restarted?.close(); await f.cleanup(); }
});

it("coalesces concurrent account reads into one locked rotation", async () => {
  const f = await chatGptFixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  try {
    await f.connected(); f.clock.advanceWall(3_600_000);
    f.setTokenHook(async () => { entered.resolve(); await release.promise; });
    const first = f.service.refreshAccount(); await entered.promise;
    const second = f.service.refreshAccount(); assert.equal(first, second);
    assert.deepEqual(f.service.readAccount(), { state: "expired" });
    release.resolve();
    const [a, b] = await Promise.all([first, second]); assert.deepEqual(a, b); assert.equal(a.state, "connected");
    assert.equal(f.calls.filter(call => call.url.endsWith("/oauth/token")).length, 2);
  } finally { release.resolve(); await f.cleanup(); }
});

it("keeps quota authority across renewal until a completed inference proves usage available", async () => {
  const f = await chatGptFixture();
  const image = { model: "gpt-6.1-sol", instruction: "Synthetic", input: { kind: "image" as const, mediaType: "image/png" as const, base64: "YQ==" } };
  try {
    await f.connected(); f.setSse('data: {"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}}\n\n');
    await assert.rejects(f.service.extractText(image), { code: "CHATGPT_USAGE_LIMIT" });
    f.clock.advanceWall(3_600_000);
    const account = await f.service.refreshAccount(); assert.equal(account.state, "connected");
    if (account.state !== "connected") throw new Error("renewed account required");
    assert.equal(account.planUsage, "limit-reached"); assert.equal(f.repository.read()?.session?.usage, "limit-reached");
    f.setSse(completedOcrStream("Synthetic")); await f.service.extractText(image);
    assert.equal(f.repository.read()?.session?.usage, "available");
  } finally { await f.cleanup(); }
});

it("preserves credentials on temporary renewal failure and marks real refresh denial expired", async () => {
  const f = await chatGptFixture();
  try {
    await f.connected(); f.clock.advanceWall(3_600_000); const before = f.repository.read();
    f.setTokenStatus(503);
    await assert.rejects(f.service.refreshAccount(), { code: "CHATGPT_AUTH_UNAVAILABLE" });
    assert.deepEqual(f.repository.read(), before);
    f.setTokenStatus(400, "invalid_grant");
    assert.deepEqual(await f.service.refreshAccount(), { state: "expired" });
    assert.equal(f.repository.read()?.session, null); assert.equal(f.repository.read()?.clientId, before?.clientId);
  } finally { await f.cleanup(); }
});

it("honors earliest refresh time without asking the operator to reconnect a renewable session", async () => {
  const f = await chatGptFixture();
  try {
    f.setToken({ earliest_refresh_at: Math.floor(f.clock.nowMs() / 1000) + 7200 });
    await f.connected(); f.clock.advanceWall(3_600_000); const before = f.repository.read();
    await assert.rejects(f.service.refreshAccount(), { code: "CHATGPT_AUTH_UNAVAILABLE" });
    assert.deepEqual(f.repository.read(), before); assert.equal(f.calls.filter(call => call.url.endsWith("/oauth/token")).length, 1);
  } finally { await f.cleanup(); }
});

it("does not enable plan use while renewing an identity-only session", async () => {
  const f = await chatGptFixture();
  try {
    await f.connected(false); f.clock.advanceWall(3_600_000);
    const account = await f.service.refreshAccount(); assert.equal(account.state, "connected");
    if (account.state !== "connected") throw new Error("renewed account required");
    assert.equal(account.planUsage, "disabled");
  } finally { await f.cleanup(); }
});

it("does not resurrect credentials when sign-out supersedes a pending account renewal", async () => {
  const f = await chatGptFixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  try {
    await f.connected(); f.clock.advanceWall(3_600_000);
    f.setTokenHook(async () => { entered.resolve(); await release.promise; });
    const reading = assert.rejects(f.service.refreshAccount(), { code: "CHATGPT_OCR_CANCELLED" });
    await entered.promise;
    const signingOut = f.service.signOut(); release.resolve();
    await reading; await signingOut;
    assert.equal(f.repository.read()?.session, null); assert.deepEqual(f.service.readAccount(), { state: "signed-out", account: { email: "synthetic@example.com" } });
  } finally { release.resolve(); await f.cleanup(); }
});
