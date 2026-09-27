import { createTimelineEmitter } from "../../../src/infra/events/timeline-emitter.js";
import { readTimelineRecords } from "../../../src/infra/events/timeline-reader.js";
import type { TaskStoreRegistry } from "../../../src/base/store.js";
import type { WriteFixtureWorld } from "./write-sequencer-fixtures.js";
import type { AnyWorkflowDescriptor } from "../../../src/base/workflow.js";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCommandKernel } from "../../../src/core/command-kernel.js";
import { RunRecordService, workerRunLifecyclePort, runContinuationPort, requireLifecycleApplied } from "../../../src/core/run-record-service.js";
import { executeClaimedRun } from "../../../src/core/run-executor.js";
import { createWriteSequencer } from "../../../src/core/write-sequencer.js";
import { createWriteResolutionExecutor, createWriteRecoveryService } from "../../../src/core/write-recovery.js";
import { withBoundRunConfigFingerprint } from "../../../src/core/worker-sessions.js";
import { manualClock } from "../../../src/domain/clock.js";
import { ActorIdSchema, WorkerIdSchema } from "../../../src/domain/ids.js";
import type { StartPlanWire } from "../../../src/domain/dashboard/start-plan.js";
import type { RunRecord } from "../../../src/domain/run/record.js";
import { AuthorityDatabase } from "../../helpers/synthetic-storage-admission.js";
import { createStartPlanService } from "../../../src/server/dashboard/commands/start-plan-service.js";
import { runQueuedSpanEvent } from "../../../src/server/dashboard/commands/run-queued-span.js";
import { NO_INTAKE_PROJECTIONS, UNSTORED_CONFIG_IDENTITY, UNWIRED_INTAKE_PARSER } from "../../fixtures/intake-kernel-seams.js";
import { UNWIRED_ARCHIVE_SNAPSHOTS } from "../../fixtures/archive-fixtures.js";
import { HASH_B, UUID_4, NOW } from "../../fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../fixtures/phase1f-run-fixtures.js";
import { ManualScheduler, recordingEmitter, recordingLogger } from "../../helpers/phase1f-executor-harness.js";
import { seedSyntheticRuntimeConfig, singleAppliedRunId } from "../../fixtures/operator-command-fixtures.js";
import { writeFixtureDescriptor, createWriteFixtureWorld, buildWriteFixtureRegistry, writeFixtureSessions,
  writeFixtureSessionManager, WRITE_FIXTURE_IMPL_FINGERPRINT, WRITE_FIXTURE_EID } from "./write-sequencer-fixtures.js";

export function sourceBoundHarness(descriptor: AnyWorkflowDescriptor = writeFixtureDescriptor, customStores?: (world: WriteFixtureWorld) => TaskStoreRegistry) {
  const root = mkdtempSync(join(tmpdir(), "hrauto-source-bound-"));
  const clock = manualClock(new Date(NOW));
  const database = AuthorityDatabase.open({ path: join(root, "authority.sqlite"), busyTimeoutMs: 250, migrationOwner: "repeat-proof" }, clock);
  seedSyntheticRuntimeConfig(database);
  const descriptors = { resolve: (workflow: string) => workflow === descriptor.id ? descriptor : undefined };
  const ids = sequentialIdFactory("c");
  const planIds = sequentialIdFactory("b");
  const lifecycleIds = sequentialIdFactory("a");
  const timeline = createTimelineEmitter({ repository: database.authority.timelineEvents, clock });
  const lifecycle = new RunRecordService({ database, clock, ids: lifecycleIds, publishQueued: (run, publication) => {
    assert.ok(database.authority.runs.get(run.envelope.runId), "publication sees the run inside its owning transaction");
    assert.ok(publication, "every command creation supplies presentation");
    timeline.emit(runQueuedSpanEvent({ run, ...publication, actorId: ActorIdSchema.parse(publication.actorId) }));
  } });
  const resolution = createWriteResolutionExecutor({ continuation: runContinuationPort(lifecycle), descriptors,
    authority: database, ids, resolveImplFingerprint: () => WRITE_FIXTURE_IMPL_FINGERPRINT });
  const unused = () => { throw new Error("unrequested runtime operation"); };
  const kernel = createCommandKernel({ lifecycle, appVersion: "0.1.0", authority: database, clock, ids, descriptors,
    archiveSnapshots: UNWIRED_ARCHIVE_SNAPSHOTS, configIdentity: UNSTORED_CONFIG_IDENTITY,
    intakeParser: UNWIRED_INTAKE_PARSER, intakeProjections: NO_INTAKE_PROJECTIONS, writeResolution: resolution,
    workerRuntime: { planWorkerCount: unused, spawnWorker: unused, refreshBrowser: unused, reopenBrowser: unused },
  });
  const planner = createStartPlanService({ authority: database, authorityRead: database, descriptors, clock,
    ids: planIds, planTtlMs: 600_000, configFingerprint: HASH_B, configSnapshotId: UUID_4, plannedBy: "local-operator" });
  const world = createWriteFixtureWorld();
  const stores = customStores === undefined ? buildWriteFixtureRegistry(world) : customStores(world);
  const sessions = writeFixtureSessions(world);
  const manager = writeFixtureSessionManager(sessions, stores, clock);
  const emitter = recordingEmitter();
  const worker = workerRunLifecyclePort(lifecycle);
  const common = { lifecycle: worker, stores, authority: database, sessions: manager, emitter: emitter.emitter,
    clock, ids, scheduler: new ManualScheduler(clock), taskDeadlineMs: 60_000, log: recordingLogger().log };
  const sequencer = createWriteSequencer({ ...common, operator: "local-operator", resolveImplFingerprint: () => WRITE_FIXTURE_IMPL_FINGERPRINT });
  const recovery = createWriteRecoveryService({ ...common, continuation: runContinuationPort(lifecycle), operator: "local-operator",
    resolveImplFingerprint: () => WRITE_FIXTURE_IMPL_FINGERPRINT });
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
    const active = database.authority.runtimeConfig.get(); assert.ok(active);
    const claimed = requireLifecycleApplied(lifecycle.claimNext({ commandId: ids.uuid(), workflow: descriptor.id,
      workerId: "repeat-worker", runtimeConfig: { generation: active.generation, settingsRevision: active.settingsRevision,
        settingsFingerprint: active.settingsFingerprint, configFingerprint: active.configFingerprint } }));
    assert.equal(claimed.envelope.runId, run.envelope.runId);
    return withBoundRunConfigFingerprint(manager, claimed.envelope.configFingerprint, () => executeClaimedRun({ ...common, descriptor, writeSequencer: sequencer }, {
      run: claimed, claim: { workerId: WorkerIdSchema.parse("repeat-worker"), claimGeneration: claimed.claimGeneration }, signal: new AbortController().signal,
    }));
  }
  function fresh(run: RunRecord) { const value = database.authority.runs.get(run.envelope.runId); assert.ok(value); return value; }
  return { database, descriptor, clock, ids, lifecycleIds, planIds, get queueRoots() {
    return readTimelineRecords(database.authority.timelineEvents).records.flatMap((record) =>
      record.payload.kind === "span" && record.payload.event.t === "run.queued" ? [record.payload.event] : []);
  }, lifecycle, kernel, planner, world, stores, manager,
    proposal, command, start, execute, fresh, resolution, recovery,
    dispose: () => { database.close(); rmSync(root, { recursive: true, force: true }); } };
}
