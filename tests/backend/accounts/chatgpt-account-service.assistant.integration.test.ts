import { createChatGptCredentialRepository } from '../../../src/backend/storage/configuration/chatgpt-credential-repository.js';
import { z } from 'zod';
import assert from "node:assert/strict";
import { it } from "vitest";
import { ASSISTANT_DEFAULT_MODEL, ASSISTANT_DEFAULT_EFFORT, type AssistantInferenceRequest } from "../../../src/models/dashboard/assistant.js";
import { syntheticAssistantTools, syntheticAssistantResponse, completedAssistantStream } from "../../support/helpers/assistant-function-fixtures.js";
import { chatGptFixture, completedOcrStream , publicCapabilityResponses } from "../../support/helpers/chatgpt-account-fixtures.js";
const turn = { action: "answer", text: "Synthetic explanation", citations: [] };
const request: AssistantInferenceRequest = { model: "gpt-6.1-sol", reasoning: { effort: "medium" },
  input: [{ role: "developer", content: "Synthetic fixed instructions" }, { role: "user", content: "Explain dry run" }],
  tools: syntheticAssistantTools };
function terminal(output: unknown, model = request.model) {
  return `data: ${JSON.stringify({ type: "response.completed", response: { id: "resp_synthetic", model, status: "completed", output } })}\n\n`;
}
it("uses private admitted subscription transport with fixed roles and strict namespaced assistant functions", async () => {
  const f = chatGptFixture();
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
    const f = chatGptFixture();
    try {
      await f.connected(); const call = syntheticAssistantResponse(turn).output[0]; assert.ok(call?.type === "function_call");
      const output = problem === "excessive-text" ? [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "x".repeat(25_000) }] }]
        : [{ ...call, ...(problem === "unknown-namespace" ? { namespace: "foreign" } : problem === "unknown-function" ? { name: "start" }
          : problem === "malformed-arguments" ? { arguments: "not JSON" } : { status: "incomplete" }) }];
      f.setSse(terminal(output)); await assert.rejects(f.service.inferAssistant(request));
    } finally { await f.cleanup(); }
  });
it("accepts direct namespaced calls and refuses omitted namespace, asynchronous, programmatic and unknown execution metadata", async () => {
  const f = chatGptFixture();
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
  const f = chatGptFixture(); try {
    await f.connected(); const valid = completedOcrStream("Synthetic explanation");
    for (const sse of [valid.replace('"role":"assistant"', '"role":"system"'), valid.replaceAll("gpt-6.1-sol", "unverified-model"),
      valid.replace('"delta":"Synthetic', '"delta":"conflictSynthetic'), 'data: {"type":"response.output_text.delta","delta":"partial"}\n\n']) {
      f.setSse(sse); await assert.rejects(f.service.inferAssistant(request));
    }
    await assert.rejects(f.service.inferAssistant(request, AbortSignal.abort()), { code: "CHATGPT_OCR_CANCELLED" });
  } finally { await f.cleanup(); }
});
it("preserves disabled, refresh, quota, token-bound auth and signout behavior", async () => {
  const f = chatGptFixture(); try {
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
  const f = chatGptFixture(); try {
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
  const f = chatGptFixture(); try {
    await f.connected(); const response = syntheticAssistantResponse(turn), call = response.output[0]; assert.ok(call?.type === "function_call");
    const reasoning = { type: "reasoning", id: "rs_synthetic", summary: [], encrypted_content: "synthetic-opaque-reasoning" };
    const sse = `data: ${JSON.stringify({ type: "response.function_call_arguments.delta", output_index: 1, delta: call.arguments.slice(0, 7) })}\n\n`
      + `data: ${JSON.stringify({ type: "response.function_call_arguments.delta", output_index: 1, delta: call.arguments.slice(7) })}\n\n` + terminal([reasoning, call]);
    f.setResponse(() => new Response(new ReadableStream<Uint8Array>({ start(controller) {
      const bytes = new TextEncoder().encode(sse); for (let i = 0; i < bytes.length; i += 13) controller.enqueue(bytes.slice(i, i + 13)); controller.close();
    } }), { headers: { "content-type": "text/event-stream" } }));
    assert.deepEqual((await f.service.inferAssistant(request)).output, [reasoning, call]);
    f.setResponse(() => new Response(sse.replace(JSON.stringify(call.arguments.slice(0, 7)), JSON.stringify("conflict")), { headers: { "content-type": "text/event-stream" } }));
    await assert.rejects(f.service.inferAssistant(request));
  } finally { await f.cleanup(); }
});
it("requires exact call-ID and namespace/name outputs in continuation and rejects parallel or duplicate calls", async () => {
  const f = chatGptFixture(); try {
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
  const f = chatGptFixture(); try {
    await f.connected(); f.setSse(`data: {"type":"response.output_text.delta","delta":"partial"}\n\ndata: ${JSON.stringify({ type: event, response: { error: null } })}\n\n`);
    await assert.rejects(f.service.inferAssistant(request));
  } finally { await f.cleanup(); }
});
it("keeps usage-limit events visible midstream and binds catalog order/visibility to the current selected account", async () => {
  const f = chatGptFixture(); try {
    await f.connected(); f.setModels({ models: [{ slug: "hidden", display_name: "Hidden", visibility: "hide" },
      { slug: "gpt-6.1-sol", display_name: "Current Sol", visibility: "list" }, { slug: "other", display_name: "Other", visibility: "list" }] });
    assert.deepEqual((await f.service.listAssistantModels()).catalog, { models: [{ slug: "gpt-6.1-sol", displayName: "Current Sol" }, { slug: "other", displayName: "Other" }] });
    f.setSse('data: {"type":"response.output_text.delta","delta":"partial"}\n\ndata: {"type":"error","code":"subscription_sharing_usage_limit_exceeded"}\n\n');
    await assert.rejects(f.service.inferAssistant(request), { code: "CHATGPT_USAGE_LIMIT" });
    const state = f.service.readAccount(); assert.equal(state.state, "connected"); if (state.state === "connected") assert.equal(state.planUsage, "limit-reached");
  } finally { await f.cleanup(); }
});
it("refuses a catalog that settles after signout and cancels held inference on account closure", async () => {
  const f = chatGptFixture(); let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  try {
    await f.connected(); f.setModelsHook(async () => { entered(); await held; return Response.json({ models: [{ slug: request.model, display_name: "Sol", visibility: "list" }] }); });
    const catalog = f.service.listAssistantModels().catch((error: unknown) => error);
    await started; await f.service.signOut(); release();
    assert.ok(await catalog instanceof Error);
    await f.connected();
    let responseEntered!: () => void;
    const responseStarted = new Promise<void>(resolve => { responseEntered = resolve; });
    f.setResponse(() => { responseEntered(); return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"partial"}\n\n')); } }), { headers: { "content-type": "text/event-stream" } }); });
    const inference = f.service.inferAssistant(request).catch((error: unknown) => error);
    await responseStarted; await f.service.close(); assert.ok(await inference instanceof Error);
  } finally { release(); await f.cleanup(); }
});

it("refreshes account-specific models after a fresh sign-in without a bundled catalog fallback", async () => {
  const f = chatGptFixture();
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
for (const catalog of [{ data: [] }, { models: [{ slug: "bad slug", display_name: "Invalid", visibility: "list" }] },
  { models: [{ slug: "duplicate", display_name: "One", visibility: "list" }, { slug: "duplicate", display_name: "Two", visibility: "list" }] }])
  it("refuses malformed or ambiguous current account catalogs", async () => {
    const f = chatGptFixture(); try { await f.connected(); f.setModels(catalog); await assert.rejects(f.service.listAssistantModels()); }
    finally { await f.cleanup(); }
  });


it("keeps catalog authority privately issued and refreshes before capturing its current view", async () => {
  const first = chatGptFixture(), second = chatGptFixture();
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

it('issues a finite private assistant policy only after the complete public function roundtrip and catalog', async () => {
  const f = chatGptFixture();
  try {
    await f.connected(); publicCapabilityResponses(f);
    assert.equal(f.service.captureAssistantModelPolicy(), undefined);
    await f.service.verifyAssistantCapability(capabilityPreference, () => true);
    const captured = f.service.captureAssistantModelPolicy(); assert.ok(captured);
    assert.equal(captured.policy.model, capabilityPreference.slug); assert.equal(captured.policy.effort, capabilityPreference.effort);
    assert.equal(captured.isCurrent(), true);
    assert.equal(Date.parse(captured.policy.verifiedUntil) - f.clock.nowMs(), 15 * 60_000);
    const responses = f.calls.filter(call => call.url.endsWith('/responses'));
    assert.equal(responses.length, 2);
    for (const call of responses) {
      assert.ok(typeof call.init.body === 'string');
      const wire = z.object({ store: z.literal(false), stream: z.literal(true), parallel_tool_calls: z.literal(false),
        tools: z.array(z.object({ type: z.literal('namespace'), name: z.literal('relay_capability'), tools: z.array(z.object({ name: z.literal('echo'), strict: z.literal(true) })).length(1) })).length(1),
        reasoning: z.object({ effort: z.literal(capabilityPreference.effort) }) }).parse(JSON.parse(call.init.body));
      assert.equal(wire.tools[0]?.tools.length, 1);
    }
    assert.equal(f.calls.filter(call => call.url.endsWith('/models')).length, 1);
    f.clock.advanceWall(15 * 60_000);
    assert.equal(captured.isCurrent(), false); assert.equal(f.service.captureAssistantModelPolicy(), undefined);
  } finally { await f.cleanup(); }
});
it('ordinary inference and catalog reads cannot issue an assistant capability policy', async () => {
  const f = chatGptFixture();
  try {
    await f.connected(); f.setSse(completedOcrStream('Public response', request.model));
    await f.service.inferAssistant(request); await f.service.listAssistantModels();
    assert.equal(f.service.captureAssistantModelPolicy(), undefined);
  } finally { await f.cleanup(); }
});
it('refuses capability verification without plan consent before any response request', async () => {
  const f = chatGptFixture();
  try {
    await f.connected(false); publicCapabilityResponses(f);
    await assert.rejects(f.service.verifyAssistantCapability(capabilityPreference, () => true));
    assert.equal(f.calls.filter(call => call.url.endsWith('/responses')).length, 0);
    assert.equal(f.service.captureAssistantModelPolicy(), undefined);
  } finally { await f.cleanup(); }
});
it('a completed function turn with different public arguments cannot activate the assistant', async () => {
  const f = chatGptFixture();
  try {
    await f.connected(); publicCapabilityResponses(f, 'foreign-public-value');
    await assert.rejects(f.service.verifyAssistantCapability(capabilityPreference, () => true), { code: 'CHATGPT_ASSISTANT_REFUSED' });
    assert.equal(f.calls.filter(call => call.url.endsWith('/responses')).length, 1);
    assert.equal(f.calls.filter(call => call.url.endsWith('/models')).length, 0);
    assert.equal(f.service.captureAssistantModelPolicy(), undefined);
  } finally { await f.cleanup(); }
});
it('a no-function completed message cannot replace the required capability roundtrip', async () => {
  const f = chatGptFixture();
  try {
    await f.connected(); f.setSse(completedOcrStream('Public response', request.model));
    await assert.rejects(f.service.verifyAssistantCapability(capabilityPreference, () => true), { code: 'CHATGPT_ASSISTANT_REFUSED' });
    assert.equal(f.calls.filter(call => call.url.endsWith('/responses')).length, 1);
    assert.equal(f.service.captureAssistantModelPolicy(), undefined);
  } finally { await f.cleanup(); }
});
it('a model absent from the fresh catalog cannot issue a capability policy', async () => {
  const f = chatGptFixture();
  try {
    await f.connected(); publicCapabilityResponses(f); f.setModels({ models: [] });
    await assert.rejects(f.service.verifyAssistantCapability(capabilityPreference, () => true), { code: 'CHATGPT_ASSISTANT_REFUSED' });
    assert.equal(f.calls.filter(call => call.url.endsWith('/responses')).length, 2);
    assert.equal(f.service.captureAssistantModelPolicy(), undefined);
  } finally { await f.cleanup(); }
});
it('invalidates the private capability when the captured profile or preference changes', async () => {
  const f = chatGptFixture(); let revision = 0;
  const assertCurrent = (): true => { assert.equal(revision, 0); return true; };
  try {
    await f.connected(); publicCapabilityResponses(f);
    await f.service.verifyAssistantCapability(capabilityPreference, assertCurrent);
    const captured = f.service.captureAssistantModelPolicy(); assert.ok(captured);
    revision++;
    assert.throws(() => captured.isCurrent()); assert.throws(() => f.service.captureAssistantModelPolicy());
  } finally { await f.cleanup(); }
});
it('does not issue capability after a profile or preference change during the catalog await', async () => {
  const f = chatGptFixture(); let revision = 0, release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  try {
    await f.connected(); publicCapabilityResponses(f);
    f.setModelsHook(async () => { entered(); await held; return Response.json({ models: [{ slug: capabilityPreference.slug, display_name: 'Public model', visibility: 'public' }] }); });
    const verifying = f.service.verifyAssistantCapability(capabilityPreference, () => { assert.equal(revision, 0); return true; });
    const refused = assert.rejects(verifying);
    await started; revision++; release(); await refused;
    assert.equal(f.service.captureAssistantModelPolicy(), undefined);
  } finally { release(); await f.cleanup(); }
});

it('retains capability across its own initial refresh and usage publication', async () => {
  const f = chatGptFixture();
  try {
    await f.connected(); const state = f.service.readAccount(); assert.equal(state.state, 'connected');
    if (state.state !== 'connected') throw new Error('public-fixture-account-unavailable');
    f.clock.advanceWall(Date.parse(state.expiresAt) - f.clock.nowMs() - 500);
    publicCapabilityResponses(f);
    await f.service.verifyAssistantCapability(capabilityPreference, () => true);
    assert.equal(f.service.captureAssistantModelPolicy()?.isCurrent(), true);
    assert.equal(f.calls.filter(call => call.url.endsWith('/oauth/token')).length, 2);
  } finally { await f.cleanup(); }
});
it('revokes capability for a peer credential revision even when token values stay the same', async () => {
  const f = chatGptFixture();
  try {
    await f.connected(); publicCapabilityResponses(f);
    await f.service.verifyAssistantCapability(capabilityPreference, () => true);
    const captured = f.service.captureAssistantModelPolicy(); assert.ok(captured);
    const peer = createChatGptCredentialRepository({ admission: f.admission, stateRoot: f.root });
    await peer.withLock(async transaction => {
      const record = transaction.read(); assert.ok(record?.session);
      transaction.replace({ ...record, revision: record.revision + 1 }, record.revision);
    });
    assert.equal(captured.isCurrent(), false); assert.equal(f.service.captureAssistantModelPolicy(), undefined);
  } finally { await f.cleanup(); }
});
it('aborts explicit capability verification before any response when already cancelled', async () => {
  const f = chatGptFixture();
  try {
    await f.connected(); publicCapabilityResponses(f);
    await assert.rejects(f.service.verifyAssistantCapability(capabilityPreference, () => true, AbortSignal.abort()));
    assert.equal(f.calls.filter(call => call.url.endsWith('/responses')).length, 0);
    assert.equal(f.service.captureAssistantModelPolicy(), undefined);
  } finally { await f.cleanup(); }
});
it('revokes a completed private capability at account sign-out', async () => {
  const f = chatGptFixture();
  try {
    await f.connected(); publicCapabilityResponses(f);
    await f.service.verifyAssistantCapability(capabilityPreference, () => true);
    const captured = f.service.captureAssistantModelPolicy(); assert.ok(captured);
    await f.service.signOut();
    assert.equal(captured.isCurrent(), false); assert.equal(f.service.captureAssistantModelPolicy(), undefined);
  } finally { await f.cleanup(); }
});
const retainedCapabilityFixtures = new Set<ReturnType<typeof chatGptFixture>>();
it('refuses capability issuance and another probe after response closure is unproved', async () => {
  const f = chatGptFixture(); retainedCapabilityFixtures.add(f);
  await f.connected();
  const primary = new Error('public-response-close-fault');
  let releaseAttempts = 0;
  let transportResponse: Response | undefined;
  f.setResponse(() => {
    const response = new Response(terminal([{ type: 'function_call', namespace: 'relay_capability', name: 'echo', call_id: 'public-close-call',
      arguments: JSON.stringify({ value: 'relay-public-capability' }) }], capabilityPreference.slug), { headers: { 'content-type': 'text/event-stream' } });
    assert.ok(response.body);
    const reader = response.body.getReader();
    Object.defineProperty(reader, 'releaseLock', { value: () => { releaseAttempts++; throw primary; } });
    Object.defineProperty(response.body, 'getReader', { value: () => reader });
    transportResponse = response;
    return response;
  });
  await assert.rejects(f.service.verifyAssistantCapability(capabilityPreference, () => true), (error: unknown) => {
    assert.ok(error instanceof Error);
    let cause: unknown = error.cause;
    for (let depth = 0; cause !== primary && depth < 16; depth++) {
      if (cause instanceof AggregateError) { assert.ok(cause.errors.length > 0); cause = cause.errors[0]; }
      else { assert.ok(cause instanceof Error); cause = cause.cause; }
    }
    assert.equal(cause, primary);
    assert.ok('code' in error); assert.equal(error.code, 'CHATGPT_RESOURCE_CLOSURE_UNPROVED');
    return true;
  });
  assert.equal(f.service.captureAssistantModelPolicy(), undefined);
  await assert.rejects(f.service.verifyAssistantCapability(capabilityPreference, () => true), { code: 'CHATGPT_RESOURCE_CLOSURE_UNPROVED' });
  assert.equal(f.calls.filter(call => call.url.endsWith('/responses')).length, 1);
  await assert.rejects(f.cleanup(), { code: 'CHATGPT_RESOURCE_CLOSURE_UNPROVED' });
  assert.equal(releaseAttempts, 1);
  assert.equal(transportResponse?.body?.locked, true);
});

it('revokes the private capability when its explicit verification is cancelled', async () => {
  const f = chatGptFixture(), abort = new AbortController();
  try {
    await f.connected(); publicCapabilityResponses(f);
    await f.service.verifyAssistantCapability(capabilityPreference, () => true, abort.signal);
    const captured = f.service.captureAssistantModelPolicy(); assert.ok(captured);
    abort.abort();
    assert.throws(() => captured.isCurrent(), { code: 'CHATGPT_ASSISTANT_REFUSED' });
    assert.throws(() => f.service.captureAssistantModelPolicy(), { code: 'CHATGPT_ASSISTANT_REFUSED' });
  } finally { await f.cleanup(); }
});

for (const kind of ['false', 'fulfilled-promise', 'rejected-promise'] as const) {
  it(`rejects a ${kind} trusted capability validator before any response request`, async () => {
    const f = chatGptFixture();
    try {
      await f.connected(); publicCapabilityResponses(f);
      const invalid = kind === 'false' ? () => false : kind === 'fulfilled-promise' ? () => Promise.resolve(true)
        : () => Promise.reject(new Error('public-invalid-capability-validator'));
      await assert.rejects(f.service.verifyAssistantCapability(capabilityPreference, invalid as unknown as () => true), { code: 'CHATGPT_ASSISTANT_REFUSED' });
      assert.equal(f.calls.filter(call => call.url.endsWith('/responses')).length, 0);
      assert.equal(f.service.captureAssistantModelPolicy(), undefined);
    } finally { await f.cleanup(); }
  });
}
it('rechecks exact synchronous success on a previously issued capability witness', async () => {
  const f = chatGptFixture(); let valid = true;
  try {
    await f.connected(); publicCapabilityResponses(f);
    await f.service.verifyAssistantCapability(capabilityPreference, (() => valid) as () => true);
    const captured = f.service.captureAssistantModelPolicy(); assert.ok(captured);
    valid = false;
    assert.throws(() => captured.isCurrent(), { code: 'CHATGPT_ASSISTANT_REFUSED' });
    assert.throws(() => f.service.captureAssistantModelPolicy(), { code: 'CHATGPT_ASSISTANT_REFUSED' });
  } finally { await f.cleanup(); }
});


it('prepares a catalog choice before verification without issuing assistant authority', async () => {
  const f = chatGptFixture();
  try {
    await f.connected();
    const authorityBefore = await f.service.readAuthority();
    assert.equal(authorityBefore.availability, 'available');
    assert.equal(f.service.revalidateAuthority(authorityBefore), true);
    const catalogBefore = await f.service.listAssistantModels();
    assert.deepEqual(catalogBefore.authority, authorityBefore);
    assert.equal(f.service.captureAssistantModelPolicy(), undefined);
    const before = f.calls.length;
    const current = await f.service.prepareAssistantModelPreference(capabilityPreference, () => true);
    assert.equal(current(), true);
    assert.equal(f.service.captureAssistantModelPolicy(), undefined);
    assert.equal(f.calls.slice(before).filter(call => call.url.endsWith('/responses')).length, 0);
    const authorityAfter = await f.service.readAuthority();
    assert.equal(authorityAfter.revision, authorityBefore.revision);
    assert.equal(authorityAfter.attemptGeneration, authorityBefore.attemptGeneration);
    assert.equal(authorityAfter.availability, authorityBefore.availability);
    assert.equal(f.service.revalidateAuthority(authorityBefore), true);
    const catalogAfter = await f.service.listAssistantModels();
    assert.deepEqual(catalogAfter.catalog, catalogBefore.catalog);
    assert.deepEqual(catalogAfter.authority, authorityBefore);
    assert.equal(f.service.captureAssistantModelPolicy(), undefined);
    await f.connected(false);
    const noConsentCalls = f.calls.length;
    await assert.rejects(f.service.listAssistantModels(), { code: 'CHATGPT_PLAN_DISABLED' });
    assert.equal(f.calls.length, noConsentCalls);
  } finally { await f.cleanup(); }
});
it('refuses malformed selection authority before credentials or provider requests', async () => {
  const f = chatGptFixture();
  try {
    await f.connected(); const before = f.calls.length;
    for (const invalid of [() => false, () => Promise.resolve(true), () => Promise.reject(new Error('invalid authority'))]) {
      await assert.rejects(f.service.prepareAssistantModelPreference(capabilityPreference, invalid as unknown as () => true));
      assert.equal(f.calls.length, before);
    }
    assert.equal(f.service.captureAssistantModelPolicy(), undefined);
  } finally { await f.cleanup(); }
});
it('rechecks selection identity across catalog await and after preparation', async () => {
  const f = chatGptFixture(); let current = true;
  try {
    await f.connected();
    const assertCurrent = (): true => { assert.equal(current, true); return true; };
    f.setModelsHook(async () => { current = false; return Response.json({ models: [] }); });
    await assert.rejects(f.service.prepareAssistantModelPreference(capabilityPreference, assertCurrent));
    assert.equal(f.service.captureAssistantModelPolicy(), undefined);
  } finally { await f.cleanup(); }
});
it('invalidates a prepared selection after a same-token foreign credential revision', async () => {
  const f = chatGptFixture();
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
    assert.equal(f.service.captureAssistantModelPolicy(), undefined);
  } finally { await f.cleanup(); }
});
it('allows its own token refresh while preparing a choice but issues no witness', async () => {
  const f = chatGptFixture();
  try {
    await f.connected(); const state = f.service.readAccount(); assert.equal(state.state, "connected");
    if (state.state !== "connected") throw new Error('connected account required');
    f.clock.advanceWall(Date.parse(state.expiresAt) - f.clock.nowMs() - 100);
    const current = await f.service.prepareAssistantModelPreference(capabilityPreference, () => true);
    assert.equal(current(), true);
    assert.equal(f.service.captureAssistantModelPolicy(), undefined);
    assert.equal(f.calls.filter(call => call.url.endsWith('/oauth/token')).length, 2);
  } finally { await f.cleanup(); }
});

it('selection catalog access preserves explicit consent and model availability gates', async () => {
  const f = chatGptFixture();
  try {
    await f.connected(false); const before = f.calls.length;
    await assert.rejects(f.service.prepareAssistantModelPreference(capabilityPreference, () => true));
    assert.equal(f.calls.length, before);
    await f.connected(); f.setModels({ models: [] });
    await assert.rejects(f.service.prepareAssistantModelPreference(capabilityPreference, () => true));
    assert.equal(f.service.captureAssistantModelPolicy(), undefined);
    assert.equal(f.calls.filter(call => call.url.endsWith('/responses')).length, 0);
  } finally { await f.cleanup(); }
});

it('retains an unsettled catalog reader and prevents later selection or probe requests', async () => {
  const f = chatGptFixture(); retainedCapabilityFixtures.add(f);
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
  await assert.rejects(f.service.verifyAssistantCapability(capabilityPreference, () => true), { code: 'CHATGPT_RESOURCE_CLOSURE_UNPROVED' });
  assert.equal(f.calls.length, before); assert.equal(f.service.captureAssistantModelPolicy(), undefined);
  await assert.rejects(f.cleanup(), { code: 'CHATGPT_RESOURCE_CLOSURE_UNPROVED' });
  assert.equal(attempts, 1); assert.equal(retained?.body?.locked, true);
});
