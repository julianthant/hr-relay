import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, it } from "vitest";
import { z } from "zod";
import { createProfileFixtureSet } from "../../support/helpers/admission-fixture.js";
import { chatGptFixture } from "../../support/helpers/chatgpt-account-fixtures.js";
import { assistantMessageStream, completedAssistantStream } from "../../support/helpers/assistant-function-fixtures.js";
import { createAssistantService, type AssistantServiceOptions } from "../../../src/backend/assistant/service.js";
import { AssistantToolRefusal, type AssistantPlugin, type AssistantTool } from "../../../src/backend/assistant/plugins/plugin.js";
import { assistantWorkflowFacts } from "../../../src/backend/assistant/plugins/workflows/facts.js";
import { ASSISTANT_FAILURES, ASSISTANT_VERIFY_COMMAND, AssistantInferenceRequestSchema, type AssistantFailureCode } from "../../../src/models/dashboard/assistant.js";
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
  const f = await chatGptFixture(undefined, profiles.create);
  await f.connected();
  const bodies: z.infer<typeof AssistantInferenceRequestSchema>[] = [], script: Step[] = [];
  let policyCurrent = true, onPost: (() => void) | undefined;
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
  const echo: AssistantTool = { name: "echo", description: "Echo a value with references expanded.", parameters: Echo, output: EchoOutput,
    privacy: [{ path: "value", origin: "repository-authored" }],
    async invoke(value, context) { invoked.push("echo"); return { value: context.references.expand(Echo.parse(value).value) }; } };
  const plugin: AssistantPlugin = { domain: "test", tools: input.tools ?? [echo] };
  const service = createAssistantService({ account: f.service, clock: f.clock, actorId: "local-operator", facts: () => FACTS,
    owner: () => ({ profileId: "11111111-1111-4111-8111-111111111111", epoch: 1 }), plugins: () => [plugin],
    modelPolicy: () => ({ policy: { model: "gpt-6.1-sol", eligible: true, consented: true, billing: "chatgpt-plan", verifiedUntil: "2026-10-13T00:00:00Z" }, isCurrent: () => policyCurrent }),
    ...input.options });
  const ask = (message: string, signal = new AbortController().signal, conversationId = randomUUID()) =>
    service.respond({ conversationId, messageId: randomUUID(), message }, signal);
  const posts = () => f.calls.filter(call => call.url.endsWith("/responses")).length;
  return { f, service, bodies, script, invoked, ask, posts, invalidatePolicy() { policyCurrent = false; }, onPost(hook: () => void) { onPost = hook; } };
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
  const flaky: AssistantTool = { name: "flaky", description: "Fails once.", parameters: Echo, output: EchoOutput, privacy: [{ path: "value", origin: "repository-authored" }],
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

it("refuses an expired or foreign reference as stale for the model to recover", async () => {
  const resolve: AssistantTool = { name: "resolve", description: "Resolve a reference.", parameters: Echo, output: EchoOutput, privacy: [{ path: "value", origin: "repository-authored" }],
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
  const broken: AssistantTool = { name: "broken", description: "Refuses, then breaks.", parameters: Echo, output: EchoOutput, privacy: [{ path: "value", origin: "repository-authored" }],
    async invoke() { calls++; if (calls === 1) throw new AssistantToolRefusal("ASSISTANT_READ_UNAVAILABLE"); throw new Error("projection defect"); } };
  const w = await world({ tools: [broken] });
  try {
    w.script.push(call("broken", { value: "a" }), call("broken", { value: "b" }));
    assert.deepEqual(await w.ask("Go"), { state: "refused", code: "ASSISTANT_UNAVAILABLE", message: ASSISTANT_FAILURES.ASSISTANT_UNAVAILABLE });
  } finally { await w.f.cleanup(); }
});

it("stops at eight model calls and refuses an oversized tool output for recovery", async () => {
  const big: AssistantTool = { name: "big", description: "Large output.", parameters: Echo, output: EchoOutput, privacy: [{ path: "value", origin: "repository-authored" }],
    async invoke(value) { return { value: Echo.parse(value).value.repeat(100) }; } };
  const w = await world({ tools: [big] });
  try {
    for (let index = 0; index < 8; index++) w.script.push(call("big", { value: `${String(index)}${"x".repeat(180)}` }));
    assert.deepEqual(await w.ask("Go"), { state: "refused", code: "ASSISTANT_LIMIT", message: ASSISTANT_FAILURES.ASSISTANT_LIMIT });
    assert.equal(w.posts(), 8);
    assert.deepEqual(lastOutput(w.bodies[1] ?? { model: "", reasoning: { effort: "low" }, input: [], tools: [] }), { error: "ASSISTANT_LIMIT", text: ASSISTANT_FAILURES.ASSISTANT_LIMIT });
  } finally { await w.f.cleanup(); }
});

it("fences the provider POST: invalidated policy or abort during the turn sends no further request", async () => {
  const w = await world();
  try {
    w.script.push(call("echo", { value: "a" }));
    w.onPost(() => { if (w.posts() === 1) w.invalidatePolicy(); });
    assert.deepEqual(await w.ask("Go"), { state: "refused", code: "ASSISTANT_MODEL_UNVERIFIED", message: ASSISTANT_FAILURES.ASSISTANT_MODEL_UNVERIFIED });
    assert.equal(w.posts(), 1);
    assert.deepEqual(w.invoked, []);
  } finally { await w.f.cleanup(); }
  const a = await world();
  try {
    const controller = new AbortController();
    a.script.push(call("echo", { value: "a" }));
    a.onPost(() => controller.abort());
    assert.deepEqual(await a.ask("Go", controller.signal), { state: "refused", code: "ASSISTANT_CANCELLED", message: ASSISTANT_FAILURES.ASSISTANT_CANCELLED });
    assert.equal(a.posts(), 1);
  } finally { await a.f.cleanup(); }
});

it("refuses before inference without plugins, with a failed facts pin or a model outside the catalog", async () => {
  const cases: readonly (readonly [Partial<AssistantServiceOptions>, AssistantFailureCode])[] = [[{ plugins: undefined }, "ASSISTANT_UNAVAILABLE"],
    [{ facts: () => { throw new Error("assistant-workflow-facts-stale"); } }, "ASSISTANT_CONTEXT_UNAVAILABLE"],
    [{ modelPolicy: () => ({ policy: { model: "gpt-unlisted", eligible: true, consented: true, billing: "chatgpt-plan", verifiedUntil: "2026-10-13T00:00:00Z" }, isCurrent: () => true }) }, "ASSISTANT_MODEL_UNAVAILABLE"]];
  for (const [options, code] of cases) {
    const w = await world({ options });
    try {
      assert.deepEqual(await w.ask("Go"), { state: "refused", code, message: ASSISTANT_FAILURES[code] });
      assert.equal(w.posts(), 0);
    } finally { await w.f.cleanup(); }
  }
});

it("keeps explicit verification separate from the tool loop and refuses an invalid selected run", async () => {
  let verified = 0;
  const w = await world({ options: { verifySelectedModel: async () => { verified++; } } });
  try {
    assert.equal((await w.ask(`  ${ASSISTANT_VERIFY_COMMAND} `)).state, "answered");
    assert.equal(verified, 1); assert.equal(w.posts(), 0);
    assert.equal((await w.service.respond({ conversationId: randomUUID(), messageId: randomUUID(), message: "Explain", subjectRef: "not-a-run" }, new AbortController().signal)).state, "refused");
    assert.equal(w.posts(), 0);
  } finally { await w.f.cleanup(); }
});
