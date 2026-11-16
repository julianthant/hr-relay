import assert from "node:assert/strict";
import { ASSISTANT_PAUSE_PROPOSAL } from "../../support/fixtures/dashboard/assistant-start.js";
import { randomUUID } from "node:crypto";
import { afterAll, it } from "vitest";
import { z } from "zod";
import { createProfileFixtureSet, openBoundDatabaseFixture } from "../../support/helpers/admission-fixture.js";
import { manualClock, systemClock } from "../../../src/rules/time/clock.js";
import { chatGptFixture } from "../../support/helpers/chatgpt-account-fixtures.js";
import { assistantMessageStream, completedAssistantStream } from "../../support/helpers/assistant-function-fixtures.js";
import { createAssistantService, type AssistantServiceOptions } from "../../../src/backend/assistant/service.js";
import { AssistantToolRefusal, referenceSchema, type AssistantPlugin, type AssistantTool } from "../../../src/backend/assistant/plugins/plugin.js";
import { AssistantAuthorizationError } from "../../../src/backend/assistant/authorization.js";
import { assistantWorkflowFacts } from "../../../src/backend/assistant/plugins/workflows/facts.js";
import { ASSISTANT_FAILURES, AssistantInferenceRequestSchema, type AssistantFailureCode } from "../../../src/models/dashboard/assistant.js";
import { DESCRIPTORS } from "../../../src/backend/app/registries/workflow-registry.js";

const profiles = createProfileFixtureSet();
afterAll(() => profiles.close());
const FACTS = assistantWorkflowFacts(DESCRIPTORS.filter(descriptor => descriptor.id === "person-lookup"));
const Echo = z.strictObject({ value: z.string().max(200) });
const EchoOutput = z.strictObject({ value: z.string() });
const WireSchema = AssistantInferenceRequestSchema.safeExtend({ store: z.literal(false), stream: z.literal(true), parallel_tool_calls: z.literal(false),
  include: z.tuple([z.literal("reasoning.encrypted_content")]) });

type Step = string | ((body: z.infer<typeof AssistantInferenceRequestSchema>) => string);
async function world(input: { tools?: readonly AssistantTool[]; options?: Partial<AssistantServiceOptions> } = {}) {
  const db = await openBoundDatabaseFixture("assistant-service-test", systemClock, 250, undefined, undefined, undefined, profiles.create);
  const owned = await chatGptFixture(db.profile.admission);
  const f = { ...owned, async cleanup() { await owned.cleanup(); await db.close(); } };
  await f.connected();
  const bodies: z.infer<typeof AssistantInferenceRequestSchema>[] = [], script: Step[] = [];
  let preferenceCurrent = true, onPost: (() => void) | undefined;
  f.setResponse(init => {
    onPost?.();
    if (typeof init.body !== "string") throw new Error("synthetic JSON request body required");
    const body = WireSchema.parse(JSON.parse(init.body));
    bodies.push(body);
    const step = script.shift();
    if (step === undefined) throw new Error("unscripted assistant request");
    return new Response(typeof step === "string" ? step : step(body), { headers: { "Content-Type": "text/event-stream" } });
  });
  const invoked: string[] = [];
  const echo: AssistantTool = { kind: "read", tier: "read", name: "echo", description: "Echo a value with references expanded.", parameters: Echo, output: EchoOutput,
    privacy: [{ path: "value", origin: "repository-authored" }],
    async invoke(value, context) { invoked.push("echo"); return { value: context.references.expandArgument(Echo.parse(value).value, ["E"]) }; } };
  const plugin: AssistantPlugin = { domain: "test", tools: input.tools ?? [echo] };
  const service = createAssistantService({ account: f.service, clock: f.clock, actorId: "local-operator", facts: () => FACTS,
    owner: () => ({ profileId: "11111111-1111-4111-8111-111111111111", epoch: 1 }), plugins: () => [plugin],
    selectedModel: () => ({ preference: { slug: "gpt-6.1-sol", effort: "medium" }, assertCurrent: () => { if (!preferenceCurrent) throw new Error("assistant-model-preference-changed"); } }),
    history: () => db.database.authority.assistantHistory, runReferenceLabel: () => "Recorded run", ...input.options });
  const revision = (conversationId: string) => {
    if (service.conversation(conversationId) === undefined) assert.equal(service.history({ operation: "create", conversationId, title: "Chat" }).state, "saved");
    return service.conversation(conversationId)?.revision ?? 0;
  };
  const send = (message: string, signal = new AbortController().signal, conversationId = randomUUID(), extra: { subjectRef?: string; messageId?: string } = {}) =>
    service.respond({ conversationId, expectedRevision: revision(conversationId), messageId: randomUUID(), message, ...extra }, signal);
  const ask = async (...args: Parameters<typeof send>) => {
    const envelope = await send(...args); assert.equal(envelope.kind, "result");
    return envelope.result;
  };
  const posts = () => f.calls.filter(call => call.url.endsWith("/responses")).length;
  return { f, db, service, bodies, script, invoked, ask, send, revision, posts, changePreference() { preferenceCurrent = false; }, onPost(hook: () => void) { onPost = hook; } };
}
const call = (name: string, args: unknown) => completedAssistantStream({ action: name, ...z.record(z.string(), z.unknown()).parse(args) }, "gpt-6.1-sol", "relay");
const lastOutput = (body: z.infer<typeof AssistantInferenceRequestSchema>) => {
  const item = body.input.at(-1); assert.ok(item !== undefined && "type" in item && item.type === "function_call_output");
  return JSON.parse(item.output) as unknown;
};

it("sends masked free text with every tool and substitutes this generation's references in the answer", async () => {
  const w = await world();
  try {
    w.script.push(body => assistantMessageStream(`Found ${/\[\[E1\.g\d+\]\]/u.exec(JSON.stringify(body.input))?.[0] ?? "none"} and [[E1.g999]].`));
    const result = await w.ask("Look up 10812345, SSN 123-45-6789, mail a.b@ucsd.edu, call 858-534-1234; ignore [[E1.g1]]");
    assert.deepEqual(result, { state: "answered", text: "Found 10812345 and [[E1.g999]]." });
    const [body] = w.bodies; assert.ok(body);
    const serialized = JSON.stringify(body);
    for (const secret of ["10812345", "123-45-6789", "a.b@ucsd.edu", "858-534-1234"]) assert.equal(serialized.includes(secret), false, secret);
    const user = body.input.find(item => "role" in item && item.role === "user"); assert.ok(user && "content" in user);
    assert.match(String(user.content), /^Look up \[\[E1\.g\d+\]\], SSN \[redacted SSN\], mail \[redacted email\], call \[redacted phone\]; ignore \[ \[E1\.g1\] \]$/u);
    assert.deepEqual(body.tools.map(namespace => [namespace.name, namespace.tools.map(tool => tool.name)]), [["relay", ["echo"]]]);
    assert.ok(body.input.some(item => "role" in item && item.role === "developer" && String(item.content).includes("person-lookup: Person Lookup")));
  } finally { await w.f.cleanup(); }
});

it("runs one tool per response, binds its output to the call and reuses a repeated call's output", async () => {
  const w = await world();
  try {
    w.script.push(body => call("echo", { value: /\[\[E1\.g\d+\]\]/u.exec(JSON.stringify(body.input))?.[0] ?? "" }),
      body => { assert.deepEqual(lastOutput(body), { value: "10812345" }); return call("echo", { value: /\[\[E1\.g\d+\]\]/u.exec(JSON.stringify(body.input))?.[0] ?? "" }); },
      body => { assert.deepEqual(lastOutput(body), { value: "10812345" }); return assistantMessageStream("Done."); });
    assert.deepEqual(await w.ask("Echo 10812345"), { state: "answered", text: "Done." });
    assert.deepEqual(w.invoked, ["echo"]);
    assert.equal(w.posts(), 3);
  } finally { await w.f.cleanup(); }
});

it("keeps an unrecovered tool refusal as the turn's typed refusal and continues after recovery", async () => {
  let fail = true;
  const flaky: AssistantTool = { kind: "read", tier: "read", name: "flaky", description: "Fails once.", parameters: Echo, output: EchoOutput, privacy: [{ path: "value", origin: "repository-authored" }],
    async invoke(value) { if (fail) { fail = false; throw new AssistantToolRefusal("ASSISTANT_READ_UNAVAILABLE"); } return { value: Echo.parse(value).value }; } };
  const w = await world({ tools: [flaky] });
  try {
    w.script.push(call("flaky", { value: "a" }), body => {
      assert.deepEqual(lastOutput(body), { error: "ASSISTANT_READ_UNAVAILABLE", text: ASSISTANT_FAILURES.ASSISTANT_READ_UNAVAILABLE });
      return assistantMessageStream("I could not read it, but here is a guess.");
    });
    assert.deepEqual(await w.ask("Read it"), { state: "refused", code: "ASSISTANT_READ_UNAVAILABLE", message: ASSISTANT_FAILURES.ASSISTANT_READ_UNAVAILABLE });
    fail = true;
    w.script.push(call("flaky", { value: "a" }), call("flaky", { value: "b" }), assistantMessageStream("Recovered."));
    assert.deepEqual(await w.ask("Read it"), { state: "answered", text: "Recovered." });
  } finally { await w.f.cleanup(); }
});

it("applies refusal bookkeeping to cached outcomes in call order", async () => {
  const reads: string[] = [];
  const keyed: AssistantTool = { kind: "read", tier: "read", name: "keyed", description: "Fails for bad.", parameters: Echo, output: EchoOutput, privacy: [{ path: "value", origin: "repository-authored" }],
    async invoke(value) { const { value: key } = Echo.parse(value); reads.push(key); if (key === "bad") throw new AssistantToolRefusal("ASSISTANT_READ_UNAVAILABLE"); return { value: key }; } };
  const w = await world({ tools: [keyed] });
  try {
    w.script.push(call("keyed", { value: "bad" }), call("keyed", { value: "good" }), call("keyed", { value: "bad" }), assistantMessageStream("Done."));
    assert.deepEqual(await w.ask("Go"), { state: "refused", code: "ASSISTANT_READ_UNAVAILABLE", message: ASSISTANT_FAILURES.ASSISTANT_READ_UNAVAILABLE });
    assert.deepEqual(reads, ["bad", "good"]);
    reads.length = 0;
    w.script.push(call("keyed", { value: "good" }), call("keyed", { value: "bad" }), call("keyed", { value: "good" }), assistantMessageStream("Done."));
    assert.deepEqual(await w.ask("Go"), { state: "answered", text: "Done." });
    assert.deepEqual(reads, ["good", "bad"]);
  } finally { await w.f.cleanup(); }
});

it("ends the turn with a proposal card and keeps a refused proposal recoverable", async () => {
  const card = ASSISTANT_PAUSE_PROPOSAL;
  let refuse = true;
  const proposal: AssistantTool = { kind: "proposal", tier: "leaves-machine", name: "propose", description: "Prepare a card.", parameters: Echo,
    async propose() { if (refuse) { refuse = false; throw new AssistantToolRefusal("ASSISTANT_PROPOSAL_REFUSED"); } return card; } };
  const w = await world({ tools: [proposal] });
  try {
    w.script.push(call("propose", { value: "a" }), body => {
      assert.deepEqual(lastOutput(body), { error: "ASSISTANT_PROPOSAL_REFUSED", text: ASSISTANT_FAILURES.ASSISTANT_PROPOSAL_REFUSED });
      return call("propose", { value: "b" });
    });
    assert.deepEqual(await w.ask("Pause it"), { state: "action-proposal", proposal: card });
    assert.equal(w.posts(), 2);
  } finally { await w.f.cleanup(); }
});

it("answers an expired card with its own message and logs each decision refusal with its cause", async () => {
  const events: Record<string, unknown>[] = [];
  let failure: Error = new AssistantToolRefusal("ASSISTANT_PROPOSAL_EXPIRED");
  const w = await world({ options: { decideAction: () => Promise.reject(failure), debugEvents: { emit(event) { events.push(event); } } } });
  try {
    const decision = { chatId: randomUUID(), actionId: randomUUID(), revision: 1, decision: "cancel" };
    assert.deepEqual(await w.service.decide(decision, new AbortController().signal), { state: "refused", code: "ASSISTANT_PROPOSAL_EXPIRED" });
    assert.equal(ASSISTANT_FAILURES.ASSISTANT_PROPOSAL_EXPIRED, "This card expired. Ask again for a new one.");
    failure = new Error("assistant-action-not-current PRIVATE_CANARY");
    assert.deepEqual(await w.service.decide(decision, new AbortController().signal), { state: "refused", code: "ASSISTANT_PROPOSAL_REFUSED" });
    assert.deepEqual(events.map(event => [event.code, event.reason, event.message]), [
      ["ASSISTANT_PROPOSAL_REFUSED", "action-decision", undefined], ["ASSISTANT_PROPOSAL_EXPIRED", "cause-unavailable", "AssistantToolRefusal"],
      ["ASSISTANT_PROPOSAL_REFUSED", "action-decision", undefined], ["INTERNAL_FAILURE", "cause-unavailable", "Error"]]);
    assert.equal(JSON.stringify(events).includes("CANARY"), false);
  } finally { await w.f.cleanup(); }
});
it("hands the model an authorization refusal under its own code", async () => {
  const proposal: AssistantTool = { kind: "proposal", tier: "leaves-machine", name: "propose", description: "Prepare a card.", parameters: Echo,
    async propose() { throw new AssistantAuthorizationError("assistant-binding-stale", "ASSISTANT_BINDING_STALE"); } };
  const w = await world({ tools: [proposal] });
  try {
    w.script.push(call("propose", { value: "a" }), body => {
      assert.deepEqual(lastOutput(body), { error: "ASSISTANT_BINDING_STALE", text: ASSISTANT_FAILURES.ASSISTANT_BINDING_STALE });
      return assistantMessageStream("Not prepared.");
    });
    assert.deepEqual(await w.ask("Pause it"), { state: "refused", code: "ASSISTANT_BINDING_STALE", message: ASSISTANT_FAILURES.ASSISTANT_BINDING_STALE });
  } finally { await w.f.cleanup(); }
});

it("refuses an expired or foreign reference as stale for the model to recover", async () => {
  const resolve: AssistantTool = { kind: "read", tier: "read", name: "resolve", description: "Resolve a reference.", parameters: Echo, output: EchoOutput, privacy: [{ path: "value", origin: "repository-authored" }],
    async invoke(value, context) { return { value: context.references.resolve(Echo.parse(value).value, ["E"]).target }; } };
  const w = await world({ tools: [resolve] });
  try {
    w.script.push(call("resolve", { value: "[[E1.g999]]" }), body => {
      assert.deepEqual(lastOutput(body), { error: "ASSISTANT_READ_STALE", text: ASSISTANT_FAILURES.ASSISTANT_READ_STALE });
      return assistantMessageStream("Expired.");
    });
    assert.deepEqual(await w.ask("Use 10812345"), { state: "refused", code: "ASSISTANT_READ_STALE", message: ASSISTANT_FAILURES.ASSISTANT_READ_STALE });
  } finally { await w.f.cleanup(); }
});

it("treats an unoffered tool and malformed arguments as terminal protocol failures", async () => {
  const w = await world();
  try {
    w.script.push(call("start_everything", { value: "x" }));
    assert.deepEqual(await w.ask("Go"), { state: "refused", code: "ASSISTANT_RESPONSE_INCOMPLETE", message: ASSISTANT_FAILURES.ASSISTANT_RESPONSE_INCOMPLETE });
    assert.equal(w.posts(), 1);
    w.script.push(call("echo", { value: "x", extra: true }));
    const malformed = await w.ask("Go");
    assert.deepEqual(malformed, { state: "refused", code: "ASSISTANT_INVALID", message: ASSISTANT_FAILURES.ASSISTANT_INVALID });
    assert.deepEqual(w.invoked, []);
  } finally { await w.f.cleanup(); }
});

it("keeps an unexpected tool failure fatal even after an earlier recoverable refusal", async () => {
  let calls = 0;
  const broken: AssistantTool = { kind: "read", tier: "read", name: "broken", description: "Refuses, then breaks.", parameters: Echo, output: EchoOutput, privacy: [{ path: "value", origin: "repository-authored" }],
    async invoke() { calls++; if (calls === 1) throw new AssistantToolRefusal("ASSISTANT_READ_UNAVAILABLE"); throw new Error("projection defect"); } };
  const w = await world({ tools: [broken] });
  try {
    w.script.push(call("broken", { value: "a" }), call("broken", { value: "b" }));
    assert.deepEqual(await w.ask("Go"), { state: "refused", code: "ASSISTANT_UNAVAILABLE", message: ASSISTANT_FAILURES.ASSISTANT_UNAVAILABLE });
  } finally { await w.f.cleanup(); }
});

it("stops at eight model calls and refuses an oversized tool output for recovery", async () => {
  const big: AssistantTool = { kind: "read", tier: "read", name: "big", description: "Large output.", parameters: Echo, output: EchoOutput, privacy: [{ path: "value", origin: "repository-authored" }],
    async invoke(value) { return { value: Echo.parse(value).value.repeat(100) }; } };
  const w = await world({ tools: [big] });
  try {
    for (let index = 0; index < 8; index++) w.script.push(call("big", { value: `${String(index)}${"x".repeat(180)}` }));
    assert.deepEqual(await w.ask("Go"), { state: "refused", code: "ASSISTANT_LIMIT", message: ASSISTANT_FAILURES.ASSISTANT_LIMIT });
    assert.equal(w.posts(), 8);
    assert.deepEqual(lastOutput(w.bodies[1] ?? { model: "", reasoning: { effort: "low" }, input: [], tools: [] }), { error: "ASSISTANT_LIMIT", text: ASSISTANT_FAILURES.ASSISTANT_LIMIT });
  } finally { await w.f.cleanup(); }
});

it("fences the provider POST: a changed model preference or abort during the turn sends no further request", async () => {
  const w = await world();
  try {
    w.script.push(call("echo", { value: "a" }));
    w.onPost(() => { if (w.posts() === 1) w.changePreference(); });
    assert.deepEqual(await w.ask("Go"), { state: "refused", code: "ASSISTANT_MODEL_CHANGED", message: ASSISTANT_FAILURES.ASSISTANT_MODEL_CHANGED });
    assert.equal(w.posts(), 1);
    assert.deepEqual(w.invoked, []);
  } finally { await w.f.cleanup(); }
  const a = await world();
  try {
    const controller = new AbortController();
    a.script.push(call("echo", { value: "a" }));
    a.onPost(() => controller.abort());
    const envelope = await a.send("Go", controller.signal);
    assert.equal(envelope.kind, "delivery", "an abort after the POST leaves delivery unknown");
    assert.equal(envelope.receipt?.delivery, "delivery-unknown");
    assert.equal(a.posts(), 1);
  } finally { await a.f.cleanup(); }
});

it("refuses before inference without plugins, with a failed facts pin or a model outside the catalog", async () => {
  const cases: readonly (readonly [Partial<AssistantServiceOptions>, AssistantFailureCode])[] = [[{ plugins: undefined }, "ASSISTANT_UNAVAILABLE"],
    [{ facts: () => { throw new Error("assistant-workflow-facts-stale"); } }, "ASSISTANT_CONTEXT_UNAVAILABLE"],
    [{ selectedModel: () => ({ preference: { slug: "gpt-unlisted", effort: "medium" }, assertCurrent: () => {} }) }, "ASSISTANT_MODEL_UNAVAILABLE"]];
  for (const [options, code] of cases) {
    const w = await world({ options });
    try {
      assert.deepEqual(await w.ask("Go"), { state: "refused", code, message: ASSISTANT_FAILURES[code] });
      assert.equal(w.posts(), 0);
    } finally { await w.f.cleanup(); }
  }
});

it("refuses an invalid selected run before inference", async () => {
  const w = await world();
  try {
    for (const subjectRef of ["not-a-run", `run_${randomUUID()}_99999999999999999999`]) assert.deepEqual(await w.ask("Explain", undefined, undefined, { subjectRef }),
      { state: "refused", code: "ASSISTANT_INVALID", message: ASSISTANT_FAILURES.ASSISTANT_INVALID });
    assert.equal(w.posts(), 0);
  } finally { await w.f.cleanup(); }
});

const userTexts = (body: z.infer<typeof AssistantInferenceRequestSchema>) => body.input.flatMap(item => "role" in item && item.role === "user" && "content" in item ? [String(item.content)] : []);
const assistantTexts = (body: z.infer<typeof AssistantInferenceRequestSchema>) => body.input.flatMap(item => "type" in item && item.type === "message" && "content" in item
  ? [item.content.map(part => part.text).join("")] : []);

it("replays only stored model text in order and never display, imported or local rows", async () => {
  const w = await world();
  try {
    const id = randomUUID();
    assert.equal(w.service.history({ operation: "import", conversationId: id, title: "Imported", draft: "", composer: "", notice: null, total: 1, start: 1,
      messages: [{ messageId: randomUUID(), role: "assistant", text: "IMPORT_SENTINEL 10899999" }] }).state, "saved");
    assert.equal(w.service.history({ operation: "local", conversationId: id, expectedRevision: w.revision(id), messageId: randomUUID(), text: "LOCAL_SENTINEL" }).state, "saved");
    w.script.push(body => assistantMessageStream(`Found ${/\[\[E1\.g\d+\]\]/u.exec(JSON.stringify(body.input))?.[0] ?? "none"}.`));
    assert.deepEqual(await w.ask("Look up 10812345", undefined, id), { state: "answered", text: "Found 10812345." });
    w.script.push(() => assistantMessageStream("Second."));
    assert.deepEqual(await w.ask("And again", undefined, id), { state: "answered", text: "Second." });
    const second = w.bodies[1]; assert.ok(second);
    const serialized = JSON.stringify(second.input);
    for (const sentinel of ["10812345", "IMPORT_SENTINEL", "10899999", "LOCAL_SENTINEL", "Found 10812345"]) assert.equal(serialized.includes(sentinel), false, sentinel);
    assert.deepEqual(userTexts(second).map(text => text.replace(/\[\[E1\.g\d+\]\]/u, "[[E]]")), ["Look up [[E]]", "And again"]);
    assert.deepEqual(assistantTexts(second).map(text => text.replace(/\[\[E1\.g\d+\]\]/u, "[[E]]")), ["Found [[E]]."]);
    assert.deepEqual(w.service.conversation(id)?.messages.map(row => [row.kind, row.text]), [["inert", "IMPORT_SENTINEL 10899999"], ["inert", "LOCAL_SENTINEL"],
      ["turn", "Look up 10812345"], ["answer", "Found 10812345."], ["turn", "And again"], ["answer", "Second."]]);
  } finally { await w.f.cleanup(); }
});

it("reads an exact repeat after the revision advanced without a provider call and refuses changed reuse", async () => {
  const w = await world();
  try {
    const id = randomUUID(), messageId = randomUUID();
    w.script.push(() => assistantMessageStream("Done."));
    const first = await w.send("Explain", undefined, id, { messageId });
    assert.equal(first.kind, "result"); assert.deepEqual(first.receipt, { conversationId: id, messageId, ordinal: 1, revision: 3, delivery: "answered" });
    assert.equal(w.service.history({ operation: "rename", conversationId: id, expectedRevision: 3, title: "Renamed" }).state, "saved");
    const posts = w.posts();
    assert.deepEqual(await w.service.respond({ conversationId: id, expectedRevision: 1, messageId, message: "Explain" }, new AbortController().signal),
      { kind: "delivery", receipt: { conversationId: id, messageId, ordinal: 1, revision: 4, delivery: "answered" } });
    for (const changed of [{ message: "Explain" , subjectRef: `run_${randomUUID()}_1` }, { message: "Explain differently" }]) {
      assert.deepEqual(await w.service.respond({ conversationId: id, expectedRevision: 4, messageId, ...changed }, new AbortController().signal),
        { kind: "result", result: { state: "refused", code: "ASSISTANT_CONVERSATION_STALE", message: ASSISTANT_FAILURES.ASSISTANT_CONVERSATION_STALE } });
    }
    assert.equal(w.posts(), posts);
  } finally { await w.f.cleanup(); }
});

it("accepts one of two concurrent sends and keeps a send current across rename and select", async () => {
  const w = await world();
  try {
    const id = randomUUID();
    w.onPost(() => {
      for (const operation of ["rename", "select"] as const) assert.equal(w.service.history({ operation, conversationId: id, expectedRevision: w.revision(id),
        ...(operation === "rename" ? { title: "Renamed mid-send" } : {}) }).state, "saved");
    });
    w.script.push(() => assistantMessageStream("One."));
    const first = w.send("First", undefined, id);
    assert.deepEqual(await w.send("Second", undefined, id),
      { kind: "result", result: { state: "refused", code: "ASSISTANT_CONVERSATION_BUSY", message: ASSISTANT_FAILURES.ASSISTANT_CONVERSATION_BUSY } });
    const settled = await first;
    assert.equal(settled.kind, "result"); assert.deepEqual(settled.kind === "result" ? settled.result : undefined, { state: "answered", text: "One." });
    assert.equal(settled.receipt?.revision, w.revision(id)); assert.equal(w.posts(), 1);
    assert.deepEqual(w.service.conversation(id)?.messages.map(row => [row.kind, row.delivery]), [["turn", "answered"], ["answer", "settled"]]);
  } finally { await w.f.cleanup(); }
});

it("makes no stale POST or late row after Clear before the POST or startup settlement during it", async () => {
  let beforeInference: (() => void) | undefined;
  const w = await world({ options: { facts: () => { beforeInference?.(); return FACTS; } } });
  try {
    const cleared = randomUUID();
    beforeInference = () => { assert.equal(w.service.history({ operation: "clear", conversationId: cleared, expectedRevision: w.revision(cleared) }).state, "cleared"); };
    const envelope = await w.send("Explain", undefined, cleared);
    assert.equal(envelope.kind, "result"); assert.equal(envelope.kind === "result" && envelope.result.state, "refused"); assert.equal(envelope.receipt, undefined);
    assert.equal(w.posts(), 0); assert.equal(w.service.conversation(cleared), undefined);
    beforeInference = undefined;
    const restarted = randomUUID();
    w.onPost(() => { w.db.database.authority.assistantHistory.settleInterrupted(w.f.clock.now().toISOString()); });
    w.script.push(() => assistantMessageStream("Late answer."));
    const late = await w.send("Explain", undefined, restarted);
    assert.equal(late.kind, "result"); assert.equal(late.receipt, undefined); assert.equal(w.posts(), 1);
    assert.deepEqual(w.service.conversation(restarted)?.messages.map(row => [row.kind, row.delivery]), [["turn", "delivery-unknown"]]);
  } finally { await w.f.cleanup(); }
});

const deliveryUnknown = async (w: Awaited<ReturnType<typeof world>>, prepare: (signal: AbortController) => void) => {
  const id = randomUUID(), messageId = randomUUID(), controller = new AbortController();
  prepare(controller);
  const envelope = await w.send("Explain", controller.signal, id, { messageId });
  assert.deepEqual(envelope, { kind: "delivery", receipt: { conversationId: id, messageId, ordinal: 1, revision: 3, delivery: "delivery-unknown" } });
  assert.deepEqual(w.service.conversation(id)?.messages.map(row => [row.kind, row.delivery]), [["turn", "delivery-unknown"]]);
  const posts = w.posts();
  assert.deepEqual(await w.service.respond({ conversationId: id, expectedRevision: 1, messageId, message: "Explain" }, new AbortController().signal),
    { kind: "delivery", receipt: { conversationId: id, messageId, ordinal: 1, revision: 3, delivery: "delivery-unknown" } });
  assert.equal(w.posts(), posts, "an exact repeat never sends again");
};

it("stores a lost stream or an abort after the POST as delivery-unknown and reads it back without another POST", async () => {
  const w = await world();
  try {
    const partial = assistantMessageStream("Half an answer").split("\n\n").slice(0, 3).join("\n\n") + "\n\n";
    await deliveryUnknown(w, () => { w.script.push(partial); });
    await deliveryUnknown(w, controller => { w.script.push(call("echo", { value: "a" })); w.onPost(() => { controller.abort(); }); });
    w.onPost(() => {});
    assert.equal(w.posts(), 2);
  } finally { await w.f.cleanup(); }
});

it("keeps a complete but invalid provider response a definite refusal", async () => {
  const w = await world();
  try {
    const id = randomUUID();
    w.script.push(completedAssistantStream({ action: "unoffered", value: "a" }, "gpt-6.1-sol", "relay"));
    const envelope = await w.send("Go", undefined, id);
    assert.equal(envelope.kind, "result"); assert.equal(envelope.kind === "result" && envelope.result.state, "refused");
    assert.deepEqual(w.service.conversation(id)?.messages.map(row => [row.kind, row.delivery]), [["turn", "refused"]]);
  } finally { await w.f.cleanup(); }
});

it("sends nothing and stores nothing new once the chat expires while the credentials are awaited or the stream is held", async () => {
  for (const moment of ["credentials", "stream"] as const) {
    const historyClock = manualClock(new Date("2026-10-12T12:00:00.000Z"));
    const w = await world({ options: { clock: historyClock } });
    try {
      const id = randomUUID(), messageId = randomUUID();
      let refreshed = 0;
      w.revision(id);
      const expiry = w.service.historyView().chats.find(chat => chat.id === id)?.expiresAt; assert.ok(expiry);
      const expire = () => { historyClock.setWall(new Date(expiry)); };
      if (moment === "credentials") {
        // The catalog is read while current and brings the access token into its refresh window, so inferAssistant's own credential read refreshes; the chat expires during that refresh.
        let armed = false, lapsed = false;
        w.f.setModelsHook(async () => { if (!lapsed) { lapsed = true; armed = true; w.f.clock.advanceWall(3_570_000); } return Response.json({ models: [{ slug: "gpt-6.1-sol", display_name: "GPT-6.1 Sol", visibility: "list" }] }); });
        w.f.setTokenHook(async () => { if (armed) { armed = false; refreshed++; expire(); } });
      } else w.onPost(expire);
      w.script.push(() => assistantMessageStream("Late."));
      const envelope = await w.send("Explain", undefined, id, { messageId });
      assert.equal(envelope.kind, "result"); assert.equal(envelope.kind === "result" && envelope.result.state, "refused"); assert.equal(envelope.receipt, undefined);
      assert.equal(w.posts(), moment === "credentials" ? 0 : 1);
      if (moment === "credentials") {
        assert.equal(refreshed, 1, "the held await was inferAssistant's credential refresh");
        const next = randomUUID();
        w.script.splice(0, w.script.length, () => assistantMessageStream("Next."));
        historyClock.setWall(new Date("2026-10-12T13:00:00.000Z"));
        assert.deepEqual(await w.ask("Again", undefined, next), { state: "answered", text: "Next." }, "the refused inference closed its operation");
        assert.equal(w.posts(), 1);
      }
      const raw = w.db.database.authority.assistantHistory.conversation(id, new Date(Date.parse(expiry) - 1).toISOString());
      assert.deepEqual(raw?.messages.map(row => [row.kind, row.delivery]), [["turn", "sending"]], "no reply or settlement after expiry; cleanup never ran");
    } finally { await w.f.cleanup(); }
  }
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array<number>(200_000).fill(7)]);
const PDF = new TextEncoder().encode("%PDF-1.7\nsynthetic\n%%EOF");
const XLSX = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
type World = Awaited<ReturnType<typeof world>>;
const stage = (w: World, conversationId: string, name: string, contentType: string, bytes: Uint8Array) =>
  w.service.stage({ conversationId, contentType, name, read: async () => bytes }, new AbortController().signal);
const stagedId = async (...args: Parameters<typeof stage>) => {
  const result = await stage(...args); assert.equal(result.state, "staged", JSON.stringify(result));
  return result.state === "staged" ? result.attachment.id : "";
};
const userParts = (body: z.infer<typeof AssistantInferenceRequestSchema>) => body.input.flatMap(item => "type" in item || item.role !== "user" || typeof item.content === "string" ? [] : [item.content]);

it("sends staged attachments once as content parts with references, keeps names local and replays them on a follow-up", async () => {
  const w = await world();
  try {
    const conversationId = randomUUID(); w.revision(conversationId);
    const ids = [await stagedId(w, conversationId, "Scan CANARY.png", "image/png", PNG), await stagedId(w, conversationId, "Form CANARY.pdf", "application/pdf", PDF),
      await stagedId(w, conversationId, "notes CANARY.txt", "text/plain", new TextEncoder().encode("Line one\nLine two")),
      await stagedId(w, conversationId, "Roster CANARY.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", XLSX)];
    w.script.push(body => assistantMessageStream(`Read ${/\[\[A2\.g\d+\]\]/u.exec(JSON.stringify(body.input))?.[0] ?? "none"}.`));
    const first = await w.service.respond({ conversationId, expectedRevision: w.revision(conversationId), messageId: randomUUID(), message: "What is in these?", attachments: ids },
      new AbortController().signal);
    assert.deepEqual(first.kind === "result" && first.result, { state: "answered", text: "Read Form CANARY.pdf." });
    const [body] = w.bodies; assert.ok(body);
    assert.equal(JSON.stringify(body).includes("CANARY"), false);
    const [parts] = userParts(body); assert.ok(parts);
    assert.deepEqual(parts.map(part => part.type), ["input_text", "input_text", "input_image", "input_text", "input_file", "input_text", "input_text", "input_text"]);
    assert.deepEqual(parts[2], { type: "input_image", image_url: `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`, detail: "high" });
    assert.deepEqual(parts[4], { type: "input_file", filename: "attachment-2.pdf", file_data: `data:application/pdf;base64,${Buffer.from(PDF).toString("base64")}` });
    assert.deepEqual(parts[6], { type: "input_text", text: "Line one\nLine two" });
    assert.match(JSON.stringify(parts[7]), /Attachment \[\[A4\.g\d+\]\]: spreadsheet/u);
    assert.equal(JSON.stringify(body).includes(Buffer.from(XLSX).toString("base64")), false);
    assert.deepEqual(w.service.conversation(conversationId)?.messages[0]?.attachments.map(file => file.name),
      ["Scan CANARY.png", "Form CANARY.pdf", "notes CANARY.txt", "Roster CANARY.xlsx"]);

    w.script.push(assistantMessageStream("Still here."));
    assert.deepEqual(await w.ask("And now?", undefined, conversationId), { state: "answered", text: "Still here." });
    const replayed = userParts(w.bodies[1] ?? body);
    assert.equal(replayed.length, 1); assert.deepEqual(replayed[0]?.[2], parts[2]);
    assert.equal(w.posts(), 2);

    const consumed = await w.service.respond({ conversationId, expectedRevision: w.revision(conversationId), messageId: randomUUID(), message: "Again", attachments: [ids[0] ?? ""] },
      new AbortController().signal);
    assert.deepEqual(consumed.kind === "result" && consumed.result.state === "refused" && consumed.result.code, "ASSISTANT_ATTACHMENT_UNAVAILABLE");
    assert.equal(w.posts(), 2);
  } finally { await w.f.cleanup(); }
});

it("refuses bad uploads with fixed codes before storing, one upload at a time", async () => {
  const w = await world();
  try {
    const conversationId = randomUUID(); w.revision(conversationId);
    const cases: [string, string, Uint8Array, string][] = [
      ["a.gif", "image/gif", PNG, "ASSISTANT_ATTACHMENT_UNSUPPORTED"],
      ["a.jpg", "image/png", PNG, "ASSISTANT_ATTACHMENT_UNSUPPORTED"],
      ["a.png", "image/png", PDF, "ASSISTANT_ATTACHMENT_INVALID"],
      ["a.txt", "text/plain", new Uint8Array(), "ASSISTANT_ATTACHMENT_INVALID"],
      ["a.txt", "text/plain", new Uint8Array([0xff, 0xfe]), "ASSISTANT_ATTACHMENT_INVALID"],
      ["a.txt", "text/plain", new TextEncoder().encode("nul\u0000"), "ASSISTANT_ATTACHMENT_INVALID"],
      ["a/b.txt", "text/plain", new TextEncoder().encode("ok"), "ASSISTANT_ATTACHMENT_INVALID"],
      ["a.txt", "text/plain", new Uint8Array(32 * 1024 + 1).fill(65), "ASSISTANT_ATTACHMENT_TOO_LARGE"],
      ["a.csv", "text/csv", new TextEncoder().encode("a,b"), "ok"],
    ];
    for (const [name, type, bytes, code] of cases) {
      const result = await stage(w, conversationId, name, type, bytes);
      assert.equal(result.state === "refused" ? result.code : "ok", code, `${name} ${type}`);
    }
    assert.deepEqual(await stage(w, randomUUID(), "a.txt", "text/plain", new TextEncoder().encode("ok")), { state: "refused", code: "ASSISTANT_CONVERSATION_STALE" });
    const gate = Promise.withResolvers<Uint8Array>();
    const held = w.service.stage({ conversationId, contentType: "text/plain", name: "a.txt", read: () => gate.promise }, new AbortController().signal);
    assert.deepEqual(await stage(w, conversationId, "b.txt", "text/plain", new TextEncoder().encode("ok")), { state: "refused", code: "ASSISTANT_ATTACHMENT_BUSY" });
    gate.resolve(new TextEncoder().encode("ok"));
    assert.equal((await held).state, "staged");
    assert.equal(w.posts(), 0);
  } finally { await w.f.cleanup(); }
});

it("refuses a whole send whose attachment text exceeds the context bound, without a provider call", async () => {
  const w = await world();
  try {
    const conversationId = randomUUID(); w.revision(conversationId);
    const text = new Uint8Array(30 * 1024).fill(65);
    const ids = [await stagedId(w, conversationId, "a.txt", "text/plain", text), await stagedId(w, conversationId, "b.md", "text/markdown", text)];
    const result = await w.service.respond({ conversationId, expectedRevision: w.revision(conversationId), messageId: randomUUID(), message: "Summarize", attachments: ids },
      new AbortController().signal);
    assert.deepEqual(result.kind === "result" && result.result.state === "refused" && result.result.code, "ASSISTANT_ATTACHMENT_TOO_LARGE");
    assert.equal(w.posts(), 0);
  } finally { await w.f.cleanup(); }
});

it("issues the selected run's useful first label with its pin and sends only its token to inference", async () => {
  const id = randomUUID(), version = 3, label = "Person Lookup · EID 10000001 · 2026-11-08T12:00:00Z · attempt 1";
  const selected: AssistantTool = { kind: "read", tier: "read", name: "selected_reference", description: "Return the selected reference without personal data.",
    parameters: z.strictObject({ selected: z.literal(true) }), output: z.strictObject({ run: referenceSchema("R") }), privacy: [], async invoke(_value, context) {
      const run = context.references.issue("R", id, "the selected run", id, version);
      assert.equal(context.references.resolve(run, ["R"]).version, version);
      return { run };
    } };
  const w = await world({ tools: [selected], options: { runReferenceLabel(runId, revision) {
    assert.equal(runId, id); assert.equal(revision, version); return label;
  } } });
  try {
    w.script.push(call("selected_reference", { selected: true }), body => assistantMessageStream(z.object({ run: z.string() }).parse(lastOutput(body)).run));
    const result = await w.ask("Explain the selected run", undefined, undefined, { subjectRef: `run_${id}_${version}` });
    assert.ok(result.state === "answered"); assert.equal(result.text, label);
    const provider = JSON.stringify(w.bodies);
    assert.equal(provider.includes("10000001"), false); assert.equal(provider.includes(label), false);
  } finally { await w.f.cleanup(); }
});

it("refuses a changed selected row before inference instead of issuing a generic reference", async () => {
  const w = await world({ options: { runReferenceLabel() { throw new AssistantToolRefusal("ASSISTANT_READ_STALE"); } } });
  try {
    assert.deepEqual(await w.ask("Explain", undefined, undefined, { subjectRef: `run_${randomUUID()}_1` }),
      { state: "refused", code: "ASSISTANT_READ_STALE", message: ASSISTANT_FAILURES.ASSISTANT_READ_STALE });
    assert.equal(w.posts(), 0);
  } finally { await w.f.cleanup(); }
});
