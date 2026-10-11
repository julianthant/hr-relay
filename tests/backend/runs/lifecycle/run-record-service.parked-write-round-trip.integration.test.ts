import { lifecycleCommandId,RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { CONFIG_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { testRunContinuation,testRunLifecycle,testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";

import assert from "node:assert/strict";
import { mkdtempSync,realpathSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,describe,it } from "vitest";
import { createCommandKernel,type CommandKernel } from "../../../../src/backend/runs/commands/command-kernel.js";
import { runWorkerLoop,type WorkerLoopReport } from "../../../../src/backend/runtime/workers/worker-loop.js";
import { createWriteResolutionExecutor } from "../../../../src/backend/runtime/writes/write-recovery.js";
import { createWriteSequencer,type WriteSequencerHooks } from "../../../../src/backend/runtime/writes/write-sequencer.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { WorkerIdSchema,WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock,type TestClock } from "../../../../src/rules/time/clock.js";
import type { AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { NO_INTAKE_PROJECTIONS,UNWIRED_INTAKE_PARSER } from "../../../support/fixtures/intake-kernel-seams.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import {
absentProbeEvidence,
buildWriteFixtureRegistry,
createWriteFixtureWorld,
WRITE_FIXTURE_IMPL_FINGERPRINT,
WRITE_FIXTURE_KEY,
WRITE_FIXTURE_NODE_ID,
WRITE_FIXTURE_NOW,
WRITE_FIXTURE_RUN_ID,
WRITE_FIXTURE_WORKER_ID,
WRITE_FIXTURE_WORKFLOW_ID,
writeFixtureDescriptor,
WriteFixtureProofSchema,
writeFixtureQueuedRun,
writeFixtureSessions,
type WriteFixtureWorld
} from "../../../support/fixtures/write-sequencer-fixtures.js";
import { fixtureDuoCeremonyGates } from "../../../support/helpers/duo-ceremony-fixtures.js";
import { ManualScheduler,recordingEmitter,recordingLogger } from "../../../support/helpers/phase1f-executor-harness.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

const roots: string[] = [];
const openDatabases: AuthorityDatabase[] = [];

afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface RoundTrip {
  readonly database: AuthorityDatabase;
  readonly clock: TestClock;
  readonly world: WriteFixtureWorld;
  readonly kernel: CommandKernel;
  readonly park: (failCommit?: boolean) => Promise<WorkerLoopReport>;
}

// Operator resolution may use a newer build than the build retained by the parked run.
function roundTrip(resolutionDescriptor: AnyWorkflowDescriptor = writeFixtureDescriptor, resolutionHooks?: WriteSequencerHooks): RoundTrip {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-parked-write-"));
  roots.push(root);
  const clock = manualClock(new Date(WRITE_FIXTURE_NOW));
  const database = AuthorityDatabase.open(
    { path: join(root, "state.db"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
    clock,
  );
  const active = database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  openDatabases.push(database);

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
    assert.equal(database.authority.runs.enqueue(writeFixtureQueuedRun()).state, "inserted");
    // The write lands nowhere provable: probe says absent, then the click
    // throws AFTER the fence — the canonical post-fence unknown.
    world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    if (failCommit) world.commitThrows = new Error("browser crashed mid-click");
    return runWorkerLoop({
      ...testWorkerPorts(database, clock, { path: join(root, "state.db"), descriptor: writeFixtureDescriptor, poolIndex: 1 }),
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
  };

  return { database, clock, world, kernel, park };
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
  type: "resolve-write-present" | "resolve-write-absent",
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

describe("post-fence park → typed outcome arm → typed operator resolution", () => {

  it("confirmed-present settles the same beat ⑦ bundle and resumes the run", async () => {
    const harness = roundTrip();
    await harness.park();
    const intent = parkedIntent(harness.database);
    const parked = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(parked);

    const command = resolutionCommand("resolve-write-present", {
      runId: WRITE_FIXTURE_RUN_ID,
      expectedVersion: parked.version,
      writeIntentId: intent.writeIntentId,
      intentGeneration: intent.generation,
    }, {
      proof: {
        schemaHash: deriveSchemaHash(WriteFixtureProofSchema, "output"),
        value: { transactionId: "T998877" },
      },
      evidenceNote: "receipt T998877 is visible in UCPath",
    });
    const result = harness.kernel.execute(command);
    assert.equal(result.state, "applied");

    const settled = harness.database.authority.writeIntents.get(intent.writeIntentId);
    assert.ok(settled && settled.status === "committed");
    const resumed = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(resumed && resumed.lifecycle.state === "queued");
    assert.equal(resumed.envelope.startAt, WRITE_FIXTURE_NODE_ID);
    // The operator attestation is durable as the node's transaction outcome.
    const checkpoint = harness.database.authority.runCheckpoints.latest(
      WRITE_FIXTURE_WORKFLOW_ID,
      parked.envelope.itemId,
      WRITE_FIXTURE_NODE_ID,
    );
    assert.ok(checkpoint);
    const nestedId = lifecycleCommandId("operator-present", command.commandId);
    assert.notEqual(nestedId, command.commandId);
    assert.ok(harness.database.authority.commands.get(command.commandId));
    const nested = harness.database.authority.lifecycleJournal.getCommand(nestedId);
    assert.ok(nested && "kind" in nested && nested.kind === "run-lifecycle");
    const generation = harness.database.getMeta().authorityGeneration;
    assert.equal(harness.kernel.execute(command).state, "already-applied");
    assert.equal(harness.database.getMeta().authorityGeneration, generation);
  });
});
