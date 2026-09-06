import { RunRecordService } from "../../src/core/run-record-service.js";
import { lifecycleCommandId } from "../../src/core/run-record-service.js";
import { testRunContinuation, testRunLifecycle, testWorkerPorts } from "./fixtures/run-lifecycle-fixtures.js";
/**
 * The full parked-write round trip across every landed seam, with nothing
 * faked but the browser, clock, ids, timers, and span sink:
 *
 *   worker loop → interpreter → write sequencer parks after the fence
 *   → the interpreter's typed `parked-write` OUTCOME arm (never an escaping
 *     error, never a failure terminalization)
 *   → the durable run row is `parked-write` and the intent is `parked`
 *   → the command kernel's ref write-safety §4.1 typed resolutions — executed by
 *     `createWriteResolutionExecutor` over the SAME AuthorityDatabase instance
 *     the kernel's transaction runs on
 *   → the run is resumable (`queued`, resuming AT the transaction node).
 *
 * The park is a post-fence indeterminate state, so the arms proven here are
 * exactly the ones that must never invent a terminal outcome.
 */
import { fixtureDuoCeremonyGates } from "./fixtures/duo-ceremony-fixtures.js";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { createCommandKernel, type CommandKernel } from "../../src/core/command-kernel.js";
import { runWorkerLoop, type WorkerLoopReport } from "../../src/core/worker-loop.js";
import { createWriteResolutionExecutor } from "../../src/core/write-recovery.js";
import { createWriteSequencer, type WriteSequencerHooks } from "../../src/core/write-sequencer.js";
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
  WRITE_FIXTURE_KEY_DIGEST,
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
import { NO_INTAKE_PROJECTIONS, UNSTORED_CONFIG_IDENTITY, UNWIRED_INTAKE_PARSER } from "../fixtures/intake-kernel-seams.js";
import { UNWIRED_ARCHIVE_SNAPSHOTS } from "./fixtures/archive-fixtures.js";

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
function roundTrip(resolutionDescriptor: AnyWorkflowDescriptor = writeFixtureDescriptor, resolutionHooks?: WriteSequencerHooks): RoundTrip {
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
    lifecycle: new RunRecordService({ database: database, clock: clock, ids: sequentialIdFactory("e"), publishQueued: () => {} }),
    appVersion: "0.1.0",
    archiveSnapshots: UNWIRED_ARCHIVE_SNAPSHOTS,
    configIdentity: UNSTORED_CONFIG_IDENTITY,
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
      ...testWorkerPorts(database, clock),
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
    const nestedId = lifecycleCommandId("write-resume-queued", { runId: WRITE_FIXTURE_RUN_ID,
      expectedVersion: parked.version, writeIntentId: intent.writeIntentId, generation: intent.generation,
      sourceCommandId: command.commandId });
    assert.notEqual(nestedId, command.commandId);
    assert.ok(harness.database.authority.commands.get(command.commandId));
    const nested = harness.database.authority.lifecycleJournal.getCommand(nestedId);
    assert.ok(nested && "kind" in nested && nested.kind === "run-lifecycle");
    const generation = harness.database.getMeta().authorityGeneration;
    assert.equal(harness.kernel.execute(command).state, "already-applied");
    assert.equal(harness.database.getMeta().authorityGeneration, generation);
  });

  /*
   * D136 — the stranded-intent path. This is the exact live shape recorded in
   * ref write-safety's Phase-2 as-built: an intent parked on 2026-08-04, then unrelated
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
    // keeps the contract identity it was enqueued under, so ref workflow-model §5.3's
    // replay binding stays exactly as strict as it was (see ref write-safety §4.1).
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
        assert.equal(error.message.includes(WRITE_FIXTURE_KEY), false, "the fenced natural key is authority-only");
        assert.ok(
          error.message.includes(WRITE_FIXTURE_KEY_DIGEST.slice(0, 12)),
          "the fenced digest reference must be named",
        );
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

/**
 * D245 — a confirmed-present proof that does not fit is an ORDINARY ANSWER, so
 * it comes back as a typed `rejected` the dialog can print with a code, not as
 * an escaping error the dialog can only describe as a transport failure.
 * `executeResolveGate` has answered `schema-mismatch` for the identical
 * situation one command over since the gate landed.
 *
 * Both cases assert the same second thing: the refusal unwound everything. A
 * parked write that refuses a bad answer must still be parked, at the same
 * generation, on the same run version.
 */
describe("a confirmed-present proof that does not fit (ref write-safety §4.1, D245)", () => {
  async function refusedPresent(payload: Record<string, unknown>) {
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
    }, payload));
    const after = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(after && after.lifecycle.state === "parked-write", "the park survived the refusal");
    assert.equal(after.version, parked.version);
    const settled = harness.database.authority.writeIntents.get(intent.writeIntentId);
    assert.ok(settled && settled.status === "parked");
    assert.equal(settled.generation, intent.generation);
    return result;
  }

  it("rejects a proof bound to a schema this build does not have", async () => {
    const result = await refusedPresent({
      proof: { schemaHash: "1".repeat(64), value: { transactionId: "T998877" } },
      evidenceNote: "pasted from a stale tab",
    });
    assert.ok(result.state === "rejected");
    assert.equal(result.code, "schema-mismatch");
    assert.match(result.message, /bound to schema/);
  });

  it("rejects a proof that does not parse, naming the leaf that failed", async () => {
    const result = await refusedPresent({
      proof: {
        schemaHash: deriveSchemaHash(WriteFixtureProofSchema, "output"),
        // The contract's receipt is `T` + at least six digits.
        value: { transactionId: "nope" },
      },
      evidenceNote: "typed what the page showed",
    });
    assert.ok(result.state === "rejected");
    assert.equal(result.code, "schema-mismatch");
    assert.match(result.message, /does not parse through/);
    assert.match(result.message, /transactionId/);
  });
});

/**
 * D246. The record this closes read: *"Cancelling a parked-write run strands
 * the intent with no exit."* Ref write-safety §4.1's "cancel cannot alter the intent" was
 * honoured exactly — and the cancel still took both resolutions away with it,
 * because a terminal run serves no parked-write section and
 * `executeWriteResolution` refuses every lifecycle but `parked-write`.
 *
 * Every case here asserts the same two things after the refusal: NOTHING moved
 * (the run is still parked, the intent still unresolved) and the refusal names
 * the intent, so an operator reading it knows which write to go answer.
 */
describe("cancel over an unresolved fenced write (ref write-safety §4.1, D246)", () => {
  function cancelCommand(runId: string, expectedVersion: number) {
    return {
      commandId: nextCommandId(),
      requestedAt: WRITE_FIXTURE_NOW,
      requestedBy: "local-operator",
      source: "dashboard",
      family: "run",
      type: "cancel",
      target: { runId, expectedVersion },
    } as const;
  }

  it("refuses the cancel by name and cancels nothing while the intent is parked", async () => {
    const harness = roundTrip();
    await harness.park();
    const intent = parkedIntent(harness.database);
    const parked = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(parked);

    const result = harness.kernel.execute(cancelCommand(WRITE_FIXTURE_RUN_ID, parked.version));
    assert.ok(result.state === "rejected");
    assert.equal(result.code, "invalid-state");
    assert.ok(result.message.includes(intent.writeIntentId), "the refusal names the intent to answer");
    assert.match(result.message, /parked/);
    assert.match(result.message, /ref write-safety §4\.1/);

    // Nothing moved — not the run, not the intent, not the version.
    const after = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(after && after.lifecycle.state === "parked-write");
    assert.equal(after.version, parked.version);
    assert.equal(harness.database.authority.writeIntents.get(intent.writeIntentId)?.status, "parked");
  });

  it("refuses it for an ATTEMPTING intent too — the state with no section at all", async () => {
    const harness = roundTrip();
    await harness.park();
    const parkedIntentRecord = parkedIntent(harness.database);
    // `reopenParkedAttempt` is the CAS `resolvePresent` itself performs before
    // beat ⑦ accepts an attestation, so this is the real shape of an
    // `attempting` row rather than a hand-built one. A run holding one serves
    // no parked-write section, which is why cancelling it is the worse case.
    const attempting = harness.database.withAuthorityTransaction((repositories) =>
      repositories.writeIntents.reopenParkedAttempt({
        writeIntentId: parkedIntentRecord.writeIntentId,
        generation: parkedIntentRecord.generation,
        expectedVersion: parkedIntentRecord.version,
        now: WRITE_FIXTURE_NOW,
      }));
    assert.equal(attempting.status, "attempting");
    const run = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(run);

    const result = harness.kernel.execute(cancelCommand(WRITE_FIXTURE_RUN_ID, run.version));
    assert.ok(result.state === "rejected");
    assert.equal(result.code, "invalid-state");
    assert.ok(result.message.includes(attempting.writeIntentId));
    assert.match(result.message, /attempting/);
    assert.equal(harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.lifecycle.state, "parked-write");
  });

  it("lifts the moment the write is answered ABSENT", async () => {
    const harness = roundTrip();
    await harness.park();
    const intent = parkedIntent(harness.database);
    const parked = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(parked);

    assert.equal(
      harness.kernel.execute(resolutionCommand("resolve-write-absent", {
        runId: WRITE_FIXTURE_RUN_ID,
        expectedVersion: parked.version,
        writeIntentId: intent.writeIntentId,
        intentGeneration: intent.generation,
      }, { evidenceNote: "checked UCPath: no transaction exists for this key" })).state,
      "applied",
    );
    const resumed = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(resumed);

    const cancelled = harness.kernel.execute(cancelCommand(WRITE_FIXTURE_RUN_ID, resumed.version));
    assert.equal(cancelled.state, "applied");
    const settled = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(settled && settled.lifecycle.state === "terminal");
    assert.equal(settled.lifecycle.outcome, "cancelled");
    // The retryable intent is untouched by the cancel, exactly as §4.1 says.
    assert.equal(harness.database.authority.writeIntents.get(intent.writeIntentId)?.status, "retryable");
  });

  it("lifts the moment the write is answered PRESENT", async () => {
    const harness = roundTrip();
    await harness.park();
    const intent = parkedIntent(harness.database);
    const parked = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(parked);

    assert.equal(
      harness.kernel.execute(resolutionCommand("resolve-write-present", {
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
      })).state,
      "applied",
    );
    const resumed = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(resumed);

    const cancelled = harness.kernel.execute(cancelCommand(WRITE_FIXTURE_RUN_ID, resumed.version));
    assert.equal(cancelled.state, "applied");
    assert.equal(harness.database.authority.writeIntents.get(intent.writeIntentId)?.status, "committed");
  });
});


describe("kernel outer resolution rollback", () => {
  it("unwinds product/lifecycle journals and all write evidence after inner lifecycle settlement", async () => {
    const h = roundTrip(writeFixtureDescriptor, { afterSequencedStep: (step) => {
      if (step === "run-transition") throw new Error("kernel outer resolution rollback");
    } });
    await h.park();
    const intent = parkedIntent(h.database);
    const run = h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(run);
    const command = resolutionCommand("resolve-write-present", { runId: WRITE_FIXTURE_RUN_ID,
      expectedVersion: run.version, writeIntentId: intent.writeIntentId, intentGeneration: intent.generation },
      { proof: { schemaHash: deriveSchemaHash(WriteFixtureProofSchema, "output"), value: { transactionId: "T998877" } },
        evidenceNote: "synthetic confirmed receipt" });
    const generation = h.database.getMeta().authorityGeneration;
    assert.throws(() => h.kernel.execute(command), /kernel outer resolution rollback/);
    assert.deepEqual(h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID), run);
    assert.deepEqual(h.database.authority.writeIntents.get(intent.writeIntentId), intent);
    assert.equal(h.database.authority.runCheckpoints.latest(WRITE_FIXTURE_WORKFLOW_ID, run.envelope.itemId, WRITE_FIXTURE_NODE_ID), undefined);
    assert.equal(h.database.authority.commands.get(command.commandId), undefined);
    assert.equal(h.database.getMeta().authorityGeneration, generation);
  });
});
