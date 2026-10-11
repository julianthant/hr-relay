import { lifecycleCommandId } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { RunClaimTokenSchema } from "../../../../src/backend/storage/sqlite/run-store-contracts.js";
import { reconstructConfirmedOperation } from "../../../../src/models/events/confirmed-operation.js";

import { CONFIG_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { testRunLifecycle, testRunService, testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";

import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import type { WriteSequencerContext } from "../../../../src/backend/runtime/execution/run-executor.js";
import { withBoundRunConfigFingerprint, type WorkerSessionManager } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import { buildCommittedSettlement, createWriteSequencer, executeSequencedWriteCommit, type ProductionWriteSequencer, type TransactionDryRunPreview, type WriteSequencerHooks } from "../../../../src/backend/runtime/writes/write-sequencer.js";
import { RunRecordSchema, type RunRecord } from "../../../../src/models/run/record.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { ActorIdSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock, type TestClock } from "../../../../src/rules/time/clock.js";
import { deriveIdempotencyKeyDigest, deriveWriteBindingProofDigest } from "../../../../src/rules/write-safety/write-safety.js";
import type { AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { UUID_5, UUID_6, UUID_7, UUID_8 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { absentProbeEvidence, buildWriteFixtureRegistry, createWriteFixtureWorld, WRITE_FIXTURE_EID, WRITE_FIXTURE_IMPL_FINGERPRINT, WRITE_FIXTURE_ITEM_ID, WRITE_FIXTURE_KEY, WRITE_FIXTURE_KEY_DIGEST, WRITE_FIXTURE_NODE_ID, WRITE_FIXTURE_NOW, WRITE_FIXTURE_OBSERVATION, WRITE_FIXTURE_RUN_ID, WRITE_FIXTURE_STAGED_STATE, WRITE_FIXTURE_WORKER_ID, WRITE_FIXTURE_WORKFLOW_ID, WriteFixtureCommit, writeFixtureDescriptor, WriteFixtureProofSchema, writeFixtureQueuedRun, writeFixtureSaveDescriptor, writeFixtureSessionManager, writeFixtureSessions, writeFixtureTransactionNode, type WriteFixtureWorld } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { ManualScheduler, recordingEmitter, recordingLogger } from "../../../support/helpers/phase1f-executor-harness.js";
import { AtomicWriteCommitStorageStepSchema, AuthorityDatabase, SequencedWriteCommitStepSchema, type AuthorityWriteCommitHooks } from "../../../support/helpers/synthetic-storage-admission.js";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

interface Harness {
  readonly world: WriteFixtureWorld;
  readonly database: AuthorityDatabase;
  readonly clock: TestClock;
  readonly manager: WorkerSessionManager;
  readonly sessions: ReturnType<typeof writeFixtureSessions>;
  readonly scheduler: ManualScheduler;
  readonly emitter: ReturnType<typeof recordingEmitter>;
  readonly ids: ReturnType<typeof sequentialIdFactory>;
  readonly sequencer: ProductionWriteSequencer;
  // Bind the immutable run fingerprint as the worker loop does before entering the sequencer.
  readonly execute: (context: WriteSequencerContext) => Promise<unknown>;
  readonly executeDryRun: (context: WriteSequencerContext) => Promise<TransactionDryRunPreview>;
}

function harness(options: Readonly<{
  hooks?: WriteSequencerHooks;
  commitHooks?: AuthorityWriteCommitHooks;
  emitterThrowsOn?: "data.observed" | "failed-task-span" | "transaction.fenced" | "verify-start";
}> = {}): Harness {
  const clock = manualClock(new Date(WRITE_FIXTURE_NOW));
  const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-write-sequencer-"));
  const database = AuthorityDatabase.open(
    { path: join(root, "authority.sqlite"), busyTimeoutMs: 250, migrationOwner: "write-sequencer-test" },
    clock,
    options.commitHooks,
  );
  disposers.push(() => {
    database.close();
    rmSync(root, { recursive: true, force: true });
  });
  database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  testWorkerPorts(database, clock, { path: join(root, "authority.sqlite"), descriptor: writeFixtureDescriptor, poolIndex: 1 });
  const world = createWriteFixtureWorld();
  const registry = buildWriteFixtureRegistry(world);
  const sessions = writeFixtureSessions(world);
  const manager = writeFixtureSessionManager(sessions, registry, clock);
  const emitter = recordingEmitter();
  const spanSink = {
    emit(event: Parameters<typeof emitter.emitter.emit>[0]): void {
      const throwOnFailedTaskSpan = options.emitterThrowsOn === "failed-task-span"
        && event.t === "span.ended"
        && event.kind === "task"
        && event.outcome === "failed";
      const throwOnVerifyStart = options.emitterThrowsOn === "verify-start"
        && event.t === "span.started"
        && event.kind === "task"
        && event.spanPath.endsWith("/verify");
      const throwOnEventArm = options.emitterThrowsOn !== undefined
        && options.emitterThrowsOn !== "failed-task-span"
        && options.emitterThrowsOn !== "verify-start"
        && event.t === options.emitterThrowsOn;
      if (throwOnEventArm || throwOnFailedTaskSpan || throwOnVerifyStart) {
        const failureArm = throwOnFailedTaskSpan
          ? "failed-task-span"
          : throwOnVerifyStart ? "verify-start" : event.t;
        world.events.push(`emitter-throw:${failureArm}`);
        throw new Error(`injected ${failureArm} writer failure`);
      }
      emitter.emitter.emit(event);
    },
  };
  const ids = sequentialIdFactory("c");
  const scheduler = new ManualScheduler(clock);
  const sequencer = createWriteSequencer({
    lifecycle: testRunLifecycle(database, clock),
    stores: registry,
    authority: database,
    sessions: manager,
    emitter: spanSink,
    clock,
    ids,
    scheduler,
    taskDeadlineMs: 60_000,
    operator: "local-operator",
    log: recordingLogger().log,
    resolveImplFingerprint: () => WRITE_FIXTURE_IMPL_FINGERPRINT,
    ...(options.hooks === undefined ? {} : { hooks: options.hooks }),
  });
  const execute = (context: WriteSequencerContext): Promise<unknown> =>
    withBoundRunConfigFingerprint(
      manager,
      context.run.envelope.configFingerprint,
      () => sequencer.executeTransaction(context),
    );
  const executeDryRun = (context: WriteSequencerContext): Promise<TransactionDryRunPreview> =>
    withBoundRunConfigFingerprint(
      manager,
      context.run.envelope.configFingerprint,
      () => sequencer.executeDryRun(context),
    );
  return { world, database, clock, manager, sessions, scheduler, emitter, ids, sequencer, execute, executeDryRun };
}

function claimRunning(
  database: AuthorityDatabase,
  clock: TestClock,
  runInput: Record<string, unknown> = writeFixtureQueuedRun(),
  workerId: string = WRITE_FIXTURE_WORKER_ID,
): { run: RunRecord; claim: { workerId: string; claimGeneration: number } } {
  const now = clock.now().toISOString();
  const enqueued = database.authority.runs.enqueue(runInput);
  assert.equal(enqueued.state, "inserted");
  const claimed = database.authority.runs.claimNext({
    workflow: WRITE_FIXTURE_WORKFLOW_ID,
    workerId,
    now,
  });
  if (claimed.state !== "claimed") throw new Error(`claim outcome was ${claimed.state}`);
  const claim = { workerId, claimGeneration: claimed.run.claimGeneration };
  const base = { workerId, claimedAt: now, heartbeatAt: now };
  const validating = database.authority.runs.transition({
    runId: claimed.run.envelope.runId,
    expectedVersion: claimed.run.version,
    claim,
    lifecycle: { state: "validating", ...base },
    now,
  });
  assert.equal(validating.state, "applied");
  const running = database.authority.runs.transition({
    runId: claimed.run.envelope.runId,
    expectedVersion: claimed.run.version + 1,
    claim,
    lifecycle: { state: "running", ...base, currentNodeId: WRITE_FIXTURE_NODE_ID },
    now,
  });
  if (running.state !== "applied") throw new Error("running transition failed");
  return { run: running.run, claim };
}

function contextFor(
  run: RunRecord,
  claim: { workerId: string; claimGeneration: number },
  descriptor: AnyWorkflowDescriptor = writeFixtureDescriptor,
  dryRun = false,
): WriteSequencerContext {
  return {
    descriptor,
    node: writeFixtureTransactionNode(descriptor),
    run,
    claim: { workerId: claim.workerId, claimGeneration: claim.claimGeneration } as WriteSequencerContext["claim"],
    scope: { input: { eid: WRITE_FIXTURE_EID }, outputs: {} },
    dryRun,
    signal: new AbortController().signal,
  };
}

function intentByKey(database: AuthorityDatabase) {
  return database.authority.writeIntents.findByPermanentKey("ucpath", WRITE_FIXTURE_KEY);
}

function foreignBindingProof(runId: string, leaseId: string) {
  return {
    kind: "subject-match",
    version: 1,
    proofId: UUID_7,
    runId,
    attempt: 1,
    leaseId,
    taskId: "ucpath/submit-write-fixture",
    observationId: WRITE_FIXTURE_OBSERVATION,
    pageStateId: WRITE_FIXTURE_STAGED_STATE,
    expected: {
      kind: "person",
      identifierKind: "eid",
      bindingDigest: "a".repeat(64),
      displaySuffix: "2345",
    },
    observed: {
      kind: "person",
      identifierKind: "eid",
      bindingDigest: "a".repeat(64),
      displaySuffix: "2345",
    },
    match: "match",
    observedAt: WRITE_FIXTURE_NOW,
    afterPrepareSpanPath: "wf-090000-2222/submit-write/prepare",
  };
}

function attemptingIntentFixture(runId: string, options: Readonly<{ intentId?: string }> = {}) {
  const bindingProof = foreignBindingProof(runId, UUID_6);
  const bindingProofDigest = deriveWriteBindingProofDigest(bindingProof);
  const intent = {
    writeIntentId: options.intentId ?? UUID_8,
    workflowId: WRITE_FIXTURE_WORKFLOW_ID,
    itemId: WRITE_FIXTURE_ITEM_ID,
    taskId: "ucpath/submit-write-fixture",
    system: "ucpath",
    idempotencyKey: WRITE_FIXTURE_KEY,
    idempotencyKeyDigest: WRITE_FIXTURE_KEY_DIGEST,
    currentAttemptId: UUID_5,
    generation: 1,
    runId,
    runAttempt: 1,
    bindingProof,
    bindingProofDigest,
    fencedAt: WRITE_FIXTURE_NOW,
    version: 1,
    createdAt: WRITE_FIXTURE_NOW,
    updatedAt: WRITE_FIXTURE_NOW,
    status: "attempting",
  };
  const attempt = {
    writeAttemptId: UUID_5,
    writeIntentId: intent.writeIntentId,
    generation: 1,
    runId,
    runAttempt: 1,
    leaseId: UUID_6,
    bindingProof,
    bindingProofDigest,
    fencedAt: WRITE_FIXTURE_NOW,
    outcome: { state: "attempting" },
    recordedAt: WRITE_FIXTURE_NOW,
  };
  return { intent, attempt };
}

describe("beat ⑤/⑥ — post-fence uncertainty durably parks (never done, never silent)", () => {
  it("keeps the commit lane and session owned until a deadline-ignoring callback actually settles", async () => {
    const h = harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    let releaseCallback = (): void => undefined;
    const callbackMaySettle = new Promise<void>((resolve) => {
      releaseCallback = resolve;
    });
    let reportCallbackInFlight = (): void => undefined;
    const callbackInFlight = new Promise<void>((resolve) => {
      reportCallbackInFlight = resolve;
    });
    h.world.afterCommitClickBeforeTaskSettlement = async () => {
      reportCallbackInFlight();
      await callbackMaySettle;
    };

    const execution = h.execute(contextFor(run, claim));
    await callbackInFlight;
    const [commitDeadline] = h.scheduler.pending();
    assert.ok(commitDeadline, "the in-flight commit owns its immutable task deadline");
    commitDeadline.fire();
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(
      h.emitter.events()
        .filter((event) => event.spanPath.endsWith("/commit"))
        .map((event) => event.t),
      ["span.started"],
      "deadline alone cannot flush the fenced commit lane before callback settlement",
    );
    assert.equal(intentByKey(h.database)?.status, "attempting", "the unsettled write remains recovery-visible");
    assert.deepEqual(h.sessions.closeReasons(), [], "the callback's transaction session remains open");

    releaseCallback();
    await assert.rejects(execution, /exceeded its immutable 60000ms task deadline/u);
    assert.equal(intentByKey(h.database)?.status, "parked");
    assert.deepEqual(h.sessions.closeReasons(), ["poisoned"]);
  });

  it("settles the verified external commit despite fence-event delivery failure after pre-click recordData", async () => {
    const h = harness({ emitterThrowsOn: "transaction.fenced" });
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h.world.commitRecordsBeforeClick = true;

    assert.deepEqual(await h.execute(contextFor(run, claim)), {
      disposition: "committed", proofSource: "normal-output", output: { transactionId: "T123456" }, proof: { transactionId: "T123456" },
    });

    assert.ok(
      h.world.events.indexOf("commit-click:ucpath.write-fixture.save-submit")
        < h.world.events.indexOf("emitter-throw:transaction.fenced"),
      "the external click must precede the first fallible post-fence span write",
    );
    assert.equal(intentByKey(h.database)?.status, "committed");
  });

  it("runs mandatory saved-effect verification despite its start-span delivery failure", async () => {
    const h = harness({ emitterThrowsOn: "verify-start" });
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h.world.verifyResults.push({ state: "present", proof: { transactionId: "T222222" } });
    const outcome = await h.execute(contextFor(run, claim, writeFixtureSaveDescriptor));
    assert.deepEqual(outcome, { disposition: "committed", proofSource: "normal-output", output: { transactionId: "T123456" }, proof: { transactionId: "T222222" } });
    assert.equal(intentByKey(h.database)?.status, "committed");
    assert.equal(h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.lifecycle.state, "running");
    const checkpoint = h.database.authority.runCheckpoints.latest(
      WRITE_FIXTURE_WORKFLOW_ID, WRITE_FIXTURE_ITEM_ID, WRITE_FIXTURE_NODE_ID);
    assert.ok(checkpoint);
    assert.deepEqual(checkpoint.output.value, { disposition: "committed", proofSource: "normal-output",
      confirmedAt: WRITE_FIXTURE_NOW,
      output: { schemaHash: deriveSchemaHash(WriteFixtureProofSchema, "output"), value: { transactionId: "T123456" } },
      proof: { schemaHash: deriveSchemaHash(WriteFixtureProofSchema, "output"), value: { transactionId: "T222222" } } });
    assert.ok(h.world.events.includes("emitter-throw:verify-start"));
    assert.ok(h.world.events.includes("verify"));
  });
});

describe("beat ⑦ — the whole bundle commits once or not at all", () => {
  for (const step of AtomicWriteCommitStorageStepSchema.options) {
    it(`rolls back everything when the inner primitive fails after ${step}`, async () => {
      const h = harness({
        commitHooks: {
          afterStorageStep(failedStep) {
            if (failedStep === step) throw new Error(`injected failure after ${failedStep}`);
          },
        },
      });
      const { run, claim } = claimRunning(h.database, h.clock);
      h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
      const versionBefore = h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.version;
      await assert.rejects(
        h.execute(contextFor(run, claim)),
        new RegExp(`injected failure after ${step}`),
      );
      const intent = intentByKey(h.database);
      assert.ok(intent && intent.status === "attempting", "the intent stays attempting for §4 recovery");
      assert.equal(
        h.database.authority.runCheckpoints.latest(WRITE_FIXTURE_WORKFLOW_ID, WRITE_FIXTURE_ITEM_ID, WRITE_FIXTURE_NODE_ID),
        undefined,
      );
      assert.equal(h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.version, versionBefore);
      assert.equal(h.database.authority.timelineEvents.page({}).filter((row) => row.payload.kind === "operation-confirmed").length, 0);
    });
  }

  for (const step of SequencedWriteCommitStepSchema.options) {
    it(`rolls back everything when the outer bundle fails after ${step}`, async () => {
      const h = harness({
        hooks: {
          afterSequencedStep(failedStep) {
            if (failedStep === step) throw new Error(`injected outer failure after ${failedStep}`);
          },
        },
      });
      const { run, claim } = claimRunning(h.database, h.clock);
      h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
      const versionBefore = h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.version;
      await assert.rejects(
        h.execute(contextFor(run, claim)),
        new RegExp(`injected outer failure after ${step}`),
      );
      const intent = intentByKey(h.database);
      assert.ok(intent && intent.status === "attempting");
      assert.equal(
        h.database.authority.runCheckpoints.latest(WRITE_FIXTURE_WORKFLOW_ID, WRITE_FIXTURE_ITEM_ID, WRITE_FIXTURE_NODE_ID),
        undefined,
      );
      assert.equal(h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.version, versionBefore);
    });
  }
});

describe("inline recovery of this run's own attempting intent", () => {
  it("backfills committed from a validated present recovery probe without a second click", async () => {
    const h = harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    const own = attemptingIntentFixture(WRITE_FIXTURE_RUN_ID);
    assert.equal(h.database.authority.writeIntents.fenceAttempt(own).state, "fenced");
    h.world.probeResults.push({ state: "present", proof: { transactionId: "T654321" } });

    const outcome = await h.execute(contextFor(run, claim));
    assert.deepEqual(outcome, {
      disposition: "committed",
      proofSource: "recovery-probe",
      output: { transactionId: "T654321" },
      proof: { transactionId: "T654321" },
    });
    assert.deepEqual(h.world.events, ["probe"], "recovery probes; it never prepares or clicks");
    assert.equal(intentByKey(h.database)?.status, "committed");
  });
});

describe("service-backed shared settlement", () => {
  it("keeps settlement journal identity independent of protected proof bytes while binding ordinary proof", () => {
    const settle = (documentNumber: string, transactionId = "T123456", protectedKey = false) => {
      const h = harness();
      const queued = RunRecordSchema.parse(writeFixtureQueuedRun());
      const protectedBindings = [{ kind: "test-data-local", name: "separationsKualiFinalizationCanaryDocumentNumber",
        inputPath: "documentNumber", sourceId: "10000000-0000-4000-8000-000000000001" }];
      const { run, claim } = claimRunning(h.database, h.clock, { ...queued,
        input: { ...queued.input, raw: { documentNumber }, parsed: { ...queued.input.parsed,
          value: { documentNumber }, protectedBindings } } });
      const fence = attemptingIntentFixture(run.envelope.runId);
      if (protectedKey) {
        fence.intent.idempotencyKey = `protected-document:${documentNumber}`;
        fence.intent.idempotencyKeyDigest = deriveIdempotencyKeyDigest("ucpath", fence.intent.idempotencyKey);
      }
      assert.equal(h.database.authority.writeIntents.fenceAttempt(fence).state, "fenced");
      const intent = h.database.authority.writeIntents.get(fence.intent.writeIntentId);
      assert.ok(intent?.status === "attempting");
      const bundle = buildCommittedSettlement({ descriptor: writeFixtureDescriptor, nodeId: WRITE_FIXTURE_NODE_ID,
        run, intent, commitContract: WriteFixtureCommit, operator: ActorIdSchema.parse("local-operator"),
        implFingerprint: WRITE_FIXTURE_IMPL_FINGERPRINT, proofSource: "normal-output",
        proofValue: { documentNumber, transactionId }, outputValue: { documentNumber, transactionId },
        confirmedAt: WRITE_FIXTURE_NOW, ids: h.ids });
      const input = { run: { runId: run.envelope.runId, expectedVersion: run.version, claim }, ...bundle };
      const { outcome: _outcome, ...request } = input;
      const transition = { kind: "advance-running" as const, claim: RunClaimTokenSchema.parse(claim),
        claimedAt: WRITE_FIXTURE_NOW, port: testRunLifecycle(h.database, h.clock) };
      executeSequencedWriteCommit(h.database, request, transition);
      assert.equal(h.database.authority.writeIntents.get(intent.writeIntentId)?.idempotencyKey, fence.intent.idempotencyKey);
      assert.equal(h.database.authority.writeIntents.get(intent.writeIntentId)?.idempotencyKeyDigest, fence.intent.idempotencyKeyDigest);
      const generation = h.database.getMeta().authorityGeneration;
      executeSequencedWriteCommit(h.database, request, transition);
      assert.equal(h.database.getMeta().authorityGeneration, generation);
      const commandId = lifecycleCommandId("write-advance-running", { runId: run.envelope.runId,
        expectedVersion: run.version, writeIntentId: intent.writeIntentId, generation: intent.generation });
      const journal = h.database.authority.lifecycleJournal.getCommand(commandId);
      assert.ok(journal && "requestFingerprint" in journal);
      return journal.requestFingerprint;
    };
    assert.equal(settle("12345678"), settle("87654321"));
    assert.notEqual(settle("12345678"), settle("12345678", "T234567"));
    assert.equal(settle("12345678", "T123456", true), settle("87654321", "T123456", true));
  });
  it("replays the exact worker bundle without writes and refuses changed evidence", async () => {
    const h = harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    await h.execute(contextFor(run, claim));
    const intent = intentByKey(h.database);
    assert.ok(intent?.status === "committed");
    const checkpoint = h.database.authority.runCheckpoints.latest(WRITE_FIXTURE_WORKFLOW_ID,
      WRITE_FIXTURE_ITEM_ID, WRITE_FIXTURE_NODE_ID);
    assert.ok(checkpoint);
    const confirmation = h.database.authority.timelineEvents.page({}).find((row) => row.payload.kind === "operation-confirmed");
    assert.ok(confirmation);
    const { ledger: transaction, span: committedSpan } = reconstructConfirmedOperation(h.database.authority, confirmation);

    const input = { run: { runId: run.envelope.runId, expectedVersion: run.version, claim }, checkpoint,
      commit: { writeIntentId: intent.writeIntentId, generation: intent.generation,
        completionProof: intent.completionProof, confirmedAt: intent.confirmedAt,
        outcome: checkpoint.output.value, transaction, committedSpan } };
    const transition = { kind: "advance-running" as const, claim: RunClaimTokenSchema.parse(claim), claimedAt: WRITE_FIXTURE_NOW,
      port: testRunLifecycle(h.database, h.clock) };
    const generation = h.database.getMeta().authorityGeneration;
    const before = h.database.authority.runs.get(run.envelope.runId);
    assert.deepEqual(executeSequencedWriteCommit(h.database, input, transition).run, before);
    assert.equal(h.database.getMeta().authorityGeneration, generation);
    assert.throws(() => executeSequencedWriteCommit(h.database, { ...input,
      checkpoint: { ...checkpoint, implFingerprint: "f".repeat(64) } }, transition), /replay-divergent/);
    assert.equal(h.database.getMeta().authorityGeneration, generation);
    assert.deepEqual(h.database.authority.runs.get(run.envelope.runId), before);
  });
});

describe("durable cancellation at a retained write fence", () => {
  it("lets the callback and write settlement finish before cancellation can terminalize", async () => {
    const h = harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    let release = (): void => undefined;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    let entered = (): void => undefined;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    h.world.afterCommitClickBeforeTaskSettlement = async () => { entered(); await pending; };
    let finished = false;
    const execution = h.execute(contextFor(run, claim)).finally(() => { finished = true; });
    await started;
    const service = testRunService(h.database, h.clock);
    const current = h.database.authority.runs.get(run.envelope.runId);
    assert.ok(current);
    const request = service.transition({ commandId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      runId: run.envelope.runId, expectedVersion: current.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: WRITE_FIXTURE_NOW } });
    assert.equal(request.state, "applied");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(finished, false);
    assert.equal(intentByKey(h.database)?.status, "attempting");
    assert.deepEqual(h.sessions.closeReasons(), []);
    assert.deepEqual(h.emitter.events().filter((event) => event.spanPath.endsWith("/commit")).map((event) => event.t), ["span.started"]);
    release();
    await execution;
    assert.equal(intentByKey(h.database)?.status, "committed");
    const settled = h.database.authority.runs.get(run.envelope.runId);
    assert.ok(settled && settled.cancelRequested === true && settled.lifecycle.state === "running");
    assert.equal(service.terminalize({ kind: "cancelled", commandId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      runId: settled.envelope.runId, expectedVersion: settled.version, claim, endedAt: WRITE_FIXTURE_NOW },
    writeFixtureDescriptor).state, "applied");
    const cancelled = h.database.authority.runs.get(run.envelope.runId);
    assert.ok(cancelled?.lifecycle.state === "terminal" && cancelled.lifecycle.outcome === "cancelled");
  });
});
