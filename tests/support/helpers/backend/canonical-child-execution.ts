import { boundProfileAdmission } from "../synthetic-database-admission.js";
import { withBoundRunConfigFingerprint } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { createCommandKernel } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createStartPlanService } from "../../../../src/backend/runs/commands/start-plan-service.js";
import { runQueuedSpanEvent } from "../../../../src/backend/runs/commands/run-queued-span.js";
import { RunRecordService, workerRunLifecyclePort } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createDurableChildRunExecutor } from "../../../../src/backend/runtime/execution/durable-child-executor.js";
import { executeClaimedRun, type RunExecutorDependencies } from "../../../../src/backend/runtime/execution/run-executor.js";
import type { RunRecord } from "../../../../src/models/run/record.js";
import type { ProtectedInputBinding } from "../../../../src/models/write-safety/protected-input.js";
import { ActorIdSchema, FingerprintSchema, LOCAL_OPERATOR_ACTOR_ID } from "../../../../src/rules/identity/ids.js";
import type { AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { NO_INTAKE_PROJECTIONS, UNSTORED_CONFIG_IDENTITY, UNWIRED_INTAKE_PARSER } from "../../fixtures/intake-kernel-seams.js";
import { singleAppliedRunId } from "../../fixtures/operator-command-fixtures.js";
import { testAdmittedWorker, testWorkerLifetime } from "../../fixtures/run-lifecycle-fixtures.js";

export function canonicalChildExecution(deps: RunExecutorDependencies, database: AuthorityDatabase, path: string,
  resolve: (workflowId: string) => AnyWorkflowDescriptor | undefined) {
  const { clock } = deps;
  const emitter = createTimelineEmitter({ repository: database.authority.timelineEvents, clock });
  const lifecycle = new RunRecordService({ database, clock, ids: deps.ids, resolveDescriptor: resolve,
    ...(deps.buildManifest === undefined ? {} : { buildManifest: deps.buildManifest }),
    publishQueued: (run, publication) => {
      assert.ok(publication);
      emitter.emit(runQueuedSpanEvent({ run, ...publication, actorId: ActorIdSchema.parse(publication.actorId) }));
    } });
  const unused = (): never => { throw new Error("unrequested canonical fixture effect"); };
  const kernel = createCommandKernel({ authority: database, lifecycle, clock, ids: { uuid: randomUUID }, appVersion: "0.1.0",
    descriptors: { resolve }, configIdentity: UNSTORED_CONFIG_IDENTITY, intakeParser: UNWIRED_INTAKE_PARSER,
    intakeProjections: NO_INTAKE_PROJECTIONS, writeResolution: { recheck: unused, resolveAbsent: unused },
    workerRuntime: { pool: { planPoolWorkerCount: unused, spawnPoolWorker: unused, refreshPoolBrowser: unused,
      reopenPoolBrowser: unused, stopPoolWorker: unused, pausePoolWorker: unused, resumePoolWorker: unused } } });
  const childRuns = createDurableChildRunExecutor({ authority: database,
    admission: { admitAndRelease: (context, plan) => lifecycle.admitDelegation(context, plan) },
    resolveTarget: id => { const target = resolve(id); assert.ok(target); return target; } });
  let initialBinding = true;
  let home: Readonly<{ workerId: string; workflow: string; ordinal: number; createdAt: string; reservationCommandId: string | null; path: string; processId: number }> | undefined;
  async function step(root: RunRecord, signal: AbortSignal) {
    let stage: "prepare" | "claim" | "execute" = "prepare";
    try {
    signal.throwIfAborted();
    await deps.sessions.closeAll("parked");
    if (initialBinding) {
      deps.sessions.releaseRunConfigFingerprint();
      initialBinding = false;
    }
    const descriptor = resolve(root.envelope.workflow);
    assert.ok(descriptor);
    if (home === undefined) {
      const admitted = testAdmittedWorker(database, clock, { path, workflow: descriptor.id, poolIndex: 1, browserSystems: deps.stores.stores.flatMap(store => store.kind === "browser" ? [store.namespace] : []) });
      home = { workerId: admitted.workerId, workflow: admitted.member.workflow, ordinal: admitted.member.ordinal,
        createdAt: admitted.member.createdAt, reservationCommandId: admitted.member.reservationCommandId, path: realpathSync(path), processId: process.pid };
    }
    const runtime = database.authority.runtimeConfig.get();
    assert.ok(runtime);
    const owner = testWorkerLifetime(database, descriptor.id, 1);
    assert.equal(owner.workerId, home.workerId);
    assert.equal(owner.member.workflow, home.workflow);
    assert.equal(owner.member.ordinal, home.ordinal);
    assert.equal(owner.member.createdAt, home.createdAt);
    assert.equal(owner.member.reservationCommandId, home.reservationCommandId);
    assert.equal(owner.member.poolIndex, 1);
    assert.equal(owner.member.retiredAt, null);
    assert.equal(owner.lease.processId, home.processId);
    assert.equal(owner.lease.processId, process.pid);
    assert.equal(realpathSync(path), home.path);
    assert.equal(database.getSourceDatabaseIdentity(), AuthorityDatabase.sourceDatabaseIdentity(boundProfileAdmission(home.path).authorityBackupExpectedSource()));
    stage = "claim";
    const next = lifecycle.claimNext({ commandId: randomUUID(), workflow: descriptor.id, workerId: owner.workerId,
      workerLifetime: owner.workerLifetime, runtimeConfig: { generation: runtime.generation,
        settingsRevision: runtime.settingsRevision, settingsFingerprint: runtime.settingsFingerprint,
        configFingerprint: runtime.configFingerprint } });
    assert.ok(next.state === "applied" || next.state === "applied-already");
    assert.ok("run" in next);
    const run = next.run, execution = resolve(run.envelope.workflow);
    assert.ok(execution);
    deps.sessions.configureExecution(execution.id, deps.stores);
    const claim = { workerId: owner.workerId, claimGeneration: run.claimGeneration };
    stage = "execute";
    const outcome = await withBoundRunConfigFingerprint(deps.sessions, FingerprintSchema.parse(run.envelope.configFingerprint),
      () => executeClaimedRun({ ...deps, lifecycle: workerRunLifecyclePort(lifecycle), descriptor: execution, childRuns },
        { run, claim, signal }), run.envelope.browserMode, { runId: run.envelope.runId,
        descriptorFingerprint: run.envelope.contractFingerprint,
        ...(run.envelope.captureBrowserScreenshots === undefined ? {} : { captureBrowserScreenshots: run.envelope.captureBrowserScreenshots }) });
    return { run, claim, outcome };
    } catch (error) {
      const kind = error instanceof Error ? "ERROR" : error === null ? "NULL" : error === undefined ? "UNDEFINED" : "OTHER";
      throw new AggregateError([error, new Error(JSON.stringify({ stage, kind }))], "canonical child fixture failed", { cause: error });
    }
  }
  return {
    kernel, lifecycle, childRuns, step,
    start(descriptor: AnyWorkflowDescriptor, input: unknown, options: Readonly<{ dryRun: boolean; protectedSubmissionBindings?: readonly ProtectedInputBinding[] }>) {
      const active = database.authority.runtimeConfig.get();
      assert.ok(active);
      const planner = createStartPlanService({ authority: database, authorityRead: database, descriptors: { resolve },
        clock, ids: { uuid: randomUUID }, planTtlMs: 600_000, plannedBy: LOCAL_OPERATOR_ACTOR_ID,
        configFingerprint: active.configFingerprint, configSnapshotId: active.configSnapshotId,
        ...(options.protectedSubmissionBindings === undefined ? {} : { protectedSubmissionBindings: options.protectedSubmissionBindings }) });
      const plan = planner.plan({ workflowId: descriptor.id, submissions: [input], dryRun: options.dryRun,
        selectedStepKeys: descriptor.timeline.map(step => step.key) });
      assert.equal(plan.planned.length, 1);
      assert.equal(plan.refused.length, 0);
      const result = kernel.execute({ commandId: randomUUID(), family: "start", type: "start-run", source: "dashboard",
        requestedBy: LOCAL_OPERATOR_ACTOR_ID, requestedAt: clock.now().toISOString(), target: { workflowId: descriptor.id,
          startPlanId: plan.startPlanId, expectedVersion: plan.expectedVersion }, payload: plan.fingerprints });
      const run = database.authority.runs.get(singleAppliedRunId(result));
      assert.ok(run);
      return run;
    },
    async execute(root: RunRecord, signal: AbortSignal) {
      const outcomes: Awaited<ReturnType<typeof executeClaimedRun>>[] = [];
      for (;;) {
        const current = database.authority.runs.get(root.envelope.runId);
        assert.ok(current);
        if (current.lifecycle.state === "terminal") return { run: current, outcomes };
        const { outcome } = await step(root, signal);
        outcomes.push(outcome);
        if (outcome.state !== "done" && outcome.state !== "yielded-delegation") return { run: database.authority.runs.get(root.envelope.runId), outcomes };
      }
    },
  };
}
