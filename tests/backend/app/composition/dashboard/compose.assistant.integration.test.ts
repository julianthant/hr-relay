import { faultAuthoritySnapshot, assertHttpFaultOnly, assertOnlyLoopStallWrites, exactHttpFaultLoopDelay } from "../../../../support/helpers/backend/http-route-harness.js";
import { AssistantM1RespondEnvelopeSchema, type AssistantM1Request } from "../../../../../src/models/dashboard/assistant.js";
import { replyText } from "../../../../../src/dashboard/surfaces/assistant/assistant-reply-parts-model.js";
import { AssistantHistoryResultSchema, AssistantModelPreferenceViewSchema, type AssistantHistoryOperation } from '../../../../../src/models/dashboard/assistant.js';
import { withAuthorityDatabaseReadOnly } from "../../../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";
import configuredSources from "../../../../../config/dashboard-workflow-sources.json";
import { z } from "zod";
import { DESCRIPTORS } from "../../../../../src/backend/app/registries/workflow-registry.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { it, vi } from "vitest";
import * as workerCapacity from "../../../../../src/backend/runs/commands/run-worker-capacity.js";

import * as assistantComposition from "../../../../../src/backend/app/composition/dashboard/assistant.js";
import { composeDashboardRuntime } from "../../../../../src/backend/app/composition/dashboard/compose.js";
import { composeProfileRuntime } from "../../../../../src/backend/app/composition/storage-compose.js";
import { buildRunDetail } from "../../../../../src/backend/runs/queries/run-detail.js";
import { ASSISTANT_WORKFLOW_FACTS_PATH, assistantWorkflowFacts } from "../../../../../src/backend/assistant/plugins/workflows/facts.js";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { ASSISTANT_FAILURES, AssistantInferenceRequestSchema } from "../../../../../src/models/dashboard/assistant.js";
import { CommandResultSchema } from "../../../../../src/rules/commands/commands.js";
import { createBoundProfileFixture } from "../../../../support/helpers/admission-fixture.js";
import { chatGptFixture } from "../../../../support/helpers/chatgpt-account-fixtures.js";
import { completedResponseStream } from "../../../../support/helpers/chatgpt-response-stream.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";
import { createDashboardClient } from "../../../../../src/dashboard/client/index.js";
import { DASHBOARD_TAB_HEADER } from "../../../../../src/dashboard/client/transport.js";
import { RunDetailWireSchema } from "../../../../../src/models/dashboard/run-detail.js";
import { EXECUTOR_EID, personLookupQueuedRun } from "../../../../support/helpers/phase1f-executor-harness.js";
import { RunRecordSchema } from "../../../../../src/models/run/record.js";
import { createTimelineEmitter } from "../../../../../src/backend/storage/events/timeline-emitter.js";
import { runQueuedSpanEvent } from "../../../../../src/backend/runs/commands/run-queued-span.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../../src/rules/identity/ids.js";
import { deriveTraceId } from "../../../../../src/rules/identity/identifiers.js";
import { StorageHealthConcernSchema } from "../../../../../src/rules/notifications/notification-triggers.js";

vi.mock("../../../../../src/backend/runs/commands/run-worker-capacity.js", async importOriginal => {
  const actual = await importOriginal<typeof workerCapacity>();
  return { ...actual, createRunWorkerCapacity: vi.fn(actual.createRunWorkerCapacity) };
});

type Door = { history(operation: AssistantHistoryOperation): Promise<unknown>; respond(request: AssistantM1Request): Promise<unknown> };
const clientDoor = (client: ReturnType<typeof createDashboardClient>): Door => ({
  history: operation => { if (client.assistantHistoryWrite === undefined) throw new Error('assistant history owner required'); return client.assistantHistoryWrite(operation); },
  respond: request => client.assistantRespond(request) });
const postDoor = (post: (path: string, value: unknown) => Promise<unknown>): Door => ({ history: operation => post('assistant/history', operation), respond: request => post('assistant/respond', request) });
/** One message in a new served chat. Returns the settled result. */
async function send(door: Door, input: Omit<AssistantM1Request, 'conversationId' | 'expectedRevision' | 'messageId'>) {
  const conversationId = randomUUID();
  assert.equal(AssistantHistoryResultSchema.parse(await door.history({ operation: 'create', conversationId, title: 'Chat' })).state, 'saved');
  const envelope = AssistantM1RespondEnvelopeSchema.parse(await door.respond({ conversationId, expectedRevision: 1, messageId: randomUUID(), ...input }));
  assert.equal(envelope.kind, 'result'); if (envelope.kind !== 'result') throw new Error('settled result required');
  const { result } = envelope;
  return result.state === 'answered' ? { state: result.state, text: replyText(result.reply.parts) }
    : { state: 'refused', code: result.reason, message: ASSISTANT_FAILURES[result.reason] };
}


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
  workerProcess?: Parameters<typeof composeDashboardRuntime>[0]["workerProcess"],
  preflightRunnerFactory: Parameters<typeof composeDashboardRuntime>[0]["preflightRunnerFactory"] = healthyRuntimePreflightRunners) {
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
    const target = join(f.workspace, ASSISTANT_WORKFLOW_FACTS_PATH);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${assistantWorkflowFacts(DESCRIPTORS.filter(descriptor => sources[descriptor.id] === "served")).bytes}\n`);
    const active = runtime.session.signIn({ email: "fixture@ucsd.edu", password: "disposable-fixture-password", at: clock.now().toISOString() });
    assert.equal(active.state, "active"); if (active.state !== "active") throw new Error("selected fixture required");
    const context = runtime.selectedContext(active.token);
    const authorization = await context.account.signIn({ usePlan: true }); await transport.callback(authorization); await authorization.completion;
    const dashboard = await composeDashboardRuntime({ lifetimeLock: f.lifetime, admission: f.machine, profile: { runtime, token: active.token }, repoRoot: f.workspace,
      clock, isolation: rebuildRuntimeIsolation, env: {}, backendPortOverride: 0, frontendPortOverride: 0, preflightRunnerFactory, loopDelay: exactHttpFaultLoopDelay,
      ...(workerProcess === undefined ? {} : { workerProcess }) });
    owner.dashboard = dashboard;
    const origin = `http://127.0.0.1:${String(dashboard.port)}`;
    const post = async (path: string, value: unknown): Promise<unknown> => {
      const response = await originalFetch(`${origin}/api/v1/${path}`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(value) });
      const body: unknown = await response.json(); return body;
    };

    ready = true;
    // The startup storage-health pass writes its rows on its own schedule; settle it so no checked span contains it.
    await vi.waitFor(() => assert.ok(StorageHealthConcernSchema.options.every(concern => concern === "outbox-stalled"
      || context.database.authority.notificationHealth.get(concern) !== undefined)), { timeout: 30_000, interval: 50 });
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

it('serves the read tools through authenticated composition without private provider input or command effects', async () => {
  using pluginComposition = vi.spyOn(assistantComposition, 'createAssistantPluginDeps');
  await withServedAssistant(async fixture => {
    const { context, transport, origin, originalFetch } = fixture, { run, title, subjectRef } = seedAssistantReadRun(fixture);
    const tabId = randomUUID();
    const client = createDashboardClient({ baseUrl: origin });
    const response = await originalFetch(`${origin}/api/v1/runs/${run.envelope.runId}`, { headers: { [DASHBOARD_TAB_HEADER]: tabId } });
    const wire = await response.text();
    assert.equal(response.status, 200, wire);
    const detail = RunDetailWireSchema.parse(JSON.parse(wire));
    assert.equal(detail.timeline.events.length, 12, wire);

    const mainRunDetail = pluginComposition.mock.lastCall?.[0].runDetail;
    assert.ok(mainRunDetail);
    await vi.waitFor(() => assert.equal(buildRunDetail(mainRunDetail, run.envelope.runId).timeline.events.length, 12));

    const ask = (message: string, selected?: string) => send(clientDoor(client), { message, ...(selected === undefined ? {} : { subjectRef: selected }) });
    const outputs: unknown[] = [];
    let turns = 0;
    transport.setResponse(init => {
      assert.equal(typeof init.body, 'string'); if (typeof init.body !== 'string') throw Error('synthetic request body required');
      const request = AssistantTransportRequestSchema.parse(JSON.parse(init.body)), outbound = JSON.stringify(request);
      for (const value of [run.envelope.runId, run.envelope.traceId, subjectRef, title, EXECUTOR_EID]) assert.equal(outbound.includes(value), false, value);
      assert.deepEqual(request.tools.map(namespace => namespace.name), ['relay']);
      const last = request.input.at(-1);
      if (last !== undefined && 'type' in last && last.type === 'function_call_output') outputs.push(JSON.parse(last.output));
      const token = /selected the run (\[\[R1\.g\d+\]\])/u.exec(outbound)?.[1]; assert.ok(token);
      turns++;
      const output = turns === 1 ? [{ type: 'function_call', namespace: 'relay', name: 'read_run', call_id: 'read_run', arguments: JSON.stringify({ run: token }), status: 'completed' }]
        : turns === 2 ? [{ type: 'function_call', namespace: 'relay', name: 'read_run_logs', call_id: 'read_logs', arguments: JSON.stringify({ run: token, last: 5 }), status: 'completed' }]
        : [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: `${token} is ${detail.header.status}.` }] }];
      return new Response(completedResponseStream(output, request.model, `resp_${String(turns)}`), { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const durable = () => withAuthorityDatabaseReadOnly(context.admission, join(context.admission.stateRoot, 'state.db'), database => ({
      chats: database.prepare('SELECT * FROM assistant_chats ORDER BY id').all(), actions: database.prepare('SELECT * FROM assistant_actions ORDER BY id').all(),
      commands: database.prepare('SELECT * FROM commands ORDER BY id').all(), audits: database.prepare('SELECT * FROM command_audits ORDER BY id').all(),
    }));
    const before = durable();
    assert.deepEqual(await ask('Explain this run', subjectRef), { state: 'answered', text: `Person Lookup · EID ${EXECUTOR_EID} · ${run.envelope.enqueuedAt} · attempt ${String(run.envelope.attempt)} is ${detail.header.status}.` });
    assert.equal(turns, 3);
    const [read, logs] = outputs;
    assert.deepEqual(z.object({ status: z.string(), version: z.number(), attempt: z.number(), workflow: z.string() }).parse(read),
      { status: detail.header.status, version: detail.rowRevision, attempt: detail.header.attempt, workflow: detail.header.workflowId });
    assert.deepEqual(z.strictObject({ total: z.number(), steps: z.array(z.unknown()) }).parse(logs),
      { total: 12, steps: detail.timeline.events.slice(-5).map(event => ({ at: event.at, label: event.label, stepLabel: 'Search for person', state: event.state, skipped: event.notRun.state === 'present' ? event.notRun.reason : null })) });
    const foreign = await originalFetch(`${origin}/api/v1/assistant/respond`, { method: 'POST', headers: { Origin: 'https://foreign.invalid', 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: randomUUID(), expectedRevision: 1, messageId: randomUUID(), message: 'run status', subjectRef }) });
    assert.equal(foreign.status, 403); assert.equal(turns, 3);
    assert.deepEqual(durable(), before);
    assert.deepEqual(context.database.authority.runs.get(run.envelope.runId), run);
  });
});

it('refuses an old selected-run revision before reading out the newer run', async () => {
  await withServedAssistant(async fixture => {
    const { context, transport, origin, clock } = fixture, { run, subjectRef } = seedAssistantReadRun(fixture), client = createDashboardClient({ baseUrl: origin });
    await vi.waitFor(async () => assert.equal((await client.runDetail(run.envelope.runId)).timeline.events.length, 12));
    const cancelled = await client.executeCommand({ commandId: randomUUID(), requestedAt: clock.now().toISOString(), requestedBy: 'local-operator', source: 'queue-row',
      family: 'run', type: 'cancel', target: { runId: run.envelope.runId, expectedVersion: run.version } });
    assert.equal(cancelled.state, 'applied');
    const current = context.database.authority.runs.get(run.envelope.runId); assert.ok(current && current.version !== run.version);
    const outputs: unknown[] = [];
    let turns = 0;
    transport.setResponse(init => {
      if (typeof init.body !== 'string') throw Error('synthetic request body required');
      const request = AssistantTransportRequestSchema.parse(JSON.parse(init.body)), outbound = JSON.stringify(request);
      const last = request.input.at(-1);
      if (last !== undefined && 'type' in last && last.type === 'function_call_output') outputs.push(JSON.parse(last.output));
      const token = /selected the run (\[\[R1\.g\d+\]\])/u.exec(outbound)?.[1]; assert.ok(token);
      turns++;
      const output = turns === 1 ? [{ type: 'function_call', namespace: 'relay', name: 'read_run', call_id: 'read_run', arguments: JSON.stringify({ run: token }), status: 'completed' }]
        : [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'The run is cancelled.' }] }];
      return new Response(completedResponseStream(output, request.model, `resp_${String(turns)}`), { headers: { 'Content-Type': 'text/event-stream' } });
    });
    assert.deepEqual(await send(clientDoor(client), { message: 'Explain this run', subjectRef }),
      { state: 'refused', code: 'ASSISTANT_READ_STALE', message: ASSISTANT_FAILURES.ASSISTANT_READ_STALE });
    assert.deepEqual(outputs, [], 'an already-stale selection never discloses the newer row to a tool or provider');
    assert.equal(turns, 0);
  });
});

it('refuses a selected-run revision changed after the provider POST before reading the newer run', async () => {
  await withServedAssistant(async fixture => {
    const { context, transport, origin, clock } = fixture, { run, subjectRef } = seedAssistantReadRun(fixture), client = createDashboardClient({ baseUrl: origin });
    await vi.waitFor(async () => assert.equal((await client.runDetail(run.envelope.runId)).timeline.events.length, 12));
    const outputs: unknown[] = [];
    let turns = 0;
    transport.setResponse(init => {
      if (typeof init.body !== 'string') throw Error('synthetic request body required');
      const request = AssistantTransportRequestSchema.parse(JSON.parse(init.body)), outbound = JSON.stringify(request);
      const last = request.input.at(-1);
      if (last !== undefined && 'type' in last && last.type === 'function_call_output') outputs.push(JSON.parse(last.output));
      const token = /selected the run (\[\[R1\.g\d+\]\])/u.exec(outbound)?.[1]; assert.ok(token);
      turns++;
      const output = turns === 1 ? [{ type: 'function_call', namespace: 'relay', name: 'read_run', call_id: 'read_run', arguments: JSON.stringify({ run: token }), status: 'completed' }]
        : [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'The run is cancelled.' }] }];
      const sse = completedResponseStream(output, request.model, `resp_${String(turns)}`);
      if (turns !== 1) return new Response(sse, { headers: { 'Content-Type': 'text/event-stream' } });
      return new Response(new ReadableStream<Uint8Array>({ async start(controller) {
        assert.equal(turns, 1, 'the selected label was issued and the first provider POST began before the revision changed');
        const cancelled = await client.executeCommand({ commandId: randomUUID(), requestedAt: clock.now().toISOString(), requestedBy: 'local-operator', source: 'queue-row',
          family: 'run', type: 'cancel', target: { runId: run.envelope.runId, expectedVersion: run.version } });
        assert.equal(cancelled.state, 'applied');
        const current = context.database.authority.runs.get(run.envelope.runId); assert.ok(current && current.version !== run.version);
        controller.enqueue(new TextEncoder().encode(sse)); controller.close();
      } }), { headers: { 'Content-Type': 'text/event-stream' } });
    });
    assert.deepEqual(await send(clientDoor(client), { message: 'Explain this run', subjectRef }),
      { state: 'refused', code: 'ASSISTANT_READ_STALE', message: ASSISTANT_FAILURES.ASSISTANT_READ_STALE });
    assert.deepEqual(outputs, [{ error: 'ASSISTANT_READ_STALE', text: ASSISTANT_FAILURES.ASSISTANT_READ_STALE }]);
    assert.equal(turns, 2, 'the tool refuses the stale pin and the loop preserves that refusal');
  });
});

it('serves preference CAS and replay', async () => {
  await withServedAssistant(async ({ context, transport, clock, originalFetch, origin, post }) => {
    const preferenceResponse = await originalFetch(`${origin}/api/v1/assistant/model-preference`);
      assert.equal(preferenceResponse.status, 200);
      assert.equal(preferenceResponse.headers.get('cache-control'), 'no-store');
      const preference = AssistantModelPreferenceViewSchema.parse(await preferenceResponse.json());
      assert.equal(preference.profileId, context.admission.profileBinding.profileId);
      assert.equal(preference.epoch, context.profileEpoch);
      assert.equal(preference.revision, 0);

    const view = AssistantModelPreferenceViewSchema.parse(await (await originalFetch(`${origin}/api/v1/assistant/model-preference`)).json());
      const command = { commandId: randomUUID(), requestedAt: clock.now().toISOString(), requestedBy: "local-operator",
        source: 'dashboard-assistant-model-preference', family: "assistant-model-preference", type: "set-assistant-model-preference",
        target: { profileId: view.profileId, epoch: view.epoch, expectedRevision: view.revision },
        payload: { ...view.preference, effort: view.preference.effort === 'light' ? 'medium' : 'light' } };
      const selected = CommandResultSchema.parse(await post('commands', command));
      assert.equal(selected.state, 'applied');
      const changed = AssistantModelPreferenceViewSchema.parse(await (await originalFetch(`${origin}/api/v1/assistant/model-preference`)).json());
      assert.equal(changed.revision, view.revision + 1);
      assert.deepEqual(changed.preference, command.payload);
      const beforeReplay = { generation: context.database.getMeta().authorityGeneration, timeline: context.database.authority.timelineEvents.page({ limit: 500 }),
        debug: context.database.authority.timelineEvents.debugPage({ limit: 500 }) };
      assert.equal(CommandResultSchema.parse(await post('commands', command)).state, 'already-applied');
      assertOnlyLoopStallWrites(context.database, beforeReplay);
      const beforeForeign = transport.calls.length, beforeForeignFault = faultAuthoritySnapshot({ database: context.database, stateRoot: context.admission.stateRoot });
      const foreign = { ...command, commandId: randomUUID(), target: { ...command.target, profileId: randomUUID(), expectedRevision: changed.revision } };
      assert.notEqual(CommandResultSchema.parse(await post('commands', foreign)).state, 'applied');
      assert.equal(transport.calls.length, beforeForeign);
      assertHttpFaultOnly({ database: context.database, stateRoot: context.admission.stateRoot }, beforeForeignFault, 1);
      assert.equal(context.database.authority.commands.get(foreign.commandId), undefined);
      assert.equal(context.database.authority.commandAudits.findByCommand(foreign.commandId), undefined);

  });
});

it('admits no assistant command outside a claimed proposal row or session claim', async () => {
  await withServedAssistant(async ({ context, clock, post }) => {
    const { run } = seedAssistantReadRun({ context, clock });
    const command = { commandId: randomUUID(), requestedAt: clock.now().toISOString(), requestedBy: LOCAL_OPERATOR_ACTOR_ID, source: 'assistant',
      family: 'run', type: 'cancel', target: { runId: run.envelope.runId, expectedVersion: run.version }, payload: {} };
    assert.notEqual(CommandResultSchema.parse(await post('commands', command)).state, 'applied');
    assert.equal(context.database.authority.commandAudits.findByCommand(command.commandId), undefined);
    assert.deepEqual(context.database.authority.runs.get(run.envelope.runId), run);
  });
});
