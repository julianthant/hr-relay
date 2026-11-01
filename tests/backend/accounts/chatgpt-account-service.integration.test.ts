import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, it, vi } from "vitest";
import { createBoundProfileFixture, createClonedProfileFixtures } from "../../support/helpers/admission-fixture.js";
import { createProfileRegistry } from "../../../src/backend/profiles/registry.js";
import { chatGptFixture, completedOcrStream } from "../../support/helpers/chatgpt-account-fixtures.js";
import { IsoInstantSchema } from "../../../src/rules/identity/ids.js";
import { createChatGptCredentialRepository } from "../../../src/backend/storage/configuration/credential-store.js";
import { createChatGptAccountService } from "../../../src/backend/accounts/chatgpt-account-service.js";

const image = { model: "gpt-6.1-sol", instruction: "Read this synthetic form", input: { kind: "image" as const, mediaType: "image/png" as const, base64: "YQ==" } };
const profiles = createClonedProfileFixtures();
afterAll(() => profiles.close());

it("absent account read is signed out without creating storage", async () => {
  const f = await chatGptFixture(undefined, profiles.create);
  try {
    const directory = join(f.root, "credentials"), names = readdirSync(directory).sort();
    const baseline = names.map(name => ({ name, bytes: readFileSync(join(directory, name)) }));
    assert.equal(existsSync(join(directory, "chatgpt-account.json")), false);
    assert.deepEqual(f.service.readAccount(), { state: "signed-out" });
    assert.deepEqual(readdirSync(directory).sort(), names);
    for (const file of baseline) assert.equal(readFileSync(join(directory, file.name)).equals(file.bytes), true);
    assert.equal(existsSync(join(directory, "chatgpt-account.json")), false);
    assert.equal(existsSync(join(directory, ".chatgpt-account.lock")), false);
    assert.equal(f.calls.length, 0);
  } finally { await f.cleanup(); }
});
it("binds PKCE, nonce and exact loopback URI and keeps tokens private", async () => {
  const f = await chatGptFixture(undefined, profiles.create); try {
    const attempt = await f.service.signIn({ usePlan: true }), url = new URL(attempt.authorizationUrl);
    assert.equal(url.searchParams.get("agent_name_hint"), "Relay"); assert.equal(url.searchParams.get("client_id"), "dynamic_agent_client");
    assert.equal(new URL(url.searchParams.get("redirect_uri") ?? "").hostname, "127.0.0.1");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal((await f.callback(attempt, { state: "wrong" })).status, 400); assert.equal(f.calls.length, 0);
    assert.equal((await f.callback(attempt)).status, 200);
    const state = await attempt.completion; assert.equal(state.state, "connected");
    const call = f.calls.find(call => call.url.endsWith("/oauth/token")); assert.ok(call);
    const body = call.init.body; assert.ok(body instanceof URLSearchParams);
    const form = new URLSearchParams(body); assert.equal(form.get("redirect_uri"), url.searchParams.get("redirect_uri"));
    assert.equal(createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url"), url.searchParams.get("code_challenge"));
    assert.equal(JSON.stringify(state).includes("synthetic-access"), false); assert.equal(attempt.authorizationUrl.includes("id_token"), false);
    assert.ok(f.calls.every(call => new URL(call.url).hostname === "auth.openai.com" && call.init.redirect === "error"));
  } finally { await f.cleanup(); }
});
it("granted permission rather than requested permission determines enabled plan usage", async () => {
  const f = await chatGptFixture(undefined, profiles.create); try { f.setScopes("openid profile email offline_access"); const state = await f.connected(); assert.equal(state.state, "connected"); if (state.state === "connected") assert.equal(state.planUsage, "disabled"); await assert.rejects(f.service.extractText(image), { code: "CHATGPT_PLAN_DISABLED" }); } finally { await f.cleanup(); }
});
for (const claims of [{ nonce: "wrong" }, { aud: "wrong" }, { iss: "https://foreign.example" }, { exp: 1 }, { iat: 9_999_999_999 }])
  it(`rejects invalid cryptographically signed claims ${JSON.stringify(claims)}`, async () => {
    const f = await chatGptFixture(undefined, profiles.create); try { f.setClaims(claims); const attempt = await f.service.signIn({ usePlan: true }); await f.callback(attempt); await assert.rejects(attempt.completion, { code: "CHATGPT_AUTH_INVALID" }); assert.deepEqual(f.service.readAccount(), { state: "signed-out" }); } finally { await f.cleanup(); }
  });
it("refuses first registration without issued client and OAuth denial without token exchange", async () => {
  const f = await chatGptFixture(undefined, profiles.create); try {
    const first = await f.service.signIn({ usePlan: true }); await f.callback(first, { client_id: null }); await assert.rejects(first.completion, { code: "CHATGPT_AUTH_INVALID" });
    const denied = await f.service.signIn({ usePlan: true }); await f.callback(denied, { error: "access_denied" }); await assert.rejects(denied.completion, { code: "CHATGPT_AUTH_CANCELLED" }); assert.equal(f.calls.length, 0);
  } finally { await f.cleanup(); }
});
it("signout revokes then clears tokens and retains issued client and host for return sign-in", async () => {
  const f = await chatGptFixture(undefined, profiles.create); try {
    await f.connected(); const original = JSON.parse(readFileSync(join(f.root, "credentials/chatgpt-account.json"), "utf8")) as { hostId: string };
    assert.deepEqual(await f.service.signOut(), { state: "signed-out", remoteRevocation: "confirmed" });
    const bytes = readFileSync(join(f.root, "credentials/chatgpt-account.json"), "utf8"); assert.equal(bytes.includes("synthetic-access"), false); assert.equal(bytes.includes("synthetic-refresh"), false); assert.equal(bytes.includes('"idToken"'), false);
    const revocation = f.calls.find(call => call.url.endsWith("/revoke")); assert.ok(revocation);
    const body = revocation.init.body; assert.ok(body instanceof URLSearchParams); assert.equal(body.get("token_type_hint"), "refresh_token");
    const attempt = await f.service.signIn({ usePlan: false }), url = new URL(attempt.authorizationUrl);
    assert.equal(url.searchParams.get("client_id"), "oaiapp_fixture"); assert.equal(url.searchParams.get("ext_agent_host_id"), original.hostId); assert.equal(url.searchParams.has("agent_name_hint"), false);
    await f.callback(attempt); await attempt.completion;
  } finally { await f.cleanup(); }
});
it("local signout is confirmed separately from unconfirmed revocation", async () => {
  const f = await chatGptFixture(undefined, profiles.create); try { await f.connected(); f.setRevocation(503); assert.deepEqual(await f.service.signOut(), { state: "signed-out", remoteRevocation: "unconfirmed" }); assert.deepEqual(f.service.readAccount(), { state: "signed-out" }); } finally { await f.cleanup(); }
});
it("returning sign-in rejects changed callback client and signed subject", async () => {
  const f = await chatGptFixture(undefined, profiles.create); try {
    await f.connected(); const wrong = await f.service.signIn({ usePlan: true }); await f.callback(wrong, { client_id: "oaiapp_other" }); await assert.rejects(wrong.completion, { code: "CHATGPT_AUTH_INVALID" });
    f.setClaims({ sub: "other-subject" }); const subject = await f.service.signIn({ usePlan: true }); await f.callback(subject); await assert.rejects(subject.completion, { code: "CHATGPT_AUTH_INVALID" }); assert.equal(f.service.readAccount().state, "connected");
  } finally { await f.cleanup(); }
});
it("refresh replaces rotating tokens before Responses and survives restart", async () => {
  const f = await chatGptFixture(undefined, profiles.create); try {
    await f.connected(); f.clock.advanceWall(3_600_000); assert.deepEqual(f.service.readAccount(), { state: "expired" });
    assert.deepEqual(await f.service.extractText(image), { text: "Synthetic form", model: image.model, responseId: "resp_synthetic" });
    const bytes = readFileSync(join(f.root, "credentials/chatgpt-account.json"), "utf8"); assert.equal(bytes.includes("synthetic-access-1"), false); assert.ok(bytes.includes("synthetic-refresh-2"));
    const request = f.calls.find(call => call.url.endsWith("/responses")); assert.ok(request); assert.equal(new Headers(request.init.headers).get("Authorization"), "Bearer synthetic-access-2");
    const restarted = createChatGptAccountService({ admission: f.admission, stateRoot: f.root, clock: f.clock, fetch: f.transport }); assert.equal(restarted.readAccount().state, "connected"); await restarted.close();
  } finally { await f.cleanup(); }
});
it("Responses sends image or PDF inline with required no-store stream settings", async () => {
  const f = await chatGptFixture(undefined, profiles.create); try {
    await f.connected(); await f.service.extractText(image); await f.service.extractText({ ...image, input: { kind: "pdf", filename: "synthetic.pdf", base64: "YQ==" } });
    const calls = f.calls.filter(call => call.url.endsWith("/responses")); assert.equal(calls.length, 2);
    for (const [index, call] of calls.entries()) {
      const body = call.init.body; assert.ok(typeof body === "string");
      const request = JSON.parse(body) as { store: boolean; stream: boolean; input: { content: { type: string }[] }[] };
      assert.equal(request.store, false); assert.equal(request.stream, true); assert.equal(request.input[0]?.content[0]?.type, "input_text");
      assert.ok(body.includes(index === 0 ? "data:image/png;base64,YQ==" : "data:application/pdf;base64,YQ=="));
    }
  } finally { await f.cleanup(); }
});
for (const code of ["subscription_sharing_usage_limit_exceeded", "subscription_sharing_usage_unavailable"])
  it(`rejects streamed partial text and persists ${code}`, async () => {
    const f = await chatGptFixture(undefined, profiles.create); try { await f.connected(); f.setSse(`data: {"type":"response.output_text.delta","delta":"Partial"}\n\ndata: {"type":"response.failed","response":{"error":{"code":"${code}"}}}\n\n`);
      await assert.rejects(f.service.extractText(image), { code: code.endsWith("exceeded") ? "CHATGPT_USAGE_LIMIT" : "CHATGPT_USAGE_UNAVAILABLE" });
      const state = f.service.readAccount(); assert.equal(state.state, code.endsWith("exceeded") ? "connected" : "unavailable"); if (state.state === "connected") assert.equal(state.planUsage, "limit-reached");
    } finally { await f.cleanup(); }
  });
it("refuses incomplete SSE and cancellation without returning partial text", async () => {
  const f = await chatGptFixture(undefined, profiles.create); try { await f.connected(); f.setSse('data: {"type":"response.output_text.delta","delta":"Partial"}\n\n'); await assert.rejects(f.service.extractText(image), { code: "CHATGPT_OCR_INCOMPLETE" }); await assert.rejects(f.service.extractText(image, AbortSignal.abort()), { code: "CHATGPT_OCR_CANCELLED" }); } finally { await f.cleanup(); }
});
it("foreign discovery endpoints are refused before transmitting tokens", async () => {
  const f = await chatGptFixture(undefined, profiles.create); try { f.setDiscovery({ jwks_uri: "https://foreign.example/jwks" }); const attempt = await f.service.signIn({ usePlan: true }); await f.callback(attempt); await assert.rejects(attempt.completion, { code: "CHATGPT_AUTH_INVALID" }); assert.ok(f.calls.every(call => new URL(call.url).hostname === "auth.openai.com")); } finally { await f.cleanup(); }
});
it("identity-only consent connects without a renewable plan session", async () => {
  const f = await chatGptFixture(undefined, profiles.create); try {
    f.setToken({ refresh_token: undefined }); f.setScopes("openid profile email");
    const state = await f.connected(false); assert.equal(state.state, "connected"); if (state.state === "connected") assert.equal(state.planUsage, "disabled");
    assert.deepEqual(await f.service.signOut(), { state: "signed-out", remoteRevocation: "not-needed" }); assert.equal(f.calls.some(call => call.url.endsWith("/revoke")), false);
  } finally { await f.cleanup(); }
});
it("cancel closes the owned callback and expired attempts never exchange codes", async () => {
  const f = await chatGptFixture(undefined, profiles.create); try {
    const attempt = await f.service.signIn({ usePlan: true }); await assert.rejects(f.service.signIn({ usePlan: true }), { code: "CHATGPT_AUTH_BUSY" });
    await attempt.cancel(); await assert.rejects(attempt.completion, { code: "CHATGPT_AUTH_CANCELLED" });
    await assert.rejects(f.callback(attempt));
    const expired = await f.service.signIn({ usePlan: true }); f.clock.advanceWall(300_000); await f.callback(expired); await assert.rejects(expired.completion, { code: "CHATGPT_AUTH_EXPIRED" }); assert.equal(f.calls.length, 0);
  } finally { await f.cleanup(); }
});
it("close drains sign-in startup before returning", async () => {
  const f = await chatGptFixture(undefined, profiles.create); let settled = false;
  const starting = f.service.signIn({ usePlan: true }).finally(() => { settled = true; });
  try {
    await f.service.close(); const settledWhenClosed = settled;
    const attempt = await starting.catch(() => undefined); await attempt?.cancel();
    assert.equal(settledWhenClosed, true); assert.equal(attempt, undefined);
  } finally { const attempt = await starting.catch(() => undefined); await attempt?.cancel(); await f.cleanup(); }
});
it("signout fences a sign-in started before credential initialization", async () => {
  const f = await chatGptFixture(undefined, profiles.create); let attempt: Awaited<ReturnType<typeof f.service.signIn>> | undefined;
  try {
    const starting = f.service.signIn({ usePlan: true }), signingOut = f.service.signOut();
    const [started, signedOut] = await Promise.allSettled([starting, signingOut]);
    if (started.status === "fulfilled") {
      attempt = started.value;
      const callback = await f.callback(attempt).catch(() => undefined);
      if (callback?.status === 200) await attempt.completion.catch(() => undefined); else await attempt.cancel();
    } else assert.equal((started.reason as { code?: string }).code, "CHATGPT_AUTH_CANCELLED");
    assert.equal(signedOut.status, "fulfilled"); assert.equal(f.calls.length, 0);
    assert.deepEqual(f.service.readAccount(), { state: "signed-out" });
  } finally { await attempt?.cancel(); await f.cleanup(); }
});
it("parallel sign-in startup refuses the second attempt as busy", async () => {
  const f = await chatGptFixture(undefined, profiles.create);
  const first = f.service.signIn({ usePlan: true }), second = f.service.signIn({ usePlan: true });
  try {
    const results = await Promise.allSettled([first, second]);
    for (const result of results) if (result.status === "fulfilled") await result.value.cancel();
    const concurrent = results[1]; assert.ok(concurrent);
    assert.equal(concurrent.status, "rejected");
    if (concurrent.status === "rejected") assert.equal((concurrent.reason as { code?: string }).code, "CHATGPT_AUTH_BUSY");
  } finally {
    for (const result of await Promise.allSettled([first, second])) if (result.status === "fulfilled") await result.value.cancel();
    await f.cleanup();
  }
});
it("corrupt private storage becomes unavailable without leaking input", async () => {
  const f = await chatGptFixture(undefined, profiles.create); try {
    await f.connected(); writeFileSync(join(f.root, "credentials/chatgpt-account.json"), '{"private":"synthetic-sensitive"');
    const state = f.service.readAccount(); assert.equal(state.state, "unavailable"); assert.equal(JSON.stringify(state).includes("synthetic-sensitive"), false);
  } finally { await f.cleanup(); }
});
it("failed first code exchange retains issued registration for fresh authorization", async () => {
  const f = await chatGptFixture(undefined, profiles.create); try {
    f.setTokenStatus(400); const attempt = await f.service.signIn({ usePlan: true }); await f.callback(attempt); await assert.rejects(attempt.completion, { code: "CHATGPT_ACCOUNT_EXPIRED" });
    assert.deepEqual(f.service.readAccount(), { state: "signed-out" }); f.setTokenStatus(200);
    const retry = await f.service.signIn({ usePlan: true }), url = new URL(retry.authorizationUrl);
    assert.equal(url.searchParams.get("client_id"), "oaiapp_fixture"); assert.equal(url.searchParams.has("agent_name_hint"), false);
    await f.callback(retry); assert.equal((await retry.completion).state, "connected");
  } finally { await f.cleanup(); }
});
it("rejects an ID token with a forged signature", async () => {
  const f = await chatGptFixture(undefined, profiles.create); try { f.tamperSignature(); const attempt = await f.service.signIn({ usePlan: true }); await f.callback(attempt); await assert.rejects(attempt.completion, { code: "CHATGPT_AUTH_INVALID" }); assert.deepEqual(f.service.readAccount(), { state: "signed-out" }); } finally { await f.cleanup(); }
});
it("parses split UTF-8 and split CRLF event boundaries", async () => {
  const f = await chatGptFixture(undefined, profiles.create); try {
    await f.connected(); const bytes = new TextEncoder().encode(completedOcrStream("Synthetic café").replaceAll("\n", "\r\n"));
    f.setResponse(() => new Response(new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }), { headers: { "Content-Type": "text/event-stream" } }));
    assert.deepEqual(await f.service.extractText(image), { text: "Synthetic café", model: image.model, responseId: "resp_synthetic" });
  } finally { await f.cleanup(); }
});
it("signout refuses an errored live stream's unproved closure without clearing credentials", async () => {
  const profile = await createBoundProfileFixture(), f = await chatGptFixture(profile.admission);
  let observedClosure = false;
  try {
    await f.connected(); let began: () => void = () => { throw new Error("not started"); }; const started = new Promise<void>(resolve => { began = resolve; });
    const path = join(f.root, "credentials", "chatgpt-account.json"), before = readFileSync(path);
    const callsBefore = f.calls.length;
    f.setResponse(init => new Response(new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"Partial"}\n\n')); began();
      init.signal?.addEventListener("abort", () => controller.error(new Error("synthetic-sensitive")), { once: true });
    } }), { headers: { "Content-Type": "text/event-stream" } }));
    const running = f.service.extractText(image);
    const rejected = assert.rejects(running, { code: "CHATGPT_RESOURCE_CLOSURE_UNPROVED" }); await started;
    await assert.rejects(f.service.signOut(), { code: "CHATGPT_RESOURCE_CLOSURE_UNPROVED" }); await rejected;
    assert.equal(readFileSync(path).equals(before), true);
    assert.equal(f.service.readAccount().state, "connected");
    assert.equal(f.calls.slice(callsBefore).filter(call => !call.url.endsWith("/responses")).length, 0);
    await assert.rejects(f.service.close(), { code: "CHATGPT_RESOURCE_CLOSURE_UNPROVED" });
    observedClosure = true;
  } finally { if (observedClosure) await profile.close(); }
});
it("signout drains actual graceful stream cancellation before clearing credentials", async () => {
  const f = await chatGptFixture(undefined, profiles.create), started = Promise.withResolvers<void>();
  const cancelling = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let cancelCalls = 0, releaseCalls = 0, signedOut = false;
  let restoreReader: (() => void) | undefined;
  let restoreBodyReader: (() => void) | undefined;
  let isNativeReader: (reader: unknown) => boolean = () => false;
  let signingOut: ReturnType<typeof f.service.signOut> | undefined;
  try {
    await f.connected();
    const path = join(f.root, "credentials", "chatgpt-account.json"), before = readFileSync(path);
    const releaseLock: unknown = Reflect.get(ReadableStreamDefaultReader.prototype, "releaseLock");
    assert.ok(typeof releaseLock === "function");
    const readerSpy = vi.spyOn(ReadableStreamDefaultReader.prototype, "releaseLock").mockImplementation(function (this: ReadableStreamDefaultReader<Uint8Array>) {
      if (isNativeReader(this)) releaseCalls++;
      Reflect.apply(releaseLock, this, []);
    });
    restoreReader = () => readerSpy.mockRestore();
    f.setResponse(() => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"Partial"}\n\n'));
          started.resolve();
        },
        async cancel() { cancelCalls++; cancelling.resolve(); await release.promise; },
      });
      const readerProbe = vi.spyOn(body, "getReader");
      isNativeReader = reader => readerProbe.mock.results.some(result => result.type === "return" && result.value === reader);
      restoreBodyReader = () => readerProbe.mockRestore();
      return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
    });
    const running = f.service.extractText(image);
    const rejected = assert.rejects(running, { code: "CHATGPT_OCR_CANCELLED" });
    await started.promise;
    signingOut = f.service.signOut().then(result => { signedOut = true; return result; });
    await cancelling.promise;
    assert.equal(signedOut, false);
    assert.equal(readFileSync(path).equals(before), true);
    assert.equal((await f.service.readAuthority()).availability, "pending");
    await assert.rejects(f.service.extractText(image), { code: "CHATGPT_OCR_CANCELLED" });
    assert.equal(f.calls.filter(call => call.url.endsWith("/responses")).length, 1);
    assert.equal(cancelCalls, 1); assert.equal(releaseCalls, 0);
    release.resolve(); await rejected; await signingOut;
    assert.equal(signedOut, true);
    assert.equal(cancelCalls, 1); assert.equal(releaseCalls, 1);
    assert.deepEqual(f.service.readAccount(), { state: "signed-out" });
  } finally {
    release.resolve();
    try { await signingOut; }
    finally { restoreReader?.(); restoreBodyReader?.(); await f.cleanup(); }
  }
});
it("cancelled code exchange cannot resurrect an account after signout", async () => {
  const f = await chatGptFixture(undefined, profiles.create); try {
    let release: () => void = () => { throw new Error("not initialized"); }, entered: () => void = () => { throw new Error("not initialized"); };
    const held = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    f.setTokenHook(async () => { entered(); await held; }); const attempt = await f.service.signIn({ usePlan: true }); await f.callback(attempt); await started;
    const cancelled = assert.rejects(attempt.completion, { code: "CHATGPT_AUTH_CANCELLED" }); await f.service.signOut(); release(); await cancelled;
    await new Promise<void>(resolve => setImmediate(resolve)); assert.deepEqual(f.service.readAccount(), { state: "signed-out" });
  } finally { await f.cleanup(); }
});
it("signout drains an aborted refresh before clearing the renewable session", async () => {
  const f = await chatGptFixture(undefined, profiles.create); try {
    await f.connected(); f.clock.advanceWall(3_600_000);
    let entered: () => void = () => { throw new Error("not started"); }; const started = new Promise<void>(resolve => { entered = resolve; });
    f.setTokenHook(async () => { entered(); await new Promise<void>(() => undefined); });
    const running = f.service.extractText(image), rejected = assert.rejects(running, { code: "CHATGPT_OCR_CANCELLED" }); await started;
    assert.deepEqual(await f.service.signOut(), { state: "signed-out", remoteRevocation: "confirmed" }); await rejected; assert.deepEqual(f.service.readAccount(), { state: "signed-out" });
  } finally { await f.cleanup(); }
});
it("signout reports local persistence uncertainty while readback proves tokens cleared", async () => {
  const f = await chatGptFixture(undefined, profiles.create); try {
    await f.connected(); const uncertain = createChatGptAccountService({ admission: f.admission, stateRoot: f.root, clock: f.clock, fetch: f.transport,
      credentialHooks: { afterRename() { throw new Error("synthetic-sensitive"); } } });
    await assert.rejects(uncertain.signOut(), { code: "CHATGPT_CREDENTIAL_UNCERTAIN" }); assert.deepEqual(uncertain.readAccount(), { state: "signed-out" }); await uncertain.close();
  } finally { await f.cleanup(); }
});

it("restores the existing five-minute authorization deadline without inventing a duration", async () => {
  const f = await chatGptFixture(undefined, profiles.create); try {
    const attempt = await f.service.signIn({ usePlan: true });
    assert.equal(Date.parse(attempt.expiresAt) - f.clock.nowMs(), 300_000);
    await attempt.cancel(); await assert.rejects(attempt.completion, { code: "CHATGPT_AUTH_CANCELLED" });
  } finally { await f.cleanup(); }
});
it("explicitly enabling declined plan usage requests consent on the saved registration", async () => {
  const f = await chatGptFixture(undefined, profiles.create); try {
    await f.connected(false);
    const attempt = await f.service.signIn({ usePlan: true }); const url = new URL(attempt.authorizationUrl);
    assert.equal(url.searchParams.get("client_id"), "oaiapp_fixture"); assert.equal(url.searchParams.get("prompt"), "consent");
    assert.equal(url.searchParams.has("id_token_hint"), false);
    await attempt.cancel(); await assert.rejects(attempt.completion);
  } finally { await f.cleanup(); }
});
for (const kind of ["error", "refusal", "incomplete", "empty", "contradictory", "multiple", "mismatch"] as const) it(`never admits partial text with ${kind} completion`, async () => {
  const f = await chatGptFixture(undefined, profiles.create); try {
    await f.connected();
    const text = '{"synthetic":"valid-looking"}';
    const response = { id: "resp_synthetic", model: image.model, status: kind === "contradictory" ? "failed" : "completed",
      output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: kind === "mismatch" ? "different" : text }] }] };
    if (kind === "multiple") response.output.push(response.output[0]);
    const prelude = kind === "error" ? 'data: {"type":"error","code":"synthetic"}\n\n'
      : kind === "refusal" ? 'data: {"type":"response.refusal.delta","delta":"refused"}\n\n'
      : kind === "incomplete" ? 'data: {"type":"response.incomplete"}\n\n' : "";
    f.setSse(`data: ${JSON.stringify({ type: "response.output_text.delta", delta: text })}\n\n${prelude}data: ${JSON.stringify({ type: "response.completed", ...(kind === "empty" ? {} : { response }) })}\n\n`);
    await assert.rejects(f.service.extractText(image));
  } finally { await f.cleanup(); }
});
for (const [status, body, code] of [
  [429, { error: { code: "subscription_sharing_usage_limit_exceeded" } }, "CHATGPT_USAGE_LIMIT"],
  [503, { error: { code: "subscription_sharing_usage_unavailable" } }, "CHATGPT_USAGE_UNAVAILABLE"],
  [403, { error: { code: "subscription_sharing_user_not_eligible" } }, "CHATGPT_PLAN_DISABLED"],
  [403, { error: { code: "chatpass_v2_scope_not_authorized" } }, "CHATGPT_PLAN_DISABLED"],
  [400, { error: { code: "subscription_sharing_unsupported_capability" } }, "CHATGPT_OCR_INVALID"],
  [401, { detail: "synthetic-sensitive" }, "CHATGPT_ACCOUNT_EXPIRED"],
  [403, { detail: "synthetic-sensitive" }, "CHATGPT_PLAN_DISABLED"],
  [503, { detail: "synthetic-sensitive" }, "CHATGPT_USAGE_UNAVAILABLE"],
] as const) it(`maps HTTP ${status}/${code} safely without losing credential custody`, async () => {
  const f = await chatGptFixture(undefined, profiles.create); try {
    await f.connected(); f.setResponse(() => Response.json(body, { status }));
    await assert.rejects(f.service.extractText(image), { code });
    const state = f.service.readAccount(); assert.equal(JSON.stringify(state).includes("synthetic-sensitive"), false);
    if (status === 401) assert.equal(state.state, "expired");
    if (status === 403) { assert.equal(state.state, "unavailable"); if (state.state === "unavailable") assert.equal(state.code, "CHATGPT_PLAN_DISABLED"); }
    assert.ok(readFileSync(join(f.root, "credentials/chatgpt-account.json"), "utf8").includes("synthetic-access-1"));
  } finally { await f.cleanup(); }
});
it("terminal refresh failure clears tokens, preserves the issued client and reauthorizes", async () => {
  const f = await chatGptFixture(undefined, profiles.create); try {
    await f.connected(); f.clock.advanceWall(3_600_000); f.setTokenStatus(400);
    await assert.rejects(f.service.extractText(image), { code: "CHATGPT_ACCOUNT_EXPIRED" });
    assert.deepEqual(f.service.readAccount(), { state: "signed-out" });
    const contents = readFileSync(join(f.root, "credentials/chatgpt-account.json"), "utf8");
    assert.equal(contents.includes("synthetic-access"), false); assert.ok(contents.includes("oaiapp_fixture"));
    const attempt = await f.service.signIn({ usePlan: true }); assert.equal(new URL(attempt.authorizationUrl).searchParams.get("client_id"), "oaiapp_fixture");
    await attempt.cancel(); await assert.rejects(attempt.completion);
  } finally { await f.cleanup(); }
});
it("preserves renewable credentials on a temporary or invalid-client refresh failure", async () => {
  const f = await chatGptFixture(undefined, profiles.create); try {
    await f.connected(); f.clock.advanceWall(3_600_000); f.setTokenStatus(400, "invalid_client");
    await assert.rejects(f.service.extractText(image), { code: "CHATGPT_AUTH_UNAVAILABLE" });
    assert.deepEqual(f.service.readAccount(), { state: "expired" });
    assert.ok(readFileSync(join(f.root, "credentials/chatgpt-account.json"), "utf8").includes("synthetic-refresh-1"));
    f.setTokenStatus(200); assert.equal((await f.service.extractText(image)).text, "Synthetic form");
  } finally { await f.cleanup(); }
});

it("accepts recognized reasoning items with exactly one completed assistant message", async () => {
  const f = await chatGptFixture(undefined, profiles.create); try {
    await f.connected(); const text = "Synthetic form";
    const response = { id: "resp_synthetic", model: image.model, status: "completed", output: [
      { type: "reasoning", id: "rs_synthetic", summary: [] },
      { type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text }] },
    ] };
    f.setSse(`data: ${JSON.stringify({ type: "response.output_text.delta", output_index: 1, content_index: 0, delta: text })}\n\ndata: ${JSON.stringify({ type: "response.completed", response })}\n\n`);
    assert.deepEqual(await f.service.extractText(image), { text, model: image.model, responseId: "resp_synthetic" });
  } finally { await f.cleanup(); }
});

for (const failure of ["subscription_sharing_usage_limit_exceeded", "subscription_sharing_usage_unavailable"] as const)
  it(`clears ${failure} only after a later explicit successful inference`, async () => {
    const f = await chatGptFixture(undefined, profiles.create); try {
      await f.connected(); f.setSse(`data: ${JSON.stringify({ type: "response.failed", response: { error: { code: failure } } })}\n\n`);
      await assert.rejects(f.service.extractText(image));
      const before = f.service.readAccount();
      assert.equal(before.state, failure.endsWith("exceeded") ? "connected" : "unavailable");
      if (before.state === "connected") assert.equal(before.planUsage, "limit-reached");
      f.setSse(completedOcrStream("Synthetic form"));
      assert.equal((await f.service.extractText(image)).text, "Synthetic form");
      const after = f.service.readAccount(); assert.equal(after.state, "connected");
      if (after.state === "connected") assert.equal(after.planUsage, "enabled");
      assert.equal(f.calls.filter(call => call.url.endsWith("/responses")).length, 2);
    } finally { await f.cleanup(); }
  });

it("does not return success when cancellation races successful usage recovery persistence", async () => {
  const f = await chatGptFixture(undefined, profiles.create); try {
    await f.connected(); f.setSse('data: {"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}}\n\n');
    await assert.rejects(f.service.extractText(image), { code: "CHATGPT_USAGE_LIMIT" });
    f.setSse(completedOcrStream("Synthetic form")); const controller = new AbortController();
    const service = createChatGptAccountService({ admission: f.admission, stateRoot: f.root, clock: f.clock, fetch: f.transport,
      credentialHooks: { afterRename: () => controller.abort() } });
    try { await assert.rejects(service.extractText(image, controller.signal), { code: "CHATGPT_OCR_CANCELLED" }); }
    finally { await service.close(); }
  } finally { await f.cleanup(); }
});

for (const status of [401, 403] as const) it(`refuses stale HTTP ${status} before ephemeral state publication after a concurrent quota revision`, async () => {
  const f = await chatGptFixture(undefined, profiles.create);
  let release = () => {};
  try {
    await f.connected(); let entered = () => {}; let calls = 0;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    f.setResponse(() => {
      if (++calls === 1) return new Response(new ReadableStream<Uint8Array>({
        async start(controller) {
          entered(); await held;
          controller.enqueue(new TextEncoder().encode(JSON.stringify(status === 401
            ? { detail: "synthetic refusal" } : { error: { code: "subscription_sharing_user_not_eligible" } })));
          controller.close();
        },
      }), { status, headers: { "Content-Type": "application/json" } });
      return Response.json({ error: { code: "subscription_sharing_usage_limit_exceeded" } }, { status: 429 });
    });
    const first = f.service.extractText(image);
    const refused = assert.rejects(first, { code: "CHATGPT_OCR_CANCELLED" });
    await started;
    await assert.rejects(f.service.extractText(image), { code: "CHATGPT_USAGE_LIMIT" });
    const latest = readFileSync(join(f.root, "credentials/chatgpt-account.json"));
    release(); await refused;
    assert.equal(readFileSync(join(f.root, "credentials/chatgpt-account.json")).equals(latest), true);
    const state = f.service.readAccount(); assert.equal(state.state, "connected");
    if (state.state === "connected") assert.equal(state.planUsage, "limit-reached");
    f.setResponse(() => new Response(completedOcrStream("Synthetic form"), { headers: { "Content-Type": "text/event-stream" } }));
    assert.equal((await f.service.extractText(image)).text, "Synthetic form");
    assert.equal(f.calls.filter(call => call.url.endsWith("/oauth/token")).length, 1);
    assert.equal(f.calls.filter(call => call.url.endsWith("/responses")).length, 3);
    const recovered = f.service.readAccount(); assert.equal(recovered.state, "connected");
    if (recovered.state === "connected") assert.equal(recovered.planUsage, "enabled");
  } finally { release(); await f.cleanup(); }
});

it("revalidates token-free account authority against durable revision, expiry and service restart without OAuth", async () => {
  const f = await chatGptFixture(undefined, profiles.create);
  const repository = createChatGptCredentialRepository({ admission: f.admission, stateRoot: f.root });
  try {
    await repository.withLock(async transaction => transaction.replace({
      schemaVersion: 1, revision: 1, hostId: "urn:uuid:11111111-1111-4111-8111-111111111111", clientId: "oaiapp_fixture",
      registration: { subject: "fixture", name: "Fixture", email: "fixture@example.com" },
      session: { accessToken: "fixture-access", refreshToken: null, idToken: "fixture-id", expiresAt: IsoInstantSchema.parse("2026-10-12T13:00:00.000Z"),
        earliestRefreshAt: null, scopes: ["offline_access", "resource.invoke", "chatgpt.tokens.use.direct"], usePlan: true, usage: "available" },
    }, null));
    const first = await f.service.readAuthority();
    assert.deepEqual(Object.keys(first).sort(), ["attemptGeneration", "availability", "revision"]);
    assert.equal(first.availability, "available");
    assert.equal(f.service.revalidateAuthority(first), true);
    assert.equal(f.service.revalidateAuthority({ ...first }), false);
    await repository.withLock(async transaction => { const current = transaction.read(); assert.ok(current); transaction.replace({ ...current, revision: current.revision + 1 }, current.revision); });
    assert.equal(f.service.revalidateAuthority(first), false);
    const fresh = await f.service.readAuthority(); assert.equal(f.service.revalidateAuthority(fresh), true);
    await f.service.close();
    assert.equal(f.service.revalidateAuthority(fresh), false);
    const restarted = createChatGptAccountService({ admission: f.admission, stateRoot: f.root, clock: f.clock, fetch: f.transport });
    try {
      const afterRestart = await restarted.readAuthority(); assert.equal(afterRestart.availability, "available");
      assert.equal(afterRestart.revision, fresh.revision);
      assert.equal(f.service.revalidateAuthority(fresh), false);
      assert.equal(restarted.revalidateAuthority(afterRestart), true);
      f.clock.advanceWall(3_600_001);
      assert.equal(restarted.revalidateAuthority(afterRestart), false);
      assert.equal((await restarted.readAuthority()).availability, "expired");
      await restarted.close(); assert.equal((await restarted.readAuthority()).availability, "closed");
    } finally { await restarted.close(); }
    assert.equal(f.calls.length, 0);
  } finally { await f.cleanup(); }
});

it("invalidates source captures while an attempt is cancelled before any OAuth listener or transport", async () => {
  const f = await chatGptFixture(undefined, profiles.create);
  try {
    const absent = await f.service.readAuthority(); assert.equal(absent.availability, "signed-out");
    const attempt = f.service.signIn({ usePlan: true });
    const rejected = assert.rejects(attempt, { code: "CHATGPT_AUTH_CANCELLED" });
    const closing = f.service.close();
    await rejected; await closing;
    const closed = await f.service.readAuthority(); assert.equal(closed.availability, "closed");
    assert.ok(closed.attemptGeneration > absent.attemptGeneration);
    assert.equal(f.service.revalidateAuthority(absent), false);
    assert.equal(f.calls.length, 0);
  } finally { await f.cleanup(); }
});

async function seedAuthorityAccount(f: Awaited<ReturnType<typeof chatGptFixture>>) {
  const repository = createChatGptCredentialRepository({ admission: f.admission, stateRoot: f.root });
  await repository.withLock(async transaction => transaction.replace({
    schemaVersion: 1, revision: 1, hostId: "urn:uuid:11111111-1111-4111-8111-111111111111", clientId: "oaiapp_fixture",
    registration: { subject: "fixture", name: "Fixture", email: "fixture@example.com" },
    session: { accessToken: "fixture-access", refreshToken: null, idToken: "fixture-id", expiresAt: IsoInstantSchema.parse("2026-10-12T13:00:00.000Z"),
      earliestRefreshAt: null, scopes: ["offline_access", "resource.invoke", "chatgpt.tokens.use.direct"], usePlan: true, usage: "available" },
  }, null));
  assert.equal(f.service.readAccount().state, "connected"); assert.equal(f.calls.length, 0);
  return repository;
}

it("R3 account authority reads concurrently through real busy writer locks without writing or acquiring authority", async () => {
  const f = await chatGptFixture(undefined, profiles.create);
  try {
    const repository = await seedAuthorityAccount(f);
    const before = readFileSync(join(f.root, "credentials/chatgpt-account.json"));
    for (let index = 0; index < 2; index++) {
      let release!: () => void;
      const held = new Promise<void>(resolve => { release = resolve; });
      const lock = repository.withLock(async () => held);
      try {
        for (const result of await Promise.allSettled([f.service.readAuthority(), f.service.readAuthority()])) {
          assert.equal(result.status, "fulfilled");
          if (result.status === "fulfilled") {
            assert.equal(result.value.revision, 1); assert.equal(f.service.revalidateAuthority(result.value), true);
          }
        }
        assert.equal(repository.read()?.revision === 1, true);
      } finally { release(); await lock; }
    }
    const captures = await Promise.all([f.service.readAuthority(), f.service.readAuthority(), f.service.readAuthority()]);
    assert.equal(repository.read()?.revision === 1, true);
    for (const capture of captures) {
      assert.equal(capture.availability, "available"); assert.equal(capture.revision === 1, true);
      assert.equal(f.service.revalidateAuthority(capture), true); assert.equal(f.service.revalidateAuthority({ ...capture }), false);
    }
    const cached = await f.service.readAuthority();
    assert.equal(cached.revision === 1 && f.service.revalidateAuthority(cached), true);
    assert.equal(readFileSync(join(f.root, "credentials/chatgpt-account.json")).equals(before), true);
    assert.equal(f.calls.length, 0);
  } finally { await f.cleanup(); }
});

it("R3 account authority preserves corrupt refusal and uncertain real mutation without implicit activation writes", async () => {
  const f = await chatGptFixture(undefined, profiles.create);
  let attempts = 0;
  const uncertain = createChatGptAccountService({ admission: f.admission, stateRoot: f.root, clock: f.clock, fetch: f.transport,
    credentialHooks: { afterRename() { attempts++; throw new Error("synthetic failure"); } } });
  try {
    const repository = await seedAuthorityAccount(f);
    const before = await uncertain.readAuthority();
    assert.equal(before.revision, 1); assert.equal(attempts, 0);
    const writer = createChatGptCredentialRepository({ admission: f.admission, stateRoot: f.root,
      afterRename() { attempts++; throw new Error("synthetic failure"); } });
    for (let index = 0; index < 2; index++) await assert.rejects(writer.withLock(async transaction => {
      const current = transaction.read(); assert.ok(current);
      transaction.replace({ ...current, revision: current.revision + 1 }, current.revision);
    }), { code: "CHATGPT_CREDENTIAL_UNCERTAIN" });
    assert.equal(attempts, 2); assert.equal(repository.read()?.revision, 3);
    assert.equal(uncertain.revalidateAuthority(before), false);
    assert.equal((await uncertain.readAuthority()).revision, 3);
    assert.equal(attempts, 2);
    writeFileSync(join(f.root, "credentials/chatgpt-account.json"), "{", { mode: 0o600 });
    for (let index = 0; index < 2; index++) await assert.rejects(f.service.readAuthority(), { code: "CHATGPT_CREDENTIAL_UNAVAILABLE" });
    assert.equal(f.calls.length, 0);
  } finally { await uncertain.close(); await f.cleanup(); }
});

for (const status of [401, 403] as const) it(`refuses issued authority after C1 HTTP ${status} rejection`, async () => {
  const f = await chatGptFixture(undefined, profiles.create);
  try {
    await f.connected();
    const capture = await f.service.readAuthority();
    assert.equal(capture.availability, "available");
    assert.equal(f.service.revalidateAuthority(capture), true);
    f.setResponse(() => Response.json({ detail: "synthetic refusal" }, { status }));
    await assert.rejects(f.service.extractText(image), { code: status === 401 ? "CHATGPT_ACCOUNT_EXPIRED" : "CHATGPT_PLAN_DISABLED" });
    assert.equal(f.service.revalidateAuthority(capture), false);
    assert.equal((await f.service.readAuthority()).availability, status === 401 ? "expired" : "unavailable");
    assert.ok(readFileSync(join(f.root, "credentials/chatgpt-account.json"), "utf8").includes("synthetic-access-1"));
  } finally { await f.cleanup(); }
});


it("requires both account authority admissions to remain live and bound to the same root", async () => {
  const profile = await createBoundProfileFixture(), foreign = await createBoundProfileFixture();
  const f = await chatGptFixture(profile.admission);
  const claim = createProfileRegistry(profile.machine).storageClaim(profile.admission.profileBinding.profileId);
  const delegated = profile.machine.admitProfile(claim), retained = profile.machine.admitProfile(claim);
  try {
    await seedAuthorityAccount(f);
    const captured = await f.service.readAuthority();
    assert.equal(f.service.revalidateAuthority(captured), true);
    assert.equal((await f.service.readAuthority(delegated)).availability, "available");
    assert.equal(f.service.revalidateAuthority(captured, delegated), true);
    await assert.rejects(f.service.readAuthority(foreign.admission), /state path is outside admission/u);
    assert.throws(() => f.service.revalidateAuthority(captured, foreign.admission), /state path is outside admission/u);
    delegated.release();
    await assert.rejects(f.service.readAuthority(delegated), /released admission/u);
    assert.throws(() => f.service.revalidateAuthority(captured, delegated), /released admission/u);
    assert.equal(f.service.revalidateAuthority(captured, retained), true);
    profile.admission.release();
    await assert.rejects(f.service.readAuthority(), /released admission/u);
    await assert.rejects(f.service.readAuthority(retained), /released admission/u);
    assert.throws(() => f.service.revalidateAuthority(captured, retained), /released admission/u);
  } finally {
    await f.cleanup();
    delegated.release(); retained.release(); await foreign.close(); await profile.close();
  }
});
