import { testRunLifecycle,testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";

import assert from "node:assert/strict";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,describe,it } from "vitest";
import { buildRunPreviewResult } from "../../../../src/backend/runs/lifecycle/run-result.js";
import { runWorkerLoop } from "../../../../src/backend/runtime/workers/worker-loop.js";
import { createWriteSequencer } from "../../../../src/backend/runtime/writes/write-sequencer.js";
import { RunDryRunPreviewResultSchema } from "../../../../src/models/run/result.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { WorkerIdSchema,WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock,type TestClock } from "../../../../src/rules/time/clock.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import {
absentProbeEvidence,
buildWriteFixtureRegistry,
createWriteFixtureWorld,
WRITE_FIXTURE_IMPL_FINGERPRINT,
WRITE_FIXTURE_NODE_ID,
WRITE_FIXTURE_NOW,
WRITE_FIXTURE_RUN_ID,
WRITE_FIXTURE_WORKER_ID,
WRITE_FIXTURE_WORKFLOW_ID,
writeFixtureDescriptor,
writeFixtureQueuedRun,
writeFixtureSessions,
type WriteFixtureWorld
} from "../../../support/fixtures/write-sequencer-fixtures.js";
import { fixtureDuoCeremonyGates } from "../../../support/helpers/duo-ceremony-fixtures.js";
import {
type FinalizationHarness
} from "../../../support/helpers/kuali-finalization-fixtures.js";
import { ManualScheduler,recordingLogger,recordingTimelineEmitter } from "../../../support/helpers/phase1f-executor-harness.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

const roots: string[] = [];
const openDatabases: AuthorityDatabase[] = [];
const kualiOpen: FinalizationHarness[] = [];

afterEach(() => {
  for (const open of kualiOpen.splice(0)) open.dispose();
  for (const database of openDatabases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const PREVIEW_RESULT_SCHEMA_HASH = deriveSchemaHash(RunDryRunPreviewResultSchema, "output");

interface Harness {
  readonly database: AuthorityDatabase;
  readonly clock: TestClock;
  readonly world: WriteFixtureWorld;
  readonly emitter: ReturnType<typeof recordingTimelineEmitter>;
  readonly run: (options?: Readonly<{ dryRun?: boolean; probe?: unknown }>) => Promise<void>;
}

function harness(): Harness {
  const root = mkdtempSync(join(tmpdir(), "hrauto-dry-run-preview-"));
  roots.push(root);
  const clock = manualClock(new Date(WRITE_FIXTURE_NOW));
  const database = AuthorityDatabase.open(
    { path: join(root, "state.db"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
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
    const workerPorts = testWorkerPorts(database, clock, { path: join(root, "state.db"), descriptor: writeFixtureDescriptor, poolIndex: 1 });
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
      duoCeremony: fixtureDuoCeremonyGates(clock),
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

function terminalRun(database: AuthorityDatabase) {
  const record = database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
  assert.ok(record, "the run row must exist");
  return record;
}

describe("a dry run previews its transaction node and ends there", () => {

  it("refuses to build a preview result for a run the operator did not ask to preview", async () => {
    const h = harness();
    await h.run({ dryRun: false });

    // The run committed for real, so its terminal record is the derived result.
    const result = h.database.authority.runResults.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(result);
    assert.notEqual(result.resultSchemaHash, PREVIEW_RESULT_SCHEMA_HASH);


    assert.throws(
      () => buildRunPreviewResult(
        writeFixtureDescriptor,
        { ...terminalRun(h.database), completion: undefined, lifecycle: { state: "running", workerId: WRITE_FIXTURE_WORKER_ID,
          claimedAt: WRITE_FIXTURE_NOW, heartbeatAt: WRITE_FIXTURE_NOW } },
        {
          kind: "transaction-dry-run-preview",
          nodeId: WRITE_FIXTURE_NODE_ID,
          prepare: { schemaHash: "a".repeat(64), value: {} },
          subject: { state: "unscoped", reviewedReasonId: "unscoped" },
          observedAt: WRITE_FIXTURE_NOW,
        },
        [],
        h.clock,
      ),
      /is not a dry run; a preview result may not be built for it/,
    );
  });
});
