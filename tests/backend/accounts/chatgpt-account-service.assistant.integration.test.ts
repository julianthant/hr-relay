import { createChatGptCredentialRepository } from '../../../src/backend/storage/configuration/chatgpt-credential-repository.js';
import assert from "node:assert/strict";
import { afterAll, it } from "vitest";
import { setImmediate } from 'node:timers/promises';
import { createBoundProfileFixture, createProfileFixtureSet } from '../../support/helpers/admission-fixture.js';
import { ChatGptAccountError } from '../../../src/backend/accounts/chatgpt-account-service.js';
import { ASSISTANT_DEFAULT_MODEL, ASSISTANT_DEFAULT_EFFORT, type AssistantInferenceRequest } from "../../../src/models/dashboard/assistant.js";
import { syntheticAssistantTools, syntheticAssistantResponse, completedAssistantStream } from "../../support/helpers/assistant-function-fixtures.js";
import { chatGptFixture, completedOcrStream } from "../../support/helpers/chatgpt-account-fixtures.js";
import { completedResponseStream, partialTextStream } from "../../support/helpers/chatgpt-response-stream.js";
const turn = { action: "answer", text: "Synthetic explanation", citations: [] };
const request: AssistantInferenceRequest = { model: "gpt-6.1-sol", reasoning: { effort: "medium" },
  input: [{ role: "developer", content: "Synthetic fixed instructions" }, { role: "user", content: "Explain dry run" }],
  tools: syntheticAssistantTools };
function terminal(output: readonly unknown[], model = request.model) {
  return completedResponseStream(output, model);
}
const profiles = createProfileFixtureSet();
afterAll(() => profiles.close());

it("uses private admitted subscription transport with fixed roles and strict namespaced assistant functions", async () => {
  const f = await chatGptFixture(undefined, profiles.create);
  try {
    await f.connected(); const response = syntheticAssistantResponse(turn); f.setSse(terminal(response.output));
    assert.deepEqual((await f.service.inferAssistant(request)).output, response.output);
    const call = f.calls.find(call => call.url.endsWith("/responses")); assert.ok(call && typeof call.init.body === "string");
    const wire = JSON.parse(call.init.body) as AssistantInferenceRequest & { store: boolean; stream: boolean; parallel_tool_calls: boolean; include: string[] };
    assert.equal(wire.store, false); assert.equal(wire.stream, true); assert.equal(wire.parallel_tool_calls, false);
    assert.deepEqual(wire.input.flatMap(item => "role" in item ? [item.role] : []), ["developer", "user"]);
    assert.deepEqual(wire.include, ["reasoning.encrypted_content"]); assert.deepEqual(wire.tools, request.tools); assert.deepEqual(wire.reasoning, { effort: "medium" });
    for (const field of ["previous_response_id", "conversation", "max_output_tokens", "temperature", "metadata", "background"]) assert.equal(field in wire, false);
    assert.equal(call.init.body.includes("synthetic-access"), false);
    await assert.rejects(f.service.inferAssistant({ ...request, messages: [{ role: "system", content: "override" }] } as typeof request));
    assert.equal(f.calls.filter(call => call.url.endsWith("/responses")).length, 1);
  } finally { await f.cleanup(); }
});
for (const problem of ["unknown-namespace", "unknown-function", "malformed-arguments", "unfinished", "excessive-text"] as const)
  it(`rejects ${problem} assistant output`, async () => {
    const f = await chatGptFixture(undefined, profiles.create);
    try {
      await f.connected(); const call = syntheticAssistantResponse(turn).output[0]; assert.ok(call?.type === "function_call");
      const output = problem === "excessive-text" ? [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "x".repeat(25_000) }] }]
        : [{ ...call, ...(problem === "unknown-namespace" ? { namespace: "foreign" } : problem === "unknown-function" ? { name: "start" }
          : problem === "malformed-arguments" ? { arguments: "not JSON" } : { status: "incomplete" }) }];
      f.setSse(terminal(output)); await assert.rejects(f.service.inferAssistant(request));
    } finally { await f.cleanup(); }
  });
it("accepts direct namespaced calls and refuses omitted namespace, asynchronous, programmatic and unknown execution metadata", async () => {
  const f = await chatGptFixture(undefined, profiles.create);
  try {
    await f.connected();
    const call = syntheticAssistantResponse(turn).output[0]; assert.ok(call?.type === "function_call");
    const direct = { ...call, async: false, caller: { type: "direct" } };
    f.setSse(terminal([direct]));
    assert.deepEqual((await f.service.inferAssistant(request)).output, [direct]);
    const unscoped = Object.fromEntries(Object.entries(call).filter(([key]) => key !== "namespace"));
    for (const changed of [unscoped, { ...call, async: true }, { ...call, caller: { type: "program", caller_id: "foreign-program" } }, { ...call, unknown_execution: true }]) {
      f.setSse(terminal([changed]));
      await assert.rejects(f.service.inferAssistant(request));
    }
  } finally { await f.cleanup(); }
});
it("rejects conflicting terminal text, forged roles/model, partial streams and cancellation", async () => {
  const f = await chatGptFixture(undefined, profiles.create); try {
    await f.connected(); const valid = completedOcrStream("Synthetic explanation");
    for (const sse of [valid.replace('"role":"assistant"', '"role":"system"'), valid.replaceAll("gpt-6.1-sol", "unverified-model"),
      valid.replace('"delta":"Synthetic', '"delta":"conflictSynthetic'), 'data: {"type":"response.output_text.delta","delta":"partial"}\n\n']) {
      f.setSse(sse); await assert.rejects(f.service.inferAssistant(request));
    }
    await assert.rejects(f.service.inferAssistant(request, AbortSignal.abort()), { code: "CHATGPT_OCR_CANCELLED" });
  } finally { await f.cleanup(); }
});
it("preserves disabled, refresh, quota, token-bound auth and signout behavior", async () => {
  const f = await chatGptFixture(undefined, profiles.create); try {
    await assert.rejects(f.service.inferAssistant(request), { code: "CHATGPT_ACCOUNT_EXPIRED" });
    await f.connected(false); await assert.rejects(f.service.inferAssistant(request), { code: "CHATGPT_PLAN_DISABLED" });
    await f.connected(); f.clock.advanceWall(3_600_000); f.setSse(completedAssistantStream(turn));
    assert.equal((await f.service.inferAssistant(request)).output[0]?.type, "function_call");
    f.setResponse(() => Response.json({ error: { code: "subscription_sharing_usage_limit_exceeded" } }, { status: 429 }));
    await assert.rejects(f.service.inferAssistant(request), { code: "CHATGPT_USAGE_LIMIT" });
    f.setResponse(() => Response.json({ detail: "private failure withheld" }, { status: 401 }));
    await assert.rejects(f.service.inferAssistant(request), { code: "CHATGPT_ACCOUNT_EXPIRED" }); assert.equal(f.service.readAccount().state, "expired");
    await f.service.signOut(); await assert.rejects(f.service.inferAssistant(request), { code: "CHATGPT_ACCOUNT_EXPIRED" });
  } finally { await f.cleanup(); }
});
it("malformed completed assistant content cannot clear an observed usage limit", async () => {
  const f = await chatGptFixture(undefined, profiles.create); try {
    await f.connected();
    f.setSse('data: {"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}}\n\n');
    await assert.rejects(f.service.inferAssistant(request), { code: "CHATGPT_USAGE_LIMIT" });
    f.setSse(terminal([{ type: "function_call", namespace: "synthetic", name: "answer", call_id: "invalid", arguments: "malformed" }]));
    await assert.rejects(f.service.inferAssistant(request));
    const state = f.service.readAccount(); assert.equal(state.state, "connected"); if (state.state === "connected") assert.equal(state.planUsage, "limit-reached");
    f.setSse(completedAssistantStream(turn)); await f.service.inferAssistant(request);
    const recovered = f.service.readAccount(); assert.equal(recovered.state, "connected"); if (recovered.state === "connected") assert.equal(recovered.planUsage, "enabled");
  } finally { await f.cleanup(); }
});
it("accepts fragmented strict call arguments only after terminal completion and preserves reasoning bytes", async () => {
  const f = await chatGptFixture(undefined, profiles.create); try {
    await f.connected(); const response = syntheticAssistantResponse(turn), call = response.output[0]; assert.ok(call?.type === "function_call");
    const reasoning = { type: "reasoning", id: "rs_synthetic", summary: [], encrypted_content: "synthetic-opaque-reasoning" };
    const sse = terminal([reasoning, call]).replace(`data: ${JSON.stringify({ type: "response.function_call_arguments.delta", output_index: 1, item_id: call.id, delta: call.arguments })}\n\n`,
      `data: ${JSON.stringify({ type: "response.function_call_arguments.delta", output_index: 1, item_id: call.id, delta: call.arguments.slice(0, 7) })}\n\n`
      + `data: ${JSON.stringify({ type: "response.function_call_arguments.delta", output_index: 1, item_id: call.id, delta: call.arguments.slice(7) })}\n\n`);
    f.setResponse(() => new Response(new ReadableStream<Uint8Array>({ start(controller) {
      const bytes = new TextEncoder().encode(sse); for (let i = 0; i < bytes.length; i += 13) controller.enqueue(bytes.slice(i, i + 13)); controller.close();
    } }), { headers: { "content-type": "text/event-stream" } }));
    assert.deepEqual((await f.service.inferAssistant(request)).output, [reasoning, call]);
    f.setResponse(() => new Response(sse.replace(JSON.stringify(call.arguments.slice(0, 7)), JSON.stringify("conflict")), { headers: { "content-type": "text/event-stream" } }));
    await assert.rejects(f.service.inferAssistant(request));
  } finally { await f.cleanup(); }
});
it("requires exact call-ID and namespace/name outputs in continuation and rejects parallel or duplicate calls", async () => {
  const f = await chatGptFixture(undefined, profiles.create); try {
    await f.connected(); const response = syntheticAssistantResponse(turn), call = response.output[0]; assert.ok(call?.type === "function_call");
    const output = { type: "function_call_output" as const, call_id: call.call_id, namespace: call.namespace, name: call.name, output: "{}" };
    f.setSse(completedOcrStream("Finished"));
    await f.service.inferAssistant({ ...request, input: [...request.input, call, output] });
    const before = f.calls.length;
    for (const changed of [{ ...output, call_id: "foreign" }, { ...output, namespace: "foreign" }, { ...output, name: "foreign" }])
      await assert.rejects(f.service.inferAssistant({ ...request, input: [...request.input, call, changed] }));
    await assert.rejects(f.service.inferAssistant({ ...request, input: [...request.input, call] }));
    assert.equal(f.calls.length, before);
    for (const calls of [[call, call], [call, { ...call, call_id: "second" }]]) {
      f.setSse(terminal(calls)); await assert.rejects(f.service.inferAssistant(request));
    }
  } finally { await f.cleanup(); }
});
for (const event of ["response.incomplete", "response.failed", "response.refusal.delta", "error"] as const) it(`keeps ${event} visible after partial assistant data`, async () => {
  const f = await chatGptFixture(undefined, profiles.create); try {
    await f.connected(); f.setSse(`${partialTextStream("partial")}data: ${JSON.stringify({ type: event, response: { error: null } })}\n\n`);
    await assert.rejects(f.service.inferAssistant(request));
  } finally { await f.cleanup(); }
});
it("keeps usage-limit events visible midstream and binds catalog order/visibility to the current selected account", async () => {
  const f = await chatGptFixture(undefined, profiles.create); try {
    await f.connected(); f.setModels({ models: [{ slug: "hidden", display_name: "Hidden", visibility: "hide" },
      { slug: "gpt-6.1-sol", display_name: "Current Sol", visibility: "list" }, { slug: "other", display_name: "Other", visibility: "list" }] });
    assert.deepEqual((await f.service.listAssistantModels()).catalog, { models: [{ slug: "gpt-6.1-sol", displayName: "Current Sol" }, { slug: "other", displayName: "Other" }] });
    f.setSse(partialTextStream("partial") + 'data: {"type":"error","code":"subscription_sharing_usage_limit_exceeded"}\n\n');
    await assert.rejects(f.service.inferAssistant(request), { code: "CHATGPT_USAGE_LIMIT" });
    const state = f.service.readAccount(); assert.equal(state.state, "connected"); if (state.state === "connected") assert.equal(state.planUsage, "limit-reached");
  } finally { await f.cleanup(); }
});
it("refuses a catalog that settles after signout and cancels held inference on account closure", async () => {
  const f = await chatGptFixture(undefined, profiles.create); let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  try {
    await f.connected(); f.setModelsHook(async () => { entered(); await held; return Response.json({ models: [{ slug: request.model, display_name: "Sol", visibility: "list" }] }); });
    const catalog = f.service.listAssistantModels().catch((error: unknown) => error);
    await started; await f.service.signOut(); release();
    assert.ok(await catalog instanceof Error);
    await f.connected();
    let responseEntered!: () => void;
    const responseStarted = new Promise<void>(resolve => { responseEntered = resolve; });
    f.setResponse(() => { responseEntered(); return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(partialTextStream("partial"))); } }), { headers: { "content-type": "text/event-stream" } }); });
    const inference = f.service.inferAssistant(request).catch((error: unknown) => error);
    await responseStarted; await f.service.close(); assert.ok(await inference instanceof Error);
  } finally { release(); await f.cleanup(); }
});

it("a page close while the catalog body is read is a cancellation and leaves the account usable", async () => {
  const f = await chatGptFixture(undefined, profiles.create), entered = Promise.withResolvers<void>(), abort = new AbortController();
  try {
    await f.connected();
    // As the native fetch does: an aborted request errors its body with the signal's reason.
    let calls = 0, pulls = 0;
    f.setModelsHook(init => calls++ > 0 ? Promise.resolve(Response.json({ models: [{ slug: request.model, display_name: "Sol", visibility: "list" }] })) : Promise.resolve(new Response(new ReadableStream<Uint8Array>({ start(controller) {
      init?.signal?.addEventListener("abort", () => { controller.error(init.signal?.reason); }, { once: true });
    }, pull(controller) { if (pulls++ === 0) controller.enqueue(new TextEncoder().encode('{"models":[')); else entered.resolve(); } }, { highWaterMark: 0 }), { headers: { "content-type": "application/json" } })));
    const catalog = f.service.listAssistantModels(abort.signal);
    await entered.promise; abort.abort();
    await assert.rejects(catalog, { code: "CHATGPT_OCR_CANCELLED" });
    assert.deepEqual((await f.service.listAssistantModels()).catalog.models.map(model => model.slug), [request.model]);
    assert.equal(f.service.readAccount().state, "connected");
  } finally { await f.cleanup(); }
});

it("refreshes account-specific models after a fresh sign-in without a bundled catalog fallback", async () => {
  const f = await chatGptFixture(undefined, profiles.create);
  try {
    await f.connected(); f.setModels({ models: [{ slug: "first", display_name: "First", visibility: "list" }] });
    assert.deepEqual((await f.service.listAssistantModels()).catalog.models.map(model => model.slug), ["first"]);
    await f.service.signOut(); await f.connected();
    f.setModels({ models: [{ slug: "second", display_name: "Second", visibility: "list" }] });
    assert.deepEqual((await f.service.listAssistantModels()).catalog.models.map(model => model.slug), ["second"]);
    assert.equal(f.calls.filter(call => call.url.endsWith("/models")).length, 2);
    assert.equal(f.calls.filter(call => call.url.endsWith("/responses")).length, 0);
  } finally { await f.cleanup(); }
});

it('closes a cancelled held response before admitting another inference or account close', async () => {
  const profile = await createBoundProfileFixture(), f = await chatGptFixture(profile.admission);
  const entered = Promise.withResolvers<void>(), abort = new AbortController();
  let cancellations = 0, body: ReadableStream<Uint8Array> | undefined;
  try {
    await f.connected();
    f.setResponse(() => {
      body = new ReadableStream<Uint8Array>({ pull() { entered.resolve(); }, cancel() { cancellations++; } });
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    });
    const inference = f.service.inferAssistant(request, abort.signal).catch((error: unknown) => error);
    await entered.promise;
    await setImmediate();
    abort.abort();
    const result = await inference;
    assert.equal(cancellations, 1);
    assert.equal(body?.locked, false);
    assert.ok(result instanceof Error && 'code' in result);
    assert.equal(result.code, 'CHATGPT_OCR_CANCELLED');
    f.setResponse(() => new Response(completedAssistantStream(turn), { headers: { 'content-type': 'text/event-stream' } }));
    assert.equal((await f.service.inferAssistant(request)).output[0]?.type, 'function_call');
    await f.service.close();
  } finally { try { await f.cleanup(); } finally { await profile.close(); } }
});

it('retains a real transport cancel failure even when it carries the cancellation code', async () => {
  const profile = await createBoundProfileFixture(), f = await chatGptFixture(profile.admission);
  const entered = Promise.withResolvers<void>(), abort = new AbortController();
  try {
    await f.connected();
    f.setResponse(() => new Response(new ReadableStream<Uint8Array>({
      pull() { entered.resolve(); }, cancel() { throw new ChatGptAccountError('CHATGPT_OCR_CANCELLED'); },
    }), { headers: { 'content-type': 'text/event-stream' } }));
    const rejected = assert.rejects(f.service.inferAssistant(request, abort.signal), { code: 'CHATGPT_RESOURCE_CLOSURE_UNPROVED' });
    await entered.promise;
    await setImmediate();
    abort.abort();
    await rejected;
    await assert.rejects(f.service.signOut(), { code: 'CHATGPT_RESOURCE_CLOSURE_UNPROVED' });
    assert.equal(f.service.readAccount().state, 'connected');
    await assert.rejects(f.cleanup(), { code: 'CHATGPT_RESOURCE_CLOSURE_UNPROVED' });
  } finally { await profile.close(); }
});
for (const catalog of [{ data: [] }, { models: [{ slug: "bad slug", display_name: "Invalid", visibility: "list" }] },
  { models: [{ slug: "duplicate", display_name: "One", visibility: "list" }, { slug: "duplicate", display_name: "Two", visibility: "list" }] }])
  it("refuses malformed or ambiguous current account catalogs", async () => {
    const f = await chatGptFixture(undefined, profiles.create); try { await f.connected(); f.setModels(catalog); await assert.rejects(f.service.listAssistantModels()); }
    finally { await f.cleanup(); }
  });


it("keeps catalog authority privately issued and refreshes before capturing its current view", async () => {
  const first = await chatGptFixture(undefined, profiles.create), second = await chatGptFixture(undefined, profiles.create);
  try {
    await first.connected(); await second.connected(); first.clock.advanceWall(3_600_000);
    const a = await first.service.listAssistantModels(), b = await second.service.listAssistantModels();
    assert.equal(first.service.revalidateAuthority(a.authority), true);
    assert.equal(first.service.revalidateAuthority({ ...a.authority }), false);
    assert.equal(first.service.revalidateAuthority(b.authority), false);
    assert.equal(first.calls.filter(call => call.url.endsWith("/oauth/token")).length, 2);
    assert.equal(a.catalog.models[0]?.slug, request.model);
    await first.service.signOut(); assert.equal(first.service.revalidateAuthority(a.authority), false);
  } finally { await second.cleanup(); await first.cleanup(); }
});

const capabilityPreference = { slug: ASSISTANT_DEFAULT_MODEL, effort: ASSISTANT_DEFAULT_EFFORT } as const;

it('prepares a catalog choice without issuing assistant authority', async () => {
  const f = await chatGptFixture(undefined, profiles.create);
  try {
    await f.connected();
    const authorityBefore = await f.service.readAuthority();
    assert.equal(authorityBefore.availability, 'available');
    assert.equal(f.service.revalidateAuthority(authorityBefore), true);
    const catalogBefore = await f.service.listAssistantModels();
    assert.deepEqual(catalogBefore.authority, authorityBefore);
    const before = f.calls.length;
    const current = await f.service.prepareAssistantModelPreference(capabilityPreference, () => true);
    assert.equal(current(), true);
    assert.equal(f.calls.slice(before).filter(call => call.url.endsWith('/responses')).length, 0);
    const authorityAfter = await f.service.readAuthority();
    assert.equal(authorityAfter.revision, authorityBefore.revision);
    assert.equal(authorityAfter.attemptGeneration, authorityBefore.attemptGeneration);
    assert.equal(authorityAfter.availability, authorityBefore.availability);
    assert.equal(f.service.revalidateAuthority(authorityBefore), true);
    const catalogAfter = await f.service.listAssistantModels();
    assert.deepEqual(catalogAfter.catalog, catalogBefore.catalog);
    assert.deepEqual(catalogAfter.authority, authorityBefore);
    await f.connected(false);
    const noConsentCalls = f.calls.length;
    await assert.rejects(f.service.listAssistantModels(), { code: 'CHATGPT_PLAN_DISABLED' });
    assert.equal(f.calls.length, noConsentCalls);
  } finally { await f.cleanup(); }
});
it('refuses malformed selection authority before credentials or provider requests', async () => {
  const f = await chatGptFixture(undefined, profiles.create);
  try {
    await f.connected(); const before = f.calls.length;
    for (const invalid of [() => false, () => Promise.resolve(true), () => Promise.reject(new Error('invalid authority'))]) {
      await assert.rejects(f.service.prepareAssistantModelPreference(capabilityPreference, invalid as unknown as () => true));
      assert.equal(f.calls.length, before);
    }
  } finally { await f.cleanup(); }
});
it('rechecks selection identity across catalog await and after preparation', async () => {
  const f = await chatGptFixture(undefined, profiles.create); let current = true;
  try {
    await f.connected();
    const assertCurrent = (): true => { assert.equal(current, true); return true; };
    f.setModelsHook(async () => { current = false; return Response.json({ models: [] }); });
    await assert.rejects(f.service.prepareAssistantModelPreference(capabilityPreference, assertCurrent));
  } finally { await f.cleanup(); }
});
it('invalidates a prepared selection after a same-token foreign credential revision', async () => {
  const f = await chatGptFixture(undefined, profiles.create);
  try {
    await f.connected();
    const current = await f.service.prepareAssistantModelPreference(capabilityPreference, () => true);
    assert.equal(current(), true);
    const peer = createChatGptCredentialRepository({ admission: f.admission, stateRoot: f.root });
    await peer.withLock(async transaction => {
      const record = transaction.read(); assert.ok(record?.session);
      transaction.replace({ ...record, revision: record.revision + 1 }, record.revision);
    });
    assert.throws(current);
  } finally { await f.cleanup(); }
});
it('allows its own token refresh while preparing a choice but issues no witness', async () => {
  const f = await chatGptFixture(undefined, profiles.create);
  try {
    await f.connected(); const state = f.service.readAccount(); assert.equal(state.state, "connected");
    if (state.state !== "connected") throw new Error('connected account required');
    f.clock.advanceWall(Date.parse(state.expiresAt) - f.clock.nowMs() - 100);
    const current = await f.service.prepareAssistantModelPreference(capabilityPreference, () => true);
    assert.equal(current(), true);
    assert.equal(f.calls.filter(call => call.url.endsWith('/oauth/token')).length, 2);
  } finally { await f.cleanup(); }
});

it('selection catalog access preserves explicit consent and model availability gates', async () => {
  const f = await chatGptFixture(undefined, profiles.create);
  try {
    await f.connected(false); const before = f.calls.length;
    await assert.rejects(f.service.prepareAssistantModelPreference(capabilityPreference, () => true));
    assert.equal(f.calls.length, before);
    await f.connected(); f.setModels({ models: [] });
    await assert.rejects(f.service.prepareAssistantModelPreference(capabilityPreference, () => true));
    assert.equal(f.calls.filter(call => call.url.endsWith('/responses')).length, 0);
  } finally { await f.cleanup(); }
});

// The fixture holds an unreleased reader on purpose and is never cleaned up.
const retainedFixtures = new Set<Awaited<ReturnType<typeof chatGptFixture>>>();
it('retains an unsettled catalog reader and prevents later selection requests', async () => {
  const f = await chatGptFixture(); retainedFixtures.add(f);
  await f.connected();
  const primary = new Error('catalog reader release refused'); let attempts = 0;
  let retained: Response | undefined;
  f.setModelsHook(async () => {
    const response = Response.json({ models: [{ slug: capabilityPreference.slug, display_name: 'Public fixture model', visibility: "list" }] });
    assert.ok(response.body); const reader = response.body.getReader();
    Object.defineProperty(reader, 'releaseLock', { value: () => { attempts++; throw primary; } });
    Object.defineProperty(response.body, 'getReader', { value: () => reader }); retained = response; return response;
  });
  await assert.rejects(f.service.prepareAssistantModelPreference(capabilityPreference, () => true), (error: unknown) => {
    assert.ok(error instanceof Error); assert.ok('code' in error);
    assert.equal(error.code, 'CHATGPT_RESOURCE_CLOSURE_UNPROVED');
    let cause: unknown = error.cause;
    for (let depth = 0; cause !== primary && depth < 16; depth++) {
      if (cause instanceof AggregateError) { assert.ok(cause.errors.length > 0); cause = cause.errors[0]; }
      else { assert.ok(cause instanceof Error); cause = cause.cause; }
    }
    assert.equal(cause, primary); return true;
  });
  const before = f.calls.length;
  await assert.rejects(f.service.prepareAssistantModelPreference(capabilityPreference, () => true), { code: 'CHATGPT_RESOURCE_CLOSURE_UNPROVED' });
  assert.equal(f.calls.length, before);
  await assert.rejects(f.cleanup(), { code: 'CHATGPT_RESOURCE_CLOSURE_UNPROVED' });
  assert.equal(attempts, 1); assert.equal(retained?.body?.locked, true);
});

it("fences every pre-POST checkpoint with the caller's currentness callback and makes no stale POST", async () => {
  const f = await chatGptFixture(undefined, profiles.create);
  try {
    await f.connected();
    let checks = 0, atPost = -1;
    f.setResponse(() => { atPost = checks; return new Response(completedResponseStream(syntheticAssistantResponse(turn).output, request.model, "resp_usage_fenced",
      { input_tokens: 12, output_tokens: 3, total_tokens: 15 }), { headers: { "Content-Type": "text/event-stream" } }); });
    await f.service.inferAssistant(request, undefined, () => { checks++; });
    assert.ok(atPost > 0, "the callback runs before the POST");
    assert.ok(checks > atPost, "the callback also runs while the response streams");
    for (let stale = 1; stale <= atPost; stale++) {
      const before = f.calls.filter(call => call.url.endsWith("/responses")).length;
      let seen = 0;
      await assert.rejects(f.service.inferAssistant(request, undefined, () => { if (++seen === stale) throw new Error("stale-assistant-attempt"); }), /stale-assistant-attempt/u);
      assert.equal(f.calls.filter(call => call.url.endsWith("/responses")).length, before, `checkpoint ${String(stale)} must fence the POST`);
    }
  } finally { await f.cleanup(); }
});

it("closes the caller-owned inference operation on success, failure, abort, stale currentness and invalid input", async () => {
  const settle = (closing: Promise<void>) => Promise.race([closing.then(() => "closed"), new Promise(resolve => setTimeout(() => resolve("leaked"), 2_000))]);
  const cases: readonly (readonly [string, (f: Awaited<ReturnType<typeof chatGptFixture>>) => Promise<unknown>])[] = [
    ["success", f => { f.setSse(terminal(syntheticAssistantResponse(turn).output)); return f.service.inferAssistant(request, undefined, () => {}); }],
    ["provider failure", f => { f.setResponse(() => new Response("synthetic failure", { status: 500 })); return f.service.inferAssistant(request, undefined, () => {}); }],
    ["abort", f => { const controller = new AbortController(); f.setResponse(() => { controller.abort(); return new Response(terminal(syntheticAssistantResponse(turn).output), { headers: { "Content-Type": "text/event-stream" } }); });
      return f.service.inferAssistant(request, controller.signal, () => {}); }],
    ["stale currentness", f => { let stale = false; f.setResponse(() => { stale = true; return new Response(terminal(syntheticAssistantResponse(turn).output), { headers: { "Content-Type": "text/event-stream" } }); });
      return f.service.inferAssistant(request, undefined, () => { if (stale) throw new Error("stale-assistant-attempt"); }); }],
    ["invalid input", f => f.service.inferAssistant({ ...request, model: "" }, undefined, () => {})],
  ];
  for (const [name, run] of cases) {
    const f = await chatGptFixture(undefined, profiles.create);
    try {
      await f.connected();
      await run(f).catch(() => undefined);
      assert.equal(await settle(f.service.close()), "closed", name);
    } finally { await f.cleanup(); }
  }
});


it("carries only validated completed-response usage, independently of subscription availability and OCR", async () => {
  const f = await chatGptFixture(undefined, profiles.create);
  try {
    await f.connected();
    const output = syntheticAssistantResponse(turn).output;
    const measured = { input_tokens: 12, output_tokens: 5, total_tokens: 17,
      input_tokens_details: { cached_tokens: 8 }, output_tokens_details: { reasoning_tokens: 3 }, private: "PRIVATE_USAGE_CANARY" };
    const cases: readonly (readonly [unknown, unknown])[] = [
      [measured, { state: "measured", inputTokens: 12, outputTokens: 5, totalTokens: 17 }],
      [{ input_tokens: 0, output_tokens: 0, total_tokens: 0 }, { state: "measured", inputTokens: 0, outputTokens: 0, totalTokens: 0 }],
      [undefined, { state: "unavailable", reason: "missing" }], [null, { state: "unavailable", reason: "missing" }],
      ...[{}, "private", { ...measured, total_tokens: 18 }, { ...measured, input_tokens: -1 }, { ...measured, output_tokens: 0.5 },
        { ...measured, input_tokens: Number.MAX_SAFE_INTEGER + 1 }, { ...measured, output_tokens: "5" }]
        .map(value => [value, { state: "unavailable", reason: "invalid" }] as const),
    ];
    for (const [usage, expected] of cases) {
      f.setSse(completedResponseStream(output, request.model, "resp_synthetic", usage));
      const result = await f.service.inferAssistant(request);
      assert.deepEqual(result.usage, expected);
      assert.equal(JSON.stringify(result).includes("PRIVATE_USAGE_CANARY"), false);
      const account = f.service.readAccount(); assert.ok(account.state === "connected"); assert.equal(account.planUsage, "enabled");
    }
    f.setSse(completedResponseStream([{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "OCR unchanged" }] }], request.model, "resp_ocr", { input_tokens: "invalid" }));
    assert.equal((await f.service.extractText({ model: request.model, instruction: "Read", input: { kind: "image", mediaType: "image/png", base64: "YQ==" } })).text, "OCR unchanged");
  } finally { await f.cleanup(); }
});
