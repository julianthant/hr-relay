import { ASSISTANT_DEFAULT_MODEL, ASSISTANT_DEFAULT_EFFORT } from '../../../../src/models/dashboard/assistant.js';
import assert from "node:assert/strict";
import { it } from "vitest";
import { CommandExecutor, type CommandExecutionOptions, type CommandExecutionScope, type CommandOutcome } from "../../../../src/dashboard/app/commands/command-executor.js";
import { createSharedCommands } from "../../../../src/dashboard/client/commands/shared-commands.js";
import { createDashboardTransport } from "../../../../src/dashboard/client/transport.js";
import { CommandRequestSchema, BulkRunCommandRequestSchema, type CommandRequest, type BulkRunCommandRequest, CommandResultSchema, type CommandResult } from "../../../../src/rules/commands/commands.js";
import { deriveBulkChildCommandId } from "../../../../src/rules/commands/command-groups.js";

const id = (n: number) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const RUN = id(1);
const OTHER = id(2);
function command(n = 10, runId = RUN, expectedVersion = 1) {
  return CommandRequestSchema.parse({ commandId: id(n), requestedAt: "2026-08-03T12:00:00.000Z", requestedBy: "local-operator",
    source: "dashboard", family: "run", type: "cancel", target: { runId, expectedVersion } });
}
function bulk(n = 20, runIds = [RUN, OTHER]) {
  const { target: _target, ...envelope } = command(n);
  return BulkRunCommandRequestSchema.parse({ ...envelope, bulkCommandId: id(n),
    targets: runIds.map(runId => ({ runId, expectedVersion: 1 })), mode: "best-effort" });
}
function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<Value>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function landing(request: CommandRequest) {
  assert.equal(request.family, "run");
  if (request.family !== "run") assert.fail("expected run");
  return { state: "applied", commandId: request.commandId, affectedTargets: [{ family: "run", runId: request.target.runId }] };
}
function vector(request: BulkRunCommandRequest) {
  return { state: "vector", bulkCommandId: request.bulkCommandId, type: request.type, requestedCount: request.targets.length,
    results: request.targets.map(target => ({ outcome: "applied", runId: target.runId,
      commandId: deriveBulkChildCommandId(request.bulkCommandId, target.runId), replayed: false, detail: "private server prose" })) };
}
function harness() {
  const sent: string[] = [];
  const state = new Map<string, { version: number; cancelled: boolean }>();
  let reply: ((request: CommandRequest | BulkRunCommandRequest) => unknown) | undefined;
  const client = createSharedCommands(createDashboardTransport({ baseUrl: "http://fixture.test", fetchImpl: async (_url, init) => {
    if (typeof init?.body !== "string") assert.fail("JSON command body missing");
    const body = init.body; sent.push(body);
    const input: unknown = JSON.parse(body);
    const request = typeof input === "object" && input !== null && "targets" in input
      ? BulkRunCommandRequestSchema.parse(input) : CommandRequestSchema.parse(input);
    if (reply) { const response = await reply(request); return response instanceof Response ? response : Response.json(response); }
    const targets = "targets" in request ? request.targets : request.family === "run" ? [request.target] : [];
    for (const target of targets) state.set(target.runId, { version: target.expectedVersion + 1, cancelled: true });
    return Response.json("targets" in request ? vector(request) : landing(request));
  } }));
  let scope: CommandExecutionScope | undefined = { actorId: "local-operator", client, authority: {}, dayRequest: {} };
  const executor = new CommandExecutor(() => scope);
  const published: CommandOutcome[] = [];
  const options = (): CommandExecutionOptions => {
    assert.ok(scope);
    return { scope, publish: value => published.push(value), readback: async (request, result) => {
      if (request.family !== "run") return { state: "mismatch", evidence: state };
      const observed = state.get(request.target.runId);
      const legal = "affectedTargets" in result ? result.affectedTargets.every(target => target.family === "run" && target.runId === request.target.runId) : true;
      return observed?.version === request.target.expectedVersion + 1 && observed.cancelled && legal
        ? { state: "matched", evidence: { runId: request.target.runId, ...observed } }
        : { state: "mismatch", evidence: observed };
    } };
  };
  return { executor, sent, state, client, published, options,
    setReply(value: typeof reply) { reply = value; },
    scope: () => scope,
    replaceScope(value: CommandExecutionScope | undefined) { scope = value; } };
}

it("requires matching authoritative readback and retains the immutable parsed envelope", async () => {
  const h = harness();
  const input = { ...command(), reason: "Operator review" };
  const outcome = await h.executor.execute(input, h.options());
  assert.equal(outcome.kind, "confirmed");
  const retained = h.executor.retainedAttempts()[0];
  assert.equal(retained.body, h.sent[0]);
  assert.equal(Object.isFrozen(retained.request), true);
  assert.ok("target" in retained.request);
  assert.equal(Object.isFrozen(retained.request.target), true);
  input.reason = "changed";
  assert.notEqual(retained.request.reason, input.reason);
  assert.equal(h.published.length, 1);
});

it("refuses missing readback before dispatch rather than defaulting to success", async () => {
  const h = harness();
  const options = h.options();
  Reflect.deleteProperty(options, "readback");
  assert.equal((await h.executor.execute(command(), options)).kind, "failed");
  assert.equal(h.sent.length, 0);
});

it.each(["wrong-id", "wrong-target", "malformed"])("retains %s post-dispatch reply as uncertain and blocks fresh bypass", async problem => {
  const h = harness();
  h.setReply(request => {
    assert.ok(!("targets" in request));
    const result = landing(request);
    return problem === "wrong-id" ? { ...result, commandId: id(999) }
      : problem === "wrong-target" ? { ...result, affectedTargets: [{ family: "run", runId: OTHER }] } : {};
  });
  const result = await h.executor.execute(command(), h.options());
  assert.equal(result.kind, "uncertain");
  assert.equal(h.executor.retainedAttempts()[0].outcome, result);
  assert.equal((await h.executor.execute(command(11, RUN, 99), h.options())).kind, "refused");
  assert.equal(h.sent.length, 1);
});

it.each(["mismatch", "throw", "descendant-outside-admission"])("keeps %s readback uncertain with original diagnostics", async problem => {
  const h = harness();
  const cause = new Error("private readback failure");
  h.setReply(request => {
    assert.ok(!("targets" in request));
    const result = landing(request);
    return problem === "descendant-outside-admission" ? { ...result, affectedTargets: [...result.affectedTargets, { family: "run", runId: OTHER }] } : result;
  });
  const defaults = h.options();
  const options = { ...defaults, readback: problem === "throw" ? async () => { throw cause; } : defaults.readback };
  const result = await h.executor.execute(command(), options);
  assert.equal(result.kind, "uncertain");
  if (problem === "throw") assert.equal(result.cause, cause);
  if (result.kind !== "uncertain") assert.fail("expected uncertain");
  assert.doesNotMatch(result.feedback.text, /private/);
  assert.equal((await h.executor.execute(command(11), h.options())).kind, "refused");
});

it.each(["authority-unjournaled", "authority-uncertain"])("treats %s as uncertain and replays only the retained bytes", async code => {
  const h = harness();
  h.setReply(request => ({ state: "rejected", commandId: request.commandId, code, message: "private kernel prose" }));
  assert.equal((await h.executor.execute(command(), h.options())).kind, "uncertain");
  assert.equal(h.sent.length, 1);
  assert.equal((await h.executor.execute(command(11), h.options())).kind, "refused");
  h.setReply(undefined);
  const replayed = await h.executor.replay(id(10), h.options());
  assert.equal(replayed.kind, "confirmed");
  assert.equal(h.sent.length, 2);
  assert.equal(h.sent[0], h.sent[1]);
  assert.equal((await h.executor.execute(command(11, RUN, 2), h.options())).kind, "confirmed");
});

it.each(["policy-refused", "conflict", "confirmation-required"])("settles %s without inventing readback or displaying server prose", async state => {
  const h = harness();
  h.setReply(request => state === "policy-refused" ? { state: "rejected", commandId: request.commandId, code: "policy-refused", message: "private" }
    : state === "conflict" ? { state, commandId: request.commandId, currentVersion: 4, message: "private" }
    : { state, commandId: request.commandId, warningDigest: "d".repeat(64), message: "private" });
  const result = await h.executor.execute(command(), { ...h.options(), readback: async () => assert.fail("must not read a refused command") });
  assert.equal(result.kind, state === "policy-refused" ? "refused" : state);
  assert.ok(result.kind !== "confirmed"); assert.doesNotMatch(result.feedback.text, /private/);
  if (result.kind === "confirmation-required") assert.equal(result.warningDigest, "d".repeat(64));
});

it("retains an authoritative superseded Settings readback as conflict", async () => {
  const h = harness();
  const result = await h.executor.execute(command(), { ...h.options(), readback: async () => ({ state: "conflict", evidence: { revision: 3 } }) });
  assert.equal(result.kind, "conflict");
});

it("shares pending target/action locks across single, bulk and replay regardless of version", async () => {
  const h = harness(); const pending = deferred<unknown>();
  h.setReply(() => pending.promise);
  const one = h.executor.execute(command(), h.options());
  assert.equal((await h.executor.execute(bulk(), h.options())).kind, "refused");
  assert.equal((await h.executor.replay(id(10), h.options())).kind, "refused");
  assert.equal((await h.executor.execute(command(11, RUN, 2), h.options())).kind, "refused");
  pending.resolve({ state: "rejected", commandId: id(10), code: "policy-refused", message: "refused" });
  await one;
  h.setReply(undefined);
  const many = await h.executor.execute(bulk(), h.options());
  assert.equal(many.kind, "confirmed");
  assert.deepEqual(many.children?.map(child => child.kind), ["confirmed", "confirmed"]);
});

it("preflights every bulk lock without partially reserving or sending other targets", async () => {
  const h = harness(); h.setReply(() => { throw new Error("connection lost"); });
  await h.executor.execute(command(), h.options());
  assert.equal((await h.executor.execute(bulk(), h.options())).kind, "refused");
  h.setReply(undefined);
  assert.equal((await h.executor.execute(command(11, OTHER), h.options())).kind, "confirmed");
  assert.equal(h.sent.length, 2);
});

it.each(["id", "type", "count", "order", "child-id", "duplicate", "short-vector"])("retains malformed bulk %s as uncertain", async field => {
  const h = harness();
  h.setReply(request => {
    assert.ok("targets" in request);
    const result = vector(request);
    if (field === "id") return { ...result, bulkCommandId: id(99) };
    if (field === "type") return { ...result, type: "bump" };
    if (field === "count") return { ...result, requestedCount: 3 };
    if (field === "order") return { ...result, results: [...result.results].reverse() };
    if (field === "child-id") return { ...result, results: [{ ...result.results[0], commandId: id(99) }, result.results[1]] };
    if (field === "duplicate") return { ...result, results: [result.results[0], result.results[0]] };
    return { ...result, results: [result.results[0]] };
  });
  assert.equal((await h.executor.execute(bulk(), h.options())).kind, "uncertain");
  assert.equal((await h.executor.execute(command(11, OTHER), h.options())).kind, "refused");
});

it("preserves mixed child outcomes, keeps only uncertain locks, and replays the full ordered envelope", async () => {
  const h = harness();
  const request = bulk(20, [RUN, OTHER, id(3), id(4)]);
  h.setReply(input => {
    assert.ok("targets" in input);
    const result = vector(input);
    h.state.set(RUN, { version: 2, cancelled: true });
    return { ...result, results: [result.results[0], { ...result.results[1], outcome: "conflict", replayed: undefined, currentVersion: 3 },
      { outcome: "refused", runId: id(3), commandId: result.results[2].commandId, code: "policy-refused", detail: "private" },
      { outcome: "refused", runId: id(4), commandId: result.results[3].commandId, code: "authority-uncertain", detail: "private" }] };
  });
  const result = await h.executor.execute(request, h.options());
  assert.equal(result.kind, "uncertain");
  assert.deepEqual(result.children?.map(child => child.kind), ["confirmed", "conflict", "refused", "uncertain"]);
  h.setReply(undefined);
  assert.equal((await h.executor.execute(command(11, id(4)), h.options())).kind, "refused");
  assert.equal((await h.executor.replay(request.commandId, h.options())).kind, "confirmed");
  assert.equal(h.sent[0], h.sent[1]);
});

it("accepts the kernel's errored prefix and retains unattempted targets in order", async () => {
  const h = harness();
  h.setReply(request => {
    assert.ok("targets" in request);
    return { ...vector(request), results: [{ outcome: "errored", runId: RUN, commandId: deriveBulkChildCommandId(request.bulkCommandId, RUN), detail: "private" }] };
  });
  const result = await h.executor.execute(bulk(), h.options());
  assert.deepEqual(result.children?.map(child => child.kind), ["uncertain", "refused"]);
  assert.equal(result.children?.[1].kind === "refused" && result.children[1].reason, "not-attempted");
  h.setReply(undefined);
  assert.equal((await h.executor.execute(command(11, OTHER), h.options())).kind, "confirmed");
  assert.equal((await h.executor.execute(command(12), h.options())).kind, "refused");
});

for (const replacement of ["day-ABA", "actor", "client", "authority", "unmounted"] as const) {
  it(`suppresses old ${replacement} publication and retains uncertainty outside consumer lifetime`, async () => {
    const h = harness(); const pending = deferred<unknown>();
    h.setReply(() => pending.promise);
    const original = h.options();
    const running = h.executor.execute(command(), original);
    assert.ok(original.scope);
    h.replaceScope(replacement === "unmounted" ? undefined : { ...original.scope,
      ...(replacement === "actor" ? { actorId: "another-operator" } : replacement === "client" ? { client: harness().client }
        : replacement === "authority" ? { authority: {} } : { dayRequest: {} }) });
    pending.reject(new Error("unknown transport effect"));
    assert.equal((await running).kind, "uncertain");
    assert.equal(h.published.length, 0);
    assert.equal(h.executor.retainedAttempts().length, 1);
    if (replacement === "unmounted") h.replaceScope({ ...original.scope, authority: {} });
    const nextOptions = h.options();
    const refused = await h.executor.execute({ ...command(11), requestedBy: nextOptions.scope.actorId }, nextOptions);
    assert.equal(refused.kind, "refused");
    assert.ok(refused.kind === "refused" && refused.reason === "locked");
    if (replacement === "actor") assert.equal((await h.executor.replay(id(10), h.options())).kind, "refused");
  });
}

it("replays through a replacement client only on explicit same-actor request", async () => {
  const h = harness(); h.setReply(() => { throw new Error("unknown"); });
  await h.executor.execute(command(), h.options());
  const next = harness(); const original = h.options().scope;
  h.replaceScope({ ...original, client: next.client, authority: {}, dayRequest: {} });
  assert.equal((await h.executor.execute(command(11), h.options())).kind, "refused");
  const result = await h.executor.replay(id(10), { ...h.options(), readback: next.options().readback });
  assert.equal(result.kind, "confirmed");
  assert.equal(next.sent[0], h.sent[0]);
});

it("an older completed attempt cannot clear a newer pending reservation even when publication throws", async () => {
  const h = harness(); const next = deferred<unknown>(); let newer: Promise<CommandOutcome> | undefined;
  const cause = new Error("subscriber failed");
  const result = await h.executor.execute(command(), { ...h.options(), publish: () => {
    h.setReply(() => next.promise);
    newer = h.executor.execute(command(11, RUN, 2), h.options());
    throw cause;
  } });
  assert.equal(result.kind, "confirmed"); assert.equal(result.cause, cause);
  assert.equal((await h.executor.execute(command(12, RUN, 3), h.options())).kind, "refused");
  assert.equal(h.sent.length, 2);
  next.resolve({ state: "rejected", commandId: id(11), code: "policy-refused", message: "private" });
  assert.equal((await newer)?.kind, "refused");
});


it("suppresses a confirmed old result after an A to B to A request transition", async () => {
  const h = harness(); const read = deferred<unknown>();
  const options = h.options();
  const running = h.executor.execute(command(), { ...options, readback: async (request, reply, scope) => {
    await read.promise;
    return options.readback(request, reply, scope);
  } });
  await new Promise(resolve => setTimeout(resolve, 0));
  h.replaceScope({ ...options.scope, dayRequest: {} });
  h.replaceScope({ ...options.scope, dayRequest: {} });
  read.resolve(undefined);
  assert.equal((await running).kind, "confirmed");
  assert.equal(h.published.length, 0);
});

it("refuses invalid composition, replaced scope, changed actor and reused identity before sending", async () => {
  const h = harness(); const options = h.options();
  assert.equal((await h.executor.execute({}, options)).kind, "failed");
  assert.equal((await h.executor.execute({ ...command(), requestedBy: "another-operator" }, options)).kind, "refused");
  h.replaceScope({ ...options.scope, authority: {} });
  assert.equal((await h.executor.execute(command(), options)).kind, "refused");
  assert.equal(h.sent.length, 0);
  h.replaceScope(options.scope);
  await h.executor.execute(command(), options);
  assert.equal((await h.executor.execute(command(), options)).kind, "refused");
  assert.equal(h.sent.length, 1);
});

it("a pending bulk blocks single children and reserves the child command identities", async () => {
  const h = harness(); const pending = deferred<unknown>();
  h.setReply(() => pending.promise);
  const request = bulk(); const running = h.executor.execute(request, h.options());
  assert.equal((await h.executor.execute(command(11, OTHER, 99), h.options())).kind, "refused");
  pending.resolve({ state: "refused", code: "policy-refused", message: "private" });
  await running;
  assert.equal((await h.executor.execute({ ...command(), commandId: deriveBulkChildCommandId(request.bulkCommandId, RUN) }, h.options())).kind, "refused");
  assert.equal(h.sent.length, 1);
});


it("retains schema-transformed payload bytes through mutation and explicit replay", async () => {
  const h = harness();
  h.setReply(request => ({ state: "rejected", commandId: request.commandId, code: "authority-uncertain", message: "private" }));
  const input = { ...command(), family: "failure-resolution", type: "annotate-failure", target: { runId: RUN, failureId: id(90), expectedVersion: 1 },
    payload: { action: "resolve", note: "  Reviewed evidence  " } };
  assert.equal((await h.executor.execute(input, h.options())).kind, "uncertain");
  const parsed = CommandRequestSchema.parse(JSON.parse(h.sent[0]));
  assert.equal(parsed.family, "failure-resolution");
  if (parsed.family !== "failure-resolution") assert.fail("expected failure-resolution");
  assert.equal(parsed.payload.action, "resolve");
  assert.ok(parsed.payload.action === "resolve" && parsed.payload.note === "Reviewed evidence");
  input.payload.note = "Changed";
  await h.executor.replay(input.commandId, h.options());
  assert.equal(h.sent[0], h.sent[1]);
  assert.equal(h.executor.retainedAttempts().length, 1);
});


it("publishes current refusal feedback through the same owner while replaced scopes stay silent", async () => {
  const h = harness(); const original = h.options();
  const pending = deferred<unknown>(); h.setReply(() => pending.promise);
  const running = h.executor.execute(command(), original);
  const result = await h.executor.execute(command(11), original);
  assert.equal(result.kind, "refused"); assert.equal(h.published.length, 1);
  assert.equal(h.published[0], result);
  h.replaceScope({ ...original.scope, authority: {} });
  await h.executor.execute(command(12), original);
  assert.equal(h.published.length, 1);
  pending.resolve({ state: "rejected", commandId: id(10), code: "policy-refused", message: "private" });
  await running;
  assert.equal(h.published.length, 1);
});

for (const code of ["OPERATOR_MUTATION_ORIGIN_REFUSED", "OPERATOR_MUTATION_MEDIA_TYPE_REFUSED", "UNKNOWN_DENIAL"]) {
  for (const grouped of [false, true]) {
    it(`classifies ${code} for ${grouped ? "bulk" : "single"} without readback and retains the original denial`, async () => {
      const h = harness();
      h.setReply(() => Response.json({ state: "error", code, message: "private admission detail", retryable: false }, { status: 403 }));
      let reads = 0;
      const options = { ...h.options(), readback: async () => { reads++; return { state: "matched" as const, evidence: {} }; } };
      const outcome = await h.executor.execute(grouped ? bulk() : command(), options);
      assert.equal(outcome.kind, code === "UNKNOWN_DENIAL" ? "uncertain" : "refused");
      assert.equal(h.executor.retainedAttempts()[0].outcome?.cause, outcome.cause);
      assert.ok(outcome.cause instanceof Error && "code" in outcome.cause && outcome.cause.code === code);
      assert.equal(outcome.cause.message, "private admission detail"); assert.equal(reads, 0);
      assert.equal(outcome.kind === "refused" || outcome.kind === "uncertain", true);
      assert.doesNotMatch(outcome.feedback.text, /private admission detail/u);
      h.setReply(undefined);
      assert.equal((await h.executor.execute(command(70), h.options())).kind, code === "UNKNOWN_DENIAL" ? "refused" : "confirmed");
      if (grouped) assert.equal((await h.executor.execute(command(71, OTHER), h.options())).kind, code === "UNKNOWN_DENIAL" ? "refused" : "confirmed");
    });
  }
}

it("retains admitted worker pending without readback or a terminal result", async () => {
  const h = harness();
  const request = CommandRequestSchema.parse({ ...command(), family: "worker-browser", type: "stop-worker",
    target: { workerId: "person-lookup-worker-1", membershipRevision: 1, controlBasis: { leaseGeneration: 1, controlRevision: 1 } } });
  h.setReply(() => ({ state: "pending", commandId: request.commandId }));
  const options = h.options();
  const outcome = await h.executor.execute(request, { ...options, readback: async () => { assert.fail("pending cannot confirm from readback"); } });
  assert.equal(outcome.kind, "uncertain");
  assert.equal(h.executor.retainedAttempts()[0]?.request.commandId, request.commandId);
  assert.deepEqual(outcome.reply, { state: "pending", commandId: request.commandId });
});

it("treats unexpected pending Start as protocol uncertainty and retains the original attempt", async () => {
  const h = harness();
  const request = CommandRequestSchema.parse({ ...command(), family: "start", type: "start-run",
    target: { workflowId: "person-lookup", startPlanId: id(50), expectedVersion: 1 },
    payload: Object.fromEntries(["descriptorFingerprint", "configFingerprint", "ingressSchemaHash", "canonicalInputSchemaHash", "inputFingerprint"].map(key => [key, "ab".repeat(32)])) });
  h.setReply(() => ({ state: "pending", commandId: request.commandId }));
  const outcome = await h.executor.execute(request, h.options());
  assert.equal(outcome.kind, "uncertain");
  assert.equal(h.executor.retainedAttempts()[0]?.request.commandId, request.commandId);
});

it("checks an uncertain original without POST and releases only exact confirmed readback", async () => {
  const h = harness(); const request = command();
  h.setReply(() => ({ state: "pending", commandId: request.commandId }));
  assert.equal((await h.executor.execute(request, h.options())).kind, "uncertain");
  const options = { ...h.options(), observe: async () => CommandResultSchema.parse({ state: "conflict", commandId: request.commandId, currentVersion: 3, message: "diagnostic" }) };
  assert.equal((await h.executor.check(request.commandId, options)).kind, "uncertain");
  assert.equal((await h.executor.execute(command(11), h.options())).kind, "refused");
  h.state.set(RUN, { version: 2, cancelled: true });
  assert.equal((await h.executor.check(request.commandId, { ...h.options(), observe: async () => CommandResultSchema.parse(landing(request)) })).kind, "confirmed");
  assert.equal(h.sent.length, 1);
  assert.equal((await h.executor.execute(command(12), h.options())).kind, "uncertain");
  assert.equal(h.sent.length, 2);
});

it("keeps mismatch checkable and rejects concurrent checks and A to B to A late publication", async () => {
  const h = harness(); const request = command();
  h.setReply(() => ({ state: "pending", commandId: request.commandId }));
  await h.executor.execute(request, h.options());
  assert.equal((await h.executor.check(request.commandId, { ...h.options(), observe: async () => CommandResultSchema.parse(landing(request)) })).kind, "uncertain");
  let release!: (value: CommandResult) => void;
  const original = h.scope()!; const options = h.options(); const before = h.published.length;
  const pending = h.executor.check(request.commandId, { ...options, observe: () => new Promise(resolve => { release = resolve; }) });
  assert.equal((await h.executor.check(request.commandId, { ...options, observe: async () => CommandResultSchema.parse(landing(request)) })).kind, "refused");
  h.replaceScope({ ...original, dayRequest: {} }); h.replaceScope({ ...original, dayRequest: {} });
  h.state.set(RUN, { version: 2, cancelled: true }); release(CommandResultSchema.parse(landing(request)));
  assert.equal((await pending).kind, "uncertain");
  assert.equal(h.published.length, before + 1, "only synchronous overlap refusal published");
  assert.equal((await h.executor.execute(command(11), h.options())).kind, "refused");
  assert.equal((await h.executor.check(request.commandId, { ...h.options(), observe: async () => CommandResultSchema.parse(landing(request)) })).kind, "confirmed");
  assert.equal(h.sent.length, 1);
});

it.each(["actor", "client", "authority"])("cannot check/release original under changed %s", async field => {
  const h = harness(); const request = command(); h.setReply(() => ({ state: "pending", commandId: request.commandId }));
  await h.executor.execute(request, h.options()); const prior = h.scope()!;
  h.replaceScope({ ...prior, ...(field === "actor" ? { actorId: "different" } : field === "client" ? { client: harness().client } : { authority: {} }) });
  let reads = 0;
  assert.equal((await h.executor.check(request.commandId, { ...h.options(), observe: async () => { reads++; return CommandResultSchema.parse(landing(request)); } })).kind, "refused");
  assert.equal(reads, 0); assert.equal(h.sent.length, 1);
});

it('retains the unknown preference lock for the same profile while allowing a different profile', async () => {
  const h = harness(), profileA = id(700), profileB = id(701);
  h.setReply(request => {
    assert.ok(!('targets' in request)); assert.equal(request.family, "assistant-model-preference");
    if (request.family !== "assistant-model-preference") assert.fail('preference-request-required');
    return { state: 'applied', commandId: request.commandId,
      affectedTargets: [{ family: "assistant-model-preference", profileId: request.target.profileId, revision: request.target.expectedRevision + 1 }] };
  });
  const options = h.options();
  const make = (n: number, profileId: string) => CommandRequestSchema.parse({ commandId: id(n), requestedAt: '2026-01-02T03:04:05.000Z',
    requestedBy: options.scope.actorId, source: 'dashboard-assistant-model-preference', family: "assistant-model-preference", type: "set-assistant-model-preference",
    target: { profileId, epoch: 2, expectedRevision: 0 }, payload: { slug: ASSISTANT_DEFAULT_MODEL, effort: ASSISTANT_DEFAULT_EFFORT } });
  const first = await h.executor.execute(make(901, profileA), { ...options, readback: async () => ({ state: "mismatch", evidence: null }) });
  assert.equal(first.kind, "uncertain"); assert.equal(h.sent.length, 1);
  const blocked = await h.executor.execute(make(902, profileA), options);
  assert.equal(blocked.kind, "refused"); assert.equal(h.sent.length, 1);
  const separate = await h.executor.execute(make(903, profileB), { ...options, readback: async () => ({ state: "mismatch", evidence: null }) });
  assert.equal(separate.kind, "uncertain"); assert.equal(h.sent.length, 2);
  assert.equal(h.executor.retainedAttempts().filter(attempt => attempt.outcome?.kind === "uncertain").length, 2);
});
