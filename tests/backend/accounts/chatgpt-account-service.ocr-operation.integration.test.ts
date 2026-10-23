import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { it, vi } from "vitest";
import * as credentials from "../../../src/backend/storage/configuration/credential-store.js";
import { ChatGptAccountError, createChatGptAccountService } from "../../../src/backend/accounts/chatgpt-account-service.js";
import { createProfileRegistry } from "../../../src/backend/profiles/registry.js";
import { createBoundProfileFixture } from "../../support/helpers/admission-fixture.js";
import { chatGptFixture, completedOcrStream } from "../../support/helpers/chatgpt-account-fixtures.js";

async function advanceCredentialRevision(profile: ReturnType<typeof createBoundProfileFixture>): Promise<void> {
  const repository = credentials.createChatGptCredentialRepository({ admission: profile.admission, stateRoot: profile.stateRoot });
  await repository.withLock(async transaction => {
    const current = transaction.read(); assert.ok(current);
    transaction.replace({ ...current, revision: current.revision + 1 }, current.revision);
  });
}

const image = { model: "gpt-6.1-sol", instruction: "Read the synthetic page", input: { kind: "image" as const, mediaType: "image/png" as const, base64: "YQ==" } };

it("refreshes before page work, preserves its own usage transition and revokes retained OCR methods", async () => {
  const profile = createBoundProfileFixture(), f = chatGptFixture(profile.admission);
  try {
    await f.connected(); f.clock.advanceWall(3_600_000);
    let retained: (() => void) | undefined;
    const result = await f.service.withOcrOperation(async operation => {
      retained = operation.assertCurrent;
      assert.equal(f.calls.filter(call => call.url.endsWith("/oauth/token")).length, 2);
      await Promise.resolve(); operation.assertCurrent();
      const result = await operation.extractText(image);
      assert.throws(() => operation.extractText(image), { code: "CHATGPT_OCR_CANCELLED" });
      return result;
    });
    assert.equal(result.text, "Synthetic form"); assert.ok(retained);
    assert.throws(retained, { code: "CHATGPT_OCR_CANCELLED" });
    f.setSse('data: {"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}}\n\n');
    await assert.rejects(f.service.extractText(image), { code: "CHATGPT_USAGE_LIMIT" });
    f.setSse(completedOcrStream("Synthetic form"));
    assert.equal((await f.service.extractText(image)).text, "Synthetic form");
    const state = f.service.readAccount(); assert.equal(state.state, "connected");
    if (state.state !== "connected") throw new Error("synthetic account must remain connected");
    assert.equal(state.planUsage, "enabled");
  } finally { await f.cleanup(); profile.close(); }
});

for (const change of ["same-token-revision", "account-switch", "account-reconnect", "profile-epoch", "physical-release", "cancel"] as const)
  it(`refuses ${change} during scoped page work before transport or usage publication`, async () => {
    const profile = createBoundProfileFixture(), f = chatGptFixture(profile.admission);
    const peer = createChatGptAccountService({ admission: profile.admission, stateRoot: profile.stateRoot, clock: f.clock, fetch: f.transport });
    const controller = new AbortController();
    try {
      await f.connected();
      const pending = f.service.withOcrOperation(async operation => {
        if (change === "same-token-revision") await advanceCredentialRevision(profile);
        if (change === "account-switch") await peer.signOut();
        if (change === "account-reconnect") { await peer.signOut(); await f.connected(); }
        if (change === "profile-epoch") createProfileRegistry(profile.machine).advanceSession(null);
        if (change === "physical-release") profile.admission.release();
        if (change === "cancel") controller.abort();
        const before = readFileSync(join(profile.stateRoot, "credentials", "chatgpt-account.json"));
        await assert.rejects(operation.extractText(image));
        assert.equal(readFileSync(join(profile.stateRoot, "credentials", "chatgpt-account.json")).equals(before), true);
        operation.assertCurrent();
      }, controller.signal);
      await assert.rejects(pending);
      assert.equal(f.calls.filter(call => call.url.endsWith("/responses")).length, 0);
    } finally { await peer.close(); await f.cleanup(); profile.close(); }
  });

it("refuses a peer same-token revision during the real response stream without publishing usage", async () => {
  const profile = createBoundProfileFixture(), f = chatGptFixture(profile.admission);
  const peer = createChatGptAccountService({ admission: profile.admission, stateRoot: profile.stateRoot, clock: f.clock, fetch: f.transport });
  let expected: Buffer | undefined;
  try {
    await f.connected();
    f.setResponse(() => new Response(new ReadableStream<Uint8Array>({ async start(controller) {
      try {
        await advanceCredentialRevision(profile);
        expected = readFileSync(join(profile.stateRoot, "credentials", "chatgpt-account.json"));
        controller.enqueue(Buffer.from(completedOcrStream("Synthetic form"))); controller.close();
      } catch (error) { controller.error(error); }
    } }), { headers: { "content-type": "text/event-stream" } }));
    await assert.rejects(f.service.extractText(image), { code: "CHATGPT_OCR_CANCELLED" });
    assert.ok(expected); assert.equal(readFileSync(join(profile.stateRoot, "credentials", "chatgpt-account.json")).equals(expected), true);
    assert.equal(f.calls.filter(call => call.url.endsWith("/responses")).length, 1);
  } finally { await peer.close(); await f.cleanup(); profile.close(); }
});

it("revalidates the issued authority inside the real usage transaction after a peer revision at its lock boundary", async () => {
  const profile = createBoundProfileFixture(), f = chatGptFixture(profile.admission);
  const peer = createChatGptAccountService({ admission: profile.admission, stateRoot: profile.stateRoot, clock: f.clock, fetch: f.transport });
  const createRepository = credentials.createChatGptCredentialRepository;
  let armed = false, intercepted = 0, expected: Buffer | undefined;
  const factory = vi.spyOn(credentials, "createChatGptCredentialRepository").mockImplementation(options => {
    const actual = createRepository(options);
    return { ...actual, withLock: async operation => {
      if (armed) {
        armed = false; intercepted++;
        await advanceCredentialRevision(profile);
        expected = readFileSync(join(profile.stateRoot, "credentials", "chatgpt-account.json"));
      }
      return actual.withLock(operation);
    } };
  });
  const account = createChatGptAccountService({ admission: profile.admission, stateRoot: profile.stateRoot, clock: f.clock, fetch: f.transport });
  try {
    await f.connected(); await account.readAuthority();
    f.setSse('data: {"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}}\n\n');
    await assert.rejects(account.extractText(image), { code: "CHATGPT_USAGE_LIMIT" });
    f.setResponse(() => { armed = true; return new Response(completedOcrStream("Synthetic form"), { headers: { "content-type": "text/event-stream" } }); });
    await assert.rejects(account.extractText(image), { code: "CHATGPT_OCR_CANCELLED" });
    assert.equal(intercepted, 1); assert.ok(expected);
    assert.equal(readFileSync(join(profile.stateRoot, "credentials", "chatgpt-account.json")).equals(expected), true);
  } finally { factory.mockRestore(); await account.close(); await peer.close(); await f.cleanup(); profile.close(); }
});

it("account close drains an actually issued held page callback and revokes its retained methods", async () => {
  const profile = createBoundProfileFixture(), f = chatGptFixture(profile.admission);
  const page = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>();
  let settled = false, retained: (() => void) | undefined;
  try {
    await f.connected();
    const operation = f.service.withOcrOperation(async scope => { retained = scope.assertCurrent; entered.resolve(); await page.promise; scope.assertCurrent(); });
    const refused = assert.rejects(operation, { code: "CHATGPT_SERVICE_CLOSED" });
    await entered.promise;
    const closing = f.service.close().then(() => { settled = true; });
    await Promise.resolve(); assert.equal(settled, false);
    page.resolve(); await refused; await closing;
    assert.equal(settled, true); assert.ok(retained); assert.throws(retained, { code: "CHATGPT_SERVICE_CLOSED" });
    assert.equal(f.calls.filter(call => call.url.endsWith("/responses")).length, 0);
  } finally { page.resolve(); await f.cleanup(); profile.close(); }
});

it("account close waits a genuine usage transaction boundary and prevents a late usage write", async () => {
  const profile = createBoundProfileFixture(), f = chatGptFixture(profile.admission);
  const gate = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>();
  const createRepository = credentials.createChatGptCredentialRepository;
  let armed = false, settled = false;
  const factory = vi.spyOn(credentials, "createChatGptCredentialRepository").mockImplementation(options => {
    const actual = createRepository(options);
    return { ...actual, withLock: async operation => {
      if (armed) { armed = false; entered.resolve(); await gate.promise; }
      return actual.withLock(operation);
    } };
  });
  const account = createChatGptAccountService({ admission: profile.admission, stateRoot: profile.stateRoot, clock: f.clock, fetch: f.transport });
  try {
    await f.connected(); await account.readAuthority();
    f.setSse('data: {"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}}\n\n');
    await assert.rejects(account.extractText(image), { code: "CHATGPT_USAGE_LIMIT" });
    const before = readFileSync(join(profile.stateRoot, "credentials", "chatgpt-account.json"));
    f.setResponse(() => { armed = true; return new Response(completedOcrStream("Synthetic form"), { headers: { "content-type": "text/event-stream" } }); });
    const operation = account.extractText(image), refused = assert.rejects(operation, { code: "CHATGPT_SERVICE_CLOSED" });
    await entered.promise;
    const closing = account.close().then(() => { settled = true; });
    await Promise.resolve(); assert.equal(settled, false);
    gate.resolve(); await refused; await closing;
    assert.equal(settled, true); assert.equal(readFileSync(join(profile.stateRoot, "credentials", "chatgpt-account.json")).equals(before), true);
  } finally { gate.resolve(); factory.mockRestore(); await account.close(); await f.cleanup(); profile.close(); }
});

for (const owner of ["same-service", "two-services"] as const) it(`permits legitimate concurrent first OCR operations for ${owner} on one selected account`, async () => {
  const profile = createBoundProfileFixture(), f = chatGptFixture(profile.admission);
  const peer = createChatGptAccountService({ admission: profile.admission, stateRoot: profile.stateRoot, clock: f.clock, fetch: f.transport });
  const gate = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>();
  let pages = 0;
  try {
    await f.connected();
    const owners = owner === "same-service" ? [f.service, f.service] : [f.service, peer];
    const operations = owners.map(account => account.withOcrOperation(async scope => {
      pages++; entered.resolve(); await gate.promise; scope.assertCurrent(); return scope.extractText(image);
    }));
    await Promise.race([entered.promise, Promise.allSettled(operations)]);
    gate.resolve();
    const results = await Promise.allSettled(operations);
    const trace = results.map(result => result.status === "fulfilled" ? { state: "fulfilled" }
      : { state: "rejected", name: result.reason instanceof ChatGptAccountError ? "ChatGptAccountError" : result.reason instanceof credentials.ChatGptCredentialError ? "ChatGptCredentialError" : "unknown",
        code: result.reason instanceof ChatGptAccountError || result.reason instanceof credentials.ChatGptCredentialError ? result.reason.code : "unknown" });
    assert.deepEqual(trace, [{ state: "fulfilled" }, { state: "fulfilled" }]);
    assert.equal(pages, 2); assert.equal(f.calls.filter(call => call.url.endsWith("/responses")).length, 2);
  } finally { gate.resolve(); await peer.close(); await f.cleanup(); profile.close(); }
});

for (const consumer of ["ocr", "catalog"] as const) for (const cleanup of ["held", "refused"] as const)
  it(`owns the ${consumer} response before stale-authority validation with ${cleanup} cancellation`, async () => {
    const profile = createBoundProfileFixture(), f = chatGptFixture(profile.admission);
    const cancelled = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    let cancelCalls = 0, releaseCalls = 0, closed = false;
    let restoreReader: (() => void) | undefined;
    const response = () => {
      createProfileRegistry(profile.machine).advanceSession(null);
      return new Response(new ReadableStream<Uint8Array>({
        pull: () => new Promise<void>(() => undefined),
        async cancel() {
          cancelCalls++; cancelled.resolve();
          if (cleanup === "refused") throw new Error("synthetic response cancellation refused");
          await release.promise;
        },
      }), { headers: { "content-type": consumer === "ocr" ? "text/event-stream" : "application/json" } });
    };
    try {
      await f.connected(); await f.service.readAuthority();
      const before = readFileSync(join(profile.stateRoot, "credentials", "chatgpt-account.json"));
      const releaseLock: unknown = Reflect.get(ReadableStreamDefaultReader.prototype, "releaseLock");
      assert.ok(typeof releaseLock === "function");
      const readerSpy = vi.spyOn(ReadableStreamDefaultReader.prototype, "releaseLock").mockImplementation(function (this: ReadableStreamDefaultReader<Uint8Array>) {
        releaseCalls++; Reflect.apply(releaseLock, this, []);
      });
      restoreReader = () => readerSpy.mockRestore();
      if (consumer === "ocr") f.setResponse(response);
      else f.setModelsHook(async () => response());
      const operation = consumer === "ocr" ? f.service.extractText(image) : f.service.listAssistantModels();
      const rejected = assert.rejects(operation, (error: unknown) => cleanup === "held" || error instanceof ChatGptAccountError && error.code === "CHATGPT_RESOURCE_CLOSURE_UNPROVED");
      await cancelled.promise;
      const closing = f.service.close();
      if (cleanup === "held") {
        const observed = closing.then(() => { closed = true; });
        await Promise.resolve(); assert.equal(closed, false);
        release.resolve(); await rejected; await observed;
        assert.equal(closed, true);
      } else {
        await rejected; await assert.rejects(closing, { code: "CHATGPT_RESOURCE_CLOSURE_UNPROVED" });
      }
      assert.equal(cancelCalls, 1); assert.equal(releaseCalls, 1);
      assert.equal(readFileSync(join(profile.stateRoot, "credentials", "chatgpt-account.json")).equals(before), true);
    } finally {
      release.resolve(); restoreReader?.();
      if (cleanup === "held") await f.cleanup();
      profile.close();
    }
  });
