import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "vitest";
import { z } from "zod";
import { createAssistantM1Service, type AssistantM1ServiceOptions } from "../../../src/backend/assistant/service.js";
import { ChatGptResourceClosureUnprovedError } from "../../../src/backend/accounts/chatgpt-account-service.js";
import { assistantPersonBinding, resolveAssistantReply } from "../../../src/backend/assistant/replies.js";
import { AssistantToolRefusal, referenceSchema, type AssistantReadTool } from "../../../src/backend/assistant/plugins/plugin.js";
import { sessionsPlugin } from "../../../src/backend/assistant/plugins/sessions/index.js";
import { assistantWorkflowFacts } from "../../../src/backend/assistant/plugins/workflows/facts.js";
import { DESCRIPTORS } from "../../../src/backend/app/registries/workflow-registry.js";
import { AssistantInferenceRequestSchema, AssistantM1MessagePayloadSchema, AssistantM1RespondEnvelopeSchema, AssistantReplyPartsSchema, AssistantReplySchema, type AssistantM1RespondEnvelope } from "../../../src/models/dashboard/assistant.js";
import { RunRecordSchema } from "../../../src/models/run/record.js";
import { PersonLookupCanonicalInput } from "../../../src/models/workflows/person-lookup/input.js";
import { parseCanonicalInputSnapshot } from "../../../src/models/workflow/canonical-input.js";
import { createDebugEventWriter } from "../../../src/backend/logs/debug-events.js";
import { chatGptFixture } from "../../support/helpers/chatgpt-account-fixtures.js";
import { completedResponseStream, partialTextStream } from "../../support/helpers/chatgpt-response-stream.js";
import { assistantM1HistoryFixture } from "../../support/helpers/assistant-m1-history-fixture.js";
import { debugTimelineFixture } from "../../support/helpers/backend/debug-timeline-fixture.js";
import { EXECUTOR_EID, personLookupQueuedRun } from "../../support/helpers/phase1f-executor-harness.js";
import { sessionAuthorizationFixture } from "../../support/helpers/assistant-session-claims.js";
import { typedProposalFixture } from "../../support/helpers/assistant-typed-proposals.js";
import { createAssistantReferenceTable } from "../../../src/backend/assistant/references.js";

const usage = { input_tokens: 4, output_tokens: 2, total_tokens: 6 };
const message = (text: string, tokens: unknown = usage) => completedResponseStream([{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text }] }], "gpt-6.1-sol", randomUUID(), tokens === null ? undefined : tokens);
const call = (name = "read_fixture", args: unknown = { query: "lookup" }) => completedResponseStream([{ type: "function_call", namespace: "relay", name, call_id: randomUUID(), arguments: JSON.stringify(args), status: "completed" }], "gpt-6.1-sol", randomUUID(), usage);
const Wire = AssistantInferenceRequestSchema.safeExtend({ store: z.literal(false), stream: z.literal(true), parallel_tool_calls: z.literal(false), include: z.tuple([z.literal("reasoning.encrypted_content")]) });
type Step = string | ((body: z.infer<typeof Wire>) => string);
async function world() {
  const account = await chatGptFixture(); await account.connected();
  const timestamp = account.clock.now().toISOString(), storage = assistantM1HistoryFixture({ now: timestamp, acceptedAt: timestamp, profileId: account.admission.profileBinding.profileId });
  const timeline = debugTimelineFixture(), writer = createDebugEventWriter({ repository: timeline.repository, clock: account.clock, build: "test", development: true, writeStderr() {} });
  account.service.setDebugEvents(writer);
  const script: Step[] = [], bodies: z.infer<typeof Wire>[] = [], tokens = new Set<string>();
  let current = true, profileId = storage.profileId(), personLabel = `Person ${EXECUTOR_EID}`, onPost: (() => void) | undefined, onBindings: (() => void) | undefined;
  let sessions: AssistantM1Sessions | undefined, sessionTools = false, typed = typedProposalFixture(storage, timestamp);
  let failLog: Error | undefined, usageAttempts = 0, tools = 0, facts = 0, catalogs = 0, refuseTool = false, historyFault: "read" | "write" | undefined;
  const history = { ...storage.history,
    repeat(...args: Parameters<typeof storage.history.repeat>) { if (historyFault === "read") throw new Error("PRIVATE_HISTORY_CANARY"); return storage.history.repeat(...args); },
    settle(...args: Parameters<typeof storage.history.settle>) { if (historyFault === "write") throw new Error("PRIVATE_HISTORY_CANARY"); return storage.history.settle(...args); } };
  let row = RunRecordSchema.parse(personLookupQueuedRun({ runId: randomUUID(), itemId: randomUUID() }));
  account.setModelsHook(async () => { catalogs++; return Response.json({ models: [{ slug: "gpt-6.1-sol", display_name: "Synthetic", visibility: "list" }] }); });
  account.setResponse(init => {
    onPost?.(); if (typeof init.body !== "string") throw new Error("scripted JSON body required");
    const body = Wire.parse(JSON.parse(init.body)); bodies.push(body);
    const step = script.shift(); if (step === undefined) throw new Error("unscripted response");
    return new Response(typeof step === "string" ? step : step(body), { headers: { "content-type": "text/event-stream" } });
  });
  const tool: AssistantReadTool = { kind: "read", tier: "read", name: "read_fixture", description: "Read the canonical synthetic Lookup row.", parameters: z.strictObject({ query: z.literal("lookup") }),
    output: z.strictObject({ person: referenceSchema("P") }), privacy: [{ path: "person", origin: "repository-authored" }],
    async invoke(_input, context) {
      tools++; if (refuseTool) throw new AssistantToolRefusal("ASSISTANT_READ_UNAVAILABLE");
      const token = context.references.issue("P", row.envelope.runId, personLabel, EXECUTOR_EID, row.version); tokens.add(token); return { person: token };
    } };
  const options: AssistantM1ServiceOptions = { account: account.service, proposals: { open: id => typed.owner.open(id), supersede: id => typed.owner.supersede(id), issue: (...args) => typed.owner.issue(...args), answer: (...args) => typed.owner.answer(...args) }, history: () => history, clock: account.clock, actorId: "local-operator",
    owner: () => ({ profileId, epoch: storage.epoch() }), assertComposition() { if (profileId !== storage.profileId()) throw new AssistantToolRefusal("ASSISTANT_CONTEXT_STALE"); },
    selectedModel: () => ({ preference: { slug: "gpt-6.1-sol", effort: "medium" }, assertCurrent() { if (!current) throw new Error("model changed"); } }),
    facts: () => { facts++; return assistantWorkflowFacts(DESCRIPTORS.filter(descriptor => descriptor.id === "person-lookup")); }, runReferenceLabel: () => "Lookup",
    tools: () => ({ plugins: [{ domain: "fixture", tools: [tool] }, typed.owner.plugin, ...(sessionTools ? [sessionsPlugin()] : [])], ...(sessions === undefined ? {} : { sessions }), bindings(table) { onBindings?.(); return [...tokens].map(token => assistantPersonBinding(table, token, row)); } }),
    debugEvents: { emit(event) { usageAttempts++; if (failLog !== undefined) throw failLog; writer.emit(event); } } };
  let service = createAssistantM1Service(options);
  const create = () => { const id = randomUUID(); assert.equal(service.history({ operation: "create", conversationId: id, title: "Chat" }).state, "saved"); return id; };
  const request = (id = create(), text = "Explain") => { const view = service.conversation(id); assert.ok(view); return { conversationId: id, expectedRevision: view.revision, messageId: randomUUID(), message: text }; };
  const send = (input = request(), signal = new AbortController().signal) => service.respond(input, signal);
  const usageEvents = () => timeline.records.flatMap(record => record.payload.kind === "debug" && record.payload.event.assistantUsage !== undefined ? [record.payload.event] : []);
  return { account, storage, script, bodies, tool, create, request, send, usageEvents, run: () => row, service: () => service,
    counts: () => ({ catalogs, posts: bodies.length, tools, facts, usageAttempts }), restart() { service = createAssistantM1Service(options); },
    typed: () => typed, restartOwner() { typed = typedProposalFixture(storage, timestamp); service = createAssistantM1Service(options); },
    onPost(hook: () => void) { onPost = hook; }, onBindings(hook: () => void) { onBindings = hook; },
    failHistory(operation: "read" | "write") { historyFault = operation; },
    changeModel() { current = false; }, offerSessions(owner?: AssistantM1Sessions) { sessionTools = true; sessions = owner; }, changeOwner() { profileId = randomUUID(); }, refuseTool() { refuseTool = true; },
    personLabel(value: string) { personLabel = value; },
    logFailure(error: Error) { failLog = error; }, changeRevision() { row = RunRecordSchema.parse({ ...row, version: row.version + 1 }); },
    foreignInput() { const value = parseCanonicalInputSnapshot(PersonLookupCanonicalInput, row.input.parsed);
      row = RunRecordSchema.parse({ ...row, input: { ...row.input, parsed: { ...row.input.parsed, value: { ...value, emplId: "10000001" } } } }); },
    async close() { storage.database.close(); await account.cleanup(); } };
}
type AssistantM1Sessions = NonNullable<ReturnType<AssistantM1ServiceOptions["tools"]>["sessions"]>;
function result(envelope: AssistantM1RespondEnvelope) { assert.equal(envelope.kind, "result"); if (envelope.kind !== "result") assert.fail(); return envelope.result; }
it("settles measured serial/deduplicated calls and canonical run-backed parts, then reads repeats without effects", async () => {
  const w = await world(); try {
    const input = w.request();
    w.script.push(call(), call(), body => {
      const output = body.input.at(-1); assert.ok(output && "type" in output && output.type === "function_call_output");
      const value = z.object({ person: z.string() }).parse(JSON.parse(output.output)); return message(`**literal** ${value.person}`);
    });
    const envelope = AssistantM1RespondEnvelopeSchema.parse(await w.send(input)), answer = result(envelope); assert.equal(answer.state, "answered"); if (answer.state !== "answered") assert.fail();
    assert.deepEqual(answer.reply.usage, { state: "measured", callCount: 3, inputTokens: 12, outputTokens: 6, totalTokens: 18 });
    assert.equal(answer.reply.parts[0]?.kind, "text"); assert.ok(JSON.stringify(answer.reply.parts).includes('"kind":"link"'));
    assert.deepEqual(w.counts(), { catalogs: 1, posts: 3, tools: 1, facts: 1, usageAttempts: 1 });
    const stored = w.service().conversation(input.conversationId); assert.ok(stored);
    assert.deepEqual(stored.messages[1]?.payload.parts, answer.reply.parts);
    assert.deepEqual(stored.messages[1]?.payload.recording, { kind: "reply", acceptedMessageId: input.messageId });
    assert.equal(stored.messages[0]?.payload.recording.kind, "accepted-turn");
    const before = w.counts(); w.restart();
    const repeat = await w.send(input); assert.equal(repeat.kind, "delivery");
    if (repeat.kind !== "delivery") assert.fail(); assert.equal(repeat.receipt.delivery, "answered"); assert.deepEqual(repeat.usage, answer.reply.usage);
    assert.deepEqual(w.counts(), before);
    for (const raw of [String(EXECUTOR_EID), "Person", "PRIVATE"]) assert.equal(JSON.stringify(w.usageEvents()).includes(raw), false);
    assert.equal(JSON.stringify(w.bodies).includes(String(EXECUTOR_EID)), false);
  } finally { await w.close(); }
});
for (const tokens of [null, { input_tokens: -1, output_tokens: 2, total_tokens: 1 }]) it("retains unavailable real provider usage without inventing zero", async () => {
  const w = await world(); try {
    w.script.push(message("Answer", tokens)); const answer = result(await w.send()); assert.equal(answer.state, "answered"); if (answer.state !== "answered") assert.fail();
    assert.equal(answer.reply.usage.state, "unavailable"); assert.equal(answer.reply.usage.callCount, 1); assert.equal(w.usageEvents().length, 1);
  } finally { await w.close(); }
});
it("counts a failed posted call as missing and preserves unknown delivery before signal classification", async () => {
  const w = await world(); try {
    const input = w.request(), controller = new AbortController(); w.onPost(() => controller.abort()); w.script.push(partialTextStream("incomplete"));
    const envelope = await w.send(input, controller.signal); assert.equal(envelope.kind, "delivery"); if (envelope.kind !== "delivery") assert.fail();
    assert.equal(envelope.receipt.delivery, "delivery-unknown"); assert.equal(envelope.usage.state, "unavailable");
    assert.equal(w.usageEvents()[0]?.assistantUsage?.callCount, 1);
    const before = w.counts(); assert.equal((await w.send(input)).kind, "delivery"); assert.deepEqual(w.counts(), before);
  } finally { await w.close(); }
});
it("returns a fresh settled effect-free read refusal with real metadata and only explicit new-message retry", async () => {
  const w = await world(); try {
    const input = w.request(); w.refuseTool(); w.script.push(call(), message("No data"));
    const refusal = result(await w.send(input)); assert.equal(refusal.state, "no-reply"); if (refusal.state !== "no-reply") assert.fail();
    assert.equal(refusal.reason, "ASSISTANT_READ_UNAVAILABLE"); assert.equal(refusal.canRetry, true); assert.ok(refusal.turn); assert.equal(refusal.turn.usage.callCount, 2);
    const before = w.counts(); assert.equal((await w.send(input)).kind, "delivery"); assert.deepEqual(w.counts(), before);
    const changed = result(await w.send({ ...input, message: "changed" })); assert.equal(changed.state, "no-reply"); if (changed.state !== "no-reply") assert.fail();
    assert.equal(changed.turn, null); assert.equal(changed.canRetry, false); assert.deepEqual(w.counts(), before);
  } finally { await w.close(); }
});
it("rejects miscomposed change tools before catalog/provider and records actual zero calls on accepted refusal", async () => {
  const w = await world(); try {
    Object.defineProperty(w.tool, "kind", { value: "change" });
    const refusal = result(await w.send()); assert.equal(refusal.state, "no-reply"); if (refusal.state !== "no-reply") assert.fail();
    assert.equal(refusal.canRetry, false); assert.deepEqual(refusal.turn?.usage, { state: "measured", callCount: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    assert.equal(w.counts().catalogs, 0); assert.equal(w.counts().posts, 0); assert.equal(w.counts().usageAttempts, 1);
  } finally { await w.close(); }
});
for (const fault of ["revision", "foreign", "unknown"] as const) it(`refuses ${fault} binding facts without guessing/downgrading a target`, async () => {
  const w = await world(); try {
    w.script.push(call(), body => {
      if (fault === "revision") w.changeRevision(); if (fault === "foreign") w.foreignInput();
      const output = body.input.at(-1); assert.ok(output && "type" in output && output.type === "function_call_output");
      const value = z.object({ person: z.string() }).parse(JSON.parse(output.output)); return message(fault === "unknown" ? "[[P99.g1]]" : value.person);
    });
    const refusal = result(await w.send()); assert.equal(refusal.state, "no-reply"); if (refusal.state !== "no-reply") assert.fail();
    assert.equal(refusal.canRetry, false); assert.ok(refusal.turn); assert.equal(refusal.turn.usage.callCount, 2);
  } finally { await w.close(); }
});
for (const fault of ["model", "owner", "epoch", "clear", "expiry"] as const) it(`holds ${fault} changes after provider dispatch without a retry right`, async () => {
  const w = await world(); try {
    const input = w.request(); w.onPost(() => {
      if (fault === "model") w.changeModel(); if (fault === "owner") w.changeOwner(); if (fault === "epoch") w.storage.changeEpoch();
      if (fault === "clear") w.service().history({ operation: "clear", conversationId: input.conversationId, expectedRevision: 2 });
      if (fault === "expiry") w.account.clock.advanceWall(31 * 24 * 60 * 60 * 1000);
    }); w.script.push(message("Late"));
    const envelope = await w.send(input); assert.equal(envelope.kind, "delivery"); if (envelope.kind !== "delivery") assert.fail();
    assert.equal(envelope.receipt.delivery, "delivery-unknown"); assert.equal(w.counts().usageAttempts, 1);
  } finally { await w.close(); }
});
it("records returned usage before a later source-currentness refusal", async () => {
  const w = await world(); try {
    w.onBindings(() => w.changeModel()); w.script.push(message("Answer"));
    const refusal = result(await w.send()); assert.equal(refusal.state, "no-reply"); if (refusal.state !== "no-reply") assert.fail();
    assert.equal(refusal.canRetry, false); assert.equal(w.usageEvents()[0]?.assistantUsage?.state, "measured"); assert.equal(w.usageEvents()[0]?.assistantUsage?.callCount, 1);
  } finally { await w.close(); }
});
for (const invalidation of ["model", "account", "signal"] as const) it(`refuses ${invalidation} invalidated after the final inner check and before outer answer settlement`, async () => {
  const w = await world(), controller = new AbortController();
  let retirement: Promise<void> | undefined, invalidated = false;
  try {
    const input = w.request();
    w.onBindings(() => queueMicrotask(() => queueMicrotask(() => {
      invalidated = true;
      if (invalidation === "model") w.changeModel();
      if (invalidation === "account") retirement = w.account.service.close();
      if (invalidation === "signal") controller.abort();
    })));
    w.script.push(message("Retired answer"));
    const envelope = AssistantM1RespondEnvelopeSchema.parse(await w.send(input, controller.signal));
    await retirement;
    assert.equal(invalidated, true);
    const refusal = result(envelope); assert.equal(refusal.state, "no-reply"); if (refusal.state !== "no-reply") assert.fail();
    assert.equal(refusal.reason, invalidation === "signal" ? "ASSISTANT_CANCELLED" : "ASSISTANT_MODEL_CHANGED");
    assert.deepEqual(refusal.turn?.usage, { state: "measured", callCount: 1, inputTokens: 4, outputTokens: 2, totalTokens: 6 });
    const stored = w.service().conversation(input.conversationId); assert.ok(stored);
    assert.equal(stored.messages.length, 1); assert.equal(stored.messages[0]?.delivery, "refused");
    assert.equal(w.counts().posts, 1); assert.equal(w.counts().usageAttempts, 1); assert.equal(w.usageEvents().length, 1);
    const before = w.counts(), repeat = await w.send(input);
    assert.equal(repeat.kind, "delivery"); if (repeat.kind !== "delivery") assert.fail(); assert.equal(repeat.receipt.delivery, "refused");
    assert.deepEqual(w.counts(), before);
  } finally { await retirement; await w.close(); }
});
it("refuses a complete reply above 80k before committing parts that fit the storage budget", async () => {
  const w = await world(); try {
    const input = w.request(); w.personLabel("x");
    w.script.push(call(), body => {
      const output = body.input.at(-1); assert.ok(output && "type" in output && output.type === "function_call_output");
      const { person } = z.strictObject({ person: z.string() }).parse(JSON.parse(output.output));
      return message(person.repeat(276));
    });
    w.onBindings(() => {
      const view = w.service().conversation(input.conversationId), recording = view?.messages[0]?.payload.recording;
      assert.equal(recording?.kind, "accepted-turn"); if (recording?.kind !== "accepted-turn") assert.fail();
      const table = createAssistantReferenceTable(recording.acceptedTurn.ordinal);
      const reference = table.issue("P", w.run().envelope.runId, "x", EXECUTOR_EID, w.run().version);
      const parts = resolveAssistantReply(reference.repeat(276), table, [assistantPersonBinding(table, reference, w.run())]);
      const stored = { parts, recording: { kind: "reply", acceptedMessageId: input.messageId } };
      const complete = { parts, acceptedTurn: recording.acceptedTurn, usage: { state: "measured", callCount: 2, inputTokens: 8, outputTokens: 4, totalTokens: 12 } };
      assert.ok(Buffer.byteLength(JSON.stringify(parts)) < 80_000); assert.ok(Buffer.byteLength(JSON.stringify(stored)) < 80_000);
      assert.ok(Buffer.byteLength(JSON.stringify(complete)) > 80_000);
      assert.equal(AssistantReplyPartsSchema.safeParse(parts).success, true); assert.equal(AssistantM1MessagePayloadSchema.safeParse(stored).success, true);
      assert.equal(AssistantReplySchema.safeParse(complete).success, false);
    });
    const refusal = result(AssistantM1RespondEnvelopeSchema.parse(await w.send(input)));
    assert.equal(refusal.state, "no-reply"); if (refusal.state !== "no-reply") assert.fail();
    assert.equal(refusal.reason, "ASSISTANT_LIMIT"); assert.equal(refusal.canRetry, false);
    assert.deepEqual(refusal.turn?.usage, { state: "measured", callCount: 2, inputTokens: 8, outputTokens: 4, totalTokens: 12 });
    const stored = w.service().conversation(input.conversationId); assert.ok(stored);
    assert.equal(stored.messages.length, 1); assert.equal(stored.messages[0]?.delivery, "refused");
    assert.equal(w.counts().posts, 2); assert.equal(w.counts().usageAttempts, 1); assert.equal(w.usageEvents().length, 1);
  } finally { await w.close(); }
});
for (const closure of [false, true]) it("preserves a known stored answer while explicitly reporting logger failure", async () => {
  const w = await world(); try {
    w.logFailure(closure ? new ChatGptResourceClosureUnprovedError(new Error("PRIVATE_LOG_CANARY")) : new Error("PRIVATE_LOG_CANARY")); w.script.push(message("Answer"));
    const envelope = await w.send(); assert.equal(result(envelope).state, "answered");
    assert.deepEqual(envelope.diagnostic, { code: closure ? "CHATGPT_RESOURCE_CLOSURE_UNPROVED" : "ASSISTANT_USAGE_LOG_UNAVAILABLE" });
    assert.equal(JSON.stringify(envelope).includes("PRIVATE_LOG_CANARY"), false); assert.equal(w.counts().usageAttempts, 1);
  } finally { await w.close(); }
});

it("returns stored pending accounting before selected-model, facts or provider work", async () => {
  const w = await world(); try {
    const input = w.request(), timestamp = w.account.clock.now().toISOString();
    w.storage.history.accept({ conversationId: input.conversationId, messageId: input.messageId, expectedRevision: input.expectedRevision,
      text: input.message, modelText: input.message, subjectRef: null, attachments: [], proposalAnswer: null, now: timestamp });
    w.changeModel(); w.restart();
    const before = w.counts(), envelope = await w.send(input);
    assert.equal(envelope.kind, "delivery"); if (envelope.kind !== "delivery") assert.fail();
    assert.equal(envelope.receipt.delivery, "sending"); assert.deepEqual(envelope.usage, { state: "pending" });
    assert.deepEqual(w.counts(), before);
  } finally { await w.close(); }
});
for (const operation of ["read", "write"] as const) it(`keeps ${operation} failure explicit without guessing stored delivery or retry`, async () => {
  const w = await world(); try {
    const input = w.request(); w.onBindings(() => w.failHistory(operation)); w.script.push(message("Answer"));
    const envelope = AssistantM1RespondEnvelopeSchema.parse(await w.send(input));
    assert.equal(envelope.kind, "delivery"); if (envelope.kind !== "delivery") assert.fail();
    assert.equal(envelope.receipt.delivery, "delivery-unknown"); assert.equal(envelope.history.state, "unavailable");
    assert.equal(envelope.receipt.revision, operation === "read" ? 3 : 2);
    assert.equal(w.counts().usageAttempts, 1); assert.equal(JSON.stringify(envelope).includes("PRIVATE_HISTORY_CANARY"), false);
    assert.equal(w.storage.history.conversation(input.conversationId, w.account.clock.now().toISOString())?.messages[0]?.delivery, operation === "read" ? "answered" : "sending");
  } finally { await w.close(); }
});
it("settles a quota refusal with actual usage after atomically rolling back an undeliverable reply", async () => {
  const w = await world(); try {
    const timestamp = w.account.clock.now().toISOString(), a = randomUUID(), b = randomUUID();
    const base = { operation: "import" as const, draft: "", composer: "", notice: null };
    const rows = (count: number) => Array.from({ length: count }, () => ({ messageId: randomUUID(), role: "assistant" as const, text: "x".repeat(8000) }));
    w.storage.history.apply({ ...base, conversationId: a, title: "A", total: 200, start: 1, messages: rows(200) }, timestamp);
    w.storage.history.apply({ ...base, conversationId: b, title: "B", total: 49, start: 1, messages: rows(49) }, timestamp);
    w.storage.history.apply({ operation: "draft", conversationId: b, draft: "x".repeat(4000), composer: "x".repeat(3997) }, timestamp);
    const input = w.request(b, "x"); w.script.push(message("x"));
    const refusal = result(await w.send(input)); assert.equal(refusal.state, "no-reply"); if (refusal.state !== "no-reply") assert.fail();
    assert.equal(refusal.reason, "ASSISTANT_HISTORY_FULL"); assert.equal(refusal.canRetry, false); assert.equal(refusal.turn?.usage.callCount, 1);
    const stored = w.service().conversation(b); assert.ok(stored);
    assert.equal(stored.messages.length, 50); assert.equal(stored.messages.at(-1)?.delivery, "refused"); assert.equal(w.counts().usageAttempts, 1);
  } finally { await w.close(); }
});

it("starts a session under the accepted turn in ask mode and appends its server-authored session part", async () => {
  const w = await world(); try {
    const input = w.request(), starts: Parameters<AssistantM1Sessions["start"]>[] = [];
    w.offerSessions({ async start(...args) { starts.push(args); return [w.run()]; } });
    w.script.push(call("start_session", { workflow: "person-lookup", entries: [String(EXECUTOR_EID)] }), call("start_session", { workflow: "person-lookup", entries: [String(EXECUTOR_EID)] }), message("Started"));
    const answer = result(await w.send(input)); assert.equal(answer.state, "answered"); if (answer.state !== "answered") assert.fail();
    assert.equal(starts.length, 1);
    const [accepted, request, mode] = starts[0] ?? assert.fail();
    assert.equal(accepted.messageId, input.messageId); assert.deepEqual(request, { workflowId: "person-lookup", entries: [String(EXECUTOR_EID)] }); assert.equal(mode, "ask");
    const session = answer.reply.parts.at(-1); assert.ok(session?.kind === "session");
    assert.equal(session.runId, w.run().envelope.runId); assert.equal(session.meta, "queued");
    assert.equal(JSON.stringify(w.bodies).includes(w.run().envelope.runId), false);
  } finally { await w.close(); }
});
it("offers no retry after a session start was attempted and refuses session tools without their owner before the provider", async () => {
  const w = await world(); try {
    w.offerSessions({ start() { return Promise.reject(new AssistantToolRefusal("ASSISTANT_READ_UNAVAILABLE")); } });
    w.script.push(call("start_session", { workflow: "person-lookup", entries: [String(EXECUTOR_EID)] }), message("No"));
    const refusal = result(await w.send()); assert.equal(refusal.state, "no-reply"); if (refusal.state !== "no-reply") assert.fail();
    assert.equal(refusal.reason, "ASSISTANT_READ_UNAVAILABLE"); assert.equal(refusal.canRetry, false);
    w.offerSessions(); const posts = w.counts().posts;
    const unowned = result(await w.send()); assert.equal(unowned.state, "no-reply"); if (unowned.state !== "no-reply") assert.fail();
    assert.equal(unowned.reason, "ASSISTANT_UNAVAILABLE"); assert.equal(w.counts().posts, posts);
  } finally { await w.close(); }
});

for (const [mode, allowed] of [["full-access", true], ["ask", true], ["full-access", false]] as const)
  it(`passes the composer's ${mode} pick to the real session owner (Full access ${allowed ? "on" : "off"})`, async () => {
    const w = await world(); try {
      const owner = sessionAuthorizationFixture({ fullAccess: allowed, at: w.account.clock.now().toISOString(), current: () => ({ profileId: w.storage.profileId(), epoch: w.storage.epoch() }) });
      w.offerSessions(owner.authorization);
      w.script.push(call("start_session", { workflow: "separations", entries: ["4502"] }), message("Done"));
      const envelope = await w.service().respond({ ...w.request(), approvalMode: mode }, new AbortController().signal);
      if (mode === "full-access" && allowed) {
        const answer = result(envelope); assert.equal(answer.state, "answered"); if (answer.state !== "answered") assert.fail();
        assert.equal(owner.submitted.length, 1); assert.equal(owner.plans[0]?.dryRun, true); assert.equal(owner.claims.all()[0]?.claim.approvalMode, "full-access");
        assert.equal(answer.reply.parts.at(-1)?.kind, "session");
      } else assert.equal(owner.plans.length + owner.claims.all().length + owner.submitted.length, 0);
    } finally { await w.close(); }
  });
it("keeps a session command from its effect once the turn's model changes during submit", async () => {
  const w = await world(); try {
    const owner = sessionAuthorizationFixture({ at: w.account.clock.now().toISOString(), current: () => ({ profileId: w.storage.profileId(), epoch: w.storage.epoch() }),
      beforeEffect: () => { w.changeModel(); return Promise.resolve(); } });
    w.offerSessions(owner.authorization);
    w.script.push(call("start_session", { workflow: "person-lookup", entries: [String(EXECUTOR_EID)] }), message("Started"));
    const refusal = result(await w.send()); assert.equal(refusal.state, "no-reply"); if (refusal.state !== "no-reply") assert.fail();
    assert.equal(refusal.canRetry, false); assert.equal(owner.submitted.length, 0); assert.equal(owner.claims.all()[0]?.outcome.state, "unknown");
  } finally { await w.close(); }
});

const propose = (w: Awaited<ReturnType<typeof world>>, chat = w.create()) => {
  const input = w.request(chat, "Look these up");
  w.script.push(call("propose_workflow_start", { workflow: "person-lookup", entries: ["10000001", "10000002"], dryRun: false }), body => {
    const output = body.input.at(-1); assert.ok(output && "type" in output && output.type === "function_call_output");
    assert.deepEqual(JSON.parse(output.output), { status: "awaiting-yes", count: 2 }); return message("Ready");
  });
  return { chat, input, sent: w.send(input) };
};
const answered = (envelope: AssistantM1RespondEnvelope) => { const r = result(envelope); assert.equal(r.state, "answered"); if (r.state !== "answered") assert.fail(); return r.reply; };
const yesIn = (w: Awaited<ReturnType<typeof world>>, chat: ReturnType<typeof randomUUID>, text = "yes") => w.request(chat, text);

it("replies with the proposal parts and leaves the chat's proposal open, returning only the awaiting-yes output to the model", async () => {
  const w = await world(); try {
    const { chat, sent } = propose(w), reply = answered(await sent), open = w.typed().owner.open(chat);
    assert.ok(open); assert.equal(w.counts().posts, 2);
    const kinds = reply.parts.map(part => part.kind); assert.ok(kinds.includes("bullets"));
    const json = JSON.stringify(reply.parts); assert.ok(json.includes('"kind":"bold"')); assert.ok(json.includes("Reply yes to go ahead.")); assert.equal(open.snapshot.rows.length, 2);
    assert.equal(w.typed().submitted.length, 0);
  } finally { await w.close(); }
});

it("answers a typed yes with Relay's own run parts, two commands and no provider call", async () => {
  const w = await world(); try {
    const { chat, sent } = propose(w); await sent; const posts = w.counts().posts;
    const reply = answered(await w.send(yesIn(w, chat)));
    assert.equal(reply.parts[0]?.kind, "answered"); assert.equal(reply.parts.filter(part => part.kind === "session").length, 2);
    assert.equal(w.typed().submitted.length, 2); assert.equal(w.counts().posts, posts);
    assert.equal(w.typed().owner.open(chat), undefined);
  } finally { await w.close(); }
});

it("sends a changed answer to the model and supersedes the proposal so a later yes dispatches nothing", async () => {
  const w = await world(); try {
    const { chat, sent } = propose(w); await sent; const posts = w.counts().posts;
    w.script.push(message("Dry run it is"));
    answered(await w.send(yesIn(w, chat, "yes, but make it a dry run")));
    assert.equal(w.counts().posts, posts + 1); assert.equal(w.typed().owner.open(chat), undefined);
    w.script.push(message("Nothing pending"));
    answered(await w.send(yesIn(w, chat))); assert.equal(w.counts().posts, posts + 2); assert.equal(w.typed().submitted.length, 0);
  } finally { await w.close(); }
});

it("does not dispatch again for a replayed yes, before or after a restart, or for a yes in another chat", async () => {
  const w = await world(); try {
    const { chat, sent } = propose(w); await sent;
    const other = w.create(); w.script.push(message("No proposal here"));
    answered(await w.send(yesIn(w, other))); assert.equal(w.typed().submitted.length, 0); assert.ok(w.typed().owner.open(chat));
    const yes = yesIn(w, chat); answered(await w.send(yes)); assert.equal(w.typed().submitted.length, 2);
    const posts = w.counts().posts; assert.equal((await w.send(yes)).kind, "delivery"); w.restart(); assert.equal((await w.send(yes)).kind, "delivery");
    assert.equal(w.typed().submitted.length, 2); assert.equal(w.counts().posts, posts);
  } finally { await w.close(); }
});

it("does not answer a yes once another message follows the rendered proposal", async () => {
  const w = await world(); try {
    const { chat, sent } = propose(w); await sent;
    const side = w.storage.history.accept({ ...w.storage.input(chat, "Side note"), proposalAnswer: null }); assert.ok(side.state === "accepted");
    assert.ok(w.storage.history.settle(side, { delivery: "answered", usage: { state: "measured", callCount: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      reply: { id: randomUUID(), kind: "answer", parts: [{ kind: "text", runs: [{ kind: "plain", text: "Noted" }] }], modelText: "Noted" } }, w.account.clock.now().toISOString()));
    w.script.push(message("Model handled it")); const posts = w.counts().posts;
    answered(await w.send(yesIn(w, chat)));
    assert.equal(w.counts().posts, posts + 1); assert.equal(w.typed().submitted.length, 0); assert.equal(w.typed().owner.open(chat), undefined);
  } finally { await w.close(); }
});

it("after a restart over the same storage answers the still-open proposal at most once", async () => {
  const w = await world(); try {
    const { chat, sent } = propose(w); await sent;
    w.restartOwner();
    assert.ok(w.typed().owner.open(chat));
    const yes = yesIn(w, chat), reply = answered(await w.send(yes));
    assert.equal(reply.parts[0]?.kind, "answered"); assert.equal(w.typed().submitted.length, 2); assert.equal(w.typed().owner.open(chat), undefined);
    w.restartOwner(); assert.equal((await w.send(yes)).kind, "delivery"); assert.equal(w.typed().submitted.length, 0);
    w.script.push(message("Nothing pending")); answered(await w.send(yesIn(w, chat))); assert.equal(w.typed().submitted.length, 0);
  } finally { await w.close(); }
});
