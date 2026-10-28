import type { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { credentialKeychainTestEnvironment } from "../../../support/helpers/credential-keychain-fake.js";
import { timelineEventFromRow } from "../../../../src/backend/storage/sqlite/timeline-repository.js";
import { SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { deriveWriteAuthorityReason } from "../../../../src/rules/write-safety/write-authority-reason.js";
import { TimelineEventRecordSchema } from "../../../../src/models/events/timeline.js";
import { admitDirectWorker } from "../../../../src/backend/storage/sqlite/worker-slots.js";
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

const Message = z.discriminatedUnion("kind", [
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
    writeResolution: { recheck: unused, resolveAbsent: unused }, workerRuntime: { pool: { planPoolWorkerCount: unused,
      spawnPoolWorker: unused, refreshPoolBrowser: unused, reopenPoolBrowser: unused, stopPoolWorker: unused, pausePoolWorker: unused, resumePoolWorker: unused } } });
  return { lifecycle, kernel };
}

async function prepare(arm: "read" | "write" = "read") {
  const root = arm === "read" ? childExecutionRoot : childCrashWriteRoot;
  const modules = arm === "read" ? childExecutionModules : childCrashWriteModules(createWriteFixtureWorld()).modules;
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
    database.authority.runtimeConfig.initialize({ configSnapshotId: randomUUID(), revision: 1,
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
      submissions: [arm === "read" ? { emplId: "10800000", text: "same", mode: "ok" } : { eid: WRITE_FIXTURE_EID }], dryRun: false,
      selectedStepKeys: root.descriptor.timeline.map(step => step.key) });
    assert.equal(plan.planned.length, 1); assert.equal(plan.refused.length, 0);
    const rootRunId = singleAppliedRunId(kernel.execute({ commandId: randomUUID(), family: "start", type: "start-run", source: "dashboard",
      requestedBy: LOCAL_OPERATOR_ACTOR_ID, requestedAt: systemClock.now().toISOString(), target: { workflowId: root.descriptor.id,
        startPlanId: plan.startPlanId, expectedVersion: plan.expectedVersion }, payload: plan.fingerprints }));
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

async function launch(workspace: string, mode: "checkpoint" | "resume" | "attempting", lock: RuntimeLifetimeLock) {
  const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"),
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
      assert.equal(observed.authority.workerLeases.get(message.workerId)?.processId, child.child.pid);
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
        ...database.crashRunRecoveryIdentity(message.runId), now: systemClock.now().toISOString() };
      const lock = lifetimeLock;
      assert.equal(lifecycle.recoverCrash(request, lock).state, "applied");
      const run = database.authority.runs.get(message.runId); assert.ok(run);
      assert.ok(run.lifecycle.state === "terminal" && run.lifecycle.outcome === "failed");
      assert.equal(database.authority.failures.listByRun(message.runId)[0]?.code, "RUN_INTERRUPTED_BY_CRASH");
      assert.equal(canonicalJsonStringify(database.authority.runCheckpoints.listByItem(run.envelope.workflow, run.envelope.itemId)), retained);
      assert.equal(lifecycle.recoverCrash(request, lock).state, "applied-already");
      database.settleInterruptedWorker(lock, message.workerId, request.workerLifetime.leaseGeneration, systemClock.now().toISOString());
      assert.equal(database.authority.workerLeases.get(message.workerId)?.lifecycle.state, "stopped");
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
      assert.ok(result.readProfileResourceCustody().leases.every(lease => lease.lifecycle.state === "stopped"));
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
      assert.equal(observed.authority.workerLeases.get(message.workerId)?.processId, child.child.pid);
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
        ...database.crashRunRecoveryIdentity(message.runId), now: systemClock.now().toISOString() };
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
      assert.throws(() => database.assertWorkerLifecycleRelease(message.workerId), /worker-lifecycle-write-custody-unavailable/u);
      assert.throws(() => database.assertWorkerLifecycleRelease(message.workerId), /worker-lifecycle-write-custody-unavailable/u);
      for (const workflow of [root.envelope.workflow, childExecutionRoot.descriptor.id]) {
        const otherMember = database.withAuthorityTransaction(repositories => admitDirectWorker(repositories, {
    workflow, poolIndex: 2, commandId: randomUUID(), now: systemClock.now().toISOString(),
    expectedPoolVersion: repositories.workerPools.get(workflow)?.version ?? 0,
    processId: process.pid
}, randomUUID()));
        assert.notEqual(otherMember.workerId, message.workerId);
        assert.doesNotThrow(() => database.assertWorkerLifecycleRelease(otherMember.workerId));
      }
      const raw = new DatabaseSync(f.profile.path);
      try {
        const eventRow = z.object({ id: z.string(), payload_json: z.string(), kind: z.string() }).parse(raw.prepare(`
          SELECT id,payload_json,kind FROM timeline_events WHERE kind='run.claimed' AND run_id=?
            AND json_extract(payload_json,'$.payload.event.claimGeneration')=?
        `).get(message.runId, parked.claimGeneration));
        const claimRow = z.object({ id: z.string(), request_json: z.string(), outcome_json: z.string() }).parse(raw.prepare(`
          SELECT id,request_json,outcome_json FROM commands WHERE family='run-lifecycle'
            AND json_extract(request_json,'$.operation')='claim-next'
            AND json_extract(outcome_json,'$.result.runId')=?
        `).get(message.runId));
        const attemptRow = z.object({ id: z.string(), payload_json: z.string() }).parse(raw.prepare(`
          SELECT id,payload_json FROM write_attempts WHERE id=(SELECT json_extract(payload_json,'$.currentAttemptId') FROM write_intents WHERE id=?)
        `).get(message.writeIntentId));
        const uncertain = () => assert.throws(() => database.assertWorkerLifecycleRelease(message.workerId),
          error => error instanceof Error && error.message === "worker-lifecycle-write-ownership-unavailable");
        const nativeRefusal = (table: "commands" | "timeline_events", reason: "command-row-outcome-missing"
          | "run-lifecycle-request-binding-mismatch" | "timeline-event-owner-mismatch") => () =>
          assert.throws(() => database.assertWorkerLifecycleRelease(message.workerId), error =>
            error instanceof Error && error.constructor === Error
            && error.message === `authority table ${table} failed native record validation: ${reason}`
            && error.cause instanceof Error && error.cause.constructor === Error
            && error.cause.message === reason && error.cause.cause === undefined);
        const corruptProtectedRow = (
          table: "timeline_events" | "write_attempts", id: string,
          mutate: () => { changes: number | bigint }, restore: () => { changes: number | bigint },
          assertRefusal: () => void = uncertain,
        ): void => {
          const triggerName = table === "timeline_events" ? "timeline_events_immutable" : "write_attempts_immutable";
          const refusal = table === "timeline_events" ? "timeline-history-immutable" : "write-attempt-proof-immutable";
          const select = table === "timeline_events" ? "SELECT * FROM timeline_events WHERE id=?" : "SELECT * FROM write_attempts WHERE id=?";
          const definitions = SQLITE_MIGRATIONS.flatMap(migration => migration.statements.flatMap(statement =>
            [...statement.matchAll(new RegExp(`CREATE TRIGGER ${triggerName} BEFORE UPDATE ON ${table}\\n[\\s\\S]*? END;`, "gu"))].map(match => match[0].slice(0, -1))));
          assert.equal(definitions.length, 1);
          const sql = definitions[0]; assert.ok(sql);
          const trigger = { type: "trigger", name: triggerName, tbl_name: table, sql };
          const assertTrigger = () => assert.deepEqual({ ...raw.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name=?").get(triggerName) }, trigger);
          const before = raw.prepare(select).get(id); assert.ok(before);
          assertTrigger();
          assert.throws(mutate, { code: "ERR_SQLITE_ERROR", message: refusal });
          assert.deepEqual(raw.prepare(select).get(id), before);
          const sealedUpdate = (expected: typeof before, update: typeof mutate) => {
            raw.exec("BEGIN IMMEDIATE");
            try {
              assertTrigger();
              assert.deepEqual(raw.prepare(select).get(id), expected);
              raw.exec(table === "timeline_events" ? "DROP TRIGGER timeline_events_immutable" : "DROP TRIGGER write_attempts_immutable");
              assert.equal(update().changes, 1);
              raw.exec(sql);
              assertTrigger();
              const after = raw.prepare(select).get(id); assert.ok(after);
              if (table === "timeline_events") timelineEventFromRow(after);
              raw.exec("COMMIT");
              return after;
            } catch (error) {
              const rollbackFailures: unknown[] = [];
              try { raw.exec("ROLLBACK"); } catch (rollbackError) { rollbackFailures.push(rollbackError); }
              if (rollbackFailures.length !== 0) throw new AggregateError([error, ...rollbackFailures], "child-corruption-rollback-unproved", { cause: error });
              throw error;
            }
          };
          const changed = sealedUpdate(before, mutate);
          let guardFailure: { error: unknown } | undefined;
          try { assertTrigger(); assertRefusal(); } catch (error) { guardFailure = { error }; }
          const restoreFailures: unknown[] = [];
          try {
            sealedUpdate(changed, restore);
            assert.deepEqual(raw.prepare(select).get(id), before);
            assertTrigger();
            assert.throws(mutate, { code: "ERR_SQLITE_ERROR", message: refusal });
            assert.deepEqual(raw.prepare(select).get(id), before);
          } catch (error) { restoreFailures.push(error); }
          if (guardFailure !== undefined && restoreFailures.length !== 0) throw new AggregateError([
            guardFailure.error, ...restoreFailures,
          ], "child-corruption-restoration-unproved", { cause: guardFailure.error });
          if (guardFailure !== undefined) throw guardFailure.error;
          if (restoreFailures.length !== 0) throw restoreFailures[0];
        };
        const corruptCommand = (mutate: () => { changes: number | bigint }, restore: () => { changes: number | bigint },
          assertRefusal: () => void): void => {
          const before = raw.prepare("SELECT * FROM commands WHERE id=?").get(claimRow.id); assert.ok(before);
          assert.equal(mutate().changes, 1);
          const changed = raw.prepare("SELECT * FROM commands WHERE id=?").get(claimRow.id); assert.ok(changed);
          let guardFailure: { error: unknown } | undefined;
          try { assertRefusal(); } catch (error) { guardFailure = { error }; }
          const restoreFailures: unknown[] = [];
          try {
            assert.deepEqual(raw.prepare("SELECT * FROM commands WHERE id=?").get(claimRow.id), changed);
            assert.equal(restore().changes, 1);
            assert.deepEqual(raw.prepare("SELECT * FROM commands WHERE id=?").get(claimRow.id), before);
          } catch (error) { restoreFailures.push(error); }
          if (guardFailure !== undefined && restoreFailures.length !== 0) throw new AggregateError([
            guardFailure.error, ...restoreFailures,
          ], "child-command-restoration-unproved", { cause: guardFailure.error });
          if (guardFailure !== undefined) throw guardFailure.error;
          if (restoreFailures.length !== 0) throw restoreFailures[0];
        };
        const timelineRowSchema = z.strictObject({ cursor: z.number().int(), id: z.string(), workflow: z.string().nullable(),
          run_id: z.string().nullable(), worker_id: z.string().nullable(), kind: z.string(), occurred_at: z.string(),
          recorded_at: z.string(), retention_date: z.string(), retention_class: z.string(), operation_id: z.string().nullable(),
          operation_generation: z.number().nullable(), confirmed_at: z.string().nullable(), system: z.string().nullable(), payload_json: z.string(),
        });
        const originalClaimRow = timelineRowSchema.parse(raw.prepare("SELECT * FROM timeline_events WHERE id=?").get(eventRow.id));
        const claimedNative = timelineEventFromRow(originalClaimRow);
        const duplicate = timelineRowSchema.parse(raw.prepare("SELECT * FROM timeline_events WHERE run_id=? AND kind='span.started' AND retention_class='ordinary' ORDER BY cursor LIMIT 1").get(message.runId));
        const otherNative = timelineEventFromRow(duplicate);
        assert.equal(otherNative.payload.kind, "span");
        if (otherNative.payload.kind !== "span") throw new Error("child-corruption-span-source-required");
        assert.equal(otherNative.payload.event.t, "span.started");
        const missingClaim = TimelineEventRecordSchema.parse({ ...otherNative, eventId: claimedNative.eventId, cursor: claimedNative.cursor });
        corruptProtectedRow("timeline_events", eventRow.id,
          () => raw.prepare(`UPDATE timeline_events SET workflow=?,run_id=?,worker_id=?,kind=?,occurred_at=?,recorded_at=?,
            retention_date=?,retention_class=?,operation_id=?,operation_generation=?,confirmed_at=?,system=?,payload_json=? WHERE id=?`)
            .run(duplicate.workflow, duplicate.run_id, duplicate.worker_id, duplicate.kind, duplicate.occurred_at, duplicate.recorded_at,
              duplicate.retention_date, duplicate.retention_class, duplicate.operation_id, duplicate.operation_generation,
              duplicate.confirmed_at, duplicate.system, canonicalJsonStringify(missingClaim), eventRow.id),
          () => raw.prepare(`UPDATE timeline_events SET workflow=?,run_id=?,worker_id=?,kind=?,occurred_at=?,recorded_at=?,
            retention_date=?,retention_class=?,operation_id=?,operation_generation=?,confirmed_at=?,system=?,payload_json=? WHERE id=?`)
            .run(originalClaimRow.workflow, originalClaimRow.run_id, originalClaimRow.worker_id, originalClaimRow.kind,
              originalClaimRow.occurred_at, originalClaimRow.recorded_at, originalClaimRow.retention_date, originalClaimRow.retention_class,
              originalClaimRow.operation_id, originalClaimRow.operation_generation, originalClaimRow.confirmed_at,
              originalClaimRow.system, originalClaimRow.payload_json, originalClaimRow.id));
        const claimedEvent = TimelineEventRecordSchema.parse(JSON.parse(eventRow.payload_json));
        const duplicateEvent = { ...claimedEvent, eventId: duplicate.id, cursor: duplicate.cursor };
        corruptProtectedRow("timeline_events", duplicate.id,
          () => raw.prepare(`UPDATE timeline_events SET workflow=?,run_id=?,worker_id=NULL,kind='run.claimed',occurred_at=?,
          recorded_at=?,retention_date=?,retention_class='ordinary',operation_id=NULL,operation_generation=NULL,
          confirmed_at=NULL,system=NULL,payload_json=? WHERE id=?`).run(claimedEvent.workflow ?? null, message.runId,
          claimedEvent.occurredAt, claimedEvent.recordedAt, claimedEvent.retentionDate, canonicalJsonStringify(duplicateEvent), duplicate.id),
          () => raw.prepare(`UPDATE timeline_events SET workflow=?,run_id=?,worker_id=?,kind=?,occurred_at=?,recorded_at=?,
            retention_date=?,retention_class=?,operation_id=?,operation_generation=?,confirmed_at=?,system=?,payload_json=? WHERE id=?`)
            .run(duplicate.workflow, duplicate.run_id, duplicate.worker_id, duplicate.kind, duplicate.occurred_at, duplicate.recorded_at,
              duplicate.retention_date, duplicate.retention_class, duplicate.operation_id, duplicate.operation_generation,
              duplicate.confirmed_at, duplicate.system, duplicate.payload_json, duplicate.id));
        assert.deepEqual(raw.prepare("SELECT * FROM timeline_events WHERE id=?").get(duplicate.id), Object.assign(Object.create(null), duplicate));
        corruptCommand(
          () => raw.prepare("UPDATE commands SET outcome_json=NULL WHERE id=?").run(claimRow.id),
          () => raw.prepare("UPDATE commands SET outcome_json=? WHERE id=?").run(claimRow.outcome_json, claimRow.id),
          nativeRefusal("commands", "command-row-outcome-missing"));
        corruptCommand(
          () => raw.prepare("UPDATE commands SET request_json=json_set(request_json,'$.requestFingerprint',?) WHERE id=?")
          .run("0".repeat(64), claimRow.id),
          () => raw.prepare("UPDATE commands SET request_json=? WHERE id=?").run(claimRow.request_json, claimRow.id),
          nativeRefusal("commands", "run-lifecycle-request-binding-mismatch"));
        corruptCommand(
          () => raw.prepare("UPDATE commands SET request_json=json_set(request_json,'$.request.workerLifetime.leaseGeneration',?) WHERE id=?")
          .run(1 + z.object({ request: z.object({ workerLifetime: z.object({ leaseGeneration: z.number() }) }) })
            .parse(JSON.parse(claimRow.request_json)).request.workerLifetime.leaseGeneration, claimRow.id),
          () => raw.prepare("UPDATE commands SET request_json=? WHERE id=?").run(claimRow.request_json, claimRow.id),
          nativeRefusal("commands", "run-lifecycle-request-binding-mismatch"));
        corruptProtectedRow("timeline_events", eventRow.id,
          () => raw.prepare("UPDATE timeline_events SET payload_json=json_set(payload_json,'$.payload.event.attempt',?) WHERE id=?")
          .run(parked.envelope.attempt + 1, eventRow.id),
          () => raw.prepare("UPDATE timeline_events SET payload_json=? WHERE id=?").run(eventRow.payload_json, eventRow.id),
          nativeRefusal("timeline_events", "timeline-event-owner-mismatch"));
        corruptProtectedRow("write_attempts", attemptRow.id,
          () => raw.prepare("UPDATE write_attempts SET payload_json=json_set(payload_json,'$.runAttempt',?) WHERE id=?")
          .run(parked.envelope.attempt + 1, attemptRow.id),
          () => raw.prepare("UPDATE write_attempts SET payload_json=? WHERE id=?").run(attemptRow.payload_json, attemptRow.id));
        assert.deepEqual(raw.prepare("SELECT id,request_json,outcome_json FROM commands WHERE id=?").get(claimRow.id),
          Object.assign(Object.create(null), claimRow));
        assert.deepEqual(raw.prepare("SELECT id,payload_json,kind FROM timeline_events WHERE id=?").get(eventRow.id),
          Object.assign(Object.create(null), eventRow));
        assert.deepEqual(raw.prepare("SELECT id,payload_json FROM write_attempts WHERE id=?").get(attemptRow.id),
          Object.assign(Object.create(null), attemptRow));
      } finally { raw.close(); }
      assert.throws(() => database.assertWorkerLifecycleRelease(message.workerId), /worker-lifecycle-write-custody-unavailable/u);

      assert.ok(database.authority.workerControls.browsers(message.workerId).some(browser => browser.health !== "closed"));
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
      assert.doesNotThrow(() => database.assertWorkerLifecycleRelease(message.workerId));
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
