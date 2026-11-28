import { editScenarios } from "../../../assistant/scenarios/applied-edits.js";
import { undoEditScenarios } from "../../../assistant/scenarios/undo-edits.js";
import { faultAuthoritySnapshot, assertHttpFaultOnly, assertOnlyLoopStallWrites, exactHttpFaultLoopDelay } from "../../../../support/helpers/backend/http-route-harness.js";
import { AssistantM1RespondEnvelopeSchema, assistantSessionAttribution, type AssistantM1Request, type AssistantM1RespondEnvelope } from "../../../../../src/models/dashboard/assistant.js";
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
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { FIXTURE_ACTIVE_PROFILE_STATE } from "../../../../support/helpers/dashboard/profiles/fixture-profile-setup.js";
import { JSDOM } from "jsdom";
import { populateGlobal } from "vitest/runtime";
import { DashboardApp } from "../../../../../src/dashboard/app/dashboard-app.js";
import { DashboardClientProvider } from "../../../../../src/dashboard/state/client-context.js";
import * as workerCapacity from "../../../../../src/backend/runs/commands/run-worker-capacity.js";

import * as assistantComposition from "../../../../../src/backend/app/composition/dashboard/assistant.js";
import { attributionOwnsCommand } from "../../../../../src/backend/app/composition/dashboard/assistant.js";
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
import { ScriptedWorkerChild } from "../../../../support/helpers/backend/fake-worker-port.js";
import { searchPartitionDay } from "../../../../../src/models/dashboard/search-calendar.js";
import { RunRecordSchema } from "../../../../../src/models/run/record.js";
import { createTimelineEmitter } from "../../../../../src/backend/storage/events/timeline-emitter.js";
import { runQueuedSpanEvent } from "../../../../../src/backend/runs/commands/run-queued-span.js";
import { IsoInstantSchema, LOCAL_OPERATOR_ACTOR_ID, SourceSurfaceIdSchema } from "../../../../../src/rules/identity/ids.js";
import { deriveTraceId } from "../../../../../src/rules/identity/identifiers.js";
import { StorageHealthConcernSchema } from "../../../../../src/rules/notifications/notification-triggers.js";
import { AssistantToolRefusal } from "../../../../../src/backend/assistant/plugins/plugin.js";
import { createAssistantController } from "../../../../../src/dashboard/surfaces/assistant/assistant-controller-model.js";
import { createAssistantHistory } from "../../../../../src/dashboard/surfaces/assistant/assistant-history-model.js";
import { CommandExecutor, type CommandExecutionScope, type CommandOutcome } from "../../../../../src/dashboard/app/commands/command-executor.js";
import type { AssistantTypedProposalPorts } from "../../../../../src/backend/assistant/typed-proposals.js";

vi.mock("../../../../../src/backend/runs/commands/run-worker-capacity.js", async importOriginal => {
  const actual = await importOriginal<typeof workerCapacity>();
  return { ...actual, createRunWorkerCapacity: vi.fn(actual.createRunWorkerCapacity) };
});

// The composed submit, as the typed-yes owner receives it; `tamper` resends one claimed row under a changed attribution first.
const submitProbe = vi.hoisted(() => ({ submit: undefined as undefined | AssistantTypedProposalPorts["submit"],
  tamper: undefined as undefined | ((attribution: Record<string, unknown>) => unknown), tampered: [] as unknown[] }));
vi.mock("../../../../../src/backend/assistant/typed-proposals.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../../../../../src/backend/assistant/typed-proposals.js")>();
  return { ...actual, createAssistantTypedProposals: (ports: Parameters<typeof actual.createAssistantTypedProposals>[0]) => {
    submitProbe.submit = (command, attribution) => ports.submit(command, attribution);
    return actual.createAssistantTypedProposals({ ...ports, async submit(command, attribution) {
      const tamper = submitProbe.tamper; submitProbe.tamper = undefined;
      if (tamper !== undefined) submitProbe.tampered.push(await Promise.resolve().then(() => ports.submit(command, tamper(attribution) as never)).then(() => 'admitted', (error: unknown) => error));
      return ports.submit(command, attribution);
    } });
  } };
});

type Door = { history(operation: AssistantHistoryOperation): Promise<unknown>; respond(request: AssistantM1Request): Promise<unknown> };
const clientDoor = (client: ReturnType<typeof createDashboardClient>): Door => ({
  history: operation => { if (client.assistantHistoryWrite === undefined) throw new Error('assistant history owner required'); return client.assistantHistoryWrite(operation); },
  respond: request => client.assistantRespond(request) });
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
  const descriptor = DESCRIPTORS.find(value => value.id === run.envelope.workflow);
  const node = descriptor?.timeline?.flatMap(category => category.nodes).find(candidate => candidate.id === "searching");
  assert.ok(node);
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
      family: 'run', type: 'cancel', target: { runId: run.envelope.runId, expectedVersion: run.version } };
    // In process, the composed kernel refuses an assistant-source command with no claimed row or session claim before any effect.
    const kernel = vi.mocked(workerCapacity.createRunWorkerCapacity).mock.calls.at(-1)?.[0].kernel; assert.ok(kernel);
    const unclaimed = { ...command, commandId: randomUUID() };
    assert.throws(() => kernel.execute(unclaimed), /assistant-effect-not-authorized/);
    assert.equal(context.database.authority.commands.get(unclaimed.commandId), undefined);
    assert.equal(context.database.authority.commandAudits.findByCommand(unclaimed.commandId), undefined);
    assert.equal(context.database.authority.runs.get(run.envelope.runId)?.version, run.version);
    // HTTP cannot mint an assistant command: the operator ingress stamps its own source.
    assert.equal(CommandResultSchema.parse(await post('commands', command)).state, 'applied');
    assert.equal(context.database.authority.commands.get(command.commandId)?.source, 'dashboard');
  });
});

it('recovers a served read-only session after a lost reply, serves it in Queue and Logs, and cancels it with Stop', async () => {
  // A worker that never becomes ready keeps the started run queued, so Stop has a live run to cancel.
  await withServedAssistant(async ({ context, transport, origin, originalFetch, clock }) => {
    const served = createDashboardClient({ baseUrl: origin });
    const deliveries: { messageId: string; kind: AssistantM1RespondEnvelope['kind'] }[] = [];
    const client = { ...served, async assistantRespond(...args: Parameters<typeof served.assistantRespond>) {
      const [request] = args;
      const envelope = await served.assistantRespond(...args);
      deliveries.push({ messageId: request.messageId, kind: envelope.kind });
      if (deliveries.length === 1) throw new Error('lost reply after the session started');
      return envelope;
    } };
    let turns = 0;
    transport.setResponse(init => {
      if (typeof init.body !== 'string') throw Error('synthetic request body required');
      const request = AssistantTransportRequestSchema.parse(JSON.parse(init.body));
      turns++;
      const output = turns === 1 ? [{ type: 'function_call', namespace: 'relay', name: 'start_session', call_id: 'start', arguments: JSON.stringify({ workflow: 'person-lookup', entries: [EXECUTOR_EID] }), status: 'completed' }]
        : [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Started.' }] }];
      return new Response(completedResponseStream(output, request.model, `resp_${String(turns)}`), { headers: { 'Content-Type': 'text/event-stream' } });
    });
    // The dashboard's own assistant controller over the served history sends the message and later presses the chip's Stop.
    const history = await createAssistantHistory(client as Required<typeof client>, { getItem: () => null, removeItem() {} }, context.admission.profileBinding.profileId, new AbortController().signal);
    if (history.chats.read().length === 0) await history.chats.create();
    const chatId = history.chats.selectedId?.() ?? history.chats.read()[0]?.id; assert.ok(chatId);
    const scope: CommandExecutionScope = { actorId: LOCAL_OPERATOR_ACTOR_ID, client, authority: {}, dayRequest: {} }, feedback: CommandOutcome[] = [];
    let outcomeReads = 0;
    const controller = createAssistantController(client, { authority: 'a', commands: { executor: new CommandExecutor(() => scope), scope, feedback: value => { feedback.push(value); } } }, {
      conversationId: chatId, read: () => history.read(chatId), retain: state => { history.retain(chatId, state); }, revision: () => history.revision(chatId),
      receipt: receipt => { history.receipt(receipt); }, local: text => history.local(chatId, text), async outcome(messageId) {
        if (++outcomeReads === 1) throw new Error('first history read unavailable');
        return history.outcome(chatId, messageId);
      },
      refresh: () => history.refresh(chatId), unsaved: () => { history.unsaved(); } });
    controller.action({ type: 'edit', value: `Look up ${EXECUTOR_EID}` }); controller.action({ type: 'send' });
    await vi.waitFor(() => assert.equal(controller.snapshot().turn.state, 'failed'), { timeout: 30_000, interval: 50 });
    assert.equal(controller.snapshot().sessions?.length ?? 0, 0);
    controller.action({ type: 'retry' });
    await vi.waitFor(() => assert.ok(controller.snapshot().sessions?.[0]?.stop), { timeout: 30_000, interval: 50 });
    const [accepted] = deliveries; assert.ok(accepted);
    assert.deepEqual(deliveries, [{ messageId: accepted.messageId, kind: 'result' }, { messageId: accepted.messageId, kind: 'delivery' }]);
    const chip = controller.snapshot().sessions?.[0]; assert.ok(chip?.stop);
    const { runId } = chip;

    // The start is the assistant's own command under its session claim.
    const starts = context.database.authority.assistantProposals.sessions;
    const commandId = z.object({ id: z.string() }).array().parse(withAuthorityDatabaseReadOnly(context.admission, join(context.admission.stateRoot, 'state.db'), database =>
      database.prepare("SELECT id FROM commands WHERE family='start' AND json_extract(request_json,'$.source')='assistant'").all()));
    const [startId] = commandId; assert.equal(commandId.length, 1); assert.ok(startId);
    const claimed = starts.byCommand(startId.id), start = context.database.authority.commands.get(startId.id); assert.ok(claimed); assert.ok(start);
    assert.deepEqual(claimed.outcome, { state: 'started', runIds: [runId] });
    // The composed submit refuses any attribution but the owning claim's, before the kernel sees the command.
    const owned = assistantSessionAttribution(claimed.claim), profileId = context.admission.profileBinding.profileId, store = context.database.authority.assistantProposals;
    assert.equal(attributionOwnsCommand(store, start, owned, profileId), true);
    const submit = submitProbe.submit; assert.ok(submit);
    const audits = context.database.authority.commandAudits.findByCommand(start.commandId);
    for (const wrong of [{ ...owned, conversationId: randomUUID() }, { ...owned, acceptedMessageId: randomUUID() }, { ...owned, binding: { kind: 'session' as const, actionId: randomUUID() } },
      { ...owned, profileId: randomUUID() }, { ...owned, binding: { kind: 'proposal' as const, proposalId: randomUUID(), rowId: randomUUID() } }, { kind: 'unrecorded' as const }]) {
      await assert.rejects(async () => submit(start, wrong), (error: unknown) => error instanceof AssistantToolRefusal && error.code === 'ASSISTANT_PROPOSAL_REFUSED', JSON.stringify(wrong));
    }
    await assert.rejects(async () => submit({ ...start, source: SourceSurfaceIdSchema.parse('dashboard') }, owned), AssistantToolRefusal);
    assert.deepEqual(context.database.authority.commandAudits.findByCommand(start.commandId), audits);

    // Queue and Logs both serve the run.
    const day = await client.dashboardDay(searchPartitionDay(new Date(clock.now().toISOString())));
    const row = day.queueSurfaces.find(surface => surface.runId === runId); assert.ok(row, 'queue row');
    assert.deepEqual(row.startedBy, { kind: 'assistant', readOnly: true });
    // The real dashboard app, mounted over the composed backend, selects the served run and shows the line in its Queue and its Logs header.
    const { actor } = await served.bootstrap(), line = `Started by the assistant for ${actor.label} · read only`;
    const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>', { url: `${origin}/?day=${day.day}`, pretendToBeVisual: true });
    const globals = populateGlobal(globalThis, dom.window, { bindFunctions: true });
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
    Reflect.set(dom.window.navigator, 'locks', { request: async (_name: string, run: () => unknown) => run() });
    Reflect.set(globalThis, 'ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    // This composition serves no profile routes; the app's sign-in gate reads the one fixture state and everything else is the composed backend.
    const appClient = createDashboardClient({ baseUrl: origin, fetchImpl: async (input, init) => new URL(input).pathname === '/api/v1/profile/state'
      ? Response.json(FIXTURE_ACTIVE_PROFILE_STATE) : originalFetch(input, init) });
    const root = createRoot(dom.window.document.getElementById('root')!);
    try {
      await act(async () => root.render(createElement(DashboardClientProvider, { client: appClient, children: createElement(DashboardApp) })));
      await vi.waitFor(() => assert.match(dom.window.document.querySelector('.dashboard-queue-column')?.textContent ?? '', new RegExp(line)), { timeout: 20_000, interval: 100 });
      await act(async () => { dom.window.document.querySelector<HTMLElement>(`[data-queue-open]`)?.click(); });
      await vi.waitFor(() => assert.match(dom.window.document.querySelector('.dashboard-log-column')?.textContent ?? '', new RegExp(line)), { timeout: 30_000, interval: 100 });
    } finally {
      await act(async () => root.unmount());
      dom.window.close();
      for (const key of globals.keys) { const original = globals.originals.get(key); if (original === undefined) Reflect.deleteProperty(globalThis, key); else Object.defineProperty(globalThis, key, original); }
    }
    const logs = await originalFetch(`${origin}/api/v1/runs/${runId}`, { headers: { [DASHBOARD_TAB_HEADER]: randomUUID() } });
    assert.equal(logs.status, 200); assert.equal(RunDetailWireSchema.parse(await logs.json()).header.runId, runId);

    // The served chip's Stop goes through the controller and the command executor to the real kernel, and the re-read chip offers no Stop.
    await controller.stop(chip.stop);
    assert.equal(feedback.at(-1)?.kind, 'confirmed', JSON.stringify(feedback));
    const after = context.database.authority.runs.get(runId); assert.ok(after);
    assert.ok(after.lifecycle.state === 'terminal' && after.lifecycle.outcome === 'cancelled', JSON.stringify(after.lifecycle));
    assert.equal(controller.snapshot().sessions?.find(session => session.runId === runId)?.stop ?? null, null);
    controller.retire();
  }, { spawn: request => new ScriptedWorkerChild(7001, request, { ready: false, exitOnStop: true, reply: () => ({ state: 'done', result: null }) }) });
});

it('runs a typed-yes proposal row only under the attribution of the yes that answered it', async () => {
  await withServedAssistant(async ({ context, transport, origin }) => {
    const client = createDashboardClient({ baseUrl: origin });
    let turns = 0;
    transport.setResponse(init => {
      if (typeof init.body !== 'string') throw Error('synthetic request body required');
      const request = AssistantTransportRequestSchema.parse(JSON.parse(init.body));
      turns++;
      const output = turns === 1 ? [{ type: 'function_call', namespace: 'relay', name: 'propose_workflow_start', call_id: 'propose', arguments: JSON.stringify({ workflow: 'person-lookup', entries: [EXECUTOR_EID], dryRun: false }), status: 'completed' }]
        : [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Lookup is ready for review.' }] }];
      return new Response(completedResponseStream(output, request.model, `resp_${String(turns)}`), { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const conversationId = randomUUID();
    assert.equal(AssistantHistoryResultSchema.parse(await client.assistantHistoryWrite?.({ operation: 'create', conversationId, title: 'Chat' })).state, 'saved');
    const proposed = AssistantM1RespondEnvelopeSchema.parse(await client.assistantRespond({ conversationId, expectedRevision: 1, messageId: randomUUID(), message: `Prepare a Lookup for ${EXECUTOR_EID}.` }));
    assert.ok(proposed.kind === 'result' && proposed.result.state === 'answered' && proposed.receipt !== undefined, JSON.stringify(proposed));
    const store = context.database.authority.assistantProposals, open = store.open(conversationId); assert.ok(open);

    // The yes's row is first resent through the composed submit as if a different accepted message had answered it.
    submitProbe.tampered.length = 0;
    submitProbe.tamper = attribution => ({ ...attribution, acceptedMessageId: randomUUID() });
    const yesId = randomUUID();
    const answered = AssistantM1RespondEnvelopeSchema.parse(await client.assistantRespond({ conversationId, expectedRevision: proposed.receipt.revision, messageId: yesId, message: 'yes' }));
    assert.ok(answered.kind === 'result' && answered.result.state === 'answered', JSON.stringify(answered));
    assert.equal(submitProbe.tampered.length, 1);
    const [refusal] = submitProbe.tampered;
    assert.ok(refusal instanceof AssistantToolRefusal && refusal.code === 'ASSISTANT_PROPOSAL_REFUSED', String(refusal));

    // The yes that answered the proposal owns its one row command, which reached the kernel once.
    const record = store.read(open.snapshot.id); assert.ok(record);
    assert.deepEqual(record.lifecycle, { state: 'answered', answerMessageId: yesId });
    const [row] = record.rows; assert.ok(row?.result.state === 'applied', JSON.stringify(record.rows));
    const starts = z.object({ id: z.string() }).array().parse(withAuthorityDatabaseReadOnly(context.admission, join(context.admission.stateRoot, 'state.db'), database =>
      database.prepare("SELECT id FROM commands WHERE family='start' AND json_extract(request_json,'$.source')='assistant'").all()));
    assert.deepEqual(starts.map(start => start.id), [row.result.commandId]);
    assert.ok(answered.result.reply.parts.some(part => part.kind === 'session'));
  }, { spawn: request => new ScriptedWorkerChild(7002, request, { ready: false, exitOnStop: true, reply: () => ({ state: 'done', result: null }) }) });
});

it("applies spreadsheet and settings edits in the accepted turn, keeps values local and refuses unsafe or stale edits", async () => {
  await withServedAssistant(async ({ context, transport, origin, clock }) => {
    const client = createDashboardClient({ baseUrl: origin });
    const db = context.database, libraryId = randomUUID(), at = IsoInstantSchema.parse(clock.now().toISOString());
    const privateName = "Synthetic private workbook";
    const privateCell = "Synthetic private cell value ".repeat(320);
    db.authority.workbooks.create({ libraryId, version: 1, createdAt: at, savedAt: at,
      workbook: { name: privateName, libraryId, themes: {}, hasFormulas: false, sheets: [{
        id: "worksheet", name: "Sheet", width: 1, hidden: [],
        rows: [{ id: "heading", cells: [{ value: "Header" }] }, { id: "row", cells: [{ value: privateCell }] }],
      }] } });
    const since = at, initialVersion = db.authority.workbooks.read(libraryId)?.version;
    assert.equal(initialVersion, 1);
    let applied = 0;
    for (const [index, scenario] of editScenarios.entries()) {
      const calls = [...scenario.calls];
      const measured: number[] = [];
      const settingsBefore = db.authority.settingsCurrent.get();
      const linkBefore = db.authority.workbooks.catalog().find(row => row.libraryId === libraryId)?.metadata.sharePoint;
      transport.setResponse(init => {
        assert.ok(typeof init.body === "string");
        const request = AssistantTransportRequestSchema.parse(JSON.parse(init.body));
        measured.push(Math.ceil(Buffer.byteLength(init.body) / 4));
        for (const value of [privateName, privateCell.slice(0, 200), libraryId]) assert.ok(!init.body.includes(value));
        if ("maskedSource" in scenario) {
          assert.ok(!init.body.includes(scenario.maskedSource));
          assert.ok(init.body.includes("[redacted email]"));
        }
        if ("changeWorkbookAfterRead" in scenario && measured.length === 2) {
          const entry = db.authority.workbooks.catalog().find(row => row.libraryId === libraryId);
          assert.ok(entry);
          db.authority.workbooks.libraryAction(libraryId, { operationId: randomUUID(), expectedVersion: entry.version,
            expectedRevision: entry.state.revision, change: { kind: "rename", name: "Autumn tracker" } }, at);
        }
        const call = calls.shift();
        assert.ok(call, "the provider was called after the edit settled");
        assert.ok(request.tools[0]?.tools.some(tool => tool.name === call.tool));
        return new Response(completedResponseStream([{ type: "function_call", namespace: "relay", name: call.tool,
          call_id: String(measured.length), arguments: JSON.stringify(call.args), status: "completed" }],
        request.model, `resp_edit_${String(index)}_${String(measured.length)}`), { headers: { "Content-Type": "text/event-stream" } });
      });
      const conversationId = randomUUID(), messageId = randomUUID();
      assert.equal(AssistantHistoryResultSchema.parse(await client.assistantHistoryWrite?.({ operation: "create", conversationId, title: "Edit scenario" })).state, "saved");
      const message = { conversationId, expectedRevision: 1, messageId, message: scenario.message };
      const envelope = AssistantM1RespondEnvelopeSchema.parse(await client.assistantRespond(message));
      assert.equal(calls.length, 0);
      console.info(`assistant-edit-scenario | ${scenario.name} | ${Math.max(...measured)} | ${measured.reduce((a, b) => a + b, 0)}`);
      assert.ok(Math.max(...measured) <= scenario.largestRequest, scenario.name);
      assert.ok(measured.reduce((sum, count) => sum + count, 0) <= scenario.total, scenario.name);
      const edits = db.authority.assistantAppliedEdits.list(since);
      if ("refusal" in scenario) {
        assert.ok(envelope.kind === "result" && envelope.result.state === "no-reply", JSON.stringify(envelope));
        assert.equal(envelope.result.reason, scenario.refusal);
        assert.equal(edits.length, applied);
        assert.deepEqual(db.authority.settingsCurrent.get(), settingsBefore);
        assert.deepEqual(db.authority.workbooks.catalog().find(row => row.libraryId === libraryId)?.metadata.sharePoint, linkBefore);
        assert.equal(db.authority.workbooks.read(libraryId)?.workbook.name,
          index >= 3 ? "Autumn tracker" : "Summer tracker");
        continue;
      }
      assert.ok(envelope.kind === "result" && envelope.result.state === "answered", JSON.stringify(envelope));
      const rows = envelope.result.reply.parts;
      assert.equal(rows.length, 1);
      const part = rows[0], edit = edits.find(row => row.turn.messageId === messageId);
      assert.ok(part?.kind === "text" && part.editId !== undefined && edit !== undefined);
      assert.equal(part.editId, edit.id);
      assert.equal(edit.actorId, "local-operator");
      const value = part.runs.find(run => run.kind === "value");
      assert.ok(value?.kind === "value" && value.previous !== undefined);
      if ("expectedLink" in scenario) {
        assert.ok(edit.details.kind === "spreadsheets" && edit.details.command === "link");
        const linked = db.authority.workbooks.catalog().find(row => row.libraryId === libraryId)?.metadata;
        assert.equal(linked?.sharePoint?.url, scenario.expectedLink);
        assert.deepEqual(edit.details.next, linked);
        assert.equal(value.value, scenario.expectedLink);
      } else if ("expectedName" in scenario) {
        assert.ok(edit.details.kind === "spreadsheets" && edit.details.command === "rename");
        assert.equal(edit.details.next, scenario.expectedName);
        assert.equal(value.value, scenario.expectedName);
        assert.equal(db.authority.workbooks.read(libraryId)?.workbook.name, scenario.expectedName);
      } else if (index === 0) {
        assert.equal(value.previous, privateName);
        assert.equal(value.value, "Summer tracker");
        assert.equal(db.authority.workbooks.read(libraryId)?.workbook.name, "Summer tracker");
      } else if (edit.details.kind === "spreadsheets" && edit.details.location.kind === "cell") {
        assert.ok(privateCell.length > 8000);
        assert.equal(edit.details.prior, privateCell);
        assert.equal(edit.details.next, "Reviewed");
        assert.ok(value.previous.endsWith("…") && privateCell.startsWith(value.previous.slice(0, -1)));
        assert.equal(value.value, "Reviewed");
        assert.equal(db.authority.workbooks.read(libraryId)?.workbook.sheets[0]?.rows[1]?.cells[0]?.value, "Reviewed");
      } else {
        assert.equal(value.value, "Off");
        const settings = await client.editableSettings();
        const leaves = settings.sections.flatMap(section => section.leaves);
        const headless = leaves.find(leaf => leaf.path === "browser.headless");
        assert.ok(headless);
        assert.equal(headless.label, "Headless browser");
        assert.equal(part.runs[0]?.kind === "plain" && part.runs[0].text, `Changed ${headless.label} to `);
        const reply = replyText(rows);
        for (const leaf of leaves) assert.ok(!reply.includes(leaf.path), `Internal setting path in reply: ${leaf.path}`);
        assert.ok(edit.details.kind === "settings" && edit.details.path === headless.path);
        assert.equal(db.authority.settingsCurrent.get()?.settings.browser?.headless, false);
        assert.ok(db.authority.commandAudits.findByCommand(edit.id));
      }
      const repeated = AssistantM1RespondEnvelopeSchema.parse(await client.assistantRespond(message));
      assert.equal(repeated.kind, "delivery");
      assert.equal(db.authority.assistantAppliedEdits.list(since).length, ++applied);
    }
    const activity = await client.assistantActivity?.();
    assert.ok(activity?.rows.some(row => row.label === "Renamed the spreadsheet"));
    assert.ok(activity?.rows.some(row => row.label === "Changed Headless browser"));
  });
});

it.each(undoEditScenarios)("$name within the assistant budget", async scenario => {
  await withServedAssistant(async ({ context, transport, origin, clock }) => {
    const client = createDashboardClient({ baseUrl: origin }), db = context.database;
    const libraryId = randomUUID(), conversationId = randomUUID(), at = IsoInstantSchema.parse(clock.now().toISOString());
    const workbook = { name: "Separations tracker", libraryId, themes: {}, hasFormulas: false, sheets: [{
      id: "worksheet", name: "Sheet", width: 1, hidden: [],
      rows: [{ id: "heading", cells: [{ value: "Header" }] }, { id: "row", cells: [{ value: "04/23/2031" }] }],
    }] };
    db.authority.workbooks.create({ libraryId, version: 1, createdAt: at, savedAt: at, workbook });
    const saved = () => {
      const row = db.authority.workbooks.read(libraryId);
      assert.ok(row);
      return row;
    };
    assert.equal(AssistantHistoryResultSchema.parse(await client.assistantHistoryWrite?.({
      operation: "create", conversationId, title: "Undo scenario",
    })).state, "saved");
    const measured: number[] = [];
    const send = async (message: string, expectedRevision: number, calls: readonly { tool: string; args: object }[], beforeLast?: () => void) => {
      let step = 0;
      transport.setResponse(init => {
        assert.ok(typeof init.body === "string");
        const request = AssistantTransportRequestSchema.parse(JSON.parse(init.body));
        measured.push(Math.ceil(Buffer.byteLength(init.body) / 4));
        const call = calls[step++];
        assert.ok(call);
        assert.ok(request.tools[0]?.tools.some(tool => tool.name === call.tool));
        assert.ok(!init.body.includes(libraryId));
        assert.ok(!init.body.includes("04/23/2031"));
        if (step === calls.length) beforeLast?.();
        return new Response(completedResponseStream([{ type: "function_call", namespace: "relay", name: call.tool,
          call_id: String(measured.length), arguments: JSON.stringify(call.args), status: "completed" }], request.model,
        `resp_undo_${String(measured.length)}`), { headers: { "Content-Type": "text/event-stream" } });
      });
      const envelope = AssistantM1RespondEnvelopeSchema.parse(await client.assistantRespond({
        conversationId, expectedRevision, message, messageId: randomUUID(),
      }));
      assert.equal(step, calls.length);
      assert.ok(envelope.kind === "result" && envelope.receipt !== undefined);
      return { result: envelope.result, receipt: envelope.receipt };
    };
    const edited = await send('Set the only spreadsheet worksheet 1, row 2, column 1 to "04/24/2031".', 1, [
      { tool: "read_spreadsheets", args: { view: "list", sheet: null, limit: 5 } },
      { tool: "change_spreadsheet", args: { change: { action: "set-cell", sheet: "[[S1.g1]]", worksheet: 1, row: 2, column: 1,
        format: "text", source: "04/24/2031" } } },
    ]);
    assert.equal(edited.result.state, "answered");
    assert.equal(saved().workbook.sheets[0]?.rows[1]?.cells[0]?.value, "04/24/2031");
    const undone = await send("Undo the tracker change.", edited.receipt.revision, [
      { tool: "list_today_edits", args: {} }, { tool: "undo_edit", args: { edit: "[[U1.g1]]" } },
    ], () => {
      if (scenario.laterValue === null) return;
      const current = structuredClone(saved()), cell = current.workbook.sheets[0]?.rows[1]?.cells[0];
      assert.ok(cell);
      cell.value = scenario.laterValue;
      db.authority.workbooks.save({ ...current, version: current.version + 1 }, current.version);
    });
    assert.equal(saved().workbook.sheets[0]?.rows[1]?.cells[0]?.value, scenario.expectedValue);
    assert.equal(saved().version, 3);
    const edits = db.authority.assistantAppliedEdits.list(at);
    if (scenario.laterValue === null) {
      assert.ok(undone.result.state === "answered");
      const [part] = undone.result.reply.parts;
      assert.ok(part?.kind === "text" && part.editId !== undefined);
      assert.deepEqual(part.runs, [
        { kind: "plain", text: "Changed Separations tracker, worksheet 1, row 2, column 1 back: " },
        { kind: "value", previous: "04/24/2031", value: "04/23/2031" },
        { kind: "plain", text: "." },
      ]);
      assert.ok((await client.assistantActivity?.())?.rows.some(row => row.id === part.editId));
      assert.equal(edits.length, 2);
    } else {
      assert.ok(undone.result.state === "no-reply");
      assert.equal(undone.result.reason, "ASSISTANT_UNDO_STALE");
      assert.equal(ASSISTANT_FAILURES[undone.result.reason], "Not undone: changed since.");
      assert.equal(edits.length, 1);
    }
    assert.ok(Math.max(...measured) <= scenario.largestRequest, scenario.name);
    assert.ok(measured.reduce((sum, count) => sum + count, 0) <= scenario.total, scenario.name);
  });
});

it("requires an operator notification change request and journals the accepted change once", async () => {
  await withServedAssistant(async fixture => {
    const { context, transport, origin, clock } = fixture;
    const { run } = seedAssistantReadRun(fixture);
    const db = context.database, authority = db.authority;
    const at = clock.now().toISOString(), notificationId = randomUUID();
    const title = "Synthetic private notification", summary = "Synthetic private notification detail";
    const olderId = randomUUID();
    const notice = authority.notifications.create({ notificationId, actorId: LOCAL_OPERATOR_ACTOR_ID,
      dedupeFingerprint: "d".repeat(64), trigger: "failed", channel: "ping", status: "unread", snooze: { state: "not-snoozed" },
      title, summary, links: [{ kind: "run", runId: run.envelope.runId }], count: 1, lastSeenAt: at, version: 1, createdAt: at, updatedAt: at }).record;
    const door = clientDoor(createDashboardClient({ baseUrl: origin }));
    const commandIds = () => withAuthorityDatabaseReadOnly(context.admission, join(context.admission.stateRoot, "state.db"), database =>
      database.prepare("SELECT id FROM commands WHERE family='notification' ORDER BY id").all().map(row => z.string().parse(row.id)));
    async function request(message: string, source: string | null, rowIndex = 0) {
      let calls = 0;
      transport.setResponse(init => {
        assert.ok(typeof init.body === "string");
        for (const value of [notificationId, olderId, title, summary]) assert.ok(!init.body.includes(value));
        const modelRequest = AssistantTransportRequestSchema.parse(JSON.parse(init.body));
        const output = modelRequest.input.at(-1);
        let name = "list_notifications", args: unknown = { unreadOnly: false };
        if (calls++ === 1) {
          assert.ok(output !== undefined && "type" in output && output.type === "function_call_output");
          const listed = z.object({ items: z.array(z.object({ note: z.string(), trigger: z.string(), state: z.string() })) }).parse(JSON.parse(output.output));
          const row = listed.items.filter(item => item.trigger === "failed")[rowIndex];
          assert.ok(row && row.state === "unread");
          name = "change_notifications";
          args = { note: row.note, state: "read", source };
        }
        return new Response(completedResponseStream([{ type: "function_call", namespace: "relay", name,
          call_id: String(calls), arguments: JSON.stringify(args), status: "completed" }], modelRequest.model, `resp_notice_${String(calls)}`),
        { headers: { "Content-Type": "text/event-stream" } });
      });
      const result = await send(door, { message });
      assert.equal(calls, 2);
      return result;
    }
    const before = commandIds();
    for (const [message, source] of [["List my read and unread notifications.", "read"],
      ["Mark the notification as read.", null], ["Mark the read notification as unread.", "read"],
      ["Mark the notification as not read.", "read"]] as const) {
      assert.deepEqual(await request(message, source), { state: "refused", code: "ASSISTANT_VALUE_NEEDS_SOURCE",
        message: ASSISTANT_FAILURES.ASSISTANT_VALUE_NEEDS_SOURCE });
      assert.deepEqual(authority.notifications.get(notificationId), notice);
      assert.deepEqual(authority.assistantAppliedEdits.list(at), []);
      assert.deepEqual(commandIds(), before);
    }
    const olderAt = new Date(Date.parse(at) - 60_000).toISOString();
    const older = authority.notifications.create({ ...notice, notificationId: olderId, dedupeFingerprint: "e".repeat(64),
      lastSeenAt: olderAt, createdAt: olderAt, updatedAt: olderAt }).record;
    assert.deepEqual(await request("Mark the newest notification as read.", "read", 1),
      { state: "refused", code: "ASSISTANT_VALUE_NEEDS_SOURCE", message: ASSISTANT_FAILURES.ASSISTANT_VALUE_NEEDS_SOURCE });
    assert.deepEqual(authority.notifications.get(notificationId), notice);
    assert.deepEqual(authority.notifications.get(olderId), older);
    assert.deepEqual(authority.assistantAppliedEdits.list(at), []);
    assert.deepEqual(commandIds(), before);
    assert.deepEqual(await request("Please mark the newest notification as read.", "read"), { state: "answered", text: "Changed the notification to read." });
    assert.deepEqual(authority.notifications.get(olderId), older);
    const [edit, extra] = authority.assistantAppliedEdits.list(at);
    assert.ok(edit?.details.kind === "notifications" && extra === undefined);
    assert.equal(edit.details.notificationId, notificationId);
    assert.deepEqual([edit.details.command, edit.details.prior.status, edit.details.next.status, edit.details.revision], ["notification-read", "unread", "read", 2]);
    assert.ok(edit.source?.kind === "operator" && edit.source.messageId === edit.turn.messageId);
    assert.deepEqual(authority.notifications.get(notificationId), { ...notice, status: "read", version: 2 });
    const audit = authority.commandAudits.findByCommand(edit.id);
    assert.deepEqual([audit?.request.source, audit?.request.requestedBy], ["assistant", LOCAL_OPERATOR_ACTOR_ID]);
    assert.deepEqual(commandIds(), [...before, edit.id].sort());

    const undo = async (message: string, token: string) => {
      let calls = 0;
      transport.setResponse(init => {
        assert.ok(typeof init.body === "string");
        const modelRequest = AssistantTransportRequestSchema.parse(JSON.parse(init.body)), index = calls++;
        const name = index === 0 ? "list_today_edits" : "undo_edit", args = index === 0 ? {} : { edit: token };
        return new Response(completedResponseStream([{ type: "function_call", namespace: "relay", name,
          call_id: String(calls), arguments: JSON.stringify(args), status: "completed" }], modelRequest.model, `resp_notice_undo_${String(calls)}`),
        { headers: { "Content-Type": "text/event-stream" } });
      });
      const result = await send(door, { message });
      assert.equal(calls, 2);
      return result;
    };
    assert.deepEqual(await undo("Undo the notification change.", "[[U1.g1]]"),
      { state: "answered", text: "Changed the notification back: unread." });
    assert.deepEqual(authority.notifications.get(notificationId), { ...notice, version: 3 });
    const reversal = authority.assistantAppliedEdits.list(at).find(row => row.id !== edit.id);
    assert.ok(reversal?.details.kind === "notifications");
    assert.equal(authority.commandAudits.findByCommand(reversal.id)?.request.type, "notification-unread");
    assert.deepEqual(authority.notifications.get(olderId), older);
  });
});

it("restores the previous settings override, refuses to revert the original twice, and can undo the reversal", async () => {
  await withServedAssistant(async ({ context, transport, origin, clock }) => {
    const client = createDashboardClient({ baseUrl: origin }), authority = context.database.authority;
    const conversationId = randomUUID(), at = clock.now().toISOString(), initial = authority.settingsCurrent.get()?.settings.browser?.headless;
    assert.equal(AssistantHistoryResultSchema.parse(await client.assistantHistoryWrite?.({
      operation: "create", conversationId, title: "Setting undo",
    })).state, "saved");
    let revision = 1;
    const respond = async (message: string, calls: readonly { name: string; args: object }[]) => {
      let index = 0;
      transport.setResponse(init => {
        assert.ok(typeof init.body === "string");
        const modelRequest = AssistantTransportRequestSchema.parse(JSON.parse(init.body)), call = calls[index++];
        assert.ok(call);
        return new Response(completedResponseStream([{ type: "function_call", namespace: "relay", name: call.name,
          call_id: String(index), arguments: JSON.stringify(call.args), status: "completed" }], modelRequest.model, `resp_setting_${String(index)}`),
        { headers: { "Content-Type": "text/event-stream" } });
      });
      const result = AssistantM1RespondEnvelopeSchema.parse(await client.assistantRespond({
        conversationId, expectedRevision: revision, message, messageId: randomUUID(),
      }));
      assert.ok(result.kind === "result" && result.receipt !== undefined);
      assert.equal(index, calls.length);
      revision = result.receipt.revision;
      return result.result;
    };
    const changed = initial !== false ? false : true, word = changed ? "on" : "off";
    const set = await respond(`Turn headless browser mode ${word}.`, [
      { name: "read_settings", args: { key: "browser.headless" } },
      { name: "change_settings", args: { key: "browser.headless", operation: changed ? "enable" : "disable", source: word } },
    ]);
    assert.equal(set.state, "answered");
    const list = { name: "list_today_edits", args: {} };
    const undo = (number: number) => ({ name: "undo_edit", args: { edit: `[[U${String(number)}.g1]]` } });
    assert.equal((await respond("Undo the setting change.", [list, undo(1)])).state, "answered");
    const restored = authority.settingsCurrent.get();
    assert.equal(restored?.settings.browser?.headless, initial);
    const replay = await respond("Undo edit 1.", [list, undo(1)]);
    assert.ok(replay.state === "no-reply");
    assert.equal(replay.reason, "ASSISTANT_UNDO_STALE");
    assert.deepEqual(authority.settingsCurrent.get(), restored);
    assert.equal(authority.assistantAppliedEdits.list(at).length, 2);
    assert.equal((await respond("Undo the setting change.", [{ name: "list_today_edits", args: {} },
      // Both records are now offered as choices, including the original stale edit.
      { name: "undo_edit", args: { edit: "[[U2.g1]]" } }])).state, "no-reply");
    assert.equal((await respond("Undo edit 2.", [list, undo(2)])).state, "answered");
    assert.equal(authority.settingsCurrent.get()?.settings.browser?.headless, changed);
    assert.equal(authority.assistantAppliedEdits.list(at).length, 3);
  });
});
