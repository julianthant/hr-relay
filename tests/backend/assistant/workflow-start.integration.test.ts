import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, it } from "vitest";
import { z } from "zod";
import { createAssistantWorkflowStarts } from "../../../src/backend/assistant/workflow-start.js";
import { createAssistantAuthorization } from "../../../src/backend/assistant/authorization.js";
import { assistantKnowledgeArtifact, createAssistantContext } from "../../../src/backend/assistant/context.js";
import { createCommandKernel, executeSettingsCommand } from "../../../src/backend/runs/commands/command-kernel.js";
import { createDashboardCommandService } from "../../../src/backend/runs/commands/command-service.js";
import { createStartPlanService } from "../../../src/backend/runs/commands/start-plan-service.js";
import { createSettingsApplicationExecutor } from "../../../src/backend/runs/commands/settings-service.js";
import { resolveConfigWithProvenance } from "../../../src/backend/app/config/resolve.js";
import { readSettings } from "../../../src/backend/runtime/settings/settings-runtime.js";
import { createCredentialStore } from "../../support/helpers/synthetic-storage-admission.js";
import { deriveRawSettingsPatchFingerprint, SETTINGS_SCHEMA_HASH } from "../../../src/models/config/settings.js";
import { AssistantResultSchema } from "../../../src/models/dashboard/assistant.js";
import { settingsFixture } from "../../support/helpers/backend/settings-activation-fixture.js";
import { personLookupDescriptor } from "../../support/helpers/registered-workflows.js";
import { NO_INTAKE_PROJECTIONS, UNSTORED_CONFIG_IDENTITY, UNWIRED_INTAKE_PARSER } from "../../support/fixtures/intake-kernel-seams.js";
import type { AssistantFunctionContext } from "../../../src/backend/assistant/service.js";
import { workflowPlanning } from "../../../src/workflow-kit/workflow.js";
import { deriveSchemaHash } from "../../../src/models/validation/schema-bound-value.js";
import { JsonValueSchema } from "../../../src/rules/validation/canonical-json.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });

async function fixture() {
  const f = await settingsFixture(); cleanups.push(f.close);
  const raw = { emplId: "10873698" }, planning = workflowPlanning(personLookupDescriptor);
  const run = f.create({ dryRun: false, input: { raw, ingressSchemaHash: deriveSchemaHash(personLookupDescriptor.input, "input"),
    parsed: { schemaHash: deriveSchemaHash(personLookupDescriptor.canonicalInput, "output"), protectedBindings: [],
      value: JsonValueSchema.parse(planning.parseCanonicalInput(planning.parseInput(raw))) } } });
  const descriptors = { resolve: (id: string) => id === personLookupDescriptor.id ? personLookupDescriptor : undefined };
  const settings = createSettingsApplicationExecutor(value => resolveConfigWithProvenance(value, f.host, f.clock), createCredentialStore({ stateRoot: f.root }));
  const profileId = f.database.getMeta().profileId;
  assert.ok(profileId);
  const grant = executeSettingsCommand({ authority: f.database, settings, clock: f.clock, ids: { uuid: randomUUID }, authorityProfileId: profileId }, {
    commandId: randomUUID(), requestedAt: f.clock.now().toISOString(), requestedBy: "local-operator", source: "settings-surface", family: "settings", type: "apply-settings",
    target: { expectedRevision: readSettings(f.database.authority).revision }, payload: { patch: {}, patchFingerprint: deriveRawSettingsPatchFingerprint({}), settingsSchemaHash: SETTINGS_SCHEMA_HASH,
      assistantPermission: { expectedPolicyRevision: 0, mode: "every-action" } },
  });
  assert.equal(grant.state, "applied");
  const unavailable = (): never => { throw new Error("unexpected unrelated command"); };
  const kernel = createCommandKernel({ authority: f.database, lifecycle: f.service, descriptors, clock: f.clock, ids: { uuid: randomUUID }, appVersion: "0.1.0",
    configIdentity: UNSTORED_CONFIG_IDENTITY, intakeParser: UNWIRED_INTAKE_PARSER, intakeProjections: NO_INTAKE_PROJECTIONS,
    assistantRevalidate: command => authorization.assertEffect(command.commandId, command), workflowSources: { "person-lookup": "served" },
    writeResolution: { recheck: unavailable, resolveAbsent: unavailable }, workerRuntime: { pool: { planPoolWorkerCount: unavailable,
      spawnPoolWorker: unavailable, refreshPoolBrowser: unavailable, reopenPoolBrowser: unavailable, stopPoolWorker: unavailable, pausePoolWorker: unavailable, resumePoolWorker: unavailable } },
  });
  let current = true;
  const assertCurrent = () => { if (!current) throw new Error("session stale"); };
  const authorization = createAssistantAuthorization({ database: f.database, kernel, clock: f.clock, current: () => { assertCurrent(); return { profileId, epoch: 1 }; } });
  const commands = createDashboardCommandService({ kernel, projection: { ingestFromTimeline() {}, refreshRun() {} } });
  const plans = createStartPlanService({ authority: f.database, authorityRead: f.database, descriptors, clock: f.clock, ids: { uuid: randomUUID }, planTtlMs: 30_000,
    configSnapshotId: f.snapshot.configSnapshotId, configFingerprint: f.snapshot.fingerprint, plannedBy: "local-operator" });
  let served = true, dispatches = 0, loseResponse = false, changeBeforeDispatch = false;
  const dispatchErrors: unknown[] = [];
  const starts = createAssistantWorkflowStarts({ database: f.database, runs: f.service, plans, descriptors, authorization, actorId: "local-operator", clock: f.clock,
    served: () => served, assertCurrent, commands: { ...commands, async submit(command) {
      dispatches++;
      if (changeBeforeDispatch) served = false;
      try {
        const result = await commands.submit(command); if (loseResponse) throw new Error("lost dispatch response"); return result;
      } catch (error) { dispatchErrors.push(error); throw error; }
    } } });
  const request = { message: "start selected workflow", subjectRef: `run_${run.envelope.runId}_${run.version}` };
  async function propose() {
    const projected = starts.projectInput(request);
    const reference = z.object({ reference: z.string() }).parse(projected.input).reference;
    const artifact = assistantKnowledgeArtifact();
    const context: AssistantFunctionContext = { request, context: createAssistantContext(Buffer.from(artifact.bytes), artifact.policy), assertCurrent, assertRetainedCurrent: assertCurrent };
    const fn = (await starts.bindFunctions(context, new AbortController().signal))[0]?.functions[0]; assert.ok(fn);
    const result = await fn.invoke({ reference }, new AbortController().signal, context);
    assert.equal(result.kind, "complete"); if (result.kind !== "complete") throw new Error("proposal required");
    const view = AssistantResultSchema.parse(result.result); assert.equal(view.state, "action-proposal"); if (view.state !== "action-proposal") throw new Error("proposal required");
    return { projected, proposal: view.proposal, decision: { chatId: view.proposal.chatId, actionId: view.proposal.actionId, revision: view.proposal.revision, decision: "confirm" as const } };
  }
  return { ...f, starts, request, propose, authorization, dispatchErrors, dispatches: () => dispatches, revoke: () => { current = false; }, unserve: () => { served = false; }, lose: () => { loseResponse = true; }, changeAtDispatch: () => { changeBeforeDispatch = true; } };
}

it("keeps subject inputs private and starts only after exact confirmation through the canonical command door", async () => {
  const f = await fixture(), p = await f.propose();
  const outbound = JSON.stringify(p.projected.input);
  assert.equal(outbound.includes(f.request.subjectRef), false);
  assert.equal(outbound.includes("10873698"), false);
  assert.equal(f.dispatches(), 0);
  const result = await f.starts.decideAction(p.decision, new AbortController().signal);
  assert.deepEqual(f.dispatchErrors, []);
  assert.equal(result.state, "applied");
  assert.equal(f.dispatches(), 1);
  const record = f.database.authority.assistantAuthorization.action(p.proposal.actionId); assert.ok(record);
  assert.equal(record.command.family, "start"); assert.equal(record.state, "settled");
  assert.equal(f.database.authority.commandAudits.findByCommand(record.command.commandId)?.request.source, "assistant");
  await assert.rejects(f.starts.decideAction(p.decision, new AbortController().signal));
  assert.equal(f.dispatches(), 1);
});

it.each(["cancel", "expiry", "plan-expiry", "session", "workflow", "revision"] as const)("refuses a %s proposal without starting", async change => {
  const f = await fixture(), p = await f.propose();
  if (change === "cancel") assert.equal((await f.starts.decideAction({ ...p.decision, decision: "cancel" }, new AbortController().signal)).state, "cancelled");
  if (change === "expiry") f.clock.advanceWall(60_001);
  if (change === "plan-expiry") f.clock.advanceWall(30_001);
  if (change === "session") f.revoke();
  if (change === "workflow") f.unserve();
  await assert.rejects(f.starts.decideAction({ ...p.decision, ...(change === "revision" ? { revision: p.decision.revision + 1 } : {}) }, new AbortController().signal));
  assert.equal(f.dispatches(), 0);
});

it("keeps a lost dispatch response unknown and never starts it twice", async () => {
  const f = await fixture(), p = await f.propose(); f.lose();
  assert.equal((await f.starts.decideAction(p.decision, new AbortController().signal)).state, "unknown");
  const record = f.database.authority.assistantAuthorization.action(p.proposal.actionId); assert.ok(record);
  assert.equal(record.state, "unknown");
  assert.equal(f.database.authority.commandAudits.findByCommand(record.command.commandId)?.result.state, "applied");
  assert.equal(f.dispatchErrors.length, 1);
  assert.match(String(f.dispatchErrors[0]), /lost dispatch response/u);
  await assert.rejects(f.starts.decideAction(p.decision, new AbortController().signal));
  assert.equal(f.dispatches(), 1);
});

it("rechecks selected authority at the canonical command door after dispatch waits", async () => {
  const f = await fixture(), p = await f.propose(); f.changeAtDispatch();
  assert.equal((await f.starts.decideAction(p.decision, new AbortController().signal)).state, "unknown");
  const record = f.database.authority.assistantAuthorization.action(p.proposal.actionId); assert.ok(record);
  assert.equal(record.state, "unknown");
  assert.equal(f.database.authority.commandAudits.findByCommand(record.command.commandId), undefined);
  await assert.rejects(f.starts.decideAction(p.decision, new AbortController().signal));
  assert.equal(f.dispatches(), 1);
});
