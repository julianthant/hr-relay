import { testRunLifecycle, testWorkerPorts } from "../../fixtures/run-lifecycle-fixtures.js";
import assert from "node:assert/strict";
import { createBoundProfileFixture } from "../admission-fixture.js";
import { runWorkerLoop } from "../../../../src/backend/runtime/workers/worker-loop.js";
import { createWriteSequencer } from "../../../../src/backend/runtime/writes/write-sequencer.js";
import { RunDryRunPreviewResultSchema } from "../../../../src/models/run/result.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { WorkerIdSchema, WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock, type TestClock } from "../../../../src/rules/time/clock.js";
import { sequentialIdFactory } from "../../fixtures/phase1f-run-fixtures.js";
import { absentProbeEvidence, buildWriteFixtureRegistry, createWriteFixtureWorld, WRITE_FIXTURE_IMPL_FINGERPRINT, WRITE_FIXTURE_NOW, WRITE_FIXTURE_WORKER_ID, WRITE_FIXTURE_WORKFLOW_ID, writeFixtureDescriptor, writeFixtureQueuedRun, writeFixtureSessions, type WriteFixtureWorld } from "../../fixtures/write-sequencer-fixtures.js";
import { duoCeremonyGatesOver } from "../duo-ceremony-fixtures.js";
import { type FinalizationHarness } from "../kuali-finalization-fixtures.js";
import { ManualScheduler, recordingLogger, recordingTimelineEmitter } from "../phase1f-executor-harness.js";
import { AuthorityDatabase } from "../synthetic-storage-admission.js";

interface Harness {
  readonly database: AuthorityDatabase;
  readonly clock: TestClock;
  readonly world: WriteFixtureWorld;
  readonly emitter: ReturnType<typeof recordingTimelineEmitter>;
  readonly run: (options?: Readonly<{ dryRun?: boolean; probe?: unknown }>) => Promise<void>;
}



export function createDryRunPreviewResultTestWorld() {
  const roots: string[] = [];
  const profiles: Awaited<ReturnType<typeof createBoundProfileFixture>>[] = [];

  const openDatabases: AuthorityDatabase[] = [];

  const kualiOpen: FinalizationHarness[] = [];

  const PREVIEW_RESULT_SCHEMA_HASH = deriveSchemaHash(RunDryRunPreviewResultSchema, "output");

  async function harness(): Promise<Harness> {
    const profile = await createBoundProfileFixture(); profiles.push(profile);
    roots.push(profile.stateRoot);
    const clock = manualClock(new Date(WRITE_FIXTURE_NOW));
    const database = AuthorityDatabase.open(
      { path: profile.path, busyTimeoutMs: 250, migrationOwner: "unit-test" },
      clock,
    );
    openDatabases.push(database);

    const world = createWriteFixtureWorld();
    const stores = buildWriteFixtureRegistry(world);
    const sessions = writeFixtureSessions(world);
    const scheduler = new ManualScheduler(clock);
    const ids = sequentialIdFactory("c");
    const log = recordingLogger().log;
    const emitter = recordingTimelineEmitter(database, clock);

    const run = async (options: Readonly<{ dryRun?: boolean; probe?: unknown }> = {}): Promise<void> => {
      const dryRun = options.dryRun ?? true;
      const workerPorts = testWorkerPorts(database, clock, { path: profile.path, descriptor: writeFixtureDescriptor, poolIndex: 1 });
      assert.equal(database.authority.runs.enqueue(writeFixtureQueuedRun({ dryRun })).state, "inserted");

      world.probeResults.push(options.probe ?? absentProbeEvidence(WRITE_FIXTURE_NOW));
      await runWorkerLoop({
        ...workerPorts,
        workflowId: WorkflowIdSchema.parse(WRITE_FIXTURE_WORKFLOW_ID),
        workerId: WorkerIdSchema.parse(WRITE_FIXTURE_WORKER_ID),
        descriptor: writeFixtureDescriptor,
        stores,
        authority: database,
        sessionFactory: sessions.factory,
        emitter: emitter.emitter,
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
          emitter: emitter.emitter,
          clock,
          ids,
          scheduler,
          taskDeadlineMs: 60_000,
          operator: "local-operator",
          log,
          resolveImplFingerprint: () => WRITE_FIXTURE_IMPL_FINGERPRINT,
        }),
      });
    };

    return { database, clock, world, emitter, run };
  }
  const cleanup = async () => {
    for (const open of kualiOpen.splice(0)) await open.dispose();
    for (const database of openDatabases.splice(0)) database.close();
    for (const profile of profiles.splice(0)) await profile.close();
    roots.splice(0);
  };
  return { roots, openDatabases, kualiOpen, PREVIEW_RESULT_SCHEMA_HASH, harness, cleanup };
}
