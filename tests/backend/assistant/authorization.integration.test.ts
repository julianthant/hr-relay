import { AuthorityDatabase, AuthorityBackupService, OfflineAuthorityRestoreService, RecoveryStopProofStore } from "../../../src/backend/storage/sqlite/index.js";
import { observeRuntimeLockSnapshot } from "../../../src/backend/storage/sqlite/runtime-process-locks.js";
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
function fixture() {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "assistant-authorization-")));
  const machine = acquireEntrypointAdmission(workspace, "exclusive");
  const clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  const processLockRoot = join(workspace, rebuildRuntimeIsolation.processLockRoot);
  mkdirSync(processLockRoot, { recursive: true, mode: 0o700 });
  const runtime = composeProfileRuntime({ admission: machine, clock, hostFacts: { primaryDisplay: null }, processLockRoot });
  const active = runtime.session.signUp({ firstName: "Synthetic", lastName: "Operator", email: "operator@example.edu", password: "synthetic-password", createdAt: clock.now().toISOString() });
  assert.equal(active.state, "active"); if (active.state !== "active") throw new Error("signup required");
  const context = runtime.selectedContext(active.token), database = context.database;
  const unavailable = (): never => { throw new Error("unused runtime port invoked"); };
  const settings = createSettingsApplicationExecutor(context.resolveSettings, context.credentials);
  const actualKernel = createCommandKernel({ authority: database, clock, ids: { uuid: randomUUID }, appVersion: "0.1.0",
    authorityProfileId: active.profileId, settings,
    lifecycle: new RunRecordService({ database, clock, ids: { uuid: randomUUID }, publishQueued: () => {} }),
    descriptors: { resolve: () => undefined }, writeResolution: { resolvePresent: unavailable, resolveAbsent: unavailable },
    intakeParser: UNWIRED_INTAKE_PARSER, intakeProjections: NO_INTAKE_PROJECTIONS,
    configIdentity: { configSnapshotId: database.authority.runtimeConfig.get()!.configSnapshotId, configFingerprint: database.authority.runtimeConfig.get()!.configFingerprint },
    workerRuntime: { pool: { planPoolWorkerCount: unavailable, spawnPoolWorker: unavailable, stopPoolWorker: unavailable,
      pausePoolWorker: unavailable, resumePoolWorker: unavailable, refreshPoolBrowser: unavailable, reopenPoolBrowser: unavailable } },
  });
  const kernel = { ...actualKernel };
  const authorization = composeProfileAssistantAuthorization(runtime, active.token, kernel, clock);
  cleanups.push(async () => { await context.account.close(); database.close(); context.admission.release(); machine.release(); rmSync(workspace, { recursive: true, force: true }); });
  const permissionCommand = (mode: "every-action" | "before-submits" | "without-asking", expectedRevision: number = context.settings.read().record.revision,
    expectedPolicyRevision: number = database.authority.assistantAuthorization.grant()?.policy.revision ?? 0) => CommandRequestSchema.parse({
    commandId: randomUUID(), requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source: "settings-surface",
    family: "settings", type: "apply-settings", target: { expectedRevision },
    payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveRawSettingsPatchFingerprint({}), patch: {}, assistantPermission: { expectedPolicyRevision, mode } },
  });
  const execute = (request: unknown) => executeSettingsCommand({ authority: database, clock, ids: { uuid: randomUUID }, settings, authorityProfileId: active.profileId }, request);
  const grant = (mode: "every-action" | "before-submits" | "without-asking", expectedRevision: number = context.settings.read().record.revision,
    expectedPolicyRevision: number = database.authority.assistantAuthorization.grant()?.policy.revision ?? 0) => execute(permissionCommand(mode, expectedRevision, expectedPolicyRevision));
  const command = () => {
    const patch = { "browser.headless": { set: false } };
    return CommandRequestSchema.parse({ commandId: randomUUID(), requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source: "settings-surface",
      family: "settings", type: "apply-settings", target: { expectedRevision: context.settings.read().record.revision },
      payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } });
  };
  return { workspace, machine, runtime, active, context, database, clock, kernel, authorization, grant, command, permissionCommand, execute };
}

it("does not turn the displayed default into a grant, and requires genuine token/chat ownership", () => {
  const f = fixture(), chat = f.authorization.createChat();
  assert.equal(f.database.authority.assistantAuthorization.grant(), undefined);
  assert.throws(() => f.authorization.prepare(chat, f.command()), /assistant-grant-required/u);
  assert.throws(() => composeProfileAssistantAuthorization(f.runtime, randomUUID(), f.kernel, f.clock));
  assert.equal(f.grant("every-action").state, "applied");
  assert.throws(() => f.authorization.prepare({ ...chat }, f.command()), /assistant-chat-not-issued/u);
  assert.equal(f.grant("without-asking", 1).state, "conflict");
  assert.equal(f.database.authority.assistantAuthorization.grant()?.policy.mode, "every-action");
  const permission = f.permissionCommand("without-asking");
  assert.equal(permission.type, "apply-settings"); if (permission.type !== "apply-settings") throw new Error("settings required");
  const before = f.database.getMeta().authorityGeneration;
  assert.throws(() => f.execute({ ...permission, payload: { ...permission.payload, assistantPermission: { clear: true } } }));
  assert.equal(f.database.getMeta().authorityGeneration, before);
});

it("claims once and commits the real canonical Settings result in one authority generation", () => {
  const f = fixture(); assert.equal(f.grant("every-action").state, "applied");
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

it("refuses another chat, changed grant, expiry and profile revocation without command effects", () => {
  const f = fixture(); assert.equal(f.grant("without-asking").state, "applied");
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

it("refuses private or self-granting commands before storing an action", () => {
  const f = fixture(); assert.equal(f.grant("without-asking").state, "applied");
  const chat = f.authorization.createChat(), command = f.command(); assert.equal(command.type, "apply-settings");
  if (command.type !== "apply-settings") throw new Error("settings required");
  const patch = { "actor.label": { set: "Synthetic Person" } };
  assert.throws(() => f.authorization.prepare(chat, { ...command, payload: { ...command.payload, patch, patchFingerprint: deriveSettingsPatchFingerprint(patch) } }));
  assert.throws(() => f.authorization.prepare(chat, f.permissionCommand("without-asking")));
  assert.equal(f.database.authority.assistantAuthorization.actionByCommand(command.commandId), undefined);
});

it("refuses cancellation, changed manifest and reissued service capability without resurrecting durable approval", () => {
  const f = fixture(); assert.equal(f.grant("without-asking").state, "applied");
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
  const f = fixture(); assert.equal(f.grant("without-asking").state, "applied");
  const chat = f.authorization.createChat(), command = f.command(), proposal = f.authorization.prepare(chat, command);
  const directory = join(f.context.admission.stateRoot, "backups", "authority");
  const report = await new AuthorityBackupService(f.context.admission, f.database, { directory }, f.clock)
    .request({ trigger: "operator", requiredGeneration: f.database.getMeta().authorityGeneration });
  const manifest = report.manifests[0]; assert.ok(manifest);
  f.authorization.cancel(chat, proposal.id, proposal.revision);
  await f.context.account.close(); f.database.close();
  const path = join(f.context.admission.stateRoot, "state.db"), processLockRoot = join(f.workspace, rebuildRuntimeIsolation.processLockRoot);
  const sourceDatabaseIdentity = AuthorityDatabase.sourceDatabaseIdentity(path);
  const proofs = new RecoveryStopProofStore({ processLockRoot, maxProofAgeMs: 60_000 }, f.clock);
  proofs.recordRuntimeState(observeRuntimeLockSnapshot({ processLockRoot, sourceDatabaseIdentity }, f.clock));
  const proof = proofs.issue({ observedBy: "local-operator", sourceDatabaseIdentity });
  const restore = new OfflineAuthorityRestoreService(f.context.admission, { authorityPath: path, suspectDirectory: join(f.context.admission.stateRoot, "backups", "suspects"), busyTimeoutMs: 250,
    processLockRoot, stoppedProofMaxAgeMs: 60_000 }, async () => undefined, f.clock, undefined, undefined, f.context.credentials);
  assert.equal((await restore.restore({ manifestPath: join(directory, `${manifest.backupFileName}.manifest.json`), stoppedSystemProof: proof })).state, "restored");
  assert.throws(() => f.authorization.consume(chat, proposal.id));
  const restarted = composeProfileRuntime({ admission: f.machine, clock: f.clock, hostFacts: { primaryDisplay: null }, processLockRoot });
  const active = restarted.session.signIn({ email: "operator@example.edu", password: "synthetic-password", at: f.clock.now().toISOString() });
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

it("requires both grant and Settings CAS and keeps exact permission replay idempotent", () => {
  const f = fixture(), first = f.permissionCommand("every-action");
  assert.equal(first.type, "apply-settings"); if (first.type !== "apply-settings") throw new Error("settings required");
  const initial = f.context.settings.read().record, generation = f.database.getMeta().authorityGeneration;
  assert.equal(f.grant("without-asking", initial.revision, 1).state, "conflict");
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
  assert.equal(f.execute({ ...first, payload: { ...first.payload, assistantPermission: { expectedPolicyRevision: 0, mode: "without-asking" } } }).state, "rejected");
  assert.equal(f.grant("without-asking", f.context.settings.read().record.revision, 0).state, "conflict");
  assert.equal(f.database.getMeta().authorityGeneration, after);
  assert.deepEqual(f.database.authority.assistantAuthorization.grant(), granted);
  const saved = f.context.settings.read().record;
  assert.equal(f.grant("without-asking", initial.revision, granted.policy.revision).state, "conflict");
  assert.equal(f.database.getMeta().authorityGeneration, after);
  assert.deepEqual(f.context.settings.read().record, saved);
  assert.deepEqual(f.database.authority.assistantAuthorization.grant(), granted);
});
