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
