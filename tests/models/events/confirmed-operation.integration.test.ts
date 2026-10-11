import { reconstructConfirmedOperation } from "../../../src/models/events/confirmed-operation.js";
import { CONFIG_SNAPSHOT } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { testRunLifecycle,testWorkerPorts } from "../../support/fixtures/run-lifecycle-fixtures.js";

import assert from "node:assert/strict";
import { mkdtempSync,realpathSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,describe,it } from "vitest";
import type { WriteSequencerContext } from "../../../src/backend/runtime/execution/run-executor.js";
import { withBoundRunConfigFingerprint,type WorkerSessionManager } from "../../../src/backend/runtime/workers/worker-sessions.js";
import {
createWriteSequencer,
type ProductionWriteSequencer,
type TransactionDryRunPreview,
type WriteSequencerHooks
} from "../../../src/backend/runtime/writes/write-sequencer.js";
import { type RunRecord } from "../../../src/models/run/record.js";
import { manualClock,type TestClock } from "../../../src/rules/time/clock.js";
import type { AnyWorkflowDescriptor } from "../../../src/workflow-kit/workflow.js";
import { sequentialIdFactory } from "../../support/fixtures/phase1f-run-fixtures.js";
import {
absentProbeEvidence,
buildWriteFixtureRegistry,
createWriteFixtureWorld,
WRITE_FIXTURE_EID,
WRITE_FIXTURE_IMPL_FINGERPRINT,
WRITE_FIXTURE_ITEM_ID,
WRITE_FIXTURE_KEY,
WRITE_FIXTURE_NODE_ID,
WRITE_FIXTURE_NOW,
WRITE_FIXTURE_OBSERVATION,
WRITE_FIXTURE_RUN_ID,
WRITE_FIXTURE_WORKER_ID,
WRITE_FIXTURE_WORKFLOW_ID,
writeFixtureDescriptor,
writeFixtureQueuedRun,
writeFixtureSessionManager,
writeFixtureSessions,
writeFixtureTransactionNode,
type WriteFixtureWorld
} from "../../support/fixtures/write-sequencer-fixtures.js";
import { ManualScheduler,recordingEmitter,recordingLogger } from "../../support/helpers/phase1f-executor-harness.js";
import {
AuthorityDatabase,
type AuthorityWriteCommitHooks
} from "../../support/helpers/synthetic-storage-admission.js";

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

describe("the seven-beat happy path", () => {
  it("probes, prepares, binds, fences before the click, and settles beat ⑦ atomically", async () => {
    const h = harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h.world.onCommitClick = () => {
      // Fence-before-click: the durable attempting intent exists BEFORE the click.
      const fenced = intentByKey(h.database);
      assert.ok(fenced);
      assert.equal(fenced.status, "attempting");
    };

    const outcome = await h.execute(contextFor(run, claim));
    assert.deepEqual(outcome, {
      disposition: "committed",
      proofSource: "normal-output",
      output: { transactionId: "T123456" },
      proof: { transactionId: "T123456" },
    });

    // Exact ordering: probe → prepare → fresh subject observation → click.
    assert.deepEqual(h.world.events, [
      "probe",
      "prepare",
      `subject-read:${WRITE_FIXTURE_OBSERVATION}`,
      "commit-click:ucpath.write-fixture.save-submit",
    ]);

    const intent = intentByKey(h.database);
    assert.ok(intent && intent.status === "committed");
    assert.equal(intent.generation, 1);
    assert.deepEqual(intent.completionProof.value, { transactionId: "T123456" });
    const attempt = h.database.authority.writeAttempts.get(intent.currentAttemptId);
    assert.ok(attempt && attempt.outcome.state === "committed");

    const confirmation = h.database.authority.timelineEvents.page({}).find((row) => row.payload.kind === "operation-confirmed");
    assert.ok(confirmation);
    const { ledger, span } = reconstructConfirmedOperation(h.database.authority, confirmation);
    assert.equal(ledger.idempotencyKey, WRITE_FIXTURE_KEY);
    assert.equal(ledger.proofSource, "normal-output");
    assert.equal(ledger.operator, "local-operator");
    assert.equal(ledger.instance, "prod");
    assert.equal(span.kind, "write-committed-span");

    // The transaction checkpoint retains the durable TransactionOutcome.
    const checkpoint = h.database.authority.runCheckpoints.latest(
      WRITE_FIXTURE_WORKFLOW_ID, WRITE_FIXTURE_ITEM_ID, WRITE_FIXTURE_NODE_ID);
    assert.ok(checkpoint);
    const stored = checkpoint.output.value as { disposition: string; proofSource: string };
    assert.equal(stored.disposition, "committed");
    assert.equal(stored.proofSource, "normal-output");

    // The run advanced within running under the same claim, and nothing poisoned.
    const current = h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(current && current.lifecycle.state === "running");
    assert.ok(current.version > run.version);
    assert.deepEqual(h.sessions.closeReasons(), []);

    // Every task role is opened and closed; the receipt arm has no verifier.
    assert.deepEqual(
      h.emitter.events().map((event) => [event.t, event.spanPath]),
      [
        ["span.started", "wf-090000-2222/submit-write/probe"],
        ["data.observed", "wf-090000-2222/submit-write/probe"],
        ["span.ended", "wf-090000-2222/submit-write/probe"],
        ["span.started", "wf-090000-2222/submit-write/prepare"],
        ["data.observed", "wf-090000-2222/submit-write/prepare"],
        ["span.ended", "wf-090000-2222/submit-write/prepare"],
        ["span.started", "wf-090000-2222/submit-write/commit"],
        ["transaction.fenced", "wf-090000-2222/submit-write/commit"],
        ["data.observed", "wf-090000-2222/submit-write/commit"],
        ["span.ended", "wf-090000-2222/submit-write/commit"],
      ],
    );
  });
});
