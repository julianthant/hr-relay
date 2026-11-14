import { faultAuthoritySnapshot, assertHttpFaultOnly, exactHttpFaultLoopDelay } from "../../../../support/helpers/backend/http-route-harness.js";
import { AssistantModelPreferenceViewSchema } from '../../../../../src/models/dashboard/assistant.js';
import { withAuthorityDatabaseReadOnly } from "../../../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";
import configuredSources from "../../../../../config/dashboard-workflow-sources.json";
import { z } from "zod";
import { DESCRIPTORS } from "../../../../../src/backend/app/registries/workflow-registry.js";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { it, vi } from "vitest";
import { composeDashboardRuntime } from "../../../../../src/backend/app/composition/dashboard/compose.js";
import { composeProfileRuntime } from "../../../../../src/backend/app/composition/storage-compose.js";
import { assistantKnowledgeArtifact, ASSISTANT_KNOWLEDGE_PATH } from "../../../../../src/backend/assistant/context.js";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { ASSISTANT_FAILURES, ASSISTANT_VERIFY_COMMAND,  AssistantInferenceRequestSchema, AssistantResultSchema, AssistantActionResultSchema } from "../../../../../src/models/dashboard/assistant.js";
import { NotificationRecordSchema } from "../../../../../src/models/notifications/notifications.js";
import { CommandResultSchema } from "../../../../../src/rules/commands/commands.js";
import { SETTINGS_SCHEMA_HASH, deriveRawSettingsPatchFingerprint } from "../../../../../src/models/config/settings.js";
import { createBoundProfileFixture } from "../../../../support/helpers/admission-fixture.js";
import { chatGptFixture , publicCapabilityResponses } from "../../../../support/helpers/chatgpt-account-fixtures.js";
import { completedResponseStream } from "../../../../support/helpers/chatgpt-response-stream.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";
import { createDashboardClient } from "../../../../../src/dashboard/client/index.js";
import { ScriptedWorkerChild } from "../../../../support/helpers/backend/fake-worker-port.js";
import { personLookupQueuedRun } from "../../../../support/helpers/phase1f-executor-harness.js";
import { RunRecordSchema } from "../../../../../src/models/run/record.js";
import { createTimelineEmitter } from "../../../../../src/backend/storage/events/timeline-emitter.js";
import { runQueuedSpanEvent } from "../../../../../src/backend/runs/commands/run-queued-span.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../../src/rules/identity/ids.js";
import { deriveTraceId } from "../../../../../src/rules/identity/identifiers.js";
import { canonicalJsonStringify } from "../../../../../src/rules/validation/canonical-json.js";

const AssistantTransportRequestSchema = AssistantInferenceRequestSchema.safeExtend({
  store: z.literal(false), stream: z.literal(true), parallel_tool_calls: z.literal(false),
  include: z.tuple([z.literal("reasoning.encrypted_content")]),
});

type ServedAssistantFixture = {
  profile: Awaited<ReturnType<typeof createBoundProfileFixture>>;
  context: ReturnType<ReturnType<typeof composeProfileRuntime>['selectedContext']>;
  transport: Awaited<ReturnType<typeof chatGptFixture>>;
  clock: Awaited<ReturnType<typeof chatGptFixture>>['clock'];
  originalFetch: typeof fetch;
  origin: string;
  post: (path: string, value: unknown) => Promise<unknown>;
};
function assertAssistantProposalFaults(owner: Parameters<typeof faultAuthoritySnapshot>[0], before: ReturnType<typeof faultAuthoritySnapshot>,
  reason: "canonical-completion-required" | "action-decision") {
  assertHttpFaultOnly(owner, before, 2);
  const added = owner.database.authority.timelineEvents.page({ limit: 500 }).slice(before.timeline.length);
  const [proposal, http] = added; assert.ok(proposal && http);
  assert.ok(proposal.cursor < http.cursor);
  assert.notEqual(proposal.eventId, http.eventId);
  const events = added.map(record => {
    assert.deepEqual(record.scope, { kind: "transport", connectionId: "local" });
    assert.equal(record.payload.kind, "debug");
    if (record.payload.kind !== "debug") throw new Error("assistant refusal diagnostic required");
    const { build, pid, pinned, ...event } = record.payload.event;
    assert.ok(build.length > 0); assert.equal(pid, process.pid); assert.equal(pinned, false);
    z.uuid().parse(event.correlationId);
    return event;
  });
  assert.notEqual(events[0].correlationId, events[1].correlationId);
  assert.deepEqual(events.map(event => ({ ...event, correlationId: "generated" })), [
    { category: "http", phase: "failed", correlationId: "generated", area: "assistant-proposal", reason, code: "ASSISTANT_PROPOSAL_REFUSED" },
    { category: "http", phase: "failed", correlationId: "generated", area: "request", reason: "operation-refused", code: "ASSISTANT_PROPOSAL_REFUSED",
      method: "POST", route: reason === "canonical-completion-required" ? "/api/v1/assistant/respond" : "/api/v1/assistant/action", status: 200 },
  ]);
}
type ServedAssistantOwner = {
  profile?: Awaited<ReturnType<typeof createBoundProfileFixture>>;
  transport?: Awaited<ReturnType<typeof chatGptFixture>>;
  runtime?: ReturnType<typeof composeProfileRuntime>;
  dashboard?: Awaited<ReturnType<typeof composeDashboardRuntime>>;
  fetchProbe?: { mockRestore(): void };
  unsettled: Error;
  primary?: { error: unknown };
  failures: unknown[];
};
let servedAssistantOwner: ServedAssistantOwner | undefined;
async function withServedAssistant(body: (fixture: ServedAssistantFixture) => Promise<void>,
  workerProcess?: Parameters<typeof composeDashboardRuntime>[0]["workerProcess"]) {
  if (servedAssistantOwner !== undefined) {
    const error = servedAssistantOwner.primary === undefined ? servedAssistantOwner.unsettled : servedAssistantOwner.primary.error;
    if (error instanceof Error) throw error;
    throw new AggregateError([error], 'Predecessor assistant fixture remains unproved', { cause: error });
  }
  const owner: ServedAssistantOwner = { unsettled: new Error('Predecessor assistant fixture is unsettled'), failures: [] };
  servedAssistantOwner = owner;
  let ready = false;
  let primary: { error: unknown } | undefined;
  try {
    const f = await createBoundProfileFixture();
    owner.profile = f;
    const transport = await chatGptFixture(f.admission);
    owner.transport = transport;
    const originalFetch = globalThis.fetch;
    const fetchProbe = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return originalFetch(input, init);
    return transport.transport(input, init);
  });
    owner.fetchProbe = fetchProbe;
    const clock = transport.clock;
    const runtime = composeProfileRuntime({ admission: f.machine, clock, hostFacts: { primaryDisplay: null } });
    owner.runtime = runtime;
    for (const name of ["package.json", "package-lock.json"]) copyFileSync(name, join(f.workspace, name));
    const sources = z.record(z.string(), z.enum(["mock", "served", "hidden"])).parse(configuredSources);
    const knowledge = assistantKnowledgeArtifact(DESCRIPTORS.filter(descriptor => sources[descriptor.id] === "served").map(descriptor => ({ id: descriptor.id, label: descriptor.label })));
    const target = join(f.workspace, ASSISTANT_KNOWLEDGE_PATH);
    mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, `${knowledge.bytes}\n`);
    const document = join(f.workspace, knowledge.reference.files[0].path);
    mkdirSync(dirname(document), { recursive: true }); writeFileSync(document, `${knowledge.reference.files[0].text}\n`);
    const active = runtime.session.signIn({ email: "fixture@ucsd.edu", password: "disposable-fixture-password", at: clock.now().toISOString() });
    assert.equal(active.state, "active"); if (active.state !== "active") throw new Error("selected fixture required");
    const context = runtime.selectedContext(active.token);
    const authorization = await context.account.signIn({ usePlan: true }); await transport.callback(authorization); await authorization.completion;
    const dashboard = await composeDashboardRuntime({ lifetimeLock: f.lifetime, admission: f.machine, profile: { runtime, token: active.token }, repoRoot: f.workspace,
      clock, isolation: rebuildRuntimeIsolation, env: {}, backendPortOverride: 0, frontendPortOverride: 0, preflightRunnerFactory: healthyRuntimePreflightRunners, loopDelay: exactHttpFaultLoopDelay,
      ...(workerProcess === undefined ? {} : { workerProcess }) });
    owner.dashboard = dashboard;
    const origin = `http://127.0.0.1:${String(dashboard.port)}`;
    const post = async (path: string, value: unknown): Promise<unknown> => {
      const response = await originalFetch(`${origin}/api/v1/${path}`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(value) });
      const body: unknown = await response.json(); return body;
    };

    ready = true;
    await body({ profile: f, context, transport, clock, originalFetch, origin, post });
  } catch (error) { primary = { error }; owner.primary = primary; }
  if (!ready) {
    const error = primary?.error;
    if (error instanceof Error) throw error;
    throw new AggregateError([error], 'Assistant fixture construction failed', { cause: error });
  }
  try {
    assert.ok(owner.runtime);
    assert.ok(owner.transport);
    assert.ok(owner.fetchProbe);
    assert.ok(owner.profile);
    if (owner.dashboard !== undefined) await owner.dashboard.stop(); else await owner.runtime.close();
    await owner.transport.cleanup();
    owner.fetchProbe.mockRestore();
    await owner.profile.close();
    servedAssistantOwner = undefined;
  } catch (error) { owner.failures.push(error); owner.primary ??= { error }; }
  if (primary !== undefined || owner.failures.length > 0) throw new AggregateError(
    [...(primary === undefined ? [] : [primary.error]), ...owner.failures],
    'Composed assistant fixture failed', { cause: primary === undefined ? owner.failures[0] : primary.error });
}

function seedAssistantReadRun({ context, clock }: Pick<ServedAssistantFixture, 'context' | 'clock'>) {
  const active = context.database.authority.runtimeConfig.get(); assert.ok(active);
  const candidate = RunRecordSchema.parse(personLookupQueuedRun({ runId: randomUUID(), itemId: randomUUID() }));
  const now = clock.now().toISOString(), title = 'Private selected run evidence';
  const run = RunRecordSchema.parse({ ...candidate, createdAt: now, updatedAt: now, envelope: { ...candidate.envelope,
    traceId: deriveTraceId('pl', candidate.envelope.runId, clock), enqueuedAt: now,
    configSnapshotId: active.configSnapshotId, configFingerprint: active.configFingerprint } });
  const descriptor = DESCRIPTORS.find(value => value.id === run.envelope.workflow), node = descriptor?.timeline?.[0]?.nodes[0]; assert.ok(node);
  context.database.withAuthorityTransaction(repositories => {
    assert.equal(repositories.runs.enqueue(run).state, 'inserted');
    const writer = createTimelineEmitter({ repository: repositories.timelineEvents, clock });
    writer.emit(runQueuedSpanEvent({ run, actorId: LOCAL_OPERATOR_ACTOR_ID, title }));
    for (let index = 0; index < 12; index++) {
      const base = { workflow: run.envelope.workflow, runId: run.envelope.runId, attempt: run.envelope.attempt,
        traceId: run.envelope.traceId, ts: now, kind: 'task' as const, spanPath: `${run.envelope.traceId}/${node.id}#1.${index + 1}` };
      writer.emit({ ...base, t: 'span.started', parentSpanPath: run.envelope.traceId, name: 'Private recorded task evidence '.repeat(4) + String(index + 1) });
      writer.emit({ ...base, t: 'span.ended', outcome: 'done' });
    }
  });
  return { run, title, subjectRef: `run_${run.envelope.runId}_${run.version}` };
}

it('serves canonical selected-run reads through authenticated composition without private provider input or command effects', async () => {
  await withServedAssistant(async fixture => {
    const { context, transport, origin, originalFetch } = fixture, { run, title, subjectRef } = seedAssistantReadRun(fixture);
    const client = createDashboardClient({ baseUrl: origin });
    await vi.waitFor(async () => assert.equal((await client.runDetail(run.envelope.runId)).timeline.events.length, 12));
    const detail = await client.runDetail(run.envelope.runId);
    assert.equal(detail.timeline.events.length, 12);
    const unverifiedCalls = transport.calls.length;
    assert.deepEqual(await client.assistantRespond({ message: 'run status', subjectRef }), { state: 'refused', code: 'ASSISTANT_MODEL_UNVERIFIED', message: ASSISTANT_FAILURES.ASSISTANT_MODEL_UNVERIFIED });
    assert.equal(transport.calls.length, unverifiedCalls);
    publicCapabilityResponses(transport);
    assert.equal((await client.assistantRespond({ message: ASSISTANT_VERIFY_COMMAND })).state, 'answered');
    let turns = 0, forged = false;
    transport.setResponse(init => {
      assert.equal(typeof init.body, 'string'); if (typeof init.body !== 'string') throw Error('synthetic request body required');
      const request = AssistantTransportRequestSchema.parse(JSON.parse(init.body)), outbound = JSON.stringify(request);
      for (const value of [run.envelope.runId, run.envelope.traceId, subjectRef, title, '10873698', 'Private recorded task evidence']) assert.equal(outbound.includes(value), false);
      assert.deepEqual(request.tools.map(namespace => [namespace.name, namespace.tools.map(tool => tool.name)]), [['relay', ['explain_selected_run']]]);
      const user = request.input.find(item => 'role' in item && item.role === 'user'); assert.ok(user && 'content' in user && typeof user.content === 'string');
      const projected = z.strictObject({ intent: z.literal('selected-run-explanation'), reference: z.string().regex(/^ref_[a-f0-9]{32}$/u) }).parse(JSON.parse(user.content));
      turns++;
      return new Response(completedResponseStream([{ type: 'function_call', namespace: 'relay', name: 'explain_selected_run', call_id: 'read_run', arguments: JSON.stringify({ reference: forged ? 'ref_' + 'f'.repeat(32) : projected.reference }), status: 'completed' }], request.model, 'resp_run_read'), { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const durable = () => withAuthorityDatabaseReadOnly(context.admission, join(context.admission.stateRoot, 'state.db'), database => ({
      chats: database.prepare('SELECT * FROM assistant_chats ORDER BY id').all(), actions: database.prepare('SELECT * FROM assistant_actions ORDER BY id').all(),
      commands: database.prepare('SELECT * FROM commands ORDER BY id').all(), audits: database.prepare('SELECT * FROM command_audits ORDER BY id').all(),
    }));
    const before = durable();
    assert.equal(context.database.authority.assistantAuthorization.grant(), undefined);
    const answered = await client.assistantRespond({ message: 'explain this run', subjectRef });
    assert.equal(answered.state, 'answered'); if (answered.state !== 'answered') throw Error('composed canonical answer required');
    assert.ok(answered.text.includes(`${detail.header.title}: ${detail.header.status}.`)); assert.equal(turns, 1);
    assert.equal(answered.citations.length, 4);
    const sources = new Set<string>();
    for (const citation of answered.citations) {
      assert.ok('kind' in citation);
      assert.equal(citation.runId, run.envelope.runId); assert.equal(citation.rowRevision, detail.rowRevision); assert.ok(citation.quote.length <= 4000);
      assert.equal(citation.digest, createHash('sha256').update(canonicalJsonStringify({ runId: citation.runId, rowRevision: citation.rowRevision, source: citation.source, quote: citation.quote })).digest('hex'));
      sources.add(citation.source);
      if (citation.source === 'timeline') {
        const quoted = z.strictObject({ total: z.literal(12), omitted: z.number().int().nonnegative(), events: z.array(z.unknown()) }).parse(JSON.parse(citation.quote));
        assert.ok(quoted.events.length > 0 && quoted.events.length < 10); assert.equal(quoted.omitted, 12 - quoted.events.length);
        assert.deepEqual(quoted.events, detail.timeline.events.slice(-quoted.events.length).map(({ native, at, label, state, notRun }) => ({ native: native ?? null, at, label, state, notRun })));
        assert.ok(answered.text.includes(`${quoted.events.length} of 12; ${quoted.omitted} omitted`));
      } else assert.equal(citation.quote, canonicalJsonStringify(citation.source === 'status' ? detail.header : detail[citation.source]));
    }
    assert.deepEqual([...sources].sort(), ['gate', 'outcome', 'status', 'timeline']);
    for (const reference of [`run_${run.envelope.runId}_${run.version + 1}`, `run_${randomUUID()}_1`]) {
      const refused = await client.assistantRespond({ message: 'run status', subjectRef: reference });
      assert.equal(refused.state, 'refused'); if (refused.state === 'refused') assert.equal(refused.code, reference.includes(run.envelope.runId) ? 'ASSISTANT_READ_STALE' : 'ASSISTANT_READ_UNAVAILABLE');
    }
    assert.equal(turns, 1);
    const foreign = await originalFetch(`${origin}/api/v1/assistant/respond`, { method: 'POST', headers: { Origin: 'https://foreign.invalid', 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'run status', subjectRef }) });
    assert.equal(foreign.status, 403); assert.equal(turns, 1);
    forged = true;
    const refused = await client.assistantRespond({ message: 'run status', subjectRef });
    assert.equal(refused.state, 'refused'); if (refused.state === 'refused') assert.equal(refused.code, 'ASSISTANT_PROPOSAL_REFUSED');
    assert.equal(turns, 2);
    assert.deepEqual(durable(), before);
    assert.deepEqual(context.database.authority.runs.get(run.envelope.runId), run);
    assert.equal(context.database.authority.assistantAuthorization.grant(), undefined);
  });
});

it('refuses a selected-run revision changed during authenticated composed inference', async () => {
  await withServedAssistant(async fixture => {
    const { context, transport, origin, clock } = fixture, { run, subjectRef } = seedAssistantReadRun(fixture), client = createDashboardClient({ baseUrl: origin });
    await vi.waitFor(async () => assert.equal((await client.runDetail(run.envelope.runId)).timeline.events.length, 12));
    publicCapabilityResponses(transport);
    assert.equal((await client.assistantRespond({ message: ASSISTANT_VERIFY_COMMAND })).state, 'answered');
    const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    let turns = 0;
    transport.setResponse(init => {
      assert.equal(typeof init.body, 'string'); if (typeof init.body !== 'string') throw Error('synthetic request body required');
      const request = AssistantTransportRequestSchema.parse(JSON.parse(init.body));
      const user = request.input.find(item => 'role' in item && item.role === 'user'); assert.ok(user && 'content' in user && typeof user.content === 'string');
      const projected = z.strictObject({ intent: z.literal('selected-run-explanation'), reference: z.string() }).parse(JSON.parse(user.content));
      turns++; entered.resolve();
      return new Response(new ReadableStream({ async start(controller) {
        await release.promise;
        controller.enqueue(new TextEncoder().encode(completedResponseStream([{ type: 'function_call', namespace: 'relay', name: 'explain_selected_run', call_id: 'read_run', arguments: JSON.stringify({ reference: projected.reference }), status: 'completed' }], request.model, 'resp_held_read'))); controller.close();
      } }), { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const reading = client.assistantRespond({ message: 'run status', subjectRef });
    await Promise.race([entered.promise, reading.then(() => { throw Error('read settled before entering inference'); })]);
    const cancelled = await client.executeCommand({ commandId: randomUUID(), requestedAt: clock.now().toISOString(), requestedBy: 'local-operator', source: 'queue-row', family: 'run', type: 'cancel', target: { runId: run.envelope.runId, expectedVersion: run.version } }).finally(() => release.resolve());
    const result = await reading;
    assert.equal(cancelled.state, 'applied');
    assert.equal(result.state, 'refused'); if (result.state === 'refused') assert.equal(result.code, 'ASSISTANT_READ_STALE');
    assert.equal(turns, 1);
    assert.ok(context.database.authority.runs.get(run.envelope.runId)?.version !== run.version);
    assert.equal(context.database.authority.assistantAuthorization.grant(), undefined);
  });
});

it.each([
  { mode: undefined, staleAccount: false }, { mode: "every-action", staleAccount: false },
  { mode: "every-action", staleAccount: true },
] as const)("uses the real composed selected-account service with permission=$mode staleAccount=$staleAccount and bounded outbound data", async ({ mode, staleAccount }) => {
  const installed = mode !== undefined;
  await withServedAssistant(async ({ context, transport, clock, originalFetch, origin, post }) => {
    if (installed) {
      const preferenceResponse = await originalFetch(`${origin}/api/v1/assistant/model-preference`);
      assert.equal(preferenceResponse.status, 200);
      assert.equal(preferenceResponse.headers.get('cache-control'), 'no-store');
      const preference = AssistantModelPreferenceViewSchema.parse(await preferenceResponse.json());
      assert.equal(preference.profileId, context.admission.profileBinding.profileId);
      assert.equal(preference.epoch, context.profileEpoch);
      assert.equal(preference.revision, 0);
      publicCapabilityResponses(transport);
      const verified = AssistantResultSchema.parse(await post('assistant/respond', { message: ASSISTANT_VERIFY_COMMAND, subjectRef: 'ignored-fixture-reference' }));
      assert.equal(verified.state, 'answered');
    }
    const before = transport.calls.length;
    const privateResult = AssistantResultSchema.parse(await post("assistant/respond", { message: "unrecognized private local request" }));
    assert.equal(privateResult.state, "refused");
    if (privateResult.state === "refused") assert.equal(privateResult.code, installed ? "ASSISTANT_PROPOSAL_REFUSED" : "ASSISTANT_MODEL_UNVERIFIED");
    assert.equal(transport.calls.length, before);
    if (installed) {
      const grant = CommandResultSchema.parse(await post("commands", { commandId: randomUUID(), requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source: "settings-surface",
        family: "settings", type: "apply-settings", target: { expectedRevision: context.settings.read().record.revision },
        payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveRawSettingsPatchFingerprint({}), patch: {}, assistantPermission: { expectedPolicyRevision: 0, mode } } }));
      assert.equal(grant.state, "applied");
      const id = randomUUID(), ids = [id, ...Array.from({ length: 24 }, () => randomUUID())];
      context.database.withAuthorityTransaction(({ notifications }) => { for (const [index, notificationId] of ids.entries()) notifications.create(NotificationRecordSchema.parse({ notificationId, actorId: "local-operator", dedupeFingerprint: index.toString(16).padStart(64, "0"),
        trigger: "storage", channel: "ping", status: "unread", snooze: { state: "not-snoozed" }, title: "Local title", summary: "Local summary", links: [{ kind: "storage", diagnosticFingerprint: "b".repeat(64) }],
        count: 1, version: 1, lastSeenAt: clock.now().toISOString(), createdAt: clock.now().toISOString(), updatedAt: clock.now().toISOString() })); });
      const noCallBaseline = faultAuthoritySnapshot({ database: context.database, stateRoot: context.admission.stateRoot });
      const noCallRows = context.database.authority.notifications.listByActor("local-operator");
      const durableRows = () => withAuthorityDatabaseReadOnly(context.admission, join(context.admission.stateRoot, "state.db"), database => ({
        actions: database.prepare("SELECT * FROM assistant_actions ORDER BY id").all(),
        commands: database.prepare("SELECT * FROM commands ORDER BY id").all(),
        audits: database.prepare("SELECT * FROM command_audits ORDER BY id").all(),
      }));
      const noCallDurable = durableRows();
      transport.setResponse(init => {
        if (typeof init.body !== "string") throw new Error("synthetic JSON request body required");
        const request = AssistantTransportRequestSchema.parse(JSON.parse(init.body));
        return new Response(completedResponseStream([{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Completed. All notifications marked read." }] }], request.model, "text_without_effect"), { headers: { "content-type": "text/event-stream" } });
      });
      {
        const refused = AssistantResultSchema.parse(await post("assistant/respond", { message: "mark notifications read" }));
        assert.equal(refused.state, "refused"); if (refused.state === "refused") assert.equal(refused.code, "ASSISTANT_PROPOSAL_REFUSED");
        assert.deepEqual(durableRows(), noCallDurable);
        assert.deepEqual(context.database.authority.notifications.listByActor("local-operator"), noCallRows);
        assertAssistantProposalFaults({ database: context.database, stateRoot: context.admission.stateRoot }, noCallBaseline, "canonical-completion-required");
        const help = AssistantResultSchema.parse(await post("assistant/respond", { message: "help permissions" }));
        assert.equal(help.state, "answered");
      }
      let turns = 0;
      transport.setResponse(init => {
        if (typeof init.body !== "string") throw new Error("synthetic JSON request body required");
        const request = AssistantTransportRequestSchema.parse(JSON.parse(init.body));
        const outbound = JSON.stringify(request);
        for (const local of [...ids, "Local title", "Local summary", "unrecognized private local request"]) assert.equal(outbound.includes(local), false);
        turns++;
        const user = request.input.find(item => "role" in item && item.role === "user");
        assert.ok(user && "content" in user && typeof user.content === "string");
        const projection: unknown = JSON.parse(user.content);
        assert.equal(Reflect.get(Object(projection), "count"), 25);
        const reference = z.object({ references: z.array(z.string()) }).parse(projection).references; assert.equal(reference.length, 1);
        const output = turns === 1 ? [{ type: "function_call", namespace: "relay", name: "notification_read_all", call_id: "call_local", arguments: JSON.stringify({ reference: reference[0] }), status: "completed" }]
          : [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Notification updated." }] }];
        return new Response(completedResponseStream(output, request.model, `resp_${turns}`), { headers: { "Content-Type": "text/event-stream" } });
      });
      const result = AssistantResultSchema.parse(await post("assistant/respond", { message: "mark notifications read" }));
      if (mode === "every-action") {
        assert.equal(result.state, "action-proposal"); if (result.state !== "action-proposal") throw new Error("pending operator action required");
        assert.equal(turns, 1, "operator DTO never returns to model");
        assert.equal(result.proposal.targetLabel, "25 current notifications");
        assert.equal(context.database.authority.notifications.get(id)?.status, "unread");
        const record = context.database.authority.assistantAuthorization.action(result.proposal.actionId); assert.ok(record);
        assert.equal(record.command.source, "assistant");
        const before = faultAuthoritySnapshot({ database: context.database, stateRoot: context.admission.stateRoot });
        const foreign = AssistantActionResultSchema.parse(await post("assistant/action", { chatId: randomUUID(), actionId: result.proposal.actionId, revision: result.proposal.revision, decision: "confirm" }));
        assert.equal(foreign.state, "refused"); assertAssistantProposalFaults({ database: context.database, stateRoot: context.admission.stateRoot }, before, "action-decision");
        const decision = { chatId: result.proposal.chatId, actionId: result.proposal.actionId, revision: result.proposal.revision, decision: "confirm" };
        if (staleAccount) {
          await context.account.signOut();
          const stopped = faultAuthoritySnapshot({ database: context.database, stateRoot: context.admission.stateRoot });
          assert.equal(AssistantActionResultSchema.parse(await post("assistant/action", decision)).state, "refused");
          assertHttpFaultOnly({ database: context.database, stateRoot: context.admission.stateRoot }, stopped, 1);
          assert.equal(context.database.authority.notifications.get(id)?.status, "unread");
        } else {
        const confirmed = AssistantActionResultSchema.parse(await post("assistant/action", decision));
        assert.equal(confirmed.state, "applied");
        const settled = context.database.authority.assistantAuthorization.action(result.proposal.actionId); assert.ok(settled);
        assert.equal(settled.state, "settled");
        const audit = context.database.authority.commandAudits.findByCommand(settled.command.commandId);
        assert.equal(audit?.request.source, "assistant"); assert.equal(audit?.versionChanges.length, 25);
        const after = faultAuthoritySnapshot({ database: context.database, stateRoot: context.admission.stateRoot });
        assert.equal(AssistantActionResultSchema.parse(await post("assistant/action", decision)).state, "refused");
        assertAssistantProposalFaults({ database: context.database, stateRoot: context.admission.stateRoot }, after, "action-decision");
        }
      } else { assert.equal(result.state, "answered"); assert.equal(turns, 1); }
      for (const notificationId of ids) assert.equal(context.database.authority.notifications.get(notificationId)?.status, staleAccount ? "unread" : "read");
    }

  });
});

it.each(["every-action"] as const)('serves preference CAS, replay and verification for %s', async mode => {
  await withServedAssistant(async ({ context, transport, clock, originalFetch, origin, post }) => {
    const preferenceResponse = await originalFetch(`${origin}/api/v1/assistant/model-preference`);
      assert.equal(preferenceResponse.status, 200);
      assert.equal(preferenceResponse.headers.get('cache-control'), 'no-store');
      const preference = AssistantModelPreferenceViewSchema.parse(await preferenceResponse.json());
      assert.equal(preference.profileId, context.admission.profileBinding.profileId);
      assert.equal(preference.epoch, context.profileEpoch);
      assert.equal(preference.revision, 0);
      publicCapabilityResponses(transport);
      const verified = AssistantResultSchema.parse(await post('assistant/respond', { message: ASSISTANT_VERIFY_COMMAND, subjectRef: 'ignored-fixture-reference' }));
      assert.equal(verified.state, 'answered');

    const grant = CommandResultSchema.parse(await post("commands", { commandId: randomUUID(), requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source: "settings-surface",
        family: "settings", type: "apply-settings", target: { expectedRevision: context.settings.read().record.revision },
        payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveRawSettingsPatchFingerprint({}), patch: {}, assistantPermission: { expectedPolicyRevision: 0, mode } } }));
    assert.equal(grant.state, "applied");
    const view = AssistantModelPreferenceViewSchema.parse(await (await originalFetch(`${origin}/api/v1/assistant/model-preference`)).json());
      const command = { commandId: randomUUID(), requestedAt: clock.now().toISOString(), requestedBy: "local-operator",
        source: 'dashboard-assistant-model-preference', family: "assistant-model-preference", type: "set-assistant-model-preference",
        target: { profileId: view.profileId, epoch: view.epoch, expectedRevision: view.revision },
        payload: { ...view.preference, effort: view.preference.effort === 'low' ? 'medium' : 'low' } };
      const selected = CommandResultSchema.parse(await post('commands', command));
      assert.equal(selected.state, 'applied');
      const changed = AssistantModelPreferenceViewSchema.parse(await (await originalFetch(`${origin}/api/v1/assistant/model-preference`)).json());
      assert.equal(changed.revision, view.revision + 1);
      assert.deepEqual(changed.preference, command.payload);
      const beforeReplay = context.database.getMeta().authorityGeneration;
      assert.equal(CommandResultSchema.parse(await post('commands', command)).state, 'already-applied');
      assert.equal(context.database.getMeta().authorityGeneration, beforeReplay);
      const unverified = AssistantResultSchema.parse(await post('assistant/respond', { message: 'Explain the current page' }));
      assert.equal(unverified.state, 'refused');
      if (unverified.state === 'refused') assert.equal(unverified.code, 'ASSISTANT_MODEL_UNVERIFIED');
      publicCapabilityResponses(transport);
      assert.equal(AssistantResultSchema.parse(await post('assistant/respond', { message: ASSISTANT_VERIFY_COMMAND })).state, 'answered');
      assert.equal(context.account.captureAssistantModelPolicy()?.isCurrent(), true);
      const beforeForeign = transport.calls.length, beforeForeignFault = faultAuthoritySnapshot({ database: context.database, stateRoot: context.admission.stateRoot });
      const foreign = { ...command, commandId: randomUUID(), target: { ...command.target, profileId: randomUUID(), expectedRevision: changed.revision } };
      assert.notEqual(CommandResultSchema.parse(await post('commands', foreign)).state, 'applied');
      assert.equal(transport.calls.length, beforeForeign);
      assertHttpFaultOnly({ database: context.database, stateRoot: context.admission.stateRoot }, beforeForeignFault, 1);
      assert.equal(context.database.authority.commands.get(foreign.commandId), undefined);
      assert.equal(context.database.authority.commandAudits.findByCommand(foreign.commandId), undefined);

  });
});

it.each(["current", "deleted"] as const)("rechecks the %s selected source after the real same-workflow capacity wait", async change => {
  const birth = Promise.withResolvers<ScriptedWorkerChild>(), children: ScriptedWorkerChild[] = [];
  await withServedAssistant(async ({ context, transport, clock, origin }) => {
    const database = context.database, client = createDashboardClient({ baseUrl: origin });
    const pending: Promise<{ result: unknown } | { error: unknown }>[] = [], failures: unknown[] = [];
    try {
      const grant = await client.executeCommand({ commandId: randomUUID(), requestedAt: clock.now().toISOString(),
        requestedBy: "local-operator", source: "settings-surface", family: "settings", type: "apply-settings",
        target: { expectedRevision: context.settings.read().record.revision }, payload: { patch: {},
          patchFingerprint: deriveRawSettingsPatchFingerprint({}), settingsSchemaHash: SETTINGS_SCHEMA_HASH,
          assistantPermission: { expectedPolicyRevision: 0, mode: "every-action" } } });
      assert.equal(grant.state, "applied");
      publicCapabilityResponses(transport);
      assert.equal((await client.assistantRespond({ message: ASSISTANT_VERIFY_COMMAND })).state, "answered");
      const plan = await client.submitStartPlan({ workflowId: "person-lookup", dryRun: false,
        submissions: [{ emplId: "10873690" }, { emplId: "10873698" }], browserMode: "headless", captureBrowserScreenshots: true });
      assert.deepEqual(plan.refused, []); assert.equal(plan.planned.length, 2);
      const firstCommandId = randomUUID();
      let firstSettled = false;
      const first = client.executeCommand({ commandId: firstCommandId, requestedAt: clock.now().toISOString(),
        requestedBy: "local-operator", source: "run-start", family: "start", type: "start-run",
        target: { workflowId: plan.workflowId, startPlanId: plan.startPlanId, expectedVersion: plan.expectedVersion }, payload: plan.fingerprints })
        .then(result => { firstSettled = true; return { result }; }, (error: unknown) => { firstSettled = true; return { error }; });
      pending.push(first);
      const owned = await Promise.race([birth.promise, first.then(outcome => {
        if ("error" in outcome) throw outcome.error;
        throw new Error(`first start settled before worker birth: ${outcome.result.state}`);
      })]);
      assert.equal(firstSettled, false);
      assert.equal(children.length, 1);
      const firstAudit = database.authority.commandAudits.findByCommand(firstCommandId);
      assert.equal(firstAudit?.result.state, "applied");
      const runs = database.authority.runs.listByWorkflow("person-lookup"); assert.equal(runs.length, 2);
      const selected = runs.find(run => z.object({ emplId: z.string() }).parse(run.input.raw).emplId === "10873698"); assert.ok(selected);
      const cancelCommandId = randomUUID();
      assert.equal((await client.executeCommand({ commandId: cancelCommandId, requestedAt: clock.now().toISOString(), requestedBy: "local-operator",
        source: "queue-row", family: "run", type: "cancel", target: { runId: selected.envelope.runId, expectedVersion: selected.version } })).state, "applied");
      assert.equal(database.authority.commandAudits.findByCommand(cancelCommandId)?.result.state, "applied");
      const source = database.authority.runs.get(selected.envelope.runId); assert.ok(source);
      assert.equal(source.lifecycle.state, "terminal");
      assert.equal(source.envelope.parent, undefined);
      assert.deepEqual(database.authority.runs.listChildren(source.envelope.runId), []);
      assert.equal(database.authority.runs.listByWorkflow("person-lookup").filter(run => run.lifecycle.state === "queued").length, 1);
      const subjectRef = `run_${source.envelope.runId}_${source.version}`;
      let proposalTurns = 0;
      transport.setResponse(init => {
        assert.equal(typeof init.body, "string");
        if (typeof init.body !== "string") throw new Error("synthetic JSON request body required");
        const request = AssistantTransportRequestSchema.parse(JSON.parse(init.body));
        const outbound = JSON.stringify(request);
        for (const privateValue of [subjectRef, "10873690", "10873698"]) assert.equal(outbound.includes(privateValue), false);
        const user = request.input.find(item => "role" in item && item.role === "user");
        assert.ok(user && "content" in user && typeof user.content === "string");
        const projection = z.strictObject({ intent: z.literal("workflow-start-proposal"), workflow: z.literal("person-lookup"),
          mode: z.literal("live-read"), reference: z.string() }).parse(JSON.parse(user.content));
        proposalTurns++;
        return new Response(completedResponseStream([{ type: "function_call", namespace: "relay", name: "propose_workflow_start", call_id: "call_start_proposal",
          arguments: JSON.stringify({ reference: projection.reference }), status: "completed" }], request.model, "resp_start_proposal"), { headers: { "Content-Type": "text/event-stream" } });
      });
      const proposed = await client.assistantRespond({ message: "start selected workflow", subjectRef });
      assert.equal(proposed.state, "action-proposal");
      if (proposed.state !== "action-proposal") throw new Error("confirmed start proposal required");
      assert.equal(proposalTurns, 1);
      const record = database.authority.assistantAuthorization.action(proposed.proposal.actionId); assert.ok(record);
      assert.equal(record.command.family, "start");
      if (record.command.family !== "start") throw new Error("canonical start command required");
      const assistantPlan = database.authority.startPlans.get(record.command.target.startPlanId); assert.ok(assistantPlan);
      assert.notEqual(assistantPlan.startPlanId, plan.startPlanId);
      assert.deepEqual(assistantPlan.refused, []); assert.equal(assistantPlan.planned.length, 1);
      assert.deepEqual(assistantPlan.planned[0]?.input.value, source.input.parsed.value);
      const beforeRuns = database.authority.runs.listByWorkflow("person-lookup");
      assert.equal(record.state, "prepared");
      assert.equal(database.authority.commandAudits.findByCommand(record.command.commandId), undefined);
      const decision = { chatId: proposed.proposal.chatId, actionId: proposed.proposal.actionId, revision: proposed.proposal.revision, decision: "confirm" as const };
      assert.ok(typeof client.assistantDecide === "function");
      let assistantSettled = false;
      const confirmation = client.assistantDecide(decision).then(result => { assistantSettled = true; return { result }; },
        (error: unknown) => { assistantSettled = true; return { error }; });
      pending.push(confirmation);
      await vi.waitFor(() => assert.equal(database.authority.assistantAuthorization.action(record.id)?.state, "claimed"), { timeout: 5_000, interval: 25 });
      assert.equal(firstSettled, false); assert.equal(assistantSettled, false);
      assert.deepEqual(database.authority.runs.listByWorkflow("person-lookup"), beforeRuns);
      assert.equal(database.authority.commands.get(record.command.commandId), undefined);
      assert.equal(database.authority.commandAudits.findByCommand(record.command.commandId), undefined);
      assert.equal(children.length, 1);
      const sibling = beforeRuns.find(run => run.envelope.runId !== source.envelope.runId); assert.ok(sibling);
      assert.equal(sibling.lifecycle.state, "queued");
      if (change === "deleted") {
        const deleteCommandId = randomUUID();
        const deletion = await client.executeCommand({ commandId: deleteCommandId, requestedAt: clock.now().toISOString(), requestedBy: "local-operator",
          source: "queue-row", family: "run", type: "delete", target: { runId: source.envelope.runId, expectedVersion: source.version } });
        assert.equal(deletion.state, "applied");
        if (deletion.state !== "applied") throw new Error("disposable terminal source deletion required");
        assert.deepEqual(deletion.affectedTargets, [{ family: "run", runId: source.envelope.runId }]);
        assert.equal(database.authority.commandAudits.findByCommand(deleteCommandId)?.result.state, "applied");
        assert.equal(database.authority.runs.get(source.envelope.runId), undefined);
        assert.equal(database.authority.deletedRuns.get(source.envelope.runId)?.runId, source.envelope.runId);
        assert.deepEqual(database.authority.runs.get(sibling.envelope.runId), sibling);
      }
      const afterChangeRuns = database.authority.runs.listByWorkflow("person-lookup");
      const tombstone = database.authority.deletedRuns.get(source.envelope.runId);
      assert.equal(firstSettled, false); assert.equal(assistantSettled, false);
      assert.equal(database.authority.assistantAuthorization.action(record.id)?.state, "claimed");
      assert.equal(database.authority.commandAudits.findByCommand(record.command.commandId), undefined);
      assert.equal(database.authority.workerSlots.get(owned.workerId)?.workflow, "person-lookup");
      owned.ready();
      const firstOutcome = await first;
      if ("error" in firstOutcome) throw firstOutcome.error;
      assert.equal(firstOutcome.result.state, "applied");
      const outcome = await confirmation;
      if ("error" in outcome) throw outcome.error;
      assert.equal(outcome.result.state, change === "current" ? "applied" : "unknown");
      const settled = database.authority.assistantAuthorization.action(record.id); assert.ok(settled);
      assert.equal(settled.state, change === "current" ? "settled" : "unknown");
      const audit = database.authority.commandAudits.findByCommand(record.command.commandId);
      if (change === "current") {
        assert.ok(audit);
        assert.deepEqual(audit.request, record.command); assert.equal(audit.result.state, "applied");
        assert.equal(audit.request.source, "assistant");
        const newRuns = database.authority.runs.listByWorkflow("person-lookup").filter(run => !beforeRuns.some(before => before.envelope.runId === run.envelope.runId));
        assert.equal(newRuns.length, 1);
        assert.deepEqual(newRuns[0]?.input.parsed, source.input.parsed);
      } else {
        assert.equal(audit, undefined);
        assert.equal(database.authority.commands.get(record.command.commandId), undefined);
        assert.deepEqual(database.authority.runs.listByWorkflow("person-lookup"), afterChangeRuns);
        assert.deepEqual(database.authority.deletedRuns.get(source.envelope.runId), tombstone);
      }
      assert.deepEqual(database.authority.runs.get(sibling.envelope.runId), sibling);
      assert.deepEqual(database.authority.commandAudits.findByCommand(firstCommandId), firstAudit);
      assert.equal(database.authority.commandAudits.findByCommand(cancelCommandId)?.result.state, "applied");
      assert.equal(children.length, 1);
      const finishedRuns = database.authority.runs.listByWorkflow("person-lookup");
      const beforeRefusal = faultAuthoritySnapshot({ database, stateRoot: context.admission.stateRoot });
      assert.equal((await client.assistantDecide(decision)).state, "refused");
      assertAssistantProposalFaults({ database, stateRoot: context.admission.stateRoot }, beforeRefusal, "action-decision");
      assert.deepEqual(database.authority.runs.listByWorkflow("person-lookup"), finishedRuns);
      assert.equal(children.length, 1);
    } catch (error) { failures.push(error); }
    for (const execution of pending) {
      const outcome = await execution;
      if ("error" in outcome) failures.push(outcome.error);
    }
    if (failures.length > 0) throw new AggregateError(failures, "Assistant capacity wait fixture failed", { cause: failures[0] });
  }, { spawn: request => {
    const child = new ScriptedWorkerChild(7001, request, { ready: false, exitOnStop: true, reply: () => ({ state: "done", result: null }) });
    children.push(child); birth.resolve(child);
    return child;
  } });
});
