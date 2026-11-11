import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { afterAll, it } from "vitest";
import { ChatGptAccountError } from "../../../src/backend/accounts/chatgpt-account-service.js";
import { createProfileRegistry } from "../../../src/backend/profiles/registry.js";
import { createBoundProfileFixture, createProfileFixtureSet } from "../../support/helpers/admission-fixture.js";
import { chatGptFixture } from "../../support/helpers/chatgpt-account-fixtures.js";

const profiles = createProfileFixtureSet();
afterAll(() => profiles.close());

it("checks the remote authenticated catalog only on explicit invocation without inference or early renewal", async () => {
  const f = await chatGptFixture(undefined, profiles.create);
  try {
    await f.connected();
    await f.service.refreshAccount();
    assert.equal(f.calls.filter(call => call.url.endsWith("/models")).length, 0);
    for (let check = 1; check <= 2; check++) {
      assert.deepEqual(await f.service.checkConnection(), { checkedAt: f.clock.now().toISOString() });
      assert.equal(f.calls.filter(call => call.url.endsWith("/models")).length, check);
    }
    const catalog = f.calls.find(call => call.url.endsWith("/models"));
    assert.equal(new Headers(catalog?.init.headers).get("authorization"), "Bearer synthetic-access-1");
    assert.equal(f.calls.filter(call => call.url.endsWith("/responses")).length, 0);
    assert.equal(f.calls.filter(call => call.url.endsWith("/oauth/token")).length, 1);
    assert.equal(f.service.captureAssistantModelPolicy(), undefined);
  } finally { await f.cleanup(); }
});

it("refuses signed-out and disabled accounts before a catalog request and renews only eligible expiry", async () => {
  const f = await chatGptFixture(undefined, profiles.create);
  try {
    await assert.rejects(f.service.checkConnection(), { code: "CHATGPT_ACCOUNT_EXPIRED" });
    await f.connected(false);
    await assert.rejects(f.service.checkConnection(), { code: "CHATGPT_PLAN_DISABLED" });
    assert.equal(f.calls.filter(call => call.url.endsWith("/models")).length, 0);
    await f.connected();
    const tokens = f.calls.filter(call => call.url.endsWith("/oauth/token")).length;
    f.clock.advanceWall(3_600_000);
    await f.service.checkConnection();
    assert.equal(f.calls.filter(call => call.url.endsWith("/oauth/token")).length, tokens + 1);
    assert.equal(f.calls.filter(call => call.url.endsWith("/models")).length, 1);
    assert.equal(f.calls.filter(call => call.url.endsWith("/responses")).length, 0);
  } finally { await f.cleanup(); }
});

for (const problem of ["malformed", "oversized", "non-ok", "expired", "disabled"] as const)
  it(`refuses ${problem} remote responses with account-purpose diagnostics`, async () => {
    const f = await chatGptFixture(undefined, profiles.create);
    const diagnostics: unknown[] = [];
    f.service.setDebugEvents({ emit: event => { diagnostics.push(event); } });
    try {
      await f.connected();
      f.setModelsHook(async () => problem === "malformed" ? Response.json({ data: [] })
        : problem === "oversized" ? new Response(" ".repeat(2 * 1024 * 1024 + 1))
          : problem === "non-ok" ? new Response("invalid JSON", { status: 502 })
            : Response.json({ detail: "withheld" }, { status: problem === "expired" ? 401 : 403 }));
      await assert.rejects(f.service.checkConnection(), { code: problem === "expired" ? "CHATGPT_ACCOUNT_EXPIRED"
        : problem === "disabled" ? "CHATGPT_PLAN_DISABLED" : "CHATGPT_CONNECTION_FAILED" });
      assert.ok(diagnostics.some(event => typeof event === "object" && event !== null && "chatGptInference" in event
        && typeof event.chatGptInference === "object" && event.chatGptInference !== null
        && "operation" in event.chatGptInference && event.chatGptInference.operation === "account"));
    } finally { await f.cleanup(); }
  });

for (const change of ["abort", "sign-out", "profile"] as const)
  it(`refuses a catalog settled after ${change}`, async () => {
    const profile = await profiles.create(), f = await chatGptFixture(profile.admission);
    const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), abort = new AbortController();
    try {
      await f.connected();
      f.setModelsHook(async () => { entered.resolve(); await release.promise; return Response.json({ models: [] }); });
      const checked = f.service.checkConnection(abort.signal);
      const refused = change === "profile" ? assert.rejects(checked) : assert.rejects(checked, { code: "CHATGPT_CONNECTION_CANCELLED" });
      await entered.promise;
      if (change === "abort") abort.abort();
      if (change === "sign-out") await f.service.signOut();
      if (change === "profile") createProfileRegistry(profile.machine).advanceSession(null);
      release.resolve(); await refused;
      assert.equal(f.calls.filter(call => call.url.endsWith("/responses")).length, 0);
    } finally { release.resolve(); await f.cleanup(); await profile.close(); }
  });

it("preserves response closure uncertainty and prevents subsequent account operations", async () => {
  const profile = await createBoundProfileFixture(), f = await chatGptFixture(profile.admission);
  const entered = Promise.withResolvers<void>(), abort = new AbortController();
  try {
    await f.connected();
    f.setModelsHook(async () => new Response(new ReadableStream<Uint8Array>({
      pull() { entered.resolve(); }, cancel() { throw new ChatGptAccountError("CHATGPT_OCR_CANCELLED"); },
    })));
    const refused = assert.rejects(f.service.checkConnection(abort.signal), { code: "CHATGPT_RESOURCE_CLOSURE_UNPROVED" });
    await entered.promise; await setImmediate(); abort.abort(); await refused;
    await assert.rejects(f.service.checkConnection(), { code: "CHATGPT_RESOURCE_CLOSURE_UNPROVED" });
    await assert.rejects(f.cleanup(), { code: "CHATGPT_RESOURCE_CLOSURE_UNPROVED" });
  } finally { await profile.close(); }
});

it("propagates diagnostics failure after a failed remote check", async () => {
  const f = await chatGptFixture(undefined, profiles.create);
  try {
    await f.connected();
    f.service.setDebugEvents({ emit() { throw new Error("private diagnostics failure"); } });
    f.setModels({ data: [] });
    await assert.rejects(f.service.checkConnection(), { code: "CHATGPT_DIAGNOSTICS_UNAVAILABLE" });
  } finally { await f.cleanup(); }
});


it("automatically checks on read and caches success through exactly five minutes", async () => {
  const f = await chatGptFixture(undefined, profiles.create);
  try {
    await f.connected();
    const first = await f.service.readStatus();
    assert.equal(first.connection.state, "completed");
    assert.deepEqual(first.usage, { state: "available", resetAt: null });
    assert.equal(f.calls.filter(call => call.url.endsWith("/models")).length, 1);
    f.clock.advanceWall(300_000);
    assert.deepEqual(await f.service.readStatus(), first);
    assert.equal(f.calls.filter(call => call.url.endsWith("/models")).length, 1);
    f.clock.advanceWall(1);
    await f.service.readStatus();
    assert.equal(f.calls.filter(call => call.url.endsWith("/models")).length, 2);
    f.clock.advanceWall(-1);
    await f.service.readStatus();
    assert.equal(f.calls.filter(call => call.url.endsWith("/models")).length, 3);
    assert.equal(f.calls.filter(call => call.url.endsWith("/responses")).length, 0);
  } finally { await f.cleanup(); }
});

it("caches known failures but refresh failure never falls back to cached success", async () => {
  const f = await chatGptFixture(undefined, profiles.create);
  try {
    await f.connected();
    await f.service.readStatus();
    f.setModels({ data: [] }); f.clock.advanceWall(300_001);
    const failed = await f.service.readStatus();
    assert.deepEqual(failed.connection, { state: "refused", checkedAt: f.clock.now().toISOString(), failureCode: "CHATGPT_CONNECTION_FAILED" });
    assert.deepEqual(await f.service.readStatus(), failed);
    assert.equal(f.calls.filter(call => call.url.endsWith("/models")).length, 2);
    await f.service.signOut();
    const signedOut = await f.service.readStatus();
    assert.deepEqual(signedOut.account, { state: "signed-out", account: { email: "synthetic@example.com" } });
    assert.deepEqual(signedOut.usage, { state: "unavailable", reason: "signed-out" });
    await f.connected();
    f.setModels({ models: [] });
    assert.equal((await f.service.readStatus()).connection.state, "completed");
    assert.equal(f.calls.filter(call => call.url.endsWith("/models")).length, 3);
  } finally { await f.cleanup(); }
});

it("shares an in-flight status check while one cancelled reader leaves other readers alive", async () => {
  const f = await chatGptFixture(undefined, profiles.create), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const abort = new AbortController();
  try {
    await f.connected();
    f.setModelsHook(async () => { entered.resolve(); await release.promise; return Response.json({ models: [] }); });
    const first = f.service.readStatus(abort.signal), cancelled = assert.rejects(first, { code: "CHATGPT_CONNECTION_CANCELLED" });
    const second = f.service.readStatus();
    await entered.promise; abort.abort(); await cancelled;
    release.resolve();
    assert.equal((await second).connection.state, "completed");
    assert.equal(f.calls.filter(call => call.url.endsWith("/models")).length, 1);
    await f.service.readStatus();
    assert.equal(f.calls.filter(call => call.url.endsWith("/models")).length, 1);
  } finally { release.resolve(); await f.cleanup(); }
});

it("does not cache abandoned checks and never settles an old account after sign-out", async () => {
  const f = await chatGptFixture(undefined, profiles.create), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  try {
    await f.connected();
    f.setModelsHook(async () => { entered.resolve(); await release.promise; return Response.json({ models: [] }); });
    const read = f.service.readStatus(), rejected = assert.rejects(read, { code: "CHATGPT_CONNECTION_CANCELLED" });
    await entered.promise; await f.service.signOut(); release.resolve(); await rejected;
    assert.deepEqual((await f.service.readStatus()).account, { state: "signed-out", account: { email: "synthetic@example.com" } });
  } finally { release.resolve(); await f.cleanup(); }
});

it("retains a renewed status under its post-refresh authority and rechecks live admission on cache hits", async () => {
  const profile = await profiles.create(), f = await chatGptFixture(profile.admission);
  try {
    await f.connected(); f.clock.advanceWall(3_600_000);
    assert.equal((await f.service.readStatus()).connection.state, "completed");
    await f.service.readStatus();
    assert.equal(f.calls.filter(call => call.url.endsWith("/models")).length, 1);
    createProfileRegistry(profile.machine).advanceSession(null);
    await assert.rejects(f.service.readStatus());
  } finally { await f.cleanup(); await profile.close(); }
});

it("aborts the shared request after its last reader leaves and checks again on the next read", async () => {
  const f = await chatGptFixture(undefined, profiles.create), entered = Promise.withResolvers<AbortSignal>(), release = Promise.withResolvers<void>();
  const abort = new AbortController();
  try {
    await f.connected();
    f.setModelsHook(async init => {
      assert.ok(init?.signal); entered.resolve(init.signal);
      await release.promise; return Response.json({ models: [] });
    });
    const cancelled = assert.rejects(f.service.readStatus(abort.signal), { code: "CHATGPT_CONNECTION_CANCELLED" });
    const sharedSignal = await entered.promise;
    abort.abort(); await cancelled;
    assert.equal(sharedSignal.aborted, true);
    release.resolve();
    f.setModelsHook(async () => Response.json({ models: [] }));
    assert.equal((await f.service.readStatus()).connection.state, "completed");
    assert.equal(f.calls.filter(call => call.url.endsWith("/models")).length, 2);
  } finally { release.resolve(); await f.cleanup(); }
});

it("reports persisted limit-reached usage locally without guessing reset time or doing inference", async () => {
  const f = await chatGptFixture(undefined, profiles.create);
  try {
    await f.connected(); await f.service.readStatus();
    f.setSse('data: {"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}}\n\n');
    await assert.rejects(f.service.extractText({ model: "gpt-6.1-sol", instruction: "Read synthetic form", input: { kind: "image", mediaType: "image/png", base64: "aGVsbG8=" } }), { code: "CHATGPT_USAGE_LIMIT" });
    const inferenceCalls = f.calls.filter(call => call.url.endsWith("/responses")).length;
    const status = await f.service.readStatus();
    assert.deepEqual(status.usage, { state: "limit-reached", resetAt: null });
    assert.equal(status.connection.state, "completed");
    assert.equal(f.calls.filter(call => call.url.endsWith("/models")).length, 2);
    assert.equal(f.calls.filter(call => call.url.endsWith("/responses")).length, inferenceCalls);
  } finally { await f.cleanup(); }
});

it("does not serve cached success after a separate check leaves response closure unproved", async () => {
  const profile = await createBoundProfileFixture(), f = await chatGptFixture(profile.admission);
  const entered = Promise.withResolvers<void>(), abort = new AbortController();
  try {
    await f.connected(); await f.service.readStatus();
    f.setModelsHook(async () => new Response(new ReadableStream<Uint8Array>({
      pull() { entered.resolve(); }, cancel() { throw new ChatGptAccountError("CHATGPT_OCR_CANCELLED"); },
    })));
    const refused = assert.rejects(f.service.checkConnection(abort.signal), { code: "CHATGPT_RESOURCE_CLOSURE_UNPROVED" });
    await entered.promise; await setImmediate(); abort.abort(); await refused;
    await assert.rejects(f.service.readStatus(), { code: "CHATGPT_RESOURCE_CLOSURE_UNPROVED" });
    await assert.rejects(f.cleanup(), { code: "CHATGPT_RESOURCE_CLOSURE_UNPROVED" });
  } finally { await profile.close(); }
});

it("caches a catalog failure under the authority produced by its own token renewal", async () => {
  const f = await chatGptFixture(undefined, profiles.create);
  try {
    await f.connected(); f.clock.advanceWall(3_600_000); f.setModels({ data: [] });
    const failed = await f.service.readStatus();
    assert.equal(failed.connection.failureCode, "CHATGPT_CONNECTION_FAILED");
    assert.deepEqual(await f.service.readStatus(), failed);
    assert.equal(f.calls.filter(call => call.url.endsWith("/models")).length, 1);
    assert.equal(f.calls.filter(call => call.url.endsWith("/oauth/token")).length, 2);
  } finally { await f.cleanup(); }
});

it("serves pending and disabled local authority explicitly without checking remote models", async () => {
  const f = await chatGptFixture(undefined, profiles.create);
  try {
    const attempt = await f.service.signIn({ usePlan: true });
    const pending = await f.service.readStatus();
    assert.deepEqual(pending.usage, { state: "unavailable", reason: "pending" });
    assert.equal(pending.connection.failureCode, "CHATGPT_AUTH_BUSY");
    await attempt.cancel(); await assert.rejects(attempt.completion, { code: "CHATGPT_AUTH_CANCELLED" });
    await f.connected(false);
    const disabled = await f.service.readStatus();
    assert.deepEqual(disabled.usage, { state: "unavailable", reason: "disabled" });
    assert.equal(disabled.connection.failureCode, "CHATGPT_PLAN_DISABLED");
    assert.equal(f.calls.filter(call => call.url.endsWith("/models")).length, 0);
  } finally { await f.cleanup(); }
});


it("does not cache a prior catalog failure under a same-generation credential revision", async () => {
  const f = await chatGptFixture(undefined, profiles.create);
  let revised: Promise<void> | undefined;
  try {
    await f.connected();
    const before = await f.service.readAuthority();
    f.setModels({ data: [] });
    f.service.setDebugEvents({ emit(event) {
      if (event.chatGptInference?.operation !== "account") return;
      queueMicrotask(() => {
        revised = f.repository.withLock(async transaction => {
          const current = transaction.read(); assert.ok(current);
          transaction.replace({ ...current, revision: current.revision + 1 }, current.revision);
        });
      });
    } });
    await assert.rejects(f.service.readStatus(), { code: "CHATGPT_CONNECTION_CANCELLED" });
    assert.ok(revised); await revised;
    const after = await f.service.readAuthority();
    assert.equal(after.attemptGeneration, before.attemptGeneration);
    assert.notEqual(after.revision, before.revision);
    f.service.setDebugEvents({ emit() {} });
    f.setModels({ models: [] });
    assert.equal((await f.service.readStatus()).connection.state, "completed");
    assert.equal(f.calls.filter(call => call.url.endsWith("/models")).length, 2);
  } finally { await revised; await f.cleanup(); }
});


for (const status of [401, 403])
  it(`caches its own ${status} catalog refusal without adopting another credential revision`, async () => {
    const f = await chatGptFixture(undefined, profiles.create);
    try {
      await f.connected();
      const before = await f.service.readAuthority();
      f.setModelsHook(async () => Response.json({ detail: "withheld" }, { status }));
      const refused = await f.service.readStatus();
      assert.equal(refused.connection.failureCode, status === 401 ? "CHATGPT_ACCOUNT_EXPIRED" : "CHATGPT_PLAN_DISABLED");
      assert.deepEqual(refused.usage, { state: "unavailable", reason: status === 401 ? "expired" : "unavailable" });
      const after = await f.service.readAuthority();
      assert.equal(after.revision, before.revision);
      assert.equal(after.attemptGeneration, before.attemptGeneration);
      assert.deepEqual(await f.service.readStatus(), refused);
      assert.equal(f.calls.filter(call => call.url.endsWith("/models")).length, 1);
    } finally { await f.cleanup(); }
  });
