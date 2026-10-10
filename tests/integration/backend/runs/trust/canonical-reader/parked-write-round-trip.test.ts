import { CONFIG_SNAPSHOT } from "../../../../../support/fixtures/phase1c-contract-fixtures.js";
import { createTrustRunReader } from "../../../../../../src/backend/runs/trust/canonical-reader.js";
import { buildTrustSection } from "../../../../../../src/backend/runs/queries/run-trust.js";
import { makeWorld } from "../../../../../support/helpers/backend/dashboard-harness.js";
import { foldTrustGate } from "../../../../../support/helpers/backend/trust-authority-fixture.js";
import { SectionUnavailableError } from "../../../../../../src/backend/runs/commands/refusals.js";
import { RunRecordService } from "../../../../../../src/backend/runs/lifecycle/run-record-service.js";
import { lifecycleCommandId } from "../../../../../../src/backend/runs/lifecycle/run-record-service.js";
import { testRunContinuation, testRunLifecycle, testWorkerPorts } from "../../../../../support/fixtures/run-lifecycle-fixtures.js";

import { fixtureDuoCeremonyGates } from "../../../../../support/helpers/duo-ceremony-fixtures.js";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { createCommandKernel, type CommandKernel } from "../../../../../../src/backend/runs/commands/command-kernel.js";
import { runWorkerLoop, type WorkerLoopReport } from "../../../../../../src/backend/runtime/workers/worker-loop.js";
import { createWriteResolutionExecutor } from "../../../../../../src/backend/runtime/writes/write-recovery.js";
import { createWriteSequencer, type WriteSequencerHooks } from "../../../../../../src/backend/runtime/writes/write-sequencer.js";
import type { AnyWorkflowDescriptor } from "../../../../../../src/workflow-kit/workflow.js";
import { manualClock, type TestClock } from "../../../../../../src/rules/time/clock.js";
import { WorkerIdSchema, WorkflowIdSchema } from "../../../../../../src/rules/identity/ids.js";
import { deriveSchemaHash } from "../../../../../../src/models/validation/schema-bound-value.js";
import { AuthorityDatabase } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { ManualScheduler, recordingEmitter, recordingLogger } from "../../../../../support/helpers/phase1f-executor-harness.js";
import { sequentialIdFactory } from "../../../../../support/fixtures/phase1f-run-fixtures.js";
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
} from "../../../../../support/fixtures/write-sequencer-fixtures.js";
import { NO_INTAKE_PROJECTIONS, UNWIRED_INTAKE_PARSER } from "../../../../../support/fixtures/intake-kernel-seams.js";

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
  it("serves canonical parked-write evidence without a fold and refuses foreign intent membership", async () => {
    const h = roundTrip(); await h.park();
    const projection = makeWorld();
    try {
      const deps = { stateRoot: projection.stateRoot, projection: projection.projection,
        runReader: createTrustRunReader(h.database, h.clock), timeline: h.database.authority.timelineEvents,
        authority: { getRun: () => { throw new Error("raw lifecycle forbidden"); },
          latestCheckpoint: () => undefined,
          getWriteIntent: (id: string) => h.database.authority.writeIntents.get(id),
          listGateResults: (id: string) => h.database.authority.gateResults.listByRun(id) },
        descriptors: { resolve: () => undefined } };
      assert.equal(projection.projection.runFold(WRITE_FIXTURE_RUN_ID), undefined);
      const section = buildTrustSection(deps, WRITE_FIXTURE_RUN_ID, "parked-write");
      assert.equal(section.section, "parked-write");
      const intent = parkedIntent(h.database);
      assert.equal(intent.status, "parked"); if (intent.status !== "parked") throw new Error("not parked");
      for (const changed of [{ workflowId: "person-lookup" }, { runAttempt: intent.runAttempt + 1 },
        { itemId: "aaaaaaaa-0000-4000-8000-000000000001" }, { runId: "aaaaaaaa-0000-4000-8000-000000000002" }]) {
        assert.throws(() => buildTrustSection({ ...deps, authority: { ...deps.authority,
          getWriteIntent: () => ({ ...intent, ...changed }) as typeof intent } }, WRITE_FIXTURE_RUN_ID, "parked-write"),
        /IDENTITY_MISMATCH|belongs to/);
      }
      assert.deepEqual(parkedIntent(h.database), intent);
      const state = deps.runReader.read(WRITE_FIXTURE_RUN_ID);
      assert.equal(state.state, "present"); if (state.state !== "present") throw new Error("parked run missing");
      foldTrustGate(projection, state.run, "resolved");
      const contradictory = buildTrustSection(deps, WRITE_FIXTURE_RUN_ID, "parked-write");
      assert.deepEqual(contradictory, section, "resolved fold cannot hide canonical parked-write actions");
      const resolved = h.kernel.execute(resolutionCommand("resolve-write-absent", {
        runId: WRITE_FIXTURE_RUN_ID, expectedVersion: state.run.version,
        writeIntentId: intent.writeIntentId, intentGeneration: intent.generation,
      }, { evidenceNote: "checked target: no transaction exists" }));
      assert.equal(resolved.state, "applied");
      const resumed = deps.runReader.read(WRITE_FIXTURE_RUN_ID);
      assert.equal(resumed.state, "present"); if (resumed.state !== "present") throw new Error("resumed run missing");
      assert.equal(resumed.run.lifecycle.state, "queued");
      foldTrustGate(projection, resumed.run, "open");
      assert.throws(() => buildTrustSection(deps, WRITE_FIXTURE_RUN_ID, "parked-write"), SectionUnavailableError,
        "stale open evidence cannot regrant resolved write actions");

    } finally { projection.dispose(); }
  });
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


    assert.deepEqual(harness.database.authority.failures.listByRun(WRITE_FIXTURE_RUN_ID), []);
    assert.equal(harness.database.authority.runResults.get(WRITE_FIXTURE_RUN_ID), undefined);
    assert.equal(harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.completion, undefined);
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
    const nestedId = lifecycleCommandId("operator-present", command.commandId);
    assert.notEqual(nestedId, command.commandId);
    assert.ok(harness.database.authority.commands.get(command.commandId));
    const nested = harness.database.authority.lifecycleJournal.getCommand(nestedId);
    assert.ok(nested && "kind" in nested && nested.kind === "run-lifecycle");
    const generation = harness.database.getMeta().authorityGeneration;
    assert.equal(harness.kernel.execute(command).state, "already-applied");
    assert.equal(harness.database.getMeta().authorityGeneration, generation);
  });


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


describe("a confirmed-present proof that does not fit", () => {
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


describe("cancel over an unresolved fenced write", () => {
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
    let observed = false;
    harness.world.onCommitClick = () => {
      const attempting = parkedIntent(harness.database);
      assert.equal(attempting.status, "attempting");
      const run = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
      assert.ok(run);
      const result = harness.kernel.execute(cancelCommand(WRITE_FIXTURE_RUN_ID, run.version));
      assert.ok(result.state === "rejected");
      assert.equal(result.code, "invalid-state");
      assert.ok(result.message.includes(attempting.writeIntentId));
      assert.match(result.message, /attempting/);
      observed = true;
      throw new Error("browser crashed after cancel refusal");
    };
    await harness.park(false);
    assert.equal(observed, true);
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
