import { AssistantModelPreferenceViewSchema } from '../../../../../src/models/dashboard/assistant.js';
import { withAuthorityDatabaseReadOnly } from "../../../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";
import configuredSources from "../../../../../config/dashboard-workflow-sources.json";
import { z } from "zod";
import { DESCRIPTORS } from "../../../../../src/backend/app/registries/workflow-registry.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
import { chatGptFixture , publicCapabilityResponses } from "../../../../support/helpers/chatgpt-account-fixtures.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";

const AssistantTransportRequestSchema = AssistantInferenceRequestSchema.safeExtend({
  store: z.literal(false), stream: z.literal(true), parallel_tool_calls: z.literal(false),
  include: z.tuple([z.literal("reasoning.encrypted_content")]),
});

type ServedAssistantFixture = {
  context: ReturnType<ReturnType<typeof composeProfileRuntime>['selectedContext']>;
  transport: ReturnType<typeof chatGptFixture>;
  clock: ReturnType<typeof chatGptFixture>['clock'];
  originalFetch: typeof fetch;
  origin: string;
  post: (path: string, value: unknown) => Promise<unknown>;
};
type ServedAssistantOwner = {
  profile?: ReturnType<typeof createBoundProfileFixture>;
  transport?: ReturnType<typeof chatGptFixture>;
  runtime?: ReturnType<typeof composeProfileRuntime>;
  dashboard?: Awaited<ReturnType<typeof composeDashboardRuntime>>;
  fetchProbe?: { mockRestore(): void };
  unsettled: Error;
  primary?: { error: unknown };
  failures: unknown[];
};
let servedAssistantOwner: ServedAssistantOwner | undefined;
async function withServedAssistant(body: (fixture: ServedAssistantFixture) => Promise<void>) {
  if (servedAssistantOwner !== undefined) {
    const error = servedAssistantOwner.primary === undefined ? servedAssistantOwner.unsettled : servedAssistantOwner.primary.error;
    if (error instanceof Error) throw error;
    throw new AggregateError([error], 'Predecessor assistant fixture remains unproved', { cause: error });
  }
  const owner: ServedAssistantOwner = { unsettled: new Error('Predecessor assistant fixture is unsettled'), failures: [] };
  servedAssistantOwner = owner;
  const traceStart = process.hrtime.bigint();
  const trace = (stage: string) => process.stderr.write(`[DEBUG-assistant-timeout-20261026] ${stage} ${Number(process.hrtime.bigint() - traceStart) / 1_000_000}ms\n`);
  trace('fixture-start');
  let ready = false;
  let primary: { error: unknown } | undefined;
  try {
    const f = createBoundProfileFixture();
    owner.profile = f;
    trace('profile-created');
    const transport = chatGptFixture(f.admission);
    owner.transport = transport;
    trace('transport-created');
    const originalFetch = globalThis.fetch;
    const fetchProbe = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return originalFetch(input, init);
    return transport.transport(input, init);
  });
    owner.fetchProbe = fetchProbe;
    const clock = transport.clock;
    const runtime = composeProfileRuntime({ admission: f.machine, clock, hostFacts: { primaryDisplay: null }, processLockRoot: join(f.workspace, rebuildRuntimeIsolation.processLockRoot) });
    owner.runtime = runtime;
    trace('runtime-created');
    for (const name of ["package.json", "package-lock.json"]) copyFileSync(name, join(f.workspace, name));
    const sources = z.record(z.string(), z.enum(["mock", "served"])).parse(configuredSources);
    const knowledge = assistantKnowledgeArtifact(DESCRIPTORS.filter(descriptor => sources[descriptor.id] === "served").map(descriptor => ({ id: descriptor.id, label: descriptor.label })));
    const target = join(f.workspace, ASSISTANT_KNOWLEDGE_PATH);
    mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, `${knowledge.bytes}\n`);
    const document = join(f.workspace, knowledge.reference.files[0].path);
    mkdirSync(dirname(document), { recursive: true }); writeFileSync(document, `${knowledge.reference.files[0].text}\n`);
    const active = runtime.session.signIn({ email: "fixture@example.edu", password: "disposable-fixture-password", at: clock.now().toISOString() });
    assert.equal(active.state, "active"); if (active.state !== "active") throw new Error("selected fixture required");
    const context = runtime.selectedContext(active.token);
    trace('context-created');
    const authorization = await context.account.signIn({ usePlan: true }); await transport.callback(authorization); await authorization.completion;
    trace('account-connected');
    const dashboard = await composeDashboardRuntime({ admission: f.machine, profile: { runtime, token: active.token }, repoRoot: f.workspace,
      clock, isolation: rebuildRuntimeIsolation, env: {}, backendPortOverride: 0, frontendPortOverride: 0, preflightRunnerFactory: healthyRuntimePreflightRunners,
       });
    owner.dashboard = dashboard;
    trace('dashboard-created');
    const origin = `http://127.0.0.1:${String(dashboard.port)}`;
    let requestCount = 0;
    const post = async (path: string, value: unknown): Promise<unknown> => {
      const request = ++requestCount;
      trace(`request-${request}-start`);
      const response = await originalFetch(`${origin}/api/v1/${path}`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(value) });
      trace(`request-${request}-response`);
      const body: unknown = await response.json();
      trace(`request-${request}-complete`);
      return body;
    };

    ready = true;
    trace('body-start');
    await body({ context, transport, clock, originalFetch, origin, post });
    trace('body-complete');
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
    trace('runtime-cleanup-start');
    if (owner.dashboard !== undefined) await owner.dashboard.stop(); else await owner.runtime.close();
    trace('runtime-cleanup-complete');
    await owner.transport.cleanup();
    trace('transport-cleanup-complete');
    owner.fetchProbe.mockRestore();
    trace('fetch-restored');
    owner.profile.close();
    trace('profile-closed');
    servedAssistantOwner = undefined;
  } catch (error) { owner.failures.push(error); owner.primary ??= { error }; }
  if (primary !== undefined || owner.failures.length > 0) throw new AggregateError(
    [...(primary === undefined ? [] : [primary.error]), ...owner.failures],
    'Composed assistant fixture failed', { cause: primary === undefined ? owner.failures[0] : primary.error });
}

it.each([
  { mode: undefined, staleAccount: false }, { mode: "without-asking", staleAccount: false },
  { mode: "every-action", staleAccount: false }, { mode: "every-action", staleAccount: true },
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

it.each(["without-asking", "every-action"] as const)('serves preference CAS, replay and verification for %s', async mode => {
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
