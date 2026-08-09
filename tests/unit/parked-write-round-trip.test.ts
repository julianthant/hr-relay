/**
 * The full parked-write round trip across every landed seam, with nothing
 * faked but the browser, clock, ids, timers, and span sink:
 *
 *   worker loop → interpreter → write sequencer parks after the fence
 *   → the interpreter's typed `parked-write` OUTCOME arm (never an escaping
 *     error, never a failure terminalization)
 *   → the durable run row is `parked-write` and the intent is `parked`
 *   → the command kernel's doc 09 §4.1 typed resolutions — executed by
 *     `createWriteResolutionExecutor` over the SAME AuthorityDatabase instance
 *     the kernel's transaction runs on
 *   → the run is resumable (`queued`, resuming AT the transaction node).
 *
 * The park is a post-fence indeterminate state, so the arms proven here are
 * exactly the ones that must never invent a terminal outcome.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { createCommandKernel, type CommandKernel } from "../../src/core/command-kernel.js";
import { runWorkerLoop, type WorkerLoopReport } from "../../src/core/worker-loop.js";
import { createWriteResolutionExecutor } from "../../src/core/write-recovery.js";
import { createWriteSequencer } from "../../src/core/write-sequencer.js";
import type { AnyWorkflowDescriptor } from "../../src/base/workflow.js";
import { manualClock, type TestClock } from "../../src/domain/clock.js";
import { WorkerIdSchema, WorkflowIdSchema } from "../../src/domain/ids.js";
import { deriveSchemaHash } from "../../src/domain/schema-bound-value.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import { ManualScheduler, recordingEmitter, recordingLogger } from "./fixtures/phase1f-executor-harness.js";
import { sequentialIdFactory } from "./fixtures/phase1f-run-fixtures.js";
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
  WriteFixtureProofSchema,
  writeFixtureDescriptor,
  writeFixtureDescriptorAfterUnrelatedEdit,
  writeFixtureDescriptorWithMovedKey,
  writeFixtureQueuedRun,
  writeFixtureSessions,
  type WriteFixtureWorld,
} from "./fixtures/write-sequencer-fixtures.js";
import { NO_INTAKE_PROJECTIONS, UNWIRED_INTAKE_PARSER } from "../fixtures/intake-kernel-seams.js";

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
  readonly park: () => Promise<WorkerLoopReport>;
}

/**
 * `resolutionDescriptor` is the build the OPERATOR resolves under, which is not
 * necessarily the build the run parked under: a parked write waits for a human,
 * and the tree moves meanwhile (D136).
 */
function roundTrip(resolutionDescriptor: AnyWorkflowDescriptor = writeFixtureDescriptor): RoundTrip {
  const root = mkdtempSync(join(tmpdir(), "hrauto-parked-write-"));
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
  const emitter = recordingEmitter().emitter;

  const kernel = createCommandKernel({
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
      descriptors: {
        resolve: (workflowId) => (workflowId === WRITE_FIXTURE_WORKFLOW_ID ? resolutionDescriptor : undefined),
      },
      authority: database,
      ids,
      resolveImplFingerprint: () => WRITE_FIXTURE_IMPL_FINGERPRINT,
    }),
    workerRuntime: {
      planWorkerCount: () => {
        throw new Error("unused in this suite");
      },
      spawnWorker: () => {
        throw new Error("unused in this suite");
      },
      refreshBrowser: () => {
        throw new Error("unused in this suite");
      },
      reopenBrowser: () => {
        throw new Error("unused in this suite");
      },
    },
  });

  const park = async () => {
    assert.equal(database.authority.runs.enqueue(writeFixtureQueuedRun()).state, "inserted");
    // The write lands nowhere provable: probe says absent, then the click
    // throws AFTER the fence — the canonical post-fence unknown.
    world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    world.commitThrows = new Error("browser crashed mid-click");
    return runWorkerLoop({
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
      heartbeatIntervalMs: 600_000,
      idleRepollMs: 1_000,
      log,
      stopSignal: new AbortController().signal,
      exitWhenIdle: true,
      writeSequencerFor: (manager) => createWriteSequencer({
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
  return {
    commandId: nextCommandId(),
    requestedAt: WRITE_FIXTURE_NOW,
    requestedBy: "local-operator",
    source: "dashboard",
    family: "run",
    type,
    target,
    payload,
  };
}

describe("post-fence park → typed outcome arm → typed operator resolution", () => {
  it("reports parked-write as a first-class outcome over the durable parked state", async () => {
    const harness = roundTrip();
    const report = await harness.park();

    assert.equal(report.stopped, "idle");
    assert.equal(report.outcomes.length, 1);
    const outcome = report.outcomes[0];
    assert.ok(outcome && outcome.state === "parked-write");
    assert.equal(outcome.runId, WRITE_FIXTURE_RUN_ID);
    assert.equal(outcome.code, "unknown");

    const intent = parkedIntent(harness.database);
    assert.equal(intent.status, "parked");
    assert.equal(outcome.writeIntentId, intent.writeIntentId);
    assert.equal(outcome.intentGeneration, intent.generation);

    const run = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(run && run.lifecycle.state === "parked-write");
    assert.equal(run.lifecycle.writeIntentId, intent.writeIntentId);
    assert.equal(run.lifecycle.code, "unknown");

    // Nothing terminal was invented: no failure record, no result, no outbox.
    assert.deepEqual(harness.database.authority.failures.listByRun(WRITE_FIXTURE_RUN_ID), []);
    assert.equal(harness.database.authority.runResults.get(WRITE_FIXTURE_RUN_ID), undefined);
    assert.equal(harness.database.authority.terminalAuthorizations.get(WRITE_FIXTURE_RUN_ID), undefined);
  });

  it("confirmed-absent makes the run resumable at the transaction node, intent retryable", async () => {
    const harness = roundTrip();
    await harness.park();
    const intent = parkedIntent(harness.database);
    const parked = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(parked);

    const result = harness.kernel.execute(resolutionCommand("resolve-write-absent", {
      runId: WRITE_FIXTURE_RUN_ID,
      expectedVersion: parked.version,
      writeIntentId: intent.writeIntentId,
      intentGeneration: intent.generation,
    }, { evidenceNote: "checked UCPath: no transaction exists for this key" }));
    assert.equal(result.state, "applied");

    const resumed = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(resumed && resumed.lifecycle.state === "queued");
    assert.equal(resumed.envelope.startAt, WRITE_FIXTURE_NODE_ID);
    assert.equal(
      harness.database.authority.writeIntents.get(intent.writeIntentId)?.status,
      "retryable",
    );
  });

  it("confirmed-present settles the same beat ⑦ bundle and resumes the run", async () => {
    const harness = roundTrip();
    await harness.park();
    const intent = parkedIntent(harness.database);
    const parked = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(parked);

    const result = harness.kernel.execute(resolutionCommand("resolve-write-present", {
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
    }));
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
  });

  /*
   * D136 — the stranded-intent path. This is the exact live shape recorded in
   * doc 09's Phase-2 as-built: an intent parked on 2026-08-04, then unrelated
   * work touched a file in the descriptor's ~31-file contract closure before
   * the operator got to it. Under the old whole-closure binding the typed
   * resolutions refused forever and the only way out was hand-editing rows or
   * restoring the tree; both arms must now go through.
   */
  it("resolves confirmed-absent after an unrelated edit moved the contract closure", async () => {
    const harness = roundTrip(writeFixtureDescriptorAfterUnrelatedEdit);
    await harness.park();
    const intent = parkedIntent(harness.database);
    const parked = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(parked);
    assert.notEqual(
      parked.envelope.contractFingerprint,
      writeFixtureDescriptorAfterUnrelatedEdit.contractFingerprint,
      "the fixture must actually model a moved closure",
    );

    const result = harness.kernel.execute(resolutionCommand("resolve-write-absent", {
      runId: WRITE_FIXTURE_RUN_ID,
      expectedVersion: parked.version,
      writeIntentId: intent.writeIntentId,
      intentGeneration: intent.generation,
    }, { evidenceNote: "five reads of an empty field; the mutation body carried no entry at the formKey" }));
    assert.equal(result.state, "applied", "an incidental closure move may not strand a parked write");

    assert.equal(harness.database.authority.writeIntents.get(intent.writeIntentId)?.status, "retryable");
    const resumed = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(resumed && resumed.lifecycle.state === "queued");
    assert.equal(resumed.envelope.startAt, WRITE_FIXTURE_NODE_ID);
    // The resolution releases the WRITE; it never re-plans the run. The run
    // keeps the contract identity it was enqueued under, so doc 02 §5.3's
    // replay binding stays exactly as strict as it was (see doc 09 §4.1).
    assert.equal(resumed.envelope.contractFingerprint, parked.envelope.contractFingerprint);
  });

  it("resolves confirmed-present after an unrelated edit moved the contract closure", async () => {
    const harness = roundTrip(writeFixtureDescriptorAfterUnrelatedEdit);
    await harness.park();
    const intent = parkedIntent(harness.database);
    const parked = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(parked);

    const result = harness.kernel.execute(resolutionCommand("resolve-write-present", {
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
    }));
    assert.equal(result.state, "applied");
    assert.equal(harness.database.authority.writeIntents.get(intent.writeIntentId)?.status, "committed");
  });

  it("still refuses loudly when the permanent key itself moved, naming the exact check", async () => {
    const harness = roundTrip(writeFixtureDescriptorWithMovedKey);
    await harness.park();
    const intent = parkedIntent(harness.database);
    const parked = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(parked);

    assert.throws(
      () => harness.kernel.execute(resolutionCommand("resolve-write-absent", {
        runId: WRITE_FIXTURE_RUN_ID,
        expectedVersion: parked.version,
        writeIntentId: intent.writeIntentId,
        intentGeneration: intent.generation,
      }, { evidenceNote: "checked the target system" })),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /permanent-key-identity moved/);
        assert.ok(error.message.includes(WRITE_FIXTURE_KEY), "the fenced key must be named");
        assert.ok(error.message.includes("[held]  transaction-node"), "held checks are shown too");
        return true;
      },
    );
    // Nothing moved: the park is exactly as it was.
    assert.equal(harness.database.authority.writeIntents.get(intent.writeIntentId)?.status, "parked");
    assert.equal(harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.lifecycle.state, "parked-write");
  });

  it("gives no arm but the typed resolutions any way out of a park", async () => {
    const harness = roundTrip(writeFixtureDescriptorAfterUnrelatedEdit);
    await harness.park();
    const parked = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(parked);

    const retry = harness.kernel.execute({
      commandId: nextCommandId(),
      requestedAt: WRITE_FIXTURE_NOW,
      requestedBy: "local-operator",
      source: "dashboard",
      family: "run",
      type: "retry",
      target: { runId: WRITE_FIXTURE_RUN_ID, expectedVersion: parked.version },
    });
    assert.equal(retry.state, "rejected");
    assert.equal(harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.lifecycle.state, "parked-write");
    assert.equal(parkedIntent(harness.database).status, "parked");
  });

  it("refuses a stale resolution against the parked generation", async () => {
    const harness = roundTrip();
    await harness.park();
    const intent = parkedIntent(harness.database);
    const parked = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(parked);

    const stale = harness.kernel.execute(resolutionCommand("resolve-write-absent", {
      runId: WRITE_FIXTURE_RUN_ID,
      expectedVersion: parked.version,
      writeIntentId: intent.writeIntentId,
      intentGeneration: intent.generation + 1,
    }, { evidenceNote: "stale browser tab" }));
    assert.equal(stale.state, "rejected");
    assert.equal(harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.lifecycle.state, "parked-write");
    assert.equal(harness.database.authority.writeIntents.get(intent.writeIntentId)?.status, "parked");
  });
});
