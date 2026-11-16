import { admitFixtureSlot } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { unusedWorkerPool } from "../../../support/helpers/backend/unused-worker-pool.js";
import { PREFERENCES_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { testProcessImport } from "../../../support/compiled-process.js";
import type { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { credentialKeychainTestEnvironment } from "../../../support/helpers/credential-keychain-fake.js";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { deriveWriteAuthorityReason } from "../../../../src/rules/write-safety/write-authority-reason.js";
import { ErrorCatalogCodeSchema } from "../../../../src/models/failures/error-catalog.js";
import { randomUUID, createHash } from "node:crypto";
import { copyFileSync, existsSync } from "node:fs";
import { once } from "node:events";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { it } from "vitest";
import { createStartPlanService } from "../../../../src/backend/runs/commands/start-plan-service.js";
import { createCommandKernel, executeSettingsCommand } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { runQueuedSpanEvent } from "../../../../src/backend/runs/commands/run-queued-span.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { readSettings } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { deriveSettingsPatchFingerprint, SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/settings.js";
import { LOCAL_OPERATOR_ACTOR_ID, WorkerIdSchema, RunIdSchema, WriteIntentIdSchema } from "../../../../src/rules/identity/ids.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { runClaim } from "../../../../src/models/run/record.js";
import { childExecutionModules, childExecutionRoot } from "../../../support/fixtures/child-execution-workflows.js";
import { NO_INTAKE_PROJECTIONS, UNSTORED_CONFIG_IDENTITY, UNWIRED_INTAKE_PARSER } from "../../../support/fixtures/intake-kernel-seams.js";
import { singleAppliedRunId } from "../../../support/fixtures/operator-command-fixtures.js";
import { boundProfileCredentials, createBoundProfileFixture, unregisterBoundProfile } from "../../../support/helpers/admission-fixture.js";
import { childCrashWriteModules, childCrashWriteRoot } from "../../../support/fixtures/child-execution-write-workflow.js";
import { createWriteFixtureWorld, WRITE_FIXTURE_EID } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { lifecycleCommandId } from "../../../../src/rules/identity/identifiers.js";
import { reconcileExitedWorker } from "../../../../src/backend/runs/lifecycle/startup-crash-recovery.js";
import { terminalEvidenceResult } from "../../../../src/models/run/result.js";
import { createWorkflowDescriptorRegistry } from "../../../../src/workflows/registry.js";

const Message = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("preview-prepare"), workerId: WorkerIdSchema, runId: RunIdSchema,
    pid: z.number().int().positive(), events: z.array(z.string()) }),
  z.strictObject({ kind: z.literal("checkpoint"), workerId: WorkerIdSchema, runId: RunIdSchema, pid: z.number().int().positive() }),
  z.strictObject({ kind: z.literal("attempting"), workerId: WorkerIdSchema, runId: RunIdSchema,
    writeIntentId: WriteIntentIdSchema, pid: z.number().int().positive(), clicks: z.literal(1) }),
  z.strictObject({ kind: z.literal("terminal"), closure: z.literal("proved"), done: z.number().int().nonnegative() }),
  z.strictObject({ kind: z.literal("failure"), code: z.literal("CHILD_EXECUTION_FAILED"),
    stage: z.enum(["arguments", "machine", "profile", "graph", "compose", "terminal"]),
    type: z.enum(["ZOD_ERROR", "ERROR", "NULL", "UNDEFINED", "OTHER"]),
    causeCode: z.union([ErrorCatalogCodeSchema, z.literal("UNCLASSIFIED")]), errorSha256: z.string().regex(/^[a-f0-9]{64}$/u) }),
]);

function commands(database: AuthorityDatabase, descriptors: { resolve(id: string): import("../../../../src/workflow-kit/workflow.js").AnyWorkflowDescriptor | undefined }) {
  const emitter = createTimelineEmitter({ repository: database.authority.timelineEvents, clock: systemClock });
  const lifecycle = new RunRecordService({ database, clock: systemClock, ids: { uuid: randomUUID }, resolveDescriptor: id => descriptors.resolve(id),
    publishQueued: (run, publication) => { assert.ok(publication); emitter.emit(runQueuedSpanEvent({ run, ...publication, actorId: LOCAL_OPERATOR_ACTOR_ID })); } });
  const unused = (): never => { throw new Error("unrequested-crash-fixture-effect"); };
  const kernel = createCommandKernel({ authority: database, lifecycle, clock: systemClock, ids: { uuid: randomUUID }, appVersion: "0.1.0",
    descriptors, configIdentity: UNSTORED_CONFIG_IDENTITY, intakeParser: UNWIRED_INTAKE_PARSER, intakeProjections: NO_INTAKE_PROJECTIONS,
    writeResolution: { recheck: unused, resolveAbsent: unused }, workerRuntime: { pool: unusedWorkerPool(unused) } });
  return { lifecycle, kernel };
}

async function prepare(arm: "read" | "write" | "preview" = "read") {
  const root = arm === "read" ? childExecutionRoot : childCrashWriteRoot;
  const modules = arm === "read" ? childExecutionModules : childCrashWriteModules(createWriteFixtureWorld()).modules;
  if (arm === "preview") createWorkflowDescriptorRegistry([root.descriptor], modules.filter(module => module.descriptor !== root.descriptor).map(module => module.descriptor));
  const profile = await createBoundProfileFixture({ sharedMachine: true });
  copyFileSync(join(process.cwd(), "package.json"), join(profile.workspace, "package.json"));
  copyFileSync(join(process.cwd(), "package-lock.json"), join(profile.workspace, "package-lock.json"));
  const open = () => AuthorityDatabase.open(profile.admission, { path: profile.path, busyTimeoutMs: 500,
    migrationOwner: "child-crash-test" }, systemClock, undefined, undefined, undefined, boundProfileCredentials(profile.admission));
  const database = open();
  try {
    const settings = readSettings(database.authority);
    const resolved = resolveConfigWithProvenance(settings.settings, hostConfigFacts({}), systemClock,
      { stateRoot: profile.stateRoot, artifactRoot: profile.admission.artifactRoot });
    database.authority.runtimeConfig.initialize({ ...PREFERENCES_SNAPSHOT, configSnapshotId: randomUUID(), revision: 1,
      fingerprint: resolved.fingerprint, capturedAt: systemClock.now().toISOString(), capturedBy: "local-operator",
      config: resolved.config, provenance: resolved.provenance });
    const patch = { "actor.label": { set: "Synthetic operator" }, "features.duoWebAuthn": { set: false } } as const;
    assert.equal(executeSettingsCommand({ authority: database, clock: systemClock, ids: { uuid: randomUUID },
      settings: createSettingsApplicationExecutor(value => resolveConfigWithProvenance(value, hostConfigFacts({}), systemClock,
        { stateRoot: profile.stateRoot, artifactRoot: profile.admission.artifactRoot }), boundProfileCredentials(profile.admission)) },
    { commandId: randomUUID(), family: "settings", type: "apply-settings", source: "settings-surface", requestedBy: "local-operator",
      requestedAt: systemClock.now().toISOString(), target: { expectedRevision: settings.revision }, payload: {
        settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } }).state, "applied");
    const descriptors = { resolve: (id: string) => modules.find(module => module.descriptor.id === id)?.descriptor };
    const { kernel } = commands(database, descriptors);
    const active = database.authority.runtimeConfig.get(); assert.ok(active);
    const planner = createStartPlanService({ authority: database, authorityRead: database, descriptors, clock: systemClock,
      ids: { uuid: randomUUID }, planTtlMs: 600_000, plannedBy: LOCAL_OPERATOR_ACTOR_ID,
      configFingerprint: active.configFingerprint, configSnapshotId: active.configSnapshotId });
    const plan = planner.plan({ workflowId: root.descriptor.id,
      submissions: [arm === "read" ? { emplId: "10800000", text: "same", mode: "ok" } : { eid: WRITE_FIXTURE_EID }], dryRun: arm === "preview",
      selectedStepKeys: root.descriptor.timeline.map(step => step.key) });
    assert.equal(plan.planned.length, 1, JSON.stringify(plan.refused)); assert.equal(plan.refused.length, 0);
    const rootRunId = singleAppliedRunId(kernel.execute({ commandId: randomUUID(), family: "start", type: "start-run", source: "dashboard",
      requestedBy: LOCAL_OPERATOR_ACTOR_ID, requestedAt: systemClock.now().toISOString(), target: { workflowId: root.descriptor.id,
        startPlanId: plan.startPlanId, expectedVersion: plan.expectedVersion }, payload: plan.fingerprints }));
    database.withAuthorityTransaction(repositories => admitFixtureSlot(repositories, root.descriptor.id, 1, systemClock.now().toISOString()));
    database.close();
    return { profile, open, rootRunId, descriptors };
  } catch (error) {
    const failures: unknown[] = [error];
    let closed = false;
    try { database.close(); closed = true; } catch (closeError) { failures.push(closeError); }
    if (closed) { try { await profile.close(); } catch (closeError) { failures.push(closeError); } }
    if (failures.length > 1) throw new AggregateError(failures, "child-crash-prepare-cleanup-unproved", { cause: error });
    throw error;
  }
}

async function launch(workspace: string, mode: "checkpoint" | "resume" | "attempting" | "preview-prepare" | "preview-resume", lock: RuntimeLifetimeLock) {
  const child = spawn(process.execPath, ["--import", testProcessImport(),
    fileURLToPath(new URL("../../../support/processes/child-execution-crash-worker.ts", import.meta.url)), workspace, mode, String(lock.port)],
  { env: credentialKeychainTestEnvironment({}), stdio: ["ignore", "pipe", "pipe", "ipc"] });
  await lock.share(child);
  assert.ok(child.stdout && child.stderr);
  child.stdout.resume();
  const stderrHash = createHash("sha256"); let stderrBytes = 0, closed = false;
  child.once("close", () => { closed = true; });
  child.stderr.on("data", (chunk: Buffer) => { stderrHash.update(chunk); stderrBytes += chunk.byteLength; });
  return { child, closed: () => closed, stderr: () => ({ bytes: stderrBytes, sha256: stderrHash.copy().digest("hex"), complete: closed }) };

}

async function next(owned: Awaited<ReturnType<typeof launch>>): Promise<z.output<typeof Message>> {
  const { child } = owned;
  const exited = (code: number | null, signal: NodeJS.Signals | null) => new Error(JSON.stringify({
    code: "OWNED_CHILD_EXITED_BEFORE_MESSAGE", exit: code,
    signal: signal === null || signal === "SIGKILL" || signal === "SIGTERM" || signal === "SIGINT" ? signal : "OTHER",
    stderr: owned.stderr(),
  }));
  if (child.exitCode !== null || child.signalCode !== null) {
    if (!owned.closed()) await once(child, "close");
    throw exited(child.exitCode, child.signalCode);
  }
  return new Promise<z.output<typeof Message>>((resolve, reject) => {
    const clear = () => { child.off("message", onMessage); child.off("exit", onExit); child.off("error", onError); };
    const onMessage = (value: unknown) => {
      clear();
      try {
        const parsed = Message.parse(value);
        if (parsed.kind === "failure") reject(new Error(JSON.stringify({ ...parsed, stderr: owned.stderr() })));
        else resolve(parsed);
      } catch (error) { reject(new AggregateError([error], "CHILD_IPC_MESSAGE_INVALID", { cause: error })); }
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      clear(); child.once("close", () => reject(exited(code, signal)));
    };
    const onError = (error: Error) => { clear(); reject(new AggregateError([error], "owned-child-process-error", { cause: error })); };
    child.once("message", onMessage); child.once("exit", onExit); child.once("error", onError);
  });
}

async function killOwned(owned: Awaited<ReturnType<typeof launch>>): Promise<void> {
  const { child } = owned;
  if (child.exitCode !== null || child.signalCode !== null) {
    if (!owned.closed()) await once(child, "close");
    return;
  }
  const exited = once(child, "close");
  assert.equal(child.kill("SIGKILL"), true);
  const values: unknown = await exited;
  const [, signal] = z.tuple([z.number().nullable(), z.string().nullable()]).parse(values);
  assert.equal(signal, "SIGKILL");
}

it("recovers an actual process killed during delegated preview preparation without a write or Saved result", async () => {
  const f = await prepare("preview"), children: Awaited<ReturnType<typeof launch>>[] = [];
  let closureProved = false;
  let primary: { error: unknown } | undefined;
  try {
    const child = await launch(f.profile.workspace, "preview-prepare", f.profile.lifetime); children.push(child);
    const message = await next(child);
    assert.ok(message.kind === "preview-prepare");
    assert.equal(message.pid, child.child.pid);
    assert.equal(message.events.filter(event => event === "prepare").length, 1);
    assert.equal(message.events.some(event => event.startsWith("commit-click:")), false);
    const observed = f.open();
    try {
      const run = observed.authority.runs.get(message.runId); assert.ok(run?.lifecycle.state === "running");
      assert.equal(run.envelope.parent?.runId, f.rootRunId);
      assert.equal(child.child.exitCode, null); assert.equal(child.child.signalCode, null);
      for (const id of [f.rootRunId, message.runId]) {
        assert.equal(observed.authority.runResults.get(id), undefined);
        assert.deepEqual(observed.authority.writeIntents.countDryRunEvidenceByRun(id),
          { writeIntents: 0, writeAttempts: 0, confirmedOperations: 0 });
      }
    } finally { observed.close(); }
    await killOwned(child);
    const database = f.open();
    try {
      const { lifecycle } = commands(database, f.descriptors);
      const reconcile = () => reconcileExitedWorker({ machine: f.profile.machine, admission: f.profile.admission,
        database, lifecycle, clock: systemClock, lock: f.profile.lifetime,
        workerId: message.workerId });
      reconcile();
      const run = database.authority.runs.get(message.runId); assert.ok(run);
      assert.ok(run.lifecycle.state === "terminal" && run.lifecycle.outcome === "failed");
      assert.equal(database.authority.failures.listByRun(message.runId)[0]?.code, "RUN_INTERRUPTED_BY_CRASH");
      assert.equal(database.authority.failures.listByRun(message.runId)[0]?.writeState, "not-attempted");
      const result = database.authority.runResults.get(message.runId); assert.ok(result);
      assert.equal(terminalEvidenceResult(result)?.kind, "failed-evidence");
      const generation = database.getMeta().authorityGeneration;
      reconcile();
      assert.equal(database.getMeta().authorityGeneration, generation);
      assert.deepEqual(database.authority.runResults.get(message.runId), result);
    } finally { database.close(); }
    const resumed = await launch(f.profile.workspace, "preview-resume", f.profile.lifetime); children.push(resumed);
    const terminal = await next(resumed);
    assert.ok(terminal.kind === "terminal");
    assert.equal(terminal.done, 0);
    const exit: unknown = await once(resumed.child, "exit");
    const [exitCode] = z.tuple([z.number().nullable(), z.string().nullable()]).parse(exit); assert.equal(exitCode, 0);
    const retained = f.open();
    try {
      for (const id of [f.rootRunId, message.runId]) {
        const run = retained.authority.runs.get(id); assert.ok(run?.lifecycle.state === "terminal");
        assert.equal(run.lifecycle.outcome, "failed");
        assert.equal(run.envelope.dryRun, true);
        assert.equal(retained.authority.failures.listByRun(id)[0]?.writeState, "not-attempted");
        const result = retained.authority.runResults.get(id); assert.ok(result);
        assert.equal(terminalEvidenceResult(result)?.kind, "failed-evidence");
        assert.deepEqual(retained.authority.writeIntents.countDryRunEvidenceByRun(id),
          { writeIntents: 0, writeAttempts: 0, confirmedOperations: 0 });
        assert.deepEqual(retained.authority.runCheckpoints.listByItem(run.envelope.workflow, run.envelope.itemId), []);
        assert.equal(result.operationLineage, undefined);
      }
      assert.equal(retained.authority.runs.listChildren(f.rootRunId).length, 1);
      closureProved = true;
    } finally { retained.close(); }
  } catch (error) { primary = { error }; }
  const failures: unknown[] = primary === undefined ? [] : [primary.error];
  for (const child of children) { try { await killOwned(child); } catch (error) { failures.push(error); } }
  if (closureProved && failures.length === 0) {
    try { await f.profile.close(); } catch (error) { failures.push(error); }
  } else failures.push(new Error("child-preview-crash-fixture-custody-retained"));
  if (failures.length > 0) throw new AggregateError(failures, "child-preview-crash-cleanup-unproved");
});

it("reconciles an actual child OS crash after its committed read checkpoint without repeating it", async () => {
  const f = await prepare(), children: Awaited<ReturnType<typeof launch>>[] = [];
  let closureProved = false;
  let primary: { error: unknown } | undefined;
  try {
    const lifetimeLock = f.profile.lifetime;
    const child = await launch(f.profile.workspace, "checkpoint", lifetimeLock); children.push(child);
    const message = await next(child);
    assert.equal(message.kind, "checkpoint"); assert.ok(message.kind === "checkpoint");
    assert.equal(message.pid, child.child.pid);
    const observed = f.open();
    let retained: string;
    try {
      const run = observed.authority.runs.get(message.runId); assert.ok(run && runClaim(run));
      const checkpoints = observed.authority.runCheckpoints.listByItem(run.envelope.workflow, run.envelope.itemId);
      assert.ok(checkpoints.length > 0);
      retained = canonicalJsonStringify(checkpoints);
      assert.equal(child.child.exitCode, null); assert.equal(child.child.signalCode, null);
      assert.equal(observed.authority.runResults.get(run.envelope.runId), undefined);
    } finally { observed.close(); }
    await killOwned(child);
    const database = f.open();
    try {
      assert.equal(child.child.signalCode, "SIGKILL");
      const lifecycle = new RunRecordService({ database, clock: systemClock, ids: { uuid: randomUUID },
        resolveDescriptor: f.descriptors.resolve, publishQueued: () => { throw new Error("recovery-must-not-publish-new-run"); } });
      const interrupted = database.authority.runs.get(message.runId); assert.ok(interrupted);
      const claim = runClaim(interrupted); assert.ok(claim);
      const request = { commandId: lifecycleCommandId("crash", { runId: message.runId, version: interrupted.version }),
        runId: message.runId, expectedVersion: interrupted.version,
        claim: { workerId: claim.workerId, claimGeneration: claim.claimGeneration },
        now: systemClock.now().toISOString() };
      const lock = lifetimeLock;
      assert.equal(lifecycle.recoverCrash(request, lock).state, "applied");
      const run = database.authority.runs.get(message.runId); assert.ok(run);
      assert.ok(run.lifecycle.state === "terminal" && run.lifecycle.outcome === "failed");
      assert.equal(database.authority.failures.listByRun(message.runId)[0]?.code, "RUN_INTERRUPTED_BY_CRASH");
      assert.equal(canonicalJsonStringify(database.authority.runCheckpoints.listByItem(run.envelope.workflow, run.envelope.itemId)), retained);
      assert.equal(lifecycle.recoverCrash(request, lock).state, "applied-already");
      database.settleInterruptedWorker(lock, message.workerId, systemClock.now().toISOString());
    } finally { database.close(); }
    const resumed = await launch(f.profile.workspace, "resume", lifetimeLock); children.push(resumed);
    const terminal = await next(resumed);
    assert.equal(terminal.kind, "terminal"); assert.ok(terminal.kind === "terminal");
    assert.equal(terminal.closure, "proved");
    const values: unknown = await once(resumed.child, "exit");
    const [code] = z.tuple([z.number().nullable(), z.string().nullable()]).parse(values); assert.equal(code, 0);
    const result = f.open();
    try {
      const root = result.authority.runs.get(f.rootRunId); assert.ok(root);
      assert.ok(root.lifecycle.state === "terminal" && root.lifecycle.outcome === "failed");
      const childRun = result.authority.runs.get(message.runId); assert.ok(childRun);
      assert.equal(canonicalJsonStringify(result.authority.runCheckpoints.listByItem(childRun.envelope.workflow, childRun.envelope.itemId)), retained);
      const value = result.authority.runResults.get(message.runId); assert.ok(value);
      assert.equal(result.authority.runs.listByWorkflow(childRun.envelope.workflow).filter(run => run.envelope.runId === message.runId).length, 1);
      assert.equal(result.authority.writeIntents.listByRun(message.runId).length, 0);
      closureProved = true;
    } finally { result.close(); }
  } catch (error) { primary = { error }; }
  {
    const failures: unknown[] = primary === undefined ? [] : [primary.error];
    for (const child of children) { try { await killOwned(child); } catch (error) { failures.push(error); } }
    if (closureProved && failures.length === 0) {
      try { await f.profile.close(); } catch (error) { failures.push(error); }
    }
    else failures.push(new Error("child-crash-fixture-custody-retained"));
    if (failures.length !== 0) throw new AggregateError(failures, "child-crash-fixture-cleanup-unproved");
  }
});

it("parks a real attempting child after its owned OS process dies without retry or manufactured settlement", async () => {
  const f = await prepare("write"), children: Awaited<ReturnType<typeof launch>>[] = [];
  let retainedUnknownProved = false;
  let primary: { error: unknown } | undefined;
  try {
    const lifetimeLock = f.profile.lifetime;
    const child = await launch(f.profile.workspace, "attempting", lifetimeLock); children.push(child);
    const message = await next(child);
    assert.equal(message.kind, "attempting"); assert.ok(message.kind === "attempting");
    assert.equal(message.pid, child.child.pid); assert.equal(message.clicks, 1);
    const observed = f.open();
    let version: number, intentBytes: string, attemptBytes: string;
    try {
      const run = observed.authority.runs.get(message.runId); assert.ok(run?.lifecycle.state === "running");
      assert.equal(run.envelope.parent?.runId, f.rootRunId);
      const intent = observed.authority.writeIntents.get(message.writeIntentId); assert.ok(intent);
      assert.ok(intent.status === "attempting"); assert.equal(intent.runId, message.runId);
      const attempts = observed.authority.writeAttempts.listByIntent(intent.writeIntentId);
      assert.equal(attempts.length, 1);
      intentBytes = canonicalJsonStringify(intent); attemptBytes = canonicalJsonStringify(attempts); version = run.version;
      assert.equal(child.child.exitCode, null); assert.equal(child.child.signalCode, null);
      assert.equal(observed.authority.runResults.get(message.runId), undefined);
    } finally { observed.close(); }
    await killOwned(child);
    const database = f.open();
    try {
      assert.equal(child.child.signalCode, "SIGKILL");
      const { lifecycle, kernel } = commands(database, f.descriptors);
      const interrupted = database.authority.runs.get(message.runId); assert.ok(interrupted);
      const claim = runClaim(interrupted); assert.ok(claim);
      const commandId = lifecycleCommandId("crash", { runId: message.runId, version });
      const request = { commandId, runId: message.runId, expectedVersion: version,
        claim: { workerId: claim.workerId, claimGeneration: claim.claimGeneration },
        now: systemClock.now().toISOString() };
      const lock = lifetimeLock;
      assert.equal(lifecycle.recoverCrash(request, lock).state, "applied");
      const parked = database.authority.runs.get(message.runId); assert.ok(parked?.lifecycle.state === "parked-write");
      assert.equal(parked.lifecycle.code, "unknown"); assert.equal(parked.lifecycle.writeIntentId, message.writeIntentId);
      assert.equal(runClaim(parked), undefined);
      assert.equal(canonicalJsonStringify(database.authority.writeIntents.get(message.writeIntentId)), intentBytes);
      assert.equal(canonicalJsonStringify(database.authority.writeAttempts.listByIntent(message.writeIntentId)), attemptBytes);
      const audit = database.authority.lifecycleJournal.findAuditByCommand(commandId); assert.ok(audit);
      const generation = database.getMeta().authorityGeneration;
      assert.equal(lifecycle.recoverCrash(request, lock).state, "applied-already");
      assert.equal(database.getMeta().authorityGeneration, generation);
      assert.deepEqual(database.authority.lifecycleJournal.findAuditByCommand(commandId), audit);
      const root = database.authority.runs.get(f.rootRunId); assert.ok(root?.lifecycle.state === "queued");
      for (const run of [parked, root]) {
        for (const type of ["retry", "cancel"] as const) {
          const result = kernel.execute({ commandId: randomUUID(), family: "run", type, source: "dashboard", requestedBy: LOCAL_OPERATOR_ACTOR_ID,
            requestedAt: systemClock.now().toISOString(), target: { runId: run.envelope.runId, expectedVersion: run.version } });
          assert.equal(result.state, "rejected"); assert.ok(result.state === "rejected"); assert.equal(result.code, "invalid-state");
        }
      }
      assert.equal(database.authority.runs.listChildren(f.rootRunId).length, 1);
      assert.equal(database.authority.runResults.get(f.rootRunId), undefined);
      assert.equal(database.authority.runResults.get(message.runId), undefined);
      assert.deepEqual(database.authority.runs.get(message.runId), parked);
      assert.equal(database.authority.dependencies.listByParentRun(f.rootRunId).length, 1);
      assert.equal(child.child.signalCode, "SIGKILL");
      const unresolvedIntent = database.authority.writeIntents.get(message.writeIntentId);
      assert.ok(unresolvedIntent?.status === "attempting");
      const durableParked = database.authority.writeIntents.parkAttempt({ writeIntentId: unresolvedIntent.writeIntentId,
        generation: unresolvedIntent.generation, expectedVersion: unresolvedIntent.version, code: "unknown",
        message: "controlled unknown", authorityReason: deriveWriteAuthorityReason("recovery-probe-unknown", "probe", "controlled unknown"),
        now: systemClock.now().toISOString() });
      assert.equal(durableParked.status, 'parked');
      if (durableParked.status !== 'parked') throw new Error('canonical parked successor required');
      const durableAttempt = database.authority.writeAttempts.get(durableParked.currentAttemptId);
      assert.ok(durableAttempt?.outcome.state === "parked");
      const durableGeneration = database.getMeta().authorityGeneration;
      assert.equal(database.getMeta().authorityGeneration, durableGeneration);
      assert.deepEqual(database.authority.writeIntents.get(message.writeIntentId), durableParked);
      assert.deepEqual(database.authority.writeAttempts.get(durableParked.currentAttemptId), durableAttempt);
      assert.deepEqual(database.authority.runs.get(message.runId), parked);
      retainedUnknownProved = true;
    } finally { database.close(); }
  } catch (error) { primary = { error }; }
  {
    const failures: unknown[] = primary === undefined ? [] : [primary.error];
    for (const child of children) { try { await killOwned(child); } catch (error) { failures.push(error); } }
    if (retainedUnknownProved && failures.length === 0) {
      try {
        unregisterBoundProfile(f.profile.admission);
        f.profile.admission.release();
        f.profile.machine.release();
        assert.equal(existsSync(f.profile.path), true);
      } catch (error) { failures.push(error); }
    } else failures.push(new Error("child-crash-fixture-custody-retained"));
    if (failures.length !== 0) throw new AggregateError(failures, "child-crash-fixture-cleanup-unproved");
  }
});
