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
import { AssistantInferenceRequestSchema, AssistantResultSchema, AssistantActionResultSchema } from "../../../../../src/models/dashboard/assistant.js";
import { NotificationRecordSchema } from "../../../../../src/models/notifications/notifications.js";
import { CommandResultSchema } from "../../../../../src/rules/commands/commands.js";
import { SETTINGS_SCHEMA_HASH, deriveRawSettingsPatchFingerprint } from "../../../../../src/models/config/settings.js";
import { createBoundProfileFixture } from "../../../../support/helpers/admission-fixture.js";
import { chatGptFixture } from "../../../../support/helpers/chatgpt-account-fixtures.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";

const AssistantTransportRequestSchema = AssistantInferenceRequestSchema.safeExtend({
  store: z.literal(false), stream: z.literal(true), parallel_tool_calls: z.literal(false),
  include: z.tuple([z.literal("reasoning.encrypted_content")]),
});

it.each([
  { mode: undefined, staleAccount: false }, { mode: "without-asking", staleAccount: false },
  { mode: "every-action", staleAccount: false }, { mode: "every-action", staleAccount: true },
] as const)("uses the real composed selected-account service with permission=$mode staleAccount=$staleAccount and bounded outbound data", async ({ mode, staleAccount }) => {
  const installed = mode !== undefined;
  const f = createBoundProfileFixture(), transport = chatGptFixture(f.admission), originalFetch = globalThis.fetch;
  const fetchProbe = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return originalFetch(input, init);
    return transport.transport(input, init);
  });
  const clock = transport.clock;
  const runtime = composeProfileRuntime({ admission: f.machine, clock, hostFacts: { primaryDisplay: null }, processLockRoot: join(f.workspace, rebuildRuntimeIsolation.processLockRoot) });
  let dashboard: Awaited<ReturnType<typeof composeDashboardRuntime>> | undefined, primary: unknown;
  const failures: unknown[] = [];
  try {
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
    const authorization = await context.account.signIn({ usePlan: true }); await transport.callback(authorization); await authorization.completion;
    dashboard = await composeDashboardRuntime({ admission: f.machine, profile: { runtime, token: active.token }, repoRoot: f.workspace,
      clock, isolation: rebuildRuntimeIsolation, env: {}, backendPortOverride: 0, frontendPortOverride: 0, preflightRunnerFactory: healthyRuntimePreflightRunners,
      ...(installed ? { assistantModelPolicy: { policy: { model: "gpt-6.1-sol", effort: "medium" as const, eligible: true as const, consented: true as const,
        billing: "chatgpt-plan" as const, verifiedUntil: new Date(clock.nowMs() + 60_000).toISOString() }, isCurrent: () => { runtime.assertCurrent(active.token); return true; } } } : {}) });
    const origin = `http://127.0.0.1:${String(dashboard.port)}`;
    const post = async (path: string, value: unknown): Promise<unknown> => {
      const response = await originalFetch(`${origin}/api/v1/${path}`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(value) });
      const body: unknown = await response.json(); return body;
    };
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
  } catch (error) { primary = error; }
  try { if (dashboard !== undefined) await dashboard.stop(); else await runtime.close(); } catch (error) { failures.push(error); }
  try { await transport.cleanup(); } catch (error) { failures.push(error); }
  fetchProbe.mockRestore();
  if (failures.length === 0) { try { f.close(); } catch (error) { failures.push(error); } }
  if (primary !== undefined || failures.length > 0) throw new AggregateError([...(primary === undefined ? [] : [primary]), ...failures], "assistant composition fixture failed", { cause: primary });
});
