import { ASSISTANT_HISTORY_TABLES, faultAuthoritySnapshot, assertHttpFaultOnly, assertOnlyLoopStallWrites, exactHttpFaultLoopDelay } from "../../../../support/helpers/backend/http-route-harness.js";
import { AssistantHistoryResultSchema, AssistantModelPreferenceViewSchema, AssistantRespondEnvelopeSchema, type AssistantHistoryOperation, type AssistantRequest } from '../../../../../src/models/dashboard/assistant.js';
import { withAuthorityDatabaseReadOnly } from "../../../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";
import configuredSources from "../../../../../config/dashboard-workflow-sources.json";
import { z } from "zod";
import { DESCRIPTORS } from "../../../../../src/backend/app/registries/workflow-registry.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { it, vi } from "vitest";
import { NotificationRecordSchema } from "../../../../../src/models/notifications/notifications.js";
import * as workerCapacity from "../../../../../src/backend/runs/commands/run-worker-capacity.js";
import { ERROR_CATALOG } from "../../../../../src/models/failures/error-catalog.js";
import { RunWorkerStartupError, type RunWorkerCapacity } from "../../../../../src/backend/runs/commands/run-worker-capacity.js";
import { assistantProposalDigest } from "../../../../../src/dashboard/surfaces/assistant/assistant-controller-model.js";

import { composeDashboardRuntime } from "../../../../../src/backend/app/composition/dashboard/compose.js";
import { composeProfileRuntime } from "../../../../../src/backend/app/composition/storage-compose.js";
import { ASSISTANT_WORKFLOW_FACTS_PATH, assistantWorkflowFacts } from "../../../../../src/backend/assistant/plugins/workflows/facts.js";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { ASSISTANT_FAILURES, AssistantInferenceRequestSchema, AssistantResultSchema, AssistantActionDecisionSchema } from "../../../../../src/models/dashboard/assistant.js";
import { CommandResultSchema } from "../../../../../src/rules/commands/commands.js";
import { createBoundProfileFixture } from "../../../../support/helpers/admission-fixture.js";
import { chatGptFixture } from "../../../../support/helpers/chatgpt-account-fixtures.js";
import { completedResponseStream } from "../../../../support/helpers/chatgpt-response-stream.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";
import { createDashboardClient } from "../../../../../src/dashboard/client/index.js";
import { ScriptedWorkerChild } from "../../../../support/helpers/backend/fake-worker-port.js";
import { EXECUTOR_EID, personLookupQueuedRun } from "../../../../support/helpers/phase1f-executor-harness.js";
import { RunRecordSchema } from "../../../../../src/models/run/record.js";
import { createTimelineEmitter } from "../../../../../src/backend/storage/events/timeline-emitter.js";
import { runQueuedSpanEvent } from "../../../../../src/backend/runs/commands/run-queued-span.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../../src/rules/identity/ids.js";
import { deriveTraceId } from "../../../../../src/rules/identity/identifiers.js";
import { createWorkbookLibraryService } from "../../../../../src/backend/workbooks/workbook-library-service.js";
import { unexpectedWorkbookSync } from "../../../../support/helpers/backend/workbook-sync.js";

vi.mock("../../../../../src/backend/runs/commands/run-worker-capacity.js", async importOriginal => {
  const actual = await importOriginal<typeof workerCapacity>();
  return { ...actual, createRunWorkerCapacity: vi.fn(actual.createRunWorkerCapacity) };
});

type Door = { history(operation: AssistantHistoryOperation): Promise<unknown>; respond(request: AssistantRequest): Promise<unknown> };
const clientDoor = (client: ReturnType<typeof createDashboardClient>): Door => ({
  history: operation => { if (client.assistantHistoryWrite === undefined) throw new Error('assistant history owner required'); return client.assistantHistoryWrite(operation); },
  respond: request => client.assistantRespond(request) });
const postDoor = (post: (path: string, value: unknown) => Promise<unknown>): Door => ({ history: operation => post('assistant/history', operation), respond: request => post('assistant/respond', request) });
/** One message in a new served chat. Returns the settled result. */
async function send(door: Door, input: Omit<AssistantRequest, 'conversationId' | 'expectedRevision' | 'messageId'>) {
  const conversationId = randomUUID();
  assert.equal(AssistantHistoryResultSchema.parse(await door.history({ operation: 'create', conversationId, title: 'Chat' })).state, 'saved');
  const envelope = AssistantRespondEnvelopeSchema.parse(await door.respond({ conversationId, expectedRevision: 1, messageId: randomUUID(), ...input }));
  assert.equal(envelope.kind, 'result'); if (envelope.kind !== 'result') throw new Error('settled result required');
  return envelope.result;
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
    const target = join(f.workspace, ASSISTANT_WORKFLOW_FACTS_PATH);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${assistantWorkflowFacts(DESCRIPTORS.filter(descriptor => sources[descriptor.id] === "served")).bytes}\n`);
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

it('serves the read tools through authenticated composition without private provider input or command effects', async () => {
  await withServedAssistant(async fixture => {
    const { context, transport, origin, originalFetch } = fixture, { run, title, subjectRef } = seedAssistantReadRun(fixture);
    const client = createDashboardClient({ baseUrl: origin });
    await vi.waitFor(async () => assert.equal((await client.runDetail(run.envelope.runId)).timeline.events.length, 12));
    const detail = await client.runDetail(run.envelope.runId);
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
      { total: 12, steps: detail.timeline.events.slice(-5).map(event => ({ at: event.at, label: event.label, state: event.state, skipped: event.notRun.state === 'present' ? event.notRun.reason : null })) });
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
      const beforeReplay = { generation: context.database.getMeta().authorityGeneration, timeline: context.database.authority.timelineEvents.page({ limit: 500 }) };
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

function assertAssistantProposalFaults(owner: Parameters<typeof faultAuthoritySnapshot>[0], before: ReturnType<typeof faultAuthoritySnapshot>,
  reason: "canonical-completion-required" | "action-decision") {
  assertHttpFaultOnly(owner, before, 3);
  const added = owner.database.authority.timelineEvents.page({ limit: 500 }).slice(before.timeline.length);
  const [proposal, cause, http] = added; assert.ok(proposal && cause && http);
  assert.ok(proposal.cursor < cause.cursor && cause.cursor < http.cursor);
  assert.equal(new Set(added.map(record => record.eventId)).size, 3);
  const events = added.map(record => {
    assert.deepEqual(record.scope, { kind: "transport", connectionId: "local" });
    assert.equal(record.payload.kind, "debug");
    if (record.payload.kind !== "debug") throw new Error("assistant refusal diagnostic required");
    const { build, pid, pinned, ...event } = record.payload.event;
    assert.ok(build.length > 0); assert.equal(pid, process.pid); assert.equal(pinned, false);
    z.uuid().parse(event.correlationId);
    return event;
  });
  assert.equal(events[0].correlationId, events[1].correlationId);
  assert.notEqual(events[0].correlationId, events[2].correlationId);
  const stack = events[1].stack; assert.ok(typeof stack === "string");
  const [name, ...frames] = stack.split("\n"); assert.equal(name, "Error"); assert.ok(frames.length <= 40);
  for (const frame of frames) {
    assert.match(frame, /^ {4}at (?:src|scripts|node_modules|assets)\/[A-Za-z0-9_./-]+\.(?:[cm]?[jt]sx?):\d+:\d+$/u);
    assert.equal(frame.includes(".."), false);
  }
  assert.equal(JSON.stringify(events).includes("assistant-action-not-current"), false);
  assert.deepEqual(events.map(event => ({ ...event, correlationId: "generated", ...(event.stack === undefined ? {} : { stack: "safe-frames" }) })), [
    { category: "http", phase: "failed", correlationId: "generated", area: "assistant-proposal", reason, code: "ASSISTANT_PROPOSAL_REFUSED" },
    { category: "http", phase: "failed", correlationId: "generated", area: "assistant-proposal", reason: "cause-unavailable", code: "INTERNAL_FAILURE", message: "Error", stack: "safe-frames" },
    { category: "http", phase: "failed", correlationId: "generated", area: "request", reason: "operation-refused", code: "ASSISTANT_PROPOSAL_REFUSED",
      method: "POST", route: reason === "canonical-completion-required" ? "/api/v1/assistant/respond" : "/api/v1/assistant/action", status: 200 },
  ]);
}

it.each([
  { staleAccount: false }, { staleAccount: true },
] as const)("changes notifications at once without a card through the composed service with staleAccount=$staleAccount and bounded outbound data", async ({ staleAccount }) => {
  const installed = true;
  await withServedAssistant(async ({ context, transport, clock, originalFetch, origin, post }) => {
    if (installed) {
      const preferenceResponse = await originalFetch(`${origin}/api/v1/assistant/model-preference`);
      assert.equal(preferenceResponse.status, 200);
      assert.equal(preferenceResponse.headers.get('cache-control'), 'no-store');
      const preference = AssistantModelPreferenceViewSchema.parse(await preferenceResponse.json());
      assert.equal(preference.profileId, context.admission.profileBinding.profileId);
      assert.equal(preference.epoch, context.profileEpoch);
      assert.equal(preference.revision, 0);
    }
    if (installed) {
      const id = randomUUID(), ids = [id, ...Array.from({ length: 24 }, () => randomUUID())];
      context.database.withAuthorityTransaction(({ notifications }) => { for (const [index, notificationId] of ids.entries()) notifications.create(NotificationRecordSchema.parse({ notificationId, actorId: "local-operator", dedupeFingerprint: index.toString(16).padStart(64, "0"),
        trigger: "storage", channel: "ping", status: "unread", snooze: { state: "not-snoozed" }, title: "Local title", summary: "Local summary", links: [{ kind: "storage", diagnosticFingerprint: "b".repeat(64) }],
        count: 1, version: 1, lastSeenAt: clock.now().toISOString(), createdAt: clock.now().toISOString(), updatedAt: clock.now().toISOString() })); });
      const noCallBaseline = faultAuthoritySnapshot({ database: context.database, stateRoot: context.admission.stateRoot }, { tables: ASSISTANT_HISTORY_TABLES, writes: 0 });
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
        const prose = AssistantResultSchema.parse(await send(postDoor(post), { message: "mark notifications read" }));
        assert.equal(prose.state, "answered");
        assert.deepEqual(durableRows(), noCallDurable);
        assert.deepEqual(context.database.authority.notifications.listByActor("local-operator"), noCallRows);
        // The answer is stored: the chat create, the accepted turn and its settlement are the only writes.
        assertHttpFaultOnly({ database: context.database, stateRoot: context.admission.stateRoot }, noCallBaseline, 0, { tables: ASSISTANT_HISTORY_TABLES, writes: 3 });
      }
      let turns = 0;
      transport.setResponse(init => {
        if (typeof init.body !== "string") throw new Error("synthetic JSON request body required");
        const request = AssistantTransportRequestSchema.parse(JSON.parse(init.body));
        const outbound = JSON.stringify(request);
        for (const local of [...ids, "Local title", "Local summary", "unrecognized private local request"]) assert.equal(outbound.includes(local), false);
        turns++;
        const output = turns === 1 ? [{ type: "function_call", namespace: "relay", name: "change_notifications", call_id: "call_local", arguments: JSON.stringify({ action: "read", target: "all" }), status: "completed" }]
          : [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Notification updated." }] }];
        return new Response(completedResponseStream(output, request.model, `resp_${turns}`), { headers: { "Content-Type": "text/event-stream" } });
      });
      if (staleAccount) await context.account.signOut();
      const before = durableRows();
      const result = AssistantResultSchema.parse(await send(postDoor(post), { message: "mark notifications read" }));
      if (staleAccount) {
        assert.equal(result.state, "refused");
        assert.deepEqual(durableRows(), before, "a stale account applies nothing");
      } else {
        assert.deepEqual(result, { state: "answered", text: "Notification updated." });
        assert.equal(turns, 2, "the change result returns to the model, which answers in words");
        const actions = durableRows().actions.filter(row => !before.actions.some(prior => prior.id === row.id));
        assert.equal(actions.length, 1);
        const record = context.database.authority.assistantAuthorization.action(String(actions[0]?.id)); assert.ok(record);
        assert.equal(record.state, "settled"); assert.equal(record.command.source, "assistant");
        const audit = context.database.authority.commandAudits.findByCommand(record.command.commandId);
        assert.equal(audit?.request.source, "assistant"); assert.equal(audit?.versionChanges.length, 25);
      }
      for (const notificationId of ids) assert.equal(context.database.authority.notifications.get(notificationId)?.status, staleAccount ? "unread" : "read");
    }

  });
});


it.each(["current", "deleted"] as const)("rechecks the %s selected source after the real same-workflow capacity wait", async change => {
  const birth = Promise.withResolvers<ScriptedWorkerChild>(), children: ScriptedWorkerChild[] = [];
  await withServedAssistant(async ({ context, transport, clock, origin }) => {
    const database = context.database, client = createDashboardClient({ baseUrl: origin });
    const pending: Promise<{ result: unknown } | { error: unknown }>[] = [], failures: unknown[] = [];
    try {
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
        const token = /selected the run (\[\[R1\.g\d+\]\])/u.exec(outbound)?.[1]; assert.ok(token);
        proposalTurns++;
        return new Response(completedResponseStream([{ type: "function_call", namespace: "relay", name: "propose_workflow_start", call_id: "call_start_proposal",
          arguments: JSON.stringify({ workflow: "person-lookup", entries: [token] }), status: "completed" }], request.model, "resp_start_proposal"), { headers: { "Content-Type": "text/event-stream" } });
      });
      const proposed = await send(clientDoor(client), { message: "Run Person Lookup again for this run", subjectRef });
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
      assert.equal(proposed.proposal.effect, "workflow-start"); if (proposed.proposal.effect !== "workflow-start") throw new Error("start card required");
      assert.equal(proposed.proposal.source, "run");
      assert.deepEqual(proposed.proposal.startPlan.planned.map(row => row.display), [{ kind: "person", employeeId: "10873698" }]);
      const decision = AssistantActionDecisionSchema.parse({ chatId: proposed.proposal.chatId, actionId: proposed.proposal.actionId, revision: proposed.proposal.revision, decision: "confirm",
        reviewedDigest: await assistantProposalDigest(proposed.proposal) });
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

it.each(["ready", "refused", "unknown"] as const)('confirms run actions with %s capacity, retaining warnings and refusing stale cards', async capacityState => {
  const actual = await vi.importActual<typeof workerCapacity>("../../../../../src/backend/runs/commands/run-worker-capacity.js");
  let checkCapacity: RunWorkerCapacity["ensure"] = async () => { throw new Error("capacity before the fixture was ready"); };
  const capacityCalls: string[] = [];
  const factory = vi.spyOn(workerCapacity, "createRunWorkerCapacity").mockImplementation(deps => ({
    ...actual.createRunWorkerCapacity(deps), ensure: (command, result) => checkCapacity(command, result),
  }));
  try { await withServedAssistant(async fixture => {
    const { context, transport, origin, clock } = fixture, { run, subjectRef } = seedAssistantReadRun(fixture), client = createDashboardClient({ baseUrl: origin });
    const database = context.database;
    checkCapacity = async (command, result) => {
      assert.ok(command.family === "run" && command.type === "resume");
      capacityCalls.push(command.commandId);
      assert.equal(result.state, "applied");
      withAuthorityDatabaseReadOnly(context.admission, join(context.admission.stateRoot, 'state.db'), raw => {
        assert.equal(raw.prepare("SELECT state FROM assistant_actions WHERE command_id=?").get(command.commandId)?.state, "settled");
        assert.equal(raw.prepare("SELECT json_extract(payload_json,'$.result.state') AS state FROM command_audits WHERE command_id=?").get(command.commandId)?.state, "applied");
        assert.equal(raw.prepare("SELECT pause_state FROM runs WHERE id=?").get(command.target.runId)?.pause_state, null);
      });
      if (capacityState !== "ready") throw new RunWorkerStartupError({ state: capacityState, code: "RUN_QUEUED_WORKER_UNAVAILABLE",
        message: ERROR_CATALOG.RUN_QUEUED_WORKER_UNAVAILABLE.text, detail: "private worker startup diagnostic" });
    };
    let cleanupSubscription = () => {};
    try {
      if (client.assistantDecide === undefined) throw new Error('assistant decide owner required');
      const decide = (decision: Parameters<NonNullable<typeof client.assistantDecide>>[0]) => { if (client.assistantDecide === undefined) throw new Error('assistant decide owner required'); return client.assistantDecide(decision); };
      let next: (outbound: string) => readonly [string, unknown] = () => { throw new Error("no proposal scripted"); };
      const outputs: unknown[] = [];
      transport.setResponse(init => {
        if (typeof init.body !== 'string') throw Error('synthetic request body required');
        const request = AssistantTransportRequestSchema.parse(JSON.parse(init.body)), last = request.input.at(-1);
        // After a tool output the scripted model answers in prose; the turn's disposition comes from the tool outcome.
        if (last !== undefined && 'type' in last && last.type === 'function_call_output') {
          outputs.push(JSON.parse(last.output));
          return new Response(completedResponseStream([{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Done.' }] }],
            request.model, `resp_${randomUUID()}`), { headers: { 'Content-Type': 'text/event-stream' } });
        }
        const [name, args] = next(JSON.stringify(request));
        return new Response(completedResponseStream([{ type: 'function_call', namespace: 'relay', name, call_id: `call_${randomUUID()}`, arguments: JSON.stringify(args), status: 'completed' }],
          request.model, `resp_${randomUUID()}`), { headers: { 'Content-Type': 'text/event-stream' } });
      });
      const refusedTurn = async (message: string, script: (outbound: string) => readonly [string, unknown], selection?: string) => {
        next = script;
        return send(clientDoor(client), { message, ...(selection === undefined ? {} : { subjectRef: selection }) });
      };
      const selected = (outbound: string) => { const token = /selected the run (\[\[R1\.g\d+\]\])/u.exec(outbound)?.[1]; assert.ok(token); return token; };
      const propose = async (message: string, script: (outbound: string) => readonly [string, unknown], selection?: string) => {
        next = script;
        const result = await send(clientDoor(client), { message, ...(selection === undefined ? {} : { subjectRef: selection }) });
        assert.equal(result.state, 'action-proposal'); if (result.state !== 'action-proposal') throw new Error('card required');
        return result.proposal;
      };
      const confirm = async (proposal: Parameters<typeof assistantProposalDigest>[0]) => decide(AssistantActionDecisionSchema.parse({
        chatId: proposal.chatId, actionId: proposal.actionId, revision: proposal.revision, decision: 'confirm', reviewedDigest: await assistantProposalDigest(proposal) }));

      const expired = await propose('Cancel this run', outbound => ['propose_run_action', { run: selected(outbound), action: 'cancel' }], subjectRef);
      clock.setWall(new Date(clock.nowMs() + 61_000));
      assert.equal((await confirm(expired)).state, 'refused');
      assert.deepEqual(database.authority.runs.get(run.envelope.runId), run);

      const cancel = await propose('Cancel this run', outbound => ['propose_run_action', { run: selected(outbound), action: 'cancel' }], subjectRef);
      assert.equal(cancel.effect, 'run-action');
      assert.equal(database.authority.assistantAuthorization.action(cancel.actionId)?.command.family, 'run');
      assert.deepEqual(database.authority.runs.get(run.envelope.runId), run);
      assert.equal((await confirm(cancel)).state, 'applied');
      const cancelled = database.authority.runs.get(run.envelope.runId); assert.ok(cancelled && cancelled.lifecycle.state === 'terminal');
      assert.equal(database.authority.commandAudits.findByCommand(database.authority.assistantAuthorization.action(cancel.actionId)?.command.commandId ?? '')?.request.source, 'assistant');
      assert.equal((await confirm(cancel)).state, 'refused');

      const stale = await send(clientDoor(client), { message: 'Pause this run', subjectRef });
      assert.deepEqual(stale, { state: 'refused', code: 'ASSISTANT_READ_STALE', message: ASSISTANT_FAILURES.ASSISTANT_READ_STALE });

      const current = `run_${run.envelope.runId}_${cancelled.version}`;
      assert.deepEqual(await refusedTurn('Rerun this run', outbound => ['propose_rerun', { run: selected(outbound) }], current),
        { state: 'refused', code: 'ASSISTANT_PROPOSAL_REFUSED', message: ASSISTANT_FAILURES.ASSISTANT_PROPOSAL_REFUSED }, 'a cancelled source is not rerun-eligible');
      const durableCounts = () => withAuthorityDatabaseReadOnly(context.admission, join(context.admission.stateRoot, 'state.db'), raw => ({
        actions: raw.prepare('SELECT id FROM assistant_actions').all().length, plans: raw.prepare('SELECT id FROM run_requests').all().length }));
      const countsBefore = durableCounts();
      assert.deepEqual(await refusedTurn('Run Person Lookup again for this run', outbound => ['propose_workflow_start', { workflow: 'person-lookup', entries: [selected(outbound)] }], subjectRef),
        { state: 'refused', code: 'ASSISTANT_READ_STALE', message: ASSISTANT_FAILURES.ASSISTANT_READ_STALE }, 'a moved selected run cannot be reused');
      assert.deepEqual(durableCounts(), countsBefore);

      const second = seedAssistantReadRun(fixture);
      const dayOf = async (runId: string) => {
        const day = (await client.searchRuns({ q: runId, scope: 'run', limit: 1 })).results[0]?.partitionDay; assert.ok(day); return day;
      };
      const day = await dayOf(second.run.envelope.runId);
      // Only a published snapshot or patch reaches this subscriber; a fresh read would pass even without publication.
      const published: { revision: number; pause: string | undefined }[] = [];
      await new Promise<void>((resolve, reject) => {
        const subscription = client.subscribeDay({ day, onDay: received => {
          const row = received.queueSurfaces.find(surface => surface.runId === second.run.envelope.runId);
          if (row !== undefined) published.push({ revision: row.rowRevision, pause: row.pauseControl?.state });
        }, onState: state => { if (state.state === 'live') resolve(); else if (state.state === 'stopped') reject(new Error('day subscription stopped')); } });
        cleanupSubscription = () => subscription.close();
      });
      await vi.waitFor(() => assert.ok(published.length > 0), { timeout: 5_000, interval: 25 });
      const pause = await propose('Pause this run', outbound => ['propose_run_action', { run: selected(outbound), action: 'pause' }], second.subjectRef);
      const beforePause = published.length;
      assert.equal((await confirm(pause)).state, 'applied');
      const paused = database.authority.runs.get(second.run.envelope.runId); assert.ok(paused?.pause !== undefined);
      await vi.waitFor(() => assert.ok(published.slice(beforePause).some(row => row.revision === paused.version && row.pause === 'paused')), { timeout: 5_000, interval: 25 });
      const resume = await propose('Resume this run', outbound => ['propose_run_action', { run: selected(outbound), action: 'resume' }], `run_${paused.envelope.runId}_${paused.version}`);
      const beforeResume = published.length;
      assert.deepEqual(capacityCalls, [], 'expired, cancelled and pause cards never start a worker');
      assert.equal((await confirm(resume)).state, 'applied');
      const resumeCommand = database.authority.assistantAuthorization.action(resume.actionId)?.command; assert.ok(resumeCommand);
      assert.deepEqual(capacityCalls, [resumeCommand.commandId]);
      const caption = withAuthorityDatabaseReadOnly(context.admission, join(context.admission.stateRoot, 'state.db'), raw =>
        raw.prepare("SELECT json_extract(payload_json,'$.text') AS text FROM assistant_messages WHERE action_id=? AND kind='decision'").get(resume.actionId)?.text);
      assert.equal(caption, `Done: ${resume.label}.${capacityState === "ready" ? "" : ` ${ERROR_CATALOG.RUN_QUEUED_WORKER_UNAVAILABLE.text}`}`);
      assert.equal(String(caption).includes('private worker startup diagnostic'), false);
      const resumed = database.authority.runs.get(second.run.envelope.runId); assert.ok(resumed && resumed.pause === undefined);
      await vi.waitFor(() => assert.ok(published.slice(beforeResume).some(row => row.revision === resumed.version && row.pause !== 'paused')), { timeout: 5_000, interval: 25 });
      cleanupSubscription();
      for (const commandId of [pause, resume].map(card => database.authority.assistantAuthorization.action(card.actionId)?.command.commandId ?? '')) {
        assert.equal(database.authority.commandAudits.findByCommand(commandId)?.result.state, 'applied', 'one canonical execution per confirmed card');
      }

      const documents = await propose('Separate documents 4502 and 4510', () => ['propose_workflow_start', { workflow: 'separations', entries: ['4502', '4510'] }]);
      assert.ok(documents.effect === 'workflow-start' && documents.dryRun);
      assert.deepEqual(documents.startPlan.planned.map(row => row.display), [{ kind: 'document', documentNumber: '4502' }, { kind: 'document', documentNumber: '4510' }]);
      assert.equal(documents.targetLabel, '2 documents');
      assert.equal((await decide({ chatId: documents.chatId, actionId: documents.actionId, revision: documents.revision, decision: 'cancel' })).state, 'cancelled');

      const listed = await propose('Look up 10812345 and Jordan Lee', outbound => {
        const eid = /\[\[E1\.g\d+\]\]/u.exec(outbound)?.[0]; assert.ok(eid);
        return ['propose_workflow_start', { workflow: 'person-lookup', entries: [eid, 'Jordan Lee'] }];
      });
      assert.equal(listed.effect, 'workflow-start'); if (listed.effect !== 'workflow-start') throw new Error('start card required');
      assert.deepEqual(listed.startPlan.planned.map(row => row.display), [{ kind: 'person', employeeId: '10812345' }, { kind: 'person', name: 'Jordan Lee' }]);
      assert.equal(listed.targetLabel, '2 people');
      const record = database.authority.assistantAuthorization.action(listed.actionId); assert.ok(record && record.command.family === 'start');
      const startPlanId = record.command.family === 'start' ? record.command.target.startPlanId : '';
      assert.equal((await decide({ chatId: listed.chatId, actionId: listed.actionId, revision: listed.revision, decision: 'cancel' })).state, 'cancelled');
      assert.equal(database.authority.startPlans.get(startPlanId)?.consumedBy, undefined);

    } finally { cleanupSubscription(); }
  }); } finally { factory.mockRestore(); }
});

it('refuses a PDF start while Emergency Contact is not served and confirms an attached spreadsheet as a library import', async () => {
  await withServedAssistant(async fixture => {
    const { context, transport, origin, clock } = fixture, client = createDashboardClient({ baseUrl: origin }), database = context.database;
    const library = createWorkbookLibraryService({ repository: database.authority.workbooks, clock, sync: unexpectedWorkbookSync });
    let next: (outbound: string) => readonly [string, unknown] = () => { throw new Error("no proposal scripted"); };
    transport.setResponse(init => {
      if (typeof init.body !== 'string') throw Error('synthetic request body required');
      const request = AssistantTransportRequestSchema.parse(JSON.parse(init.body)), last = request.input.at(-1);
      // A tool refusal comes back as the answer text, so a failed card names its code.
      if (last !== undefined && 'type' in last && last.type === 'function_call_output') return new Response(completedResponseStream([{ type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: last.output }] }], request.model, `resp_${randomUUID()}`), { headers: { 'Content-Type': 'text/event-stream' } });
      const [name, args] = next(init.body);
      return new Response(completedResponseStream([{ type: 'function_call', namespace: 'relay', name, call_id: `call_${randomUUID()}`, arguments: JSON.stringify(args), status: 'completed' }],
        request.model, `resp_${randomUUID()}`), { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const respond = async (message: string, file: Readonly<{ name: string; mediaType: string; bytes: Uint8Array }>, script: (token: string) => readonly [string, unknown]) => {
      const conversationId = randomUUID();
      assert.equal(AssistantHistoryResultSchema.parse(await clientDoor(client).history({ operation: 'create', conversationId, title: 'Chat' })).state, 'saved');
      if (client.assistantStageAttachment === undefined || client.assistantConversation === undefined) throw new Error("assistant attachment owners required");
      const staged = await client.assistantStageAttachment(conversationId, file);
      assert.equal(staged.state, 'staged'); if (staged.state !== 'staged') throw new Error('staged attachment required');
      next = outbound => { const token = /\[\[A1\.g\d+\]\]/u.exec(outbound)?.[0]; assert.ok(token); return script(token); };
      const view = await client.assistantConversation(conversationId);
      return AssistantRespondEnvelopeSchema.parse(await client.assistantRespond({ conversationId, expectedRevision: view.revision, messageId: randomUUID(), message, attachments: [staged.attachment.id] }));
    };
    const turn = async (...args: Parameters<typeof respond>) => {
      const envelope = await respond(...args);
      assert.ok(envelope.kind === 'result' && envelope.result.state === 'action-proposal', JSON.stringify(envelope)); if (envelope.kind !== 'result' || envelope.result.state !== 'action-proposal') throw new Error('card required');
      return envelope.result.proposal;
    };
    const decide = (proposal: Parameters<typeof assistantProposalDigest>[0], decision: 'confirm' | 'cancel') => Promise.resolve(assistantProposalDigest(proposal)).then(digest => {
      if (client.assistantDecide === undefined) throw new Error('assistant decide owner required');
      return client.assistantDecide(AssistantActionDecisionSchema.parse({ chatId: proposal.chatId, actionId: proposal.actionId, revision: proposal.revision, decision,
        ...(decision === 'confirm' ? { reviewedDigest: digest } : {}) }));
    });

    assert.equal(configuredSources['emergency-contact'], 'mock');
    const pdf = await respond('Run this PDF for Emergency Contact', { name: 'contact.pdf', mediaType: 'application/pdf', bytes: new TextEncoder().encode('%PDF-1.4\n% synthetic\n') },
      file => ['propose_workflow_start', { workflow: 'emergency-contact', entries: [file] }]);
    assert.equal(pdf.kind === 'result' ? pdf.result.state === 'refused' && pdf.result.code : pdf.kind, 'ASSISTANT_PROPOSAL_REFUSED', 'a workflow that is not served is never proposed');
    assert.equal(database.authority.runs.listByWorkflow('emergency-contact').length, 0);

    const sheets = () => library.catalog().filter(entry => entry.name === 'Q3 roster').length;
    const imported = await turn('Import this as Q3 roster', { name: 'roster.csv', mediaType: 'text/csv', bytes: new TextEncoder().encode('Name,Dept\nAda,HR\n') },
      file => ['propose_spreadsheet_change', { change: { action: 'import', file, name: 'Q3 roster' } }]);
    assert.ok(imported.effect === 'spreadsheet' && imported.action === 'import');
    assert.equal(sheets(), 0, 'nothing is imported before Confirm');
    assert.equal((await decide(imported, 'confirm')).state, 'applied');
    assert.equal(sheets(), 1);
  });
});
