import { profileBrowserClosure } from "../../../src/backend/runtime/browser/native-profile-probe.js";
import { runtimeLifetimeLock } from "../../support/helpers/backend/runtime-lifetime.js";
import { syntheticOnboardingDuo, finishProfileOnboarding } from "../../support/helpers/admission-fixture.js";
import { createProductionAssistantTools } from "../../../src/backend/assistant/tools.js";
import { assistantKnowledgeArtifact, createAssistantContext } from "../../../src/backend/assistant/context.js";
import { AssistantRequestSchema, AssistantResultSchema } from "../../../src/models/dashboard/assistant.js";
import { type AssistantFunctionContext } from "../../../src/backend/assistant/service.js";






import { NotificationRecordSchema } from "../../../src/models/notifications/notifications.js";
import { z } from "zod";
import { AuthorityBackupService, OfflineAuthorityRestoreService } from "../../../src/backend/storage/sqlite/index.js";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it } from "vitest";
import { composeProfileAssistantAuthorization, composeProfileRuntime } from "../../../src/backend/app/composition/storage-compose.js";
import { acquireEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { createCommandKernel, executeSettingsCommand } from "../../../src/backend/runs/commands/command-kernel.js";
import { createSettingsApplicationExecutor } from "../../../src/backend/runs/commands/settings-service.js";
import { RunRecordService } from "../../../src/backend/runs/lifecycle/run-record-service.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { SETTINGS_SCHEMA_HASH, deriveRawSettingsPatchFingerprint, deriveSettingsPatchFingerprint } from "../../../src/models/config/settings.js";
import { PositiveIntSchema } from "../../../src/rules/identity/ids.js";
import { CommandRequestSchema } from "../../../src/rules/commands/commands.js";
import { createProfileRegistry } from "../../../src/backend/profiles/registry.js";
import { NO_INTAKE_PROJECTIONS, UNWIRED_INTAKE_PARSER } from "../../support/fixtures/intake-kernel-seams.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  const failures: unknown[] = [];
  for (const cleanup of cleanups.splice(0).reverse()) {
    try { await cleanup(); } catch (error) { failures.push(error); }
  }
  if (failures.length > 0) throw new AggregateError(failures, "assistant test cleanup failed");
});
async function fixture() {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "assistant-authorization-")));
  const lifetime = await runtimeLifetimeLock();
  const machine = acquireEntrypointAdmission(workspace, "exclusive", lifetime);
  const clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  const processLockRoot = join(workspace, rebuildRuntimeIsolation.processLockRoot);
  mkdirSync(processLockRoot, { recursive: true, mode: 0o700 });
  const signUpFields = { firstName: "Synthetic", lastName: "Operator", email: "operator@ucsd.edu", password: "synthetic-password", createdAt: clock.now().toISOString() };
  const runtime = composeProfileRuntime({ onboardingDuo: syntheticOnboardingDuo(() => signUpFields.email), admission: machine, clock, hostFacts: { primaryDisplay: null } });
  const active = await finishProfileOnboarding(runtime.session, runtime.session.signUp(signUpFields));
  assert.equal(active.state, "active"); if (active.state !== "active") throw new Error("signup required");
  const context = runtime.selectedContext(active.token), database = context.database;
  const unavailable = (): never => { throw new Error("unused runtime port invoked"); };
  const settings = createSettingsApplicationExecutor(context.resolveSettings, context.credentials);
  const actualKernel = createCommandKernel({ authority: database, clock, ids: { uuid: randomUUID }, appVersion: "0.1.0",
    authorityProfileId: active.profileId, settings,
    lifecycle: new RunRecordService({ database, clock, ids: { uuid: randomUUID }, publishQueued: () => {} }),
    descriptors: { resolve: () => undefined }, writeResolution: { recheck: unavailable, resolveAbsent: unavailable },
    intakeParser: UNWIRED_INTAKE_PARSER, intakeProjections: NO_INTAKE_PROJECTIONS,
    configIdentity: { configSnapshotId: database.authority.runtimeConfig.get()!.configSnapshotId, configFingerprint: database.authority.runtimeConfig.get()!.configFingerprint },
    workerRuntime: { pool: { planPoolWorkerCount: unavailable, spawnPoolWorker: unavailable, stopPoolWorker: unavailable,
      pausePoolWorker: unavailable, resumePoolWorker: unavailable, refreshPoolBrowser: unavailable, reopenPoolBrowser: unavailable } },
  });
  const kernel = { ...actualKernel };
  const authorization = composeProfileAssistantAuthorization(runtime, active.token, kernel, clock);
  cleanups.push(async () => { await context.account.close(); database.close(); context.admission.release(); machine.release(); rmSync(workspace, { recursive: true, force: true }); });
  const permissionCommand = (mode: "every-action", expectedRevision: number = context.settings.read().record.revision,
    expectedPolicyRevision: number = database.authority.assistantAuthorization.grant()?.policy.revision ?? 0) => CommandRequestSchema.parse({
    commandId: randomUUID(), requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source: "settings-surface",
    family: "settings", type: "apply-settings", target: { expectedRevision },
    payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveRawSettingsPatchFingerprint({}), patch: {}, assistantPermission: { expectedPolicyRevision, mode } },
  });
  const execute = (request: unknown) => executeSettingsCommand({ authority: database, clock, ids: { uuid: randomUUID }, settings, authorityProfileId: active.profileId }, request);
  const grant = (mode: "every-action", expectedRevision: number = context.settings.read().record.revision,
    expectedPolicyRevision: number = database.authority.assistantAuthorization.grant()?.policy.revision ?? 0) => execute(permissionCommand(mode, expectedRevision, expectedPolicyRevision));
  const command = () => {
    const patch = { "browser.headless": { set: false } };
    return CommandRequestSchema.parse({ commandId: randomUUID(), requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source: "settings-surface",
      family: "settings", type: "apply-settings", target: { expectedRevision: context.settings.read().record.revision },
      payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } });
  };
  return { workspace, machine, runtime, active, context, database, clock, kernel, authorization, grant, command, permissionCommand, execute };
}

it("does not turn the displayed default into a grant, and requires genuine token/chat ownership", async () => {
  const f = await fixture(), chat = f.authorization.createChat();
  assert.equal(f.database.authority.assistantAuthorization.grant(), undefined);
  assert.throws(() => f.authorization.prepare(chat, f.command()), /assistant-grant-required/u);
  assert.throws(() => composeProfileAssistantAuthorization(f.runtime, randomUUID(), f.kernel, f.clock));
  assert.equal(f.grant("every-action").state, "applied");
  assert.throws(() => f.authorization.prepare({ ...chat }, f.command()), /assistant-chat-not-issued/u);
  assert.equal(f.grant("every-action", 1).state, "conflict");
  assert.equal(f.database.authority.assistantAuthorization.grant()?.policy.mode, "every-action");
  const permission = f.permissionCommand("every-action");
  assert.equal(permission.type, "apply-settings"); if (permission.type !== "apply-settings") throw new Error("settings required");
  const before = f.database.getMeta().authorityGeneration;
  assert.throws(() => f.execute({ ...permission, payload: { ...permission.payload, assistantPermission: { clear: true } } }));
  assert.equal(f.database.getMeta().authorityGeneration, before);
});

it.each(["before-submits", "without-asking"])("refuses an operator attempt to recreate retired %s authority", async mode => {
  const f = await fixture();
  const request = f.permissionCommand("every-action");
  assert.equal(request.type, "apply-settings");
  if (request.type !== "apply-settings") throw new Error("settings required");
  const before = f.database.getMeta().authorityGeneration;
  const result = f.execute({ ...request, payload: { ...request.payload, assistantPermission: { expectedPolicyRevision: 0, mode } } });
  assert.equal(result.state, "rejected");
  assert.equal(f.database.getMeta().authorityGeneration, before);
  assert.equal(f.database.authority.assistantAuthorization.grant(), undefined);
});

it("claims once and commits the real canonical Settings result in one authority generation", async () => {
  const f = await fixture(); assert.equal(f.grant("every-action").state, "applied");
  const chat = f.authorization.createChat(), command = f.command(), proposal = f.authorization.prepare(chat, command);
  assert.equal(proposal.state, "prepared");
  assert.throws(() => f.authorization.consume(chat, proposal.id), /not-consumable/u);
  const approved = f.authorization.approve(chat, proposal.id, proposal.revision);
  assert.equal(approved.revision, 2);
  const before = f.database.getMeta().authorityGeneration;
  assert.equal(f.authorization.consume(chat, proposal.id)?.state, "applied");
  assert.equal(f.database.getMeta().authorityGeneration, before + 1);
  assert.ok(f.database.authority.commandAudits.findByCommand(command.commandId));
  assert.equal(f.context.settings.read().record.settings.browser?.headless, false);
  const settled = f.database.getMeta().authorityGeneration;
  assert.equal(f.authorization.consume(chat, proposal.id)?.state, "applied");
  assert.equal(f.database.getMeta().authorityGeneration, settled);
  assert.throws(() => f.authorization.approve(chat, proposal.id, 1), /state-conflict/u);
});

it("refuses another chat, changed grant, expiry and profile revocation without command effects", async () => {
  const f = await fixture(); assert.equal(f.grant("every-action").state, "applied");
  const chat = f.authorization.createChat(), other = f.authorization.createChat(), command = f.command();
  const proposal = f.authorization.prepare(chat, command);
  assert.throws(() => f.authorization.consume(other, proposal.id), /stale/u);
  assert.equal(f.grant("every-action").state, "applied");
  assert.throws(() => f.authorization.consume(chat, proposal.id), /BINDING_STALE/u);
  assert.equal(f.database.authority.commands.get(command.commandId), undefined);
  const next = f.authorization.prepare(chat, f.command());
  f.clock.advanceWall(60_001);
  assert.throws(() => f.authorization.approve(chat, next.id, next.revision), /stale/u);
  createProfileRegistry(f.machine).advanceSession(null);
  assert.throws(() => f.authorization.createChat());
  assert.throws(() => f.authorization.consume(chat, next.id));
});

it("refuses private or self-granting commands before storing an action", async () => {
  const f = await fixture(); assert.equal(f.grant("every-action").state, "applied");
  const chat = f.authorization.createChat(), command = f.command(); assert.equal(command.type, "apply-settings");
  if (command.type !== "apply-settings") throw new Error("settings required");
  const patch = { "actor.label": { set: "Synthetic Person" } };
  assert.throws(() => f.authorization.prepare(chat, { ...command, payload: { ...command.payload, patch, patchFingerprint: deriveSettingsPatchFingerprint(patch) } }));
  assert.throws(() => f.authorization.prepare(chat, f.permissionCommand("every-action")));
  assert.equal(f.database.authority.assistantAuthorization.actionByCommand(command.commandId), undefined);
});

it("refuses cancellation, changed manifest and reissued service capability without resurrecting durable approval", async () => {
  const f = await fixture(); assert.equal(f.grant("every-action").state, "applied");
  const chat = f.authorization.createChat(), command = f.command(), proposal = f.authorization.prepare(chat, command);
  f.authorization.cancel(chat, proposal.id, proposal.revision);
  assert.throws(() => f.authorization.consume(chat, proposal.id), /not-consumable/u);
  const nextCommand = f.command(), next = f.authorization.prepare(chat, nextCommand);
  const restarted = composeProfileAssistantAuthorization(f.runtime, f.active.token, f.kernel, f.clock);
  assert.throws(() => restarted.consume(chat, next.id), /not-issued/u);
  const newChat = restarted.createChat();
  assert.throws(() => restarted.consume(newChat, next.id), /stale/u);
  const manifest = f.kernel.assistantManifest.bind(f.kernel);
  f.kernel.assistantManifest = () => ({ ...manifest(), revision: PositiveIntSchema.parse(2) });
  assert.throws(() => f.authorization.consume(chat, next.id), /BINDING_STALE/u);
  assert.equal(f.database.authority.commands.get(nextCommand.commandId), undefined);
  f.kernel.assistantManifest = manifest;
});

it("does not resurrect an approval copied back by the real stopped restore", async () => {
  const f = await fixture(); assert.equal(f.grant("every-action").state, "applied");
  const chat = f.authorization.createChat(), command = f.command(), proposal = f.authorization.prepare(chat, command);
  const approved = f.authorization.approve(chat, proposal.id, proposal.revision);
  const directory = join(f.context.admission.stateRoot, "backups", "authority");
  const report = await new AuthorityBackupService(f.context.admission, f.database, { directory }, f.clock)
    .request({ trigger: "operator", requiredGeneration: f.database.getMeta().authorityGeneration });
  const manifest = report.manifests[0]; assert.ok(manifest);
  f.authorization.cancel(chat, proposal.id, approved.revision);
  await f.context.account.close(); f.database.close();
  const path = join(f.context.admission.stateRoot, "state.db"), processLockRoot = join(f.workspace, rebuildRuntimeIsolation.processLockRoot);


  const proof = f.context.admission.acquireOfflineMaintenance();
  const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, f.context.admission, { authorityPath: path, suspectDirectory: join(f.context.admission.stateRoot, "backups", "suspects"), busyTimeoutMs: 250,
    processLockRoot}, async () => undefined, f.clock, undefined, f.context.credentials);
  assert.equal((await restore.restore({ manifestPath: join(directory, `${manifest.backupFileName}.manifest.json`) }, proof)).state, "restored");
  assert.throws(() => f.authorization.consume(chat, proposal.id));
  const restarted = composeProfileRuntime({ admission: f.machine, clock: f.clock, hostFacts: { primaryDisplay: null } });
  const active = restarted.session.signIn({ email: "operator@ucsd.edu", password: "synthetic-password", at: f.clock.now().toISOString() });
  assert.equal(active.state, "active"); if (active.state !== "active") throw new Error("active restored profile required");
  const context = restarted.selectedContext(active.token);
  cleanups.push(async () => { await context.account.close(); context.database.close(); context.admission.release(); });
  const issuer = composeProfileAssistantAuthorization(restarted, active.token, f.kernel, f.clock);
  assert.equal(context.database.authority.assistantAuthorization.action(proposal.id)?.state, "approved");
  assert.throws(() => issuer.consume(chat, proposal.id), /not-issued/u);
  const fresh = issuer.createChat();
  assert.throws(() => issuer.consume(fresh, proposal.id), /stale/u);
  assert.equal(context.database.authority.commands.get(command.commandId), undefined);
});

it("requires both grant and Settings CAS and keeps exact permission replay idempotent", async () => {
  const f = await fixture(), first = f.permissionCommand("every-action");
  assert.equal(first.type, "apply-settings"); if (first.type !== "apply-settings") throw new Error("settings required");
  const initial = f.context.settings.read().record, generation = f.database.getMeta().authorityGeneration;
  assert.equal(f.grant("every-action", initial.revision, 1).state, "conflict");
  assert.equal(f.database.getMeta().authorityGeneration, generation);
  assert.deepEqual(f.context.settings.read().record, initial);
  assert.equal(f.database.authority.assistantAuthorization.grant(), undefined);
  assert.equal(f.execute(first).state, "applied");
  const granted = f.database.authority.assistantAuthorization.grant(), after = f.database.getMeta().authorityGeneration;
  assert.ok(granted);
  assert.deepEqual(f.context.settings.read().record.settings, initial.settings);
  assert.equal(f.context.settings.read().record.revision, initial.revision + 1);
  assert.equal(f.execute(first).state, "already-applied");
  assert.deepEqual(f.database.authority.assistantAuthorization.grant(), granted);
  assert.equal(f.database.getMeta().authorityGeneration, after);
  assert.equal(f.execute({ ...first, payload: { ...first.payload, assistantPermission: { expectedPolicyRevision: 1, mode: "every-action" } } }).state, "rejected");
  assert.equal(f.grant("every-action", f.context.settings.read().record.revision, 0).state, "conflict");
  assert.equal(f.database.getMeta().authorityGeneration, after);
  assert.deepEqual(f.database.authority.assistantAuthorization.grant(), granted);
  const saved = f.context.settings.read().record;
  assert.equal(f.grant("every-action", initial.revision, granted.policy.revision).state, "conflict");
  assert.equal(f.database.getMeta().authorityGeneration, after);
  assert.deepEqual(f.context.settings.read().record, saved);
  assert.deepEqual(f.database.authority.assistantAuthorization.grant(), granted);
});

it.each(["every-action"] as const)("binds opaque notification references to actual canonical %s authorization without exposing local rows", async mode => {
  const f = await fixture();
  assert.equal(f.grant(mode).state, "applied");
  const notification = NotificationRecordSchema.parse({ notificationId: randomUUID(), actorId: "local-operator", dedupeFingerprint: "a".repeat(64),
    trigger: "storage", channel: "ping", status: "unread", snooze: { state: "not-snoozed" }, title: "Local-only title", summary: "Local-only content",
    links: [{ kind: "storage", diagnosticFingerprint: "b".repeat(64) }], count: 1, version: 1,
    lastSeenAt: f.clock.now().toISOString(), createdAt: f.clock.now().toISOString(), updatedAt: f.clock.now().toISOString() });
  const notices = Array.from({ length: 25 }, (_, index) => ({ ...notification, notificationId: index === 0 ? notification.notificationId : randomUUID(), dedupeFingerprint: index.toString(16).padStart(64, "0") }));
  const pinned = NotificationRecordSchema.parse({ ...notification, notificationId: randomUUID(), dedupeFingerprint: "c".repeat(64), trigger: "backfill-gap", links: [] });
  f.database.withAuthorityTransaction(({ notifications }) => { for (const row of [...notices, pinned]) notifications.create(row); });
  const tools = createProductionAssistantTools({ knowledge: assistantKnowledgeArtifact(), database: f.database, kernel: f.kernel, authorization: f.authorization, actorId: "local-operator", clock: f.clock,
    assertCurrent: () => f.runtime.assertCurrent(f.active.token) });
  const request = AssistantRequestSchema.parse({ message: "mark notifications read" });
  const projected = z.strictObject({ intent: z.literal("notification"), action: z.literal("notification-read-all"), count: z.number(), references: z.array(z.string()) }).parse(tools.projectInput(request).input);
  const bytes = JSON.stringify(projected);
  for (const privateValue of [notification.notificationId, notification.actorId, notification.title, notification.summary]) assert.equal(bytes.includes(privateValue), false);
  assert.equal(projected.references.length, 1); assert.equal(projected.count, 25);
  const knowledge = assistantKnowledgeArtifact();
  const context: AssistantFunctionContext = { request, context: createAssistantContext(Buffer.from(knowledge.bytes), knowledge.policy),
    assertCurrent: () => f.runtime.assertCurrent(f.active.token), assertRetainedCurrent: () => f.runtime.assertCurrent(f.active.token) };
  const sets = await tools.bindFunctions(context, new AbortController().signal), fn = sets[0]?.functions[0]; assert.ok(fn);
  const reference = projected.references[0]; assert.ok(reference);
  const before = f.database.getMeta().authorityGeneration;
  await assert.rejects(() => fn.invoke({ reference, expectedVersion: 1 }, new AbortController().signal, context));
  assert.equal(f.database.getMeta().authorityGeneration, before);
  const outcome = await fn.invoke({ reference }, new AbortController().signal, context);
  assert.equal(outcome.kind, "complete");
  assert.equal(f.database.authority.notifications.get(notification.notificationId)?.status, "unread");
  if (outcome.kind === "complete" && mode === "every-action") {
    const operator = AssistantResultSchema.parse(outcome.result);
    assert.equal(operator.state, "action-proposal"); if (operator.state !== "action-proposal") throw new Error("operator proposal required");
    assert.equal(operator.proposal.targetLabel, "25 current notifications");
    const identity = { chatId: operator.proposal.chatId, actionId: operator.proposal.actionId, revision: operator.proposal.revision, decision: "confirm" as const };
    assert.throws(() => tools.decideAction({ ...identity, chatId: randomUUID() }, new AbortController().signal));
    assert.equal((await tools.decideAction(identity, new AbortController().signal)).state, "applied");
    assert.equal(f.database.authority.notifications.get(notification.notificationId)?.status, "read");
    const record = f.database.authority.assistantAuthorization.action(identity.actionId); assert.ok(record);
    assert.equal(record.command.source, "assistant");
    assert.equal(f.database.authority.commandAudits.findByCommand(record.command.commandId)?.request.source, "assistant");
    assert.throws(() => tools.decideAction(identity, new AbortController().signal));
  }
  for (const row of notices) assert.equal(f.database.authority.notifications.get(row.notificationId)?.status, "read");
  assert.deepEqual(f.database.authority.notifications.get(pinned.notificationId), pinned);
  const after = f.database.getMeta().authorityGeneration;
  await assert.rejects(() => fn.invoke({ reference }, new AbortController().signal, context));
  assert.equal(f.database.getMeta().authorityGeneration, after);
});

it.each(["manifest", "row", "added", "session"] as const)("refuses a production notification reference changed at the %s boundary without an effect", async boundary => {
  const f = await fixture(); assert.equal(f.grant("every-action").state, "applied");
  const notification = NotificationRecordSchema.parse({ notificationId: randomUUID(), actorId: "local-operator", dedupeFingerprint: "a".repeat(64),
    trigger: "storage", channel: "ping", status: "unread", snooze: { state: "not-snoozed" }, title: "Local-only title", summary: "Local-only content",
    links: [{ kind: "storage", diagnosticFingerprint: "b".repeat(64) }], count: 1, version: 1,
    lastSeenAt: f.clock.now().toISOString(), createdAt: f.clock.now().toISOString(), updatedAt: f.clock.now().toISOString() });
  f.database.withAuthorityTransaction(({ notifications }) => notifications.create(notification));
  const tools = createProductionAssistantTools({ knowledge: assistantKnowledgeArtifact(), database: f.database, kernel: f.kernel, authorization: f.authorization, actorId: "local-operator", clock: f.clock,
    assertCurrent: () => f.runtime.assertCurrent(f.active.token) });
  const request = AssistantRequestSchema.parse({ message: "mark notifications read" });
  const projection = z.object({ references: z.array(z.string()) }).parse(tools.projectInput(request).input);
  const artifact = assistantKnowledgeArtifact();
  const context: AssistantFunctionContext = { request, context: createAssistantContext(Buffer.from(artifact.bytes), artifact.policy), assertCurrent: () => f.runtime.assertCurrent(f.active.token) };
  const functions = await tools.bindFunctions(context, new AbortController().signal), fn = functions[0]?.functions[0]; assert.ok(fn);
  const reference = projection.references[0]; assert.ok(reference);
  if (boundary === "manifest") { const prior = f.kernel.assistantManifest(); f.kernel.assistantManifest = () => ({ ...prior, revision: PositiveIntSchema.parse(prior.revision + 1) }); }
  if (boundary === "row") f.database.withAuthorityTransaction(({ notifications }) => notifications.updateState({ notificationId: notification.notificationId, expectedVersion: 1,
    status: "unread", snooze: { state: "not-snoozed" }, updatedAt: f.clock.now().toISOString() }));
  if (boundary === "added") f.database.withAuthorityTransaction(({ notifications }) => notifications.create({ ...notification, notificationId: randomUUID(), dedupeFingerprint: "d".repeat(64) }));
  if (boundary === "session") f.runtime.beginClose();
  const before = f.database.getMeta().authorityGeneration;
  await assert.rejects(() => fn.invoke({ reference }, new AbortController().signal, context));
  assert.equal(f.database.getMeta().authorityGeneration, before);
  assert.equal(f.database.authority.notifications.get(notification.notificationId)?.status, "unread");
  if (boundary === "session") await f.runtime.close();
});

it.each(["cancel", "expired", "manifest", "grant", "target", "added", "restart"] as const)("keeps an issued confirmation bound through %s without an unauthorized effect", async change => {
  const f = await fixture(); assert.equal(f.grant("every-action").state, "applied");
  const notification = NotificationRecordSchema.parse({ notificationId: randomUUID(), actorId: "local-operator", dedupeFingerprint: "a".repeat(64),
    trigger: "storage", channel: "ping", status: "unread", snooze: { state: "not-snoozed" }, title: "Local title", summary: "Local summary",
    links: [{ kind: "storage", diagnosticFingerprint: "b".repeat(64) }], count: 1, version: 1,
    lastSeenAt: f.clock.now().toISOString(), createdAt: f.clock.now().toISOString(), updatedAt: f.clock.now().toISOString() });
  f.database.withAuthorityTransaction(({ notifications }) => notifications.create(notification));
  const toolsInput = { knowledge: assistantKnowledgeArtifact(), database: f.database, kernel: f.kernel, authorization: f.authorization, actorId: "local-operator", clock: f.clock,
    assertCurrent: () => f.runtime.assertCurrent(f.active.token) };
  const tools = createProductionAssistantTools(toolsInput), request = AssistantRequestSchema.parse({ message: "mark notifications read" });
  const projection = z.object({ references: z.array(z.string()) }).parse(tools.projectInput(request).input);
  const reference = projection.references[0]; assert.ok(reference);
  const knowledge = assistantKnowledgeArtifact();
  const context: AssistantFunctionContext = { request, context: createAssistantContext(Buffer.from(knowledge.bytes), knowledge.policy),
    assertCurrent: toolsInput.assertCurrent, assertRetainedCurrent: toolsInput.assertCurrent };
  const functions = await tools.bindFunctions(context, new AbortController().signal), fn = functions[0]?.functions[0]; assert.ok(fn);
  const outcome = await fn.invoke({ reference }, new AbortController().signal, context);
  assert.equal(outcome.kind, "complete"); if (outcome.kind !== "complete") throw new Error("operator result required");
  const result = AssistantResultSchema.parse(outcome.result);
  assert.equal(result.state, "action-proposal"); if (result.state !== "action-proposal") throw new Error("operator proposal required");
  const decision = { chatId: result.proposal.chatId, actionId: result.proposal.actionId, revision: result.proposal.revision, decision: "confirm" as const };
  if (change === "cancel") assert.equal((await tools.decideAction({ ...decision, decision: "cancel" }, new AbortController().signal)).state, "cancelled");
  if (change === "expired") f.clock.advanceWall(60_001);
  if (change === "manifest") { const prior = f.kernel.assistantManifest(); f.kernel.assistantManifest = () => ({ ...prior, revision: PositiveIntSchema.parse(prior.revision + 1) }); }
  if (change === "grant") assert.equal(f.grant("every-action").state, "applied");
  if (change === "target") f.database.withAuthorityTransaction(({ notifications }) => notifications.updateState({ notificationId: notification.notificationId, expectedVersion: 1,
    status: "unread", snooze: { state: "not-snoozed" }, updatedAt: f.clock.now().toISOString() }));
  if (change === "added") f.database.withAuthorityTransaction(({ notifications }) => notifications.create({ ...notification, notificationId: randomUUID(), dedupeFingerprint: "d".repeat(64) }));
  const owner = change === "restart" ? createProductionAssistantTools(toolsInput) : tools;
  const before = f.database.getMeta().authorityGeneration;
  assert.throws(() => owner.decideAction(decision, new AbortController().signal));
  assert.equal(f.database.getMeta().authorityGeneration, before);
  assert.equal(f.database.authority.notifications.get(notification.notificationId)?.status, "unread");
});

it.each(["confirm", "cancel"] as const)("keeps stale collection confirmation refused but permits exact inert %s", async decision => {
  const f = await fixture(); assert.equal(f.grant("every-action").state, "applied");
  const notification = NotificationRecordSchema.parse({ notificationId: randomUUID(), actorId: "local-operator", dedupeFingerprint: "a".repeat(64),
    trigger: "storage", channel: "ping", status: "unread", snooze: { state: "not-snoozed" }, title: "Local title", summary: "Local summary",
    links: [{ kind: "storage", diagnosticFingerprint: "b".repeat(64) }], count: 1, version: 1,
    lastSeenAt: f.clock.now().toISOString(), createdAt: f.clock.now().toISOString(), updatedAt: f.clock.now().toISOString() });
  f.database.withAuthorityTransaction(({ notifications }) => notifications.create(notification));
  const tools = createProductionAssistantTools({ knowledge: assistantKnowledgeArtifact(), database: f.database, kernel: f.kernel, authorization: f.authorization, actorId: "local-operator", clock: f.clock,
    assertCurrent: () => f.runtime.assertCurrent(f.active.token) });
  const request = AssistantRequestSchema.parse({ message: "mark notifications read" });
  const reference = z.object({ references: z.array(z.string()) }).parse(tools.projectInput(request).input).references[0]; assert.ok(reference);
  const knowledge = assistantKnowledgeArtifact(), context: AssistantFunctionContext = { request, context: createAssistantContext(Buffer.from(knowledge.bytes), knowledge.policy),
    assertCurrent: () => f.runtime.assertCurrent(f.active.token), assertRetainedCurrent: () => f.runtime.assertCurrent(f.active.token) };
  return tools.bindFunctions(context, new AbortController().signal).then(async sets => {
    const fn = sets[0]?.functions[0]; assert.ok(fn);
    const result = await fn.invoke({ reference }, new AbortController().signal, context);
    assert.equal(result.kind, "complete"); if (result.kind !== "complete" || result.result.state !== "action-proposal") throw new Error("prepared action required");
    const proposal = result.result.proposal, action = f.database.authority.assistantAuthorization.action(proposal.actionId); assert.ok(action);
    f.database.withAuthorityTransaction(({ notifications }) => notifications.create({ ...notification, notificationId: randomUUID(), dedupeFingerprint: "c".repeat(64) }));
    const rows = f.database.authority.notifications.listByActor("local-operator");
    const input = { chatId: proposal.chatId, actionId: proposal.actionId, revision: proposal.revision, decision };
    if (decision === "confirm") assert.throws(() => tools.decideAction(input, new AbortController().signal));
    else assert.equal((await tools.decideAction(input, new AbortController().signal)).state, "cancelled");
    assert.equal(f.database.authority.assistantAuthorization.action(proposal.actionId)?.state, decision === "cancel" ? "cancelled" : "prepared");
    assert.equal(f.database.authority.commands.get(action.command.commandId), undefined);
    assert.equal(f.database.authority.commandAudits.findByCommand(action.command.commandId), undefined);
    assert.deepEqual(f.database.authority.notifications.listByActor("local-operator"), rows);
  });
});
