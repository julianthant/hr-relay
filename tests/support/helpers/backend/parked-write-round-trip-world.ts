import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { initialSettingsFileRecord } from "../../../../src/models/config/settings.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { runQueuedSpanEvent } from "../../../../src/backend/runs/commands/run-queued-span.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { CONFIG_SNAPSHOT } from "../../fixtures/phase1c-contract-fixtures.js";
import { testRunContinuation, testRunLifecycle, testWorkerPorts } from "../../fixtures/run-lifecycle-fixtures.js";
import assert from "node:assert/strict";
import { createBoundProfileFixture, boundProfileCredentials } from "../admission-fixture.js";
import { createCommandKernel, type CommandKernel } from "../../../../src/backend/runs/commands/command-kernel.js";
import { runWorkerLoop, type WorkerLoopReport } from "../../../../src/backend/runtime/workers/worker-loop.js";
import { createWriteResolutionExecutor } from "../../../../src/backend/runtime/writes/write-recovery.js";
import { createWriteSequencer, type WriteSequencerHooks } from "../../../../src/backend/runtime/writes/write-sequencer.js";
import { LOCAL_OPERATOR_ACTOR_ID, WorkerIdSchema, WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock, type TestClock } from "../../../../src/rules/time/clock.js";
import { type AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { NO_INTAKE_PROJECTIONS, UNWIRED_INTAKE_PARSER } from "../../fixtures/intake-kernel-seams.js";
import { sequentialIdFactory } from "../../fixtures/phase1f-run-fixtures.js";
import { absentProbeEvidence, buildWriteFixtureRegistry, createWriteFixtureWorld, WRITE_FIXTURE_IMPL_FINGERPRINT, WRITE_FIXTURE_KEY, WRITE_FIXTURE_NOW, WRITE_FIXTURE_WORKER_ID, WRITE_FIXTURE_WORKFLOW_ID, writeFixtureDescriptor, writeFixtureQueuedRun, writeFixtureSessions, type WriteFixtureWorld } from "../../fixtures/write-sequencer-fixtures.js";
import { duoCeremonyGatesOver } from "../duo-ceremony-fixtures.js";
import { ManualScheduler, recordingEmitter, recordingLogger } from "../phase1f-executor-harness.js";
import { AuthorityDatabase } from "../synthetic-storage-admission.js";

interface RoundTrip {
  readonly profile: Awaited<ReturnType<typeof createBoundProfileFixture>>;
  readonly database: AuthorityDatabase;
  readonly clock: TestClock;
  readonly world: WriteFixtureWorld;
  readonly kernel: CommandKernel;
  readonly park: (failCommit?: boolean) => Promise<WorkerLoopReport>;
  readonly resume: () => Promise<WorkerLoopReport>;
}



export function createParkedWriteRoundTripTestWorld() {
  const roots: string[] = [];
  const profiles = new Map<AuthorityDatabase, Awaited<ReturnType<typeof createBoundProfileFixture>>>();

  const openDatabases: AuthorityDatabase[] = [];

  async function roundTrip(resolutionDescriptor: AnyWorkflowDescriptor = writeFixtureDescriptor, resolutionHooks?: WriteSequencerHooks): Promise<RoundTrip> {
    const profile = await createBoundProfileFixture();
    roots.push(profile.workspace);
    const clock = manualClock(new Date(WRITE_FIXTURE_NOW));
    let database: AuthorityDatabase;
    try {
      database = AuthorityDatabase.open({ path: profile.path, busyTimeoutMs: 250, migrationOwner: "unit-test" },
        clock, undefined, undefined, undefined, boundProfileCredentials(profile.admission));
    } catch (error) {
      const failures: unknown[] = [error];
      try { await profile.close(); } catch (cleanupError) { failures.push(cleanupError); }
      if (failures.length > 1) throw new AggregateError(failures, "parked fixture opening cleanup failed", { cause: error });
      throw error;
    }
    profiles.set(database, profile);
    openDatabases.push(database);
    const resolved = resolveConfigWithProvenance(initialSettingsFileRecord().settings, hostConfigFacts({}), clock,
      { stateRoot: profile.stateRoot, artifactRoot: profile.admission.artifactRoot });
    const active = database.authority.runtimeConfig.initialize({ ...CONFIG_SNAPSHOT, config: resolved.config,
      fingerprint: resolved.fingerprint, provenance: resolved.provenance });

    const world = createWriteFixtureWorld();
    const stores = buildWriteFixtureRegistry(world);
    const sessions = writeFixtureSessions(world);
    const scheduler = new ManualScheduler(clock);
    const ids = sequentialIdFactory("c");
    const log = recordingLogger().log;
    const emitter = recordingEmitter().emitter;

    const kernel = createCommandKernel({
      lifecycle: new RunRecordService({ database: database, clock: clock, ids: sequentialIdFactory("e"), publishQueued: () => {} }),
      appVersion: "0.1.0",
      configIdentity: { configFingerprint: active.configFingerprint, configSnapshotId: active.configSnapshotId },
      intakeParser: UNWIRED_INTAKE_PARSER,
      intakeProjections: NO_INTAKE_PROJECTIONS,
      authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
      clock,
      ids: sequentialIdFactory("d"),
      descriptors: {
        resolve: (workflowId) => (workflowId === WRITE_FIXTURE_WORKFLOW_ID ? resolutionDescriptor : undefined),
      },
      // The deliverable's exact requirement: the SAME AuthorityDatabase instance
      // the kernel transacts on, so `commitWriteAttempt` nests as a savepoint.
      writeResolution: createWriteResolutionExecutor({
        hooks: resolutionHooks,
        continuation: testRunContinuation(database, clock),
        descriptors: {
          resolve: (workflowId) => (workflowId === WRITE_FIXTURE_WORKFLOW_ID ? resolutionDescriptor : undefined),
        },
        authority: database,
        ids,
        resolveImplFingerprint: () => WRITE_FIXTURE_IMPL_FINGERPRINT,
      }),
      workerRuntime: { pool: { planPoolWorkerCount: () => { throw new Error("unexpected worker command"); }, spawnPoolWorker: () => { throw new Error("unexpected worker command"); }, refreshPoolBrowser: () => { throw new Error("unexpected worker command"); }, reopenPoolBrowser: () => { throw new Error("unexpected worker command"); }, stopPoolWorker: () => { throw new Error("unexpected worker command"); }, pausePoolWorker: () => { throw new Error("unexpected worker command"); }, resumePoolWorker: () => { throw new Error("unexpected worker command"); } } },
    });

    const park = async (failCommit = true) => {
      const queued = RunRecordSchema.parse(writeFixtureQueuedRun());
      const run = RunRecordSchema.parse({ ...queued, envelope: { ...queued.envelope,
        configSnapshotId: active.configSnapshotId, configFingerprint: active.configFingerprint } });
      assert.equal(database.authority.runs.enqueue(run).state, "inserted");
      createTimelineEmitter({ repository: database.authority.timelineEvents, clock }).emit(
        runQueuedSpanEvent({ run, actorId: LOCAL_OPERATOR_ACTOR_ID, title: "Synthetic write-resolution rehearsal" }));
      // The write lands nowhere provable: probe says absent, then the click
      // throws AFTER the fence — the canonical post-fence unknown.
      world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
      if (failCommit) world.commitThrows = new Error("browser crashed mid-click");
      return resume();
    };
    const resume = () => runWorkerLoop({
        ...testWorkerPorts(database, clock, { path: profile.path, descriptor: writeFixtureDescriptor, poolIndex: 1 }),
        workflowId: WorkflowIdSchema.parse(WRITE_FIXTURE_WORKFLOW_ID),
        workerId: WorkerIdSchema.parse(WRITE_FIXTURE_WORKER_ID),
        descriptor: writeFixtureDescriptor,
        stores,
        authority: database,
        sessionFactory: sessions.factory,
        emitter,
        clock,
        ids,
        scheduler,
        taskDeadlineMs: 60_000,
        sessionAcquireMs: 20_000,
        duoCeremony: duoCeremonyGatesOver(database, clock, scheduler),
        heartbeatIntervalMs: 600_000,
        idleRepollMs: 1_000,
        log,
        stopSignal: new AbortController().signal,
        exitWhenIdle: true,
        writeSequencerFor: (manager) => createWriteSequencer({
          lifecycle: testRunLifecycle(database, clock),
          stores,
          authority: database,
          sessions: manager,
          emitter,
          clock,
          ids,
          scheduler,
          taskDeadlineMs: 60_000,
          operator: "local-operator",
          log,
          resolveImplFingerprint: () => WRITE_FIXTURE_IMPL_FINGERPRINT,
        }),
      });

    return { profile, database, clock, world, kernel, park, resume };
  }

  function parkedIntent(database: AuthorityDatabase) {
    const intent = database.authority.writeIntents.findByPermanentKey("ucpath", WRITE_FIXTURE_KEY);
    assert.ok(intent, "the fence must have created a permanent-key intent");
    return intent;
  }

  let commandSequence = 0;

  function nextCommandId(): string {
    commandSequence += 1;
    const tail = String(commandSequence).padStart(4, "0");
    return `cccccccc-${tail}-4000-8000-${tail}00000000`;
  }

  function resolutionCommand(
    type: "recheck-write" | "resolve-write-absent",
    target: Readonly<{
      runId: string;
      expectedVersion: number;
      writeIntentId: string;
      intentGeneration: number;
    }>,
    payload: Record<string, unknown>,
  ) {
    const database = openDatabases.at(-1); assert.ok(database);
    const intent = database.authority.writeIntents.get(target.writeIntentId); assert.ok(intent);
    assert.equal(intent.status, "parked"); if (intent.status !== "parked") throw new Error("fixture requires parked intent");
    return {
      commandId: nextCommandId(),
      requestedAt: WRITE_FIXTURE_NOW,
      requestedBy: "local-operator",
      source: "dashboard",
      family: "run",
      type,
      target: { ...target, writeAttemptId: intent.currentAttemptId, bindingProofDigest: intent.bindingProofDigest },
      payload: { ...payload, occurrenceKeyDigest: intent.idempotencyKeyDigest },
    };
  }
  async function cleanup(): Promise<void> {
    const failures: unknown[] = [];
    for (const database of openDatabases.splice(0)) {
      try { database.close(); await profiles.get(database)?.close(); profiles.delete(database); }
      catch (error) { failures.push(error); }
    }
    roots.splice(0);
    if (failures.length > 0) throw new AggregateError(failures, "parked write fixture cleanup failed");
  }
  return { roots, openDatabases, cleanup, roundTrip, parkedIntent, resolutionCommand, nextCommandId };
}
