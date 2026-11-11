import { unusedWorkerPool } from "../../helpers/backend/unused-worker-pool.js";
import { retainAuthoritySourceClosure } from '../../../../src/backend/storage/source-closure.js';
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { readTimelineRecords } from "../../../../src/backend/storage/events/timeline-reader.js";
import type { TaskStoreRegistry } from "../../../../src/workflow-kit/task-registry.js";
import type { ProtectedSecretSource } from "../../../../src/models/config/secrets.js";
import type { WriteFixtureWorld } from "../write-sequencer-fixtures.js";
import { bindWorkflowDelegationTargets, workflowProjections, type AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { testAdmittedWorker } from '../run-lifecycle-fixtures.js';
import assert from "node:assert/strict";

import { createBoundProfileFixture, type BoundProfileStorageFixture } from "../../helpers/admission-fixture.js";
import { duoCeremonyGatesOver } from "../../helpers/duo-ceremony-fixtures.js";
import { createCommandKernel, type CommandKernelDependencies } from "../../../../src/backend/runs/commands/command-kernel.js";
import { RunRecordService, workerRunLifecyclePort, runContinuationPort, requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { executeClaimedRun } from "../../../../src/backend/runtime/execution/run-executor.js";
import { createDurableChildRunExecutor } from "../../../../src/backend/runtime/execution/durable-child-executor.js";
import { createWriteSequencer } from "../../../../src/backend/runtime/writes/write-sequencer.js";
import { createWriteResolutionExecutor, createWriteRecoveryService } from "../../../../src/backend/runtime/writes/write-recovery.js";
import { withBoundRunConfigFingerprint } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import { manualClock, type Clock } from "../../../../src/rules/time/clock.js";
import { ActorIdSchema, WorkerIdSchema } from "../../../../src/rules/identity/ids.js";
import type { StartPlanWire } from "../../../../src/models/dashboard/start-plan.js";
import type { RunRecord } from "../../../../src/models/run/record.js";
import { AuthorityDatabase } from "../../helpers/synthetic-database-admission.js";
import { createStartPlanService } from "../../../../src/backend/runs/commands/start-plan-service.js";
import { runQueuedSpanEvent } from "../../../../src/backend/runs/commands/run-queued-span.js";
import { NO_INTAKE_PROJECTIONS, UNSTORED_CONFIG_IDENTITY, UNWIRED_INTAKE_PARSER } from "../intake-kernel-seams.js";
import { NOW } from "../phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../phase1f-run-fixtures.js";
import { ManualScheduler, recordingEmitter, recordingLogger } from "../../helpers/phase1f-executor-harness.js";
import { seedSyntheticRuntimeConfig, singleAppliedRunId } from "../operator-command-fixtures.js";
import { writeFixtureDescriptor, createWriteFixtureWorld, buildWriteFixtureRegistry, writeFixtureSessions,
  writeFixtureSessionManager, WRITE_FIXTURE_EID } from "../write-sequencer-fixtures.js";

const retainedSourceBoundFixtureOwners = new Set<object>();

export async function sourceBoundHarness(descriptor: AnyWorkflowDescriptor = writeFixtureDescriptor, customStores?: (world: WriteFixtureWorld) => TaskStoreRegistry, initializeRuntime: (database: AuthorityDatabase, clock: Clock) => void = seedSyntheticRuntimeConfig, protectedSecrets?: ProtectedSecretSource,
  profileFixture: () => Promise<BoundProfileStorageFixture> = createBoundProfileFixture,
  childDescriptors: readonly AnyWorkflowDescriptor[] = [],
  commandNotices?: CommandKernelDependencies["commandNotices"],
  durableSpans = false) {
  bindWorkflowDelegationTargets([descriptor, ...childDescriptors]);
  const held: { profile?: BoundProfileStorageFixture; database?: AuthorityDatabase; worker?: ReturnType<typeof testAdmittedWorker>; primary?: unknown } = {};
  retainedSourceBoundFixtureOwners.add(held);
  try {
  const profile = await profileFixture();
  held.profile = profile;

  const clock = manualClock(new Date(NOW));
  const database = AuthorityDatabase.open({ path: profile.path, busyTimeoutMs: 250, migrationOwner: "repeat-proof" }, clock);
  held.database = database;
  initializeRuntime(database, clock);
  const activeConfig = database.authority.runtimeConfig.get();
  assert.ok(activeConfig);
  let registeredDescriptor = descriptor;
  const descriptors = { resolve: (workflow: string) => workflow === registeredDescriptor.id ? registeredDescriptor : childDescriptors.find(child => child.id === workflow) };
  const ids = sequentialIdFactory("c");
  const planIds = sequentialIdFactory("b");
  const lifecycleIds = sequentialIdFactory("a");
  const admitted = testAdmittedWorker(database, clock, { path: profile.path, workflow: descriptor.id,
    poolIndex: 1, browserSystems: workflowProjections(descriptor).systems });
  held.worker = admitted;
  const slot = admitted.member;
  const timeline = createTimelineEmitter({ repository: database.authority.timelineEvents, clock });
  const lifecycle = new RunRecordService({ database, clock, ids: lifecycleIds, resolveDescriptor: descriptors.resolve, publishQueued: (run, publication) => {
    assert.ok(database.authority.runs.get(run.envelope.runId), "publication sees the run inside its owning transaction");
    assert.ok(publication, "every command creation supplies presentation");
    timeline.emit(runQueuedSpanEvent({ run, ...publication, actorId: ActorIdSchema.parse(publication.actorId) }));
  } });
  const resolution = createWriteResolutionExecutor({ continuation: runContinuationPort(lifecycle), descriptors,
    authority: database, ids  });
  const unused = () => { throw new Error("unrequested runtime operation"); };
  const kernel = createCommandKernel({ lifecycle, appVersion: "0.1.0", authority: database, clock, ids, descriptors,
    configIdentity: UNSTORED_CONFIG_IDENTITY,
    intakeParser: UNWIRED_INTAKE_PARSER, intakeProjections: NO_INTAKE_PROJECTIONS, writeResolution: resolution,
    workerRuntime: {pool:unusedWorkerPool(unused)},
    ...(commandNotices === undefined ? {} : { commandNotices }),
  });
  const planner = createStartPlanService({ authority: database, authorityRead: database, descriptors, clock,
    ...(protectedSecrets === undefined ? {} : { protectedSecrets }),
    ids: planIds, planTtlMs: 600_000, configFingerprint: activeConfig.configFingerprint, configSnapshotId: activeConfig.configSnapshotId, plannedBy: "local-operator" });
  const world = createWriteFixtureWorld();
  const stores = customStores === undefined ? buildWriteFixtureRegistry(world) : customStores(world);
  const sessions = writeFixtureSessions(world);
  const manager = await writeFixtureSessionManager(sessions, stores, clock, duoCeremonyGatesOver(database, clock, new ManualScheduler(clock)));
  const executionOwners = new Map([[descriptor.id, { slot, manager }]]);
  for (const child of childDescriptors) {
    const owner = testAdmittedWorker(database, clock, { path: profile.path, workflow: child.id, poolIndex: 1,
      browserSystems: workflowProjections(child).systems });
    const childManager = await writeFixtureSessionManager(sessions, stores, clock, duoCeremonyGatesOver(database, clock, new ManualScheduler(clock)));
    childManager.configureExecution(child.id, stores);
    executionOwners.set(child.id, { slot: owner.member, manager: childManager });
  }
  // Delegation admission reads a dependency's `data.observed` spans back from the timeline.
  const emitter = durableSpans ? timeline : recordingEmitter().emitter;
  const worker = workerRunLifecyclePort(lifecycle);
  const common = { lifecycle: worker, stores, authority: database, sessions: manager, emitter,
    childRuns: createDurableChildRunExecutor({ authority: database, admission: { admitAndRelease: (context, plan) => lifecycle.admitDelegation(context, plan) },
      resolveTarget: id => { const target = descriptors.resolve(id); if (target === undefined) throw new Error("fixture-child-descriptor-missing"); return target; } }),
    clock, ids, scheduler: new ManualScheduler(clock), taskDeadlineMs: 60_000, log: recordingLogger().log };
  const sequencer = createWriteSequencer({ ...common, operator: "local-operator"  });
  const recovery = createWriteRecoveryService({ ...common, continuation: runContinuationPort(lifecycle), operator: "local-operator"  });
  function proposal(source?: RunRecord, acknowledgment?: string, dryRun = false, eid = WRITE_FIXTURE_EID, memo?: string) {
    const selectedStepKeys = descriptor.timeline.map((step) => step.key);
    return planner.plan({ workflowId: descriptor.id, submissions: [{ eid, ...(memo === undefined ? {} : { memo }) }], dryRun, selectedStepKeys,
      ...(source === undefined ? {} : { rerunSource: { runId: source.envelope.runId, expectedVersion: source.version,
        intent: "rerun", selectedStepKeys } }),
      ...(acknowledgment === undefined ? {} : { warningAcknowledgment: acknowledgment }) });
  }
  function command(plan: StartPlanWire) {
    return { commandId: ids.uuid(), requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard",
      family: "start", type: "start-run", target: { workflowId: descriptor.id, startPlanId: plan.startPlanId, expectedVersion: plan.expectedVersion },
      payload: plan.fingerprints };
  }
  function start(plan: StartPlanWire) {
    const result = kernel.execute(command(plan));
    const run = database.authority.runs.get(singleAppliedRunId(result));
    assert.ok(run); return run;
  }
  async function execute(run: RunRecord) {
    let root = run;
    const visited = new Set<string>();
    while (root.envelope.parent !== undefined) {
      assert.ok(visited.size < 32 && !visited.has(root.envelope.runId), "fixture child ancestry must be bounded and exact");
      visited.add(root.envelope.runId);
      const parent = database.authority.runs.get(root.envelope.parent.runId); assert.ok(parent);
      root = parent;
    }
    const home = executionOwners.get(root.envelope.workflow); assert.ok(home);
    const execution = executionOwners.get(run.envelope.workflow); assert.ok(execution);
    const { slot } = home, { manager } = execution;
    const target = descriptors.resolve(run.envelope.workflow); assert.ok(target);
    manager.configureExecution(target.id, stores);
    const active = database.authority.runtimeConfig.get(); assert.ok(active);
    const claimed = requireLifecycleApplied(lifecycle.claimNext({ commandId: ids.uuid(), workflow: root.envelope.workflow,
      workerId: slot.workerId, runtimeConfig: { generation: active.generation, settingsRevision: active.settingsRevision,
        settingsFingerprint: active.settingsFingerprint, configFingerprint: active.configFingerprint } }));
    assert.equal(claimed.envelope.runId, run.envelope.runId);
    const executing = descriptors.resolve(claimed.envelope.workflow); assert.ok(executing);
    return withBoundRunConfigFingerprint(manager, claimed.envelope.configFingerprint, () => executeClaimedRun({ ...common, sessions: manager, descriptor: executing, writeSequencer: sequencer }, {
      run: claimed, claim: { workerId: WorkerIdSchema.parse(slot.workerId), claimGeneration: claimed.claimGeneration }, signal: new AbortController().signal,
    }), claimed.envelope.browserMode, { runId: claimed.envelope.runId, descriptorFingerprint: claimed.envelope.contractFingerprint });
  }
  function fresh(run: RunRecord) { const value = database.authority.runs.get(run.envelope.runId); assert.ok(value); return value; }
  let disposeAttempted = false, disposeFailure: Error | undefined;
  retainedSourceBoundFixtureOwners.delete(held);
  return { profile, authorityPath:profile.path,database, get descriptor() { return registeredDescriptor; },
    registerDescriptor(next: AnyWorkflowDescriptor) {
      bindWorkflowDelegationTargets([next, ...childDescriptors]);
      registeredDescriptor = next;
    }, clock, ids, lifecycleIds, planIds, get queueRoots() {
    return readTimelineRecords(database.authority.timelineEvents).records.flatMap((record) =>
      record.payload.kind === "span" && record.payload.event.t === "run.queued" ? [record.payload.event] : []);
  }, lifecycle, kernel, planner, world, stores, manager,
    proposal, command, start, execute, fresh, resolution, recovery,
    dispose: async () => {
      if (disposeAttempted) { if (disposeFailure !== undefined) throw disposeFailure; return; }
      disposeAttempted = true;
      try { database.close(); await profile.close(); }
      catch (error) {
        held.primary = error;
        disposeFailure = retainAuthoritySourceClosure([error], { admission: held });
        retainedSourceBoundFixtureOwners.add(held);
        throw disposeFailure;
      }
    } };

  } catch (error) { held.primary = error; throw retainAuthoritySourceClosure([error], { admission: held }); }
}
