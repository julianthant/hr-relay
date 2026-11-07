import { profileBrowserClosure } from "../../../src/backend/runtime/browser/profile-browser-closure.js";
import { runtimeLifetimeLock } from "../../support/helpers/backend/runtime-lifetime.js";
import { syntheticOnboardingDuo, finishProfileOnboarding } from "../../support/helpers/admission-fixture.js";




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
  const runtime = composeProfileRuntime({ onboardingDuo: syntheticOnboardingDuo(), admission: machine, clock, hostFacts: { primaryDisplay: null } });
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
  const execute = (request: unknown) => executeSettingsCommand({ authority: database, clock, ids: { uuid: randomUUID }, settings }, request);
  const command = () => {
    const patch = { "browser.headless": { set: false } };
    return CommandRequestSchema.parse({ commandId: randomUUID(), requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source: "settings-surface",
      family: "settings", type: "apply-settings", target: { expectedRevision: context.settings.read().record.revision },
      payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } });
  };
  return { workspace, machine, runtime, active, context, database, clock, kernel, authorization, command, execute };
}

it("prepares on the operator's Confirm alone, and requires genuine token/chat ownership", async () => {
  const f = await fixture(), chat = f.authorization.createChat();
  assert.equal(f.authorization.prepare(chat, f.command()).state, "prepared");
  assert.throws(() => composeProfileAssistantAuthorization(f.runtime, randomUUID(), f.kernel, f.clock));
  assert.throws(() => f.authorization.prepare({ ...chat }, f.command()), /assistant-chat-not-issued/u);
});

it("rejects a Settings command that carries the retired assistant permission", async () => {
  const f = await fixture(), request = f.command(), before = f.database.getMeta().authorityGeneration;
  assert.equal(request.type, "apply-settings"); if (request.type !== "apply-settings") throw new Error("settings required");
  assert.throws(() => f.execute({ ...request, payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveRawSettingsPatchFingerprint({}), patch: {},
    assistantPermission: { expectedPolicyRevision: 0, mode: "every-action" } } }));
  assert.equal(f.database.getMeta().authorityGeneration, before);
});

it("claims once and commits the real canonical Settings result in one authority generation", async () => {
  const f = await fixture();
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

it("refuses another chat, expiry and profile revocation without command effects", async () => {
  const f = await fixture();
  const chat = f.authorization.createChat(), other = f.authorization.createChat(), command = f.command();
  const proposal = f.authorization.prepare(chat, command);
  assert.throws(() => f.authorization.consume(other, proposal.id), /stale/u);
  assert.equal(f.database.authority.commands.get(command.commandId), undefined);
  const next = f.authorization.prepare(chat, f.command());
  f.clock.advanceWall(60_001);
  assert.throws(() => f.authorization.approve(chat, next.id, next.revision), /stale/u);
  createProfileRegistry(f.machine).advanceSession(null);
  assert.throws(() => f.authorization.createChat());
  assert.throws(() => f.authorization.consume(chat, next.id));
});

it("refuses private commands before storing an action", async () => {
  const f = await fixture();
  const chat = f.authorization.createChat(), command = f.command(); assert.equal(command.type, "apply-settings");
  if (command.type !== "apply-settings") throw new Error("settings required");
  const patch = { "actor.label": { set: "Synthetic Person" } };
  assert.throws(() => f.authorization.prepare(chat, { ...command, payload: { ...command.payload, patch, patchFingerprint: deriveSettingsPatchFingerprint(patch) } }));
  assert.equal(f.database.authority.assistantAuthorization.actionByCommand(command.commandId), undefined);
});

it("refuses cancellation, changed manifest and reissued service capability without resurrecting durable approval", async () => {
  const f = await fixture();
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
  const f = await fixture();
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

it("keeps checkpoint recovery operator-only even when a manifest classifies the command", async () => {
  const f = await fixture();
  const chat = f.authorization.createChat();
  const command = CommandRequestSchema.parse({ commandId: randomUUID(), requestedAt: f.clock.now().toISOString(),
    requestedBy: "local-operator", source: "dashboard", family: "run", type: "recover-run",
    target: { runId: randomUUID(), expectedVersion: 1 } });
  assert.ok(f.kernel.assistantAvailability().some(entry => entry.family === "run" && entry.action === "recover-run" && entry.availability === "unavailable"));
  const manifest = f.kernel.assistantManifest();
  assert.ok(manifest.entries.every(entry => entry.family !== "run" || entry.action !== "recover-run"));
  f.kernel.assistantManifest = () => ({ ...manifest, entries: [...manifest.entries,
    { family: "run", action: "recover-run", classification: "external-submit", subject: "classified" }] });
  const generation = f.database.getMeta().authorityGeneration;
  assert.throws(() => f.authorization.prepare(chat, command), /assistant-command-values-unbound/u);
  assert.equal(f.database.getMeta().authorityGeneration, generation);
  assert.equal(f.database.authority.commands.get(command.commandId), undefined);
  assert.equal(f.database.authority.commandAudits.findByCommand(command.commandId), undefined);
  assert.equal(f.database.authority.assistantAuthorization.actionByCommand(command.commandId), undefined);
});
