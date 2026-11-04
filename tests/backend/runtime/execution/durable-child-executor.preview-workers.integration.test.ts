import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, it } from "vitest";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { executeSettingsCommand } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { createWriteSequencer } from "../../../../src/backend/runtime/writes/write-sequencer.js";
import { WorkerSessionManager } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import { deriveIdempotencyKeyDigest } from "../../../../src/rules/write-safety/write-safety.js";
import { readDelegationEvidence } from "../../../../src/backend/storage/sqlite/delegation-authority.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { deriveSettingsPatchFingerprint, SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/settings.js";
import { RunDelegatedDryRunPreviewResultSchema, RunDryRunPreviewResultSchema, terminalEvidenceResult } from "../../../../src/models/run/result.js";
import type { RunRecord } from "../../../../src/models/run/record.js";
import { FingerprintSchema, WorkerIdSchema, WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { resolveTaskImplFingerprint } from "../../../../src/workflow-kit/validation/build-manifest.js";
import { createWorkflowDescriptorRegistry } from "../../../../src/workflows/descriptor-registry.js";
import { childExecutionBuildManifest } from "../../../support/fixtures/child-execution-build-manifest.js";
import { childCrashWrite, childPreviewMembersRoot as root } from "../../../support/fixtures/child-execution-write-workflow.js";
import { testAdmittedWorker, testRunLifecycle } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { absentProbeEvidence, buildWriteFixtureRegistry, createWriteFixtureWorld, writeFixtureSessions, WRITE_FIXTURE_EID } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { canonicalChildExecution } from "../../../support/helpers/backend/canonical-child-execution.js";
import { createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";
import { duoCeremonyGatesOver } from "../../../support/helpers/duo-ceremony-fixtures.js";
import { ManualScheduler } from "../../../support/helpers/phase1f-executor-harness.js";
import { AuthorityDatabase, createCredentialStore } from "../../../support/helpers/synthetic-storage-admission.js";
import { stopSyntheticDatabaseWorkers } from "../../../support/helpers/synthetic-database-admission.js";

const world = createRunExecutorTestWorld();
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  const failures: unknown[] = [];
  for (const close of cleanups.splice(0).reverse()) { try { await close(); } catch (error) { failures.push(error); } }
  try { await world.cleanup(); } catch (error) { failures.push(error); }
  if (failures.length > 0) throw new AggregateError(failures, "preview-worker-cleanup-failed");
});

async function fixture(workerCount = 1) {
  const descriptors = [root.descriptor, childCrashWrite.descriptor];
  createWorkflowDescriptorRegistry([root.descriptor], [childCrashWrite.descriptor]);
  const resolve = (id: string) => descriptors.find(descriptor => descriptor.id === id);
  const h = await world.executorHarness({ descriptor: root.descriptor });
  const { database, clock, path, stateRoot } = h.authority;
  const patch = { "actor.label": { set: "Synthetic operator" } } as const;
  assert.equal(executeSettingsCommand({ authority: database, clock, ids: { uuid: randomUUID },
    settings: createSettingsApplicationExecutor(settings => resolveConfigWithProvenance(settings, hostConfigFacts({}), clock),
      createCredentialStore({ stateRoot })) }, { commandId: randomUUID(), family: "settings", type: "apply-settings", source: "settings-surface",
    requestedBy: "local-operator", requestedAt: clock.now().toISOString(), target: { expectedRevision: 1 },
    payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } }).state, "applied");
  const workers: { connection: ReturnType<typeof AuthorityDatabase.open>; driver: ReturnType<typeof createWriteFixtureWorld>;
    execution: ReturnType<typeof canonicalChildExecution>; workerId: string }[] = [];
  for (const poolIndex of Array.from({ length: workerCount }, (_, index) => index + 1)) {
    const connection = poolIndex === 1 ? database : AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "preview-worker-test" }, clock);
    const driver = createWriteFixtureWorld(), stores = buildWriteFixtureRegistry(driver), scheduler = new ManualScheduler(clock);
    const admitted = testAdmittedWorker(connection, clock, { path, workflow: root.descriptor.id, poolIndex, browserSystems: ["ucpath"] });
    const sessions = new WorkerSessionManager({ workerId: WorkerIdSchema.parse(admitted.workerId), workflowId: WorkflowIdSchema.parse(root.descriptor.id),
      stores, factory: writeFixtureSessions(driver).factory, clock, scheduler, acquireDeadlineMs: 30_000,
      browserScreenshotCapture: { capture: async () => undefined }, duoCeremony: duoCeremonyGatesOver(connection, clock, scheduler) });
    const runtime = database.authority.runtimeConfig.get(); assert.ok(runtime);
    sessions.bindRunConfigFingerprint(FingerprintSchema.parse(runtime.configFingerprint));
    cleanups.push(async () => {
      await sessions.closeAll("worker-stop");
      if (poolIndex !== 1) { stopSyntheticDatabaseWorkers({ database: connection, path }); connection.close(); }
    });
    const sequencer = createWriteSequencer({ ...h.deps, lifecycle: testRunLifecycle(connection, clock), stores, authority: connection,
      sessions, scheduler, operator: "local-operator", resolveImplFingerprint: id => resolveTaskImplFingerprint(childExecutionBuildManifest, id) });
    const execution = canonicalChildExecution({ ...h.deps, stores, authority: connection, sessions, scheduler, ids: { uuid: randomUUID },
      buildManifest: childExecutionBuildManifest, writeSequencer: sequencer }, connection, path, resolve, undefined, { poolIndex,
      resources: (_reader, run) => {
        if (run.envelope.workflow === childCrashWrite.descriptor.id) {
          const { eid } = childCrashWrite.descriptor.input.parse(run.input.parsed.value);
          driver.subjectEid = eid;
          const absent = absentProbeEvidence(clock.now().toISOString());
          driver.probeResults.push({ ...absent, evidence: { ...absent.evidence,
            idempotencyKeyDigest: deriveIdempotencyKeyDigest("ucpath", `${eid}|fixture-termination`) } });
        }
        return {};
      } });
    workers.push({ connection, driver, execution, workerId: admitted.workerId });
  }
  const [home] = workers; assert.ok(home);
  const run = home.execution.start(root.descriptor, { eid: WRITE_FIXTURE_EID }, { dryRun: true });
  const current = (id = run.envelope.runId) => { const value = database.authority.runs.get(id); assert.ok(value); return value; };
  const command = (type: "retry" | "resume" | "cancel" | "recover-run", target: RunRecord) => ({ commandId: randomUUID(), family: "run" as const, type,
    source: "dashboard" as const, requestedBy: "local-operator", requestedAt: clock.now().toISOString(),
    target: { runId: target.envelope.runId, expectedVersion: target.version }, ...(type === "cancel" ? { reason: "Synthetic member cancellation" } : {}) });
  const claimNext = (worker: (typeof workers)[number]) => {
    const runtime = database.authority.runtimeConfig.get(); assert.ok(runtime);
    const slot = database.authority.workerSlots.get(worker.workerId), lease = database.authority.workerLeases.get(worker.workerId); assert.ok(slot && lease);
    return worker.execution.lifecycle.claimNext({ commandId: randomUUID(), workflow: root.descriptor.id, workerId: worker.workerId,
      workerLifetime: { membershipRevision: slot.membershipRevision, leaseGeneration: lease.leaseGeneration }, runtimeConfig: {
        generation: runtime.generation, settingsRevision: runtime.settingsRevision,
        settingsFingerprint: runtime.settingsFingerprint, configFingerprint: runtime.configFingerprint } });
  };
  return { database, clock, workers, home, run, current, command, claimNext };
}

function assertPreviewOnly(f: Awaited<ReturnType<typeof fixture>>, runs: readonly RunRecord[]) {
  for (const run of runs) {
    assert.equal(run.envelope.dryRun, true);
    assert.deepEqual(f.database.authority.writeIntents.countDryRunEvidenceByRun(run.envelope.runId),
      { writeIntents: 0, writeAttempts: 0, confirmedOperations: 0 });
    assert.deepEqual(f.database.authority.runCheckpoints.listByItem(run.envelope.workflow, run.envelope.itemId), []);
  }
  for (const { driver } of f.workers) assert.equal(driver.events.some(event => event.startsWith("commit-click:")), false);
}

it("joins independent preview workers in manifest order after reversed settlement and wakes the parent once", async () => {
  const f = await fixture(4);
  assert.equal((await f.home.execution.step(f.run, world.SIGNAL)).outcome.state, "yielded-delegation");
  const [manifest] = f.database.authority.delegationManifests.listByParentRun(f.run.envelope.runId); assert.ok(manifest);
  assert.deepEqual(manifest.children.map(member => childCrashWrite.descriptor.input.parse(f.current(member.childRunId).input.parsed.value).eid),
    [WRITE_FIXTURE_EID, "10800001", "10800002"]);
  const pending: { release: ReturnType<typeof Promise.withResolvers<void>>; execution: ReturnType<typeof f.home.execution.step>;
    run: RunRecord; worker: (typeof f.workers)[number] }[] = [];
  try {
    for (const worker of f.workers.slice(1)) {
      const reached = Promise.withResolvers<RunRecord>(), release = Promise.withResolvers<void>();
      worker.driver.prepareSteps = async () => {
        const run = f.database.authority.runs.listChildren(f.run.envelope.runId).find(child => "workerId" in child.lifecycle && child.lifecycle.workerId === worker.workerId);
        assert.ok(run); reached.resolve(run); await release.promise;
      };
      const execution = worker.execution.step(f.run, world.SIGNAL);
      const run = await Promise.race([reached.promise, execution.then(result => { throw new Error(`preview-preparation-not-reached: ${JSON.stringify(f.database.authority.failures.listByRun(result.run.envelope.runId))}`); })]);
      pending.push({ release, execution, run, worker });
    }
    assert.equal(new Set(pending.map(entry => entry.run.lifecycle.state === "running" ? entry.run.lifecycle.workerId : undefined)).size, 3);
    assert.equal(new Set(pending.map(entry => entry.worker.connection)).size, 3);
    const settlementOrder = [];
    for (const member of [...manifest.children].reverse()) {
      assert.equal(f.database.authority.dependencies.readiness(f.run.envelope.runId, "join").state, "waiting");
      assert.deepEqual(f.claimNext(f.home), { state: "refused", refusal: { reason: "none-eligible" } });
      const next = pending.find(entry => entry.run.envelope.runId === member.childRunId); assert.ok(next);
      next.release.resolve();
      const settled = await next.execution; assert.equal(settled.outcome.state, "done");
      settlementOrder.push(settled.run.envelope.runId);
      assert.equal(f.current().claimGeneration, 1);
    }
    assert.deepEqual(settlementOrder, manifest.children.map(child => child.childRunId).reverse());
    assert.equal(f.database.authority.dependencies.readiness(f.run.envelope.runId, "join").state, "ready");
    const joined = await f.home.execution.step(f.run, world.SIGNAL);
    assert.equal(joined.run.envelope.runId, f.run.envelope.runId);
    assert.equal(joined.outcome.state, "done");
    const result = f.database.authority.runResults.get(f.run.envelope.runId); assert.ok(result);
    assert.equal(RunDelegatedDryRunPreviewResultSchema.parse(result.result.value).externalCommit, "none");
    const [receipt] = result.dependencies; assert.ok(receipt?.state === "delegation-resolved");
    assert.deepEqual(receipt.members.map(member => member.runId), manifest.children.map(member => member.childRunId));
    assert.deepEqual(receipt.members.map(member => member.lifecycle), ["done", "done", "done"]);
    assert.equal(f.current().claimGeneration, 2);
    for (const worker of f.workers) assert.deepEqual(f.claimNext(worker), { state: "refused", refusal: { reason: "none-eligible" } });
    const claims = f.database.authority.timelineEvents.page({ runId: f.run.envelope.runId }).filter(row => row.payload.kind === "span" && row.payload.event.t === "run.claimed");
    assert.equal(claims.length, 2);
    assertPreviewOnly(f, [f.current(), ...f.database.authority.runs.listChildren(f.run.envelope.runId)]);
  } finally {
    for (const entry of pending) entry.release.resolve();
    await Promise.all(pending.map(entry => entry.execution));
  }
});

it("retains preview, failed and cancelled members through authorized retries and manual resume without retrying UNKNOWN", async () => {
  const f = await fixture();
  assert.equal((await f.home.execution.step(f.run, world.SIGNAL)).outcome.state, "yielded-delegation");
  const success = await f.home.execution.step(f.run, world.SIGNAL); assert.equal(success.outcome.state, "done", JSON.stringify(f.database.authority.failures.listByRun(success.run.envelope.runId)));
  const [worker] = f.workers; assert.ok(worker);
  worker.driver.onPrepare = () => { throw new Error("synthetic preparation failure"); };
  const failed = await worker.execution.step(f.run, world.SIGNAL); assert.equal(failed.outcome.state, "failed");
  delete worker.driver.onPrepare;
  const queued = f.database.authority.runs.listChildren(f.run.envelope.runId).find(run => run.lifecycle.state === "queued"); assert.ok(queued);
  const cancelled = f.command("cancel", queued);
  assert.equal(f.home.execution.kernel.execute(cancelled).state, "applied");
  const original = readDelegationEvidence(f.database.authority, f.run.envelope.runId, "members");
  assert.deepEqual(original.children.map(child => child.run.lifecycle.state === "terminal" ? child.run.lifecycle.outcome : child.run.lifecycle.state).sort(), ["cancelled", "done", "failed"]);
  assert.equal(f.database.authority.dependencies.readiness(f.run.envelope.runId, "join").state, "blocked");
  const before = original.children.map(child => ({ run: child.run, result: child.result }));
  for (const member of before) {
    if (member.run.envelope.runId === success.run.envelope.runId) continue;
    const retry = f.command("retry", member.run);
    const applied = f.home.execution.kernel.execute(retry); assert.equal(applied.state, "applied", JSON.stringify(applied));
    assert.deepEqual(f.home.execution.kernel.execute(retry), { ...applied, state: "already-applied" });
  }
  assert.ok(f.current().pause);
  const replacements = f.database.authority.runs.listChildren(f.run.envelope.runId).filter(run => run.envelope.retryOf !== undefined);
  assert.equal(replacements.length, 2);
  for (const replacement of replacements) {
    assert.equal(replacement.envelope.attempt, 2);
    assert.equal(replacement.envelope.dryRun, true);
    assert.equal(replacement.envelope.configSnapshotId, f.run.envelope.configSnapshotId);
    assert.ok(before.some(member => member.run.envelope.runId === replacement.envelope.retryOf));
    assert.equal((await f.home.execution.step(f.run, world.SIGNAL)).outcome.state, "done");
  }
  assert.ok(f.current().pause);
  assert.equal(f.database.authority.runResults.get(f.run.envelope.runId), undefined);
  const resume = f.command("resume", f.current());
  assert.equal(f.home.execution.kernel.execute(resume).state, "applied");
  assert.equal((await f.home.execution.step(f.run, world.SIGNAL)).outcome.state, "done");
  const result = f.database.authority.runResults.get(f.run.envelope.runId); assert.ok(result);
  assert.equal(RunDelegatedDryRunPreviewResultSchema.parse(result.result.value).externalCommit, "none");
  const [receipt] = result.dependencies; assert.ok(receipt?.state === "delegation-resolved");
  const effective = original.manifest.children.map(member => replacements.find(run => run.envelope.retryOf === member.childRunId) ?? f.current(member.childRunId));
  assert.deepEqual(receipt.members.map(member => [member.runId, member.itemId, member.attempt, member.lifecycle, member.resultDigest]),
    effective.map(run => [run.envelope.runId, run.envelope.itemId, run.envelope.attempt, "done", f.database.authority.runResults.get(run.envelope.runId)?.resultDigest]));
  for (const member of before) {
    assert.deepEqual(f.current(member.run.envelope.runId), member.run);
    assert.deepEqual(f.database.authority.runResults.get(member.run.envelope.runId), member.result);
  }
  assert.equal(RunDryRunPreviewResultSchema.parse(f.database.authority.runResults.get(success.run.envelope.runId)?.result.value).externalCommit, "none");
  assertPreviewOnly(f, [f.current(), ...f.database.authority.runs.listChildren(f.run.envelope.runId)]);

  const failedEvidence = before.find(member => member.run.envelope.runId === failed.run.envelope.runId); assert.ok(failedEvidence);
  assert.equal(terminalEvidenceResult(failedEvidence.result)?.kind, "failed-evidence");
  const unknownRoot = f.home.execution.start(root.descriptor, { eid: WRITE_FIXTURE_EID }, { dryRun: false });
  worker.driver.commitThrows = new Error("synthetic fenced write uncertainty");
  assert.equal((await f.home.execution.step(unknownRoot, world.SIGNAL)).outcome.state, "yielded-delegation");
  const unknown = await f.home.execution.step(unknownRoot, world.SIGNAL); assert.equal(unknown.outcome.state, "parked-write");
  const parked = f.current(unknown.run.envelope.runId); assert.ok(parked.lifecycle.state === "parked-write");
  const intent = f.database.authority.writeIntents.get(parked.lifecycle.writeIntentId); assert.ok(intent?.status === "parked");
  const attempts = f.database.authority.writeAttempts.listByIntent(intent.writeIntentId); assert.equal(attempts.length, 1);
  const memberAttempts = f.database.authority.runs.listByItem({ workflow: parked.envelope.workflow, itemId: parked.envelope.itemId });
  for (const target of [parked, f.current(unknownRoot.envelope.runId)]) for (const type of ["retry", "recover-run"] as const) {
    const refusal = f.home.execution.kernel.execute(f.command(type, target));
    assert.ok(refusal.state === "rejected");
    assert.equal(refusal.code, type === "retry" ? "invalid-state" : "RUN_CONTINUATION_REFUSED");
  }
  assert.deepEqual(f.database.authority.writeIntents.get(intent.writeIntentId), intent);
  assert.deepEqual(f.database.authority.writeAttempts.listByIntent(intent.writeIntentId), attempts);
  assert.deepEqual(f.current(parked.envelope.runId), parked);
  assert.deepEqual(f.database.authority.runs.listByItem({ workflow: parked.envelope.workflow, itemId: parked.envelope.itemId }), memberAttempts);
  assert.equal(memberAttempts.filter(run => run.envelope.retryOf === parked.envelope.runId).length, 0);
  assert.equal(f.database.authority.runs.listChildren(unknownRoot.envelope.runId).length, 3);
  assert.equal(f.database.authority.runResults.get(unknownRoot.envelope.runId), undefined);
  assert.equal(f.database.authority.runResults.get(parked.envelope.runId), undefined);
});
