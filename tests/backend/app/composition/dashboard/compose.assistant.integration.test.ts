import { AssistantModelPreferenceViewSchema } from '../../../../../src/models/dashboard/assistant.js';
import { withAuthorityDatabaseReadOnly } from "../../../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";
import configuredSources from "../../../../../config/dashboard-workflow-sources.json";
import { z } from "zod";
import { DESCRIPTORS } from "../../../../../src/backend/app/registries/workflow-registry.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { it, vi } from "vitest";
import { composeDashboardRuntime } from "../../../../../src/backend/app/composition/dashboard/compose.js";
import { composeProfileRuntime } from "../../../../../src/backend/app/composition/storage-compose.js";
import { assistantKnowledgeArtifact, ASSISTANT_KNOWLEDGE_PATH } from "../../../../../src/backend/assistant/context.js";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { ASSISTANT_VERIFY_COMMAND,  AssistantInferenceRequestSchema, AssistantResultSchema, AssistantActionResultSchema } from "../../../../../src/models/dashboard/assistant.js";
import { NotificationRecordSchema } from "../../../../../src/models/notifications/notifications.js";
import { CommandResultSchema } from "../../../../../src/rules/commands/commands.js";
import { SETTINGS_SCHEMA_HASH, deriveRawSettingsPatchFingerprint } from "../../../../../src/models/config/settings.js";
import { createBoundProfileFixture } from "../../../../support/helpers/admission-fixture.js";
import { AuthorityDatabase } from "../../../../../src/backend/storage/sqlite/authority-database.js";
import { chatGptFixture , publicCapabilityResponses } from "../../../../support/helpers/chatgpt-account-fixtures.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";
import { createDashboardClient } from "../../../../../src/dashboard/client/index.js";
import { workerPoolMember, type WorkerPoolMember } from "../../../../../src/models/run/worker-slot.js";
import { bindWorkerProcessAdmission } from "../../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { runCapacityCommandId } from "../../../../../src/backend/runs/commands/run-worker-capacity.js";

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
    const sources = z.record(z.string(), z.enum(["mock", "served"])).parse(configuredSources);
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
      clock, isolation: rebuildRuntimeIsolation, env: {}, backendPortOverride: 0, frontendPortOverride: 0, preflightRunnerFactory: healthyRuntimePreflightRunners,
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
      const noCallBaseline = context.database.getMeta().authorityGeneration;
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
        return new Response(`data: ${JSON.stringify({ type: "response.completed", response: { id: "text_without_effect", model: request.model, status: "completed",
          output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Completed. All notifications marked read." }] }] } })}\n\n`, { headers: { "content-type": "text/event-stream" } });
      });
      {
        const refused = AssistantResultSchema.parse(await post("assistant/respond", { message: "mark notifications read" }));
        assert.equal(refused.state, "refused"); if (refused.state === "refused") assert.equal(refused.code, "ASSISTANT_PROPOSAL_REFUSED");
        assert.deepEqual(durableRows(), noCallDurable);
        assert.deepEqual(context.database.authority.notifications.listByActor("local-operator"), noCallRows);
        assert.equal(context.database.getMeta().authorityGeneration, noCallBaseline);
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
        return new Response(`data: ${JSON.stringify({ type: "response.completed", response: { id: `resp_${turns}`, model: request.model, status: "completed", output } })}\n\n`, { headers: { "Content-Type": "text/event-stream" } });
      });
      const result = AssistantResultSchema.parse(await post("assistant/respond", { message: "mark notifications read" }));
      if (mode === "every-action") {
        assert.equal(result.state, "action-proposal"); if (result.state !== "action-proposal") throw new Error("pending operator action required");
        assert.equal(turns, 1, "operator DTO never returns to model");
        assert.equal(result.proposal.targetLabel, "25 current notifications");
        assert.equal(context.database.authority.notifications.get(id)?.status, "unread");
        const record = context.database.authority.assistantAuthorization.action(result.proposal.actionId); assert.ok(record);
        assert.equal(record.command.source, "assistant");
        const before = context.database.getMeta().authorityGeneration;
        const foreign = AssistantActionResultSchema.parse(await post("assistant/action", { chatId: randomUUID(), actionId: result.proposal.actionId, revision: result.proposal.revision, decision: "confirm" }));
        assert.equal(foreign.state, "refused"); assert.equal(context.database.getMeta().authorityGeneration, before);
        const decision = { chatId: result.proposal.chatId, actionId: result.proposal.actionId, revision: result.proposal.revision, decision: "confirm" };
        if (staleAccount) {
          await context.account.signOut();
          const stopped = context.database.getMeta().authorityGeneration;
          assert.equal(AssistantActionResultSchema.parse(await post("assistant/action", decision)).state, "refused");
          assert.equal(context.database.getMeta().authorityGeneration, stopped);
          assert.equal(context.database.authority.notifications.get(id)?.status, "unread");
        } else {
        const confirmed = AssistantActionResultSchema.parse(await post("assistant/action", decision));
        assert.equal(confirmed.state, "applied");
        const settled = context.database.authority.assistantAuthorization.action(result.proposal.actionId); assert.ok(settled);
        assert.equal(settled.state, "settled");
        const audit = context.database.authority.commandAudits.findByCommand(settled.command.commandId);
        assert.equal(audit?.request.source, "assistant"); assert.equal(audit?.versionChanges.length, 25);
        const after = context.database.getMeta().authorityGeneration;
        assert.equal(AssistantActionResultSchema.parse(await post("assistant/action", decision)).state, "refused");
        assert.equal(context.database.getMeta().authorityGeneration, after);
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
      const beforeForeign = transport.calls.length, generation = context.database.getMeta().authorityGeneration;
      const foreign = { ...command, commandId: randomUUID(), target: { ...command.target, profileId: randomUUID(), expectedRevision: changed.revision } };
      assert.notEqual(CommandResultSchema.parse(await post('commands', foreign)).state, 'applied');
      assert.equal(transport.calls.length, beforeForeign);
      assert.equal(context.database.getMeta().authorityGeneration, generation);
      assert.equal(context.database.authority.commands.get(foreign.commandId), undefined);
      assert.equal(context.database.authority.commandAudits.findByCommand(foreign.commandId), undefined);

  });
});

it.each(["current", "deleted"] as const)("rechecks the %s selected source after the real same-workflow capacity wait", async change => {
  type Birth = { child: ReturnType<typeof spawn>; member: WorkerPoolMember; ready: Promise<unknown>;
    closed: Promise<{ code: number | null; signal: string | null }> };
  const birth = Promise.withResolvers<Birth>(), children: Birth[] = [];
  await withServedAssistant(async ({ profile, context, transport, clock, origin }) => {
    const database = context.database, client = createDashboardClient({ baseUrl: origin });
    const pending: Promise<{ result: unknown } | { error: unknown }>[] = [], failures: unknown[] = [];
    let processLock: ReturnType<typeof bindWorkerProcessAdmission>["processLock"] | undefined;
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
      assert.equal(await owned.ready, "ready");
      assert.equal(firstSettled, false);
      assert.equal(children.length, 1);
      const firstAudit = database.authority.commandAudits.findByCommand(firstCommandId);
      assert.equal(firstAudit?.result.state, "applied");
      assert.equal(database.authority.workerLeases.get(owned.member.workerId), undefined);
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
        return new Response(`data: ${JSON.stringify({ type: "response.completed", response: { id: "resp_start_proposal", model: request.model, status: "completed",
          output: [{ type: "function_call", namespace: "relay", name: "propose_workflow_start", call_id: "call_start_proposal",
            arguments: JSON.stringify({ reference: projection.reference }), status: "completed" }] } })}\n\n`, { headers: { "Content-Type": "text/event-stream" } });
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
      const beforeRuns = database.authority.runs.listByWorkflow("person-lookup"), beforeControls = database.authority.workerControls.list();
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
      assert.deepEqual(database.authority.workerControls.list(), beforeControls);
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
      assert.deepEqual(database.authority.workerControls.list(), beforeControls);
      const pid = owned.child.pid; assert.ok(pid !== undefined);
      const workerDatabase = AuthorityDatabase.open(context.admission,
        { path: profile.path, busyTimeoutMs: 250, migrationOwner: "assistant-capacity-birth" }, clock,
        undefined, undefined, undefined, context.credentials);
      let binderCloseAttempted = false;
      try {
        const bound = bindWorkerProcessAdmission({ authorityPath: profile.path, processLockRoot: join(profile.workspace, rebuildRuntimeIsolation.processLockRoot),
          clock, pid, workerId: owned.member.workerId, open: () => workerDatabase, close: value => { binderCloseAttempted = true; value.close(); },
          admit: value => value.withAuthorityReadSnapshot(() => {
            const slot = value.authority.workerSlots.get(owned.member.workerId); assert.ok(slot);
            assert.deepEqual(workerPoolMember(slot), owned.member); return owned.member.workerId;
          }) });
        processLock = bound.processLock;
        const spawnCommandId = runCapacityCommandId(firstCommandId, "spawn-worker", owned.member.poolIndex);
        assert.equal(workerDatabase.authority.workerControls.get(spawnCommandId)?.request.type, "spawn-worker");
        assert.equal(workerDatabase.authority.workerLeases.start({ commandId: spawnCommandId, workerId: bound.workerId, workflow: "person-lookup",
          browserSystems: ["crm", "ucpath"], processId: pid, requestedBy: "local-operator", now: clock.now().toISOString() }).state, "started");
      } finally { if (!binderCloseAttempted) workerDatabase.close(); }
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
      assert.deepEqual(database.authority.workerControls.list().map(control => control.commandId), beforeControls.map(control => control.commandId));
      const finishedRuns = database.authority.runs.listByWorkflow("person-lookup"), finishedControls = database.authority.workerControls.list();
      const generation = database.getMeta().authorityGeneration;
      assert.equal((await client.assistantDecide(decision)).state, "refused");
      assert.equal(database.getMeta().authorityGeneration, generation);
      assert.deepEqual(database.authority.runs.listByWorkflow("person-lookup"), finishedRuns);
      assert.deepEqual(database.authority.workerControls.list(), finishedControls);
      assert.equal(children.length, 1);
    } catch (error) { failures.push(error); }
    for (const owned of children) {
      try {
        if (owned.child.connected) await new Promise<void>((resolve, reject) => {
          owned.child.send("stop", error => { if (error === null) resolve(); else reject(error); });
        });
        assert.deepEqual(await owned.closed, { code: 0, signal: null });
        const pid = owned.child.pid; assert.ok(pid !== undefined);
        assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
        assert.throws(() => process.kill(-pid, 0), { code: "ESRCH" });
      } catch (error) { failures.push(error); }
    }
    for (const execution of pending) {
      const outcome = await execution;
      if ("error" in outcome) failures.push(outcome.error);
    }
    if (failures.length === 0) {
      try {
        assert.equal(children.length, 1); assert.ok(processLock);
        const owned = children[0]; assert.ok(owned);
        const member = owned.member, lease = database.authority.workerLeases.get(member.workerId); assert.ok(lease);
        assert.equal(lease.processId, owned.child.pid);
        const lifetime = { leaseGeneration: lease.leaseGeneration, processId: lease.processId, startedAt: lease.lifecycle.startedAt };
        database.settleInterruptedWorker(profile.lifetime, member.workerId, lease.leaseGeneration, clock.now().toISOString());
        assert.equal(database.authority.workerLeases.get(member.workerId)?.lifecycle.state, "stopped");
        database.assertWorkerLifecycleRelease(member.workerId);
        assert.ok(database.authority.workerControls.browsers(member.workerId).every(browser => browser.health === "closed"));
        processLock.release();
        database.assertStoppedWorkerLifetime(member, lifetime);
      } catch (error) { failures.push(error); }
    }
    if (failures.length > 0) throw new AggregateError(failures, "Assistant capacity wait fixture failed", { cause: failures[0] });
  }, { spawn: ({ member }) => {
    const child = spawn(process.execPath, ["-e", 'process.on("message", () => { process.disconnect(); }); process.send("ready");'],
      { detached: true, env: {}, stdio: ["ignore", "ignore", "ignore", "ipc"] });
    const ready = once(child, "message").then(([message]: unknown[]) => message);
    const closed = new Promise<{ code: number | null; signal: string | null }>(resolve => { child.once("close", (code, signal) => resolve({ code, signal })); });
    const owned = { child, member, ready, closed }; children.push(owned); birth.resolve(owned);
    return { pid: child.pid, kill: signal => child.kill(signal), onExit: listener => { child.on("exit", listener); }, onError: listener => { child.on("error", listener); } };
  } });
});
