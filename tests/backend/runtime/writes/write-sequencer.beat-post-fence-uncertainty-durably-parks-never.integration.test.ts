import { CONFIG_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { testRunLifecycle,testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";

import assert from "node:assert/strict";
import { mkdtempSync,realpathSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,describe,it } from "vitest";
import { z } from "zod";
import type { WriteSequencerContext } from "../../../../src/backend/runtime/execution/run-executor.js";
import { withBoundRunConfigFingerprint,type WorkerSessionManager } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import {
createWriteSequencer,
WriteParkedError,
type ProductionWriteSequencer,
type TransactionDryRunPreview,
type WriteSequencerHooks
} from "../../../../src/backend/runtime/writes/write-sequencer.js";
import { type RunRecord } from "../../../../src/models/run/record.js";
import { manualClock,type TestClock } from "../../../../src/rules/time/clock.js";
import type { AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
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
WRITE_FIXTURE_RUN_ID,
WRITE_FIXTURE_WORKER_ID,
WRITE_FIXTURE_WORKFLOW_ID,
writeFixtureDescriptor,
writeFixtureQueuedRun,
writeFixtureSaveDescriptor,
writeFixtureSessionManager,
writeFixtureSessions,
writeFixtureTransactionNode,
type WriteFixtureWorld
} from "../../../support/fixtures/write-sequencer-fixtures.js";
import { ManualScheduler,recordingEmitter,recordingLogger } from "../../../support/helpers/phase1f-executor-harness.js";
import {
AuthorityDatabase,
type AuthorityWriteCommitHooks
} from "../../../support/helpers/synthetic-storage-admission.js";

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

describe("beat ⑤/⑥ — post-fence uncertainty durably parks (never done, never silent)", () => {

  it("retains a parent-aborted transaction lease until its non-cooperative commit callback settles", async () => {
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
    const parent = new AbortController();
    const parentFailure = new Error("operator cancelled while the external callback was in flight");
    let executionSettled = false;
    const execution = h.execute({
      ...contextFor(run, claim),
      signal: parent.signal,
    }).then(
      (value) => ({ state: "fulfilled" as const, value }),
      (error: unknown) => ({ state: "rejected" as const, error }),
    ).finally(() => {
      executionSettled = true;
    });

    await callbackInFlight;
    parent.abort(parentFailure);
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(
      h.emitter.events()
        .filter((event) => event.spanPath.endsWith("/commit"))
        .map((event) => event.t),
      ["span.started"],
      "parent abort cannot flush the commit lane before callback settlement",
    );
    assert.equal(intentByKey(h.database)?.status, "attempting");
    assert.deepEqual(h.sessions.closeReasons(), [], "the retained transaction session remains open");
    assert.equal(executionSettled, false, "the fenced execution remains owned while its callback is in flight");
    assert.deepEqual(h.scheduler.pending(), [], "parent-first cancellation cancels the later task deadline");

    releaseCallback();
    const outcome = await execution;
    assert.equal(outcome.state, "rejected");
    if (outcome.state !== "rejected") return;
    assert.ok(outcome.error instanceof WriteParkedError);
    assert.match(outcome.error.message, /operator cancelled while the external callback was in flight/u);
    assert.equal(intentByKey(h.database)?.status, "parked");
    assert.equal(h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.lifecycle.state, "parked-write");
    assert.deepEqual(h.sessions.closeReasons(), ["poisoned"], "post-settlement failure poisons exactly once");
  });

  it("keeps a deadline failure primary when parent abort follows during retained callback settlement", async () => {
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
    const parent = new AbortController();
    const parentFailure = new Error("parent abort followed the commit deadline");
    const execution = h.execute({
      ...contextFor(run, claim),
      signal: parent.signal,
    }).then(
      (value) => ({ state: "fulfilled" as const, value }),
      (error: unknown) => ({ state: "rejected" as const, error }),
    );

    await callbackInFlight;
    const [commitDeadline] = h.scheduler.pending();
    assert.ok(commitDeadline);
    commitDeadline.fire();
    await new Promise((resolve) => setImmediate(resolve));
    parent.abort(parentFailure);
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(
      h.emitter.events()
        .filter((event) => event.spanPath.endsWith("/commit"))
        .map((event) => event.t),
      ["span.started"],
    );
    assert.equal(intentByKey(h.database)?.status, "attempting");
    assert.deepEqual(h.sessions.closeReasons(), []);

    releaseCallback();
    const outcome = await execution;
    assert.equal(outcome.state, "rejected");
    if (outcome.state !== "rejected") return;
    assert.ok(outcome.error instanceof WriteParkedError);
    assert.ok(outcome.error.cause instanceof Error);
    assert.ok(outcome.error.cause.cause instanceof AggregateError);
    const [deadlineFailure, retainedParentFailure] = z.array(z.unknown()).parse(
      outcome.error.cause.cause.errors,
    );
    assert.ok(deadlineFailure instanceof Error);
    assert.match(deadlineFailure.message, /exceeded its immutable 60000ms task deadline/u);
    assert.equal(retainedParentFailure, parentFailure);
    assert.equal(intentByKey(h.database)?.status, "parked");
    assert.deepEqual(h.sessions.closeReasons(), ["poisoned"]);
  });

  it("parks by task and field when a buffered commit observation is undeclared", async () => {
    const h = harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h.world.recordUndeclaredCommitField = true;

    await assert.rejects(
      h.execute(contextFor(run, claim)),
      (error: unknown) => error instanceof WriteParkedError
        && /ucpath\/submit-write-fixture.*undeclaredCommitField/u.test(error.message),
    );

    assert.ok(h.world.events.includes("commit-click:ucpath.write-fixture.save-submit"));
    assert.equal(intentByKey(h.database)?.status, "parked");
    assert.equal(JSON.stringify(h.emitter.events()).includes("RAW_UNDECLARED_COMMIT"), false);
  });

  it("parks with the commit error first when post-settlement fence emission also throws", async () => {
    const h = harness({ emitterThrowsOn: "transaction.fenced" });
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h.world.commitThrows = new Error("PRIMARY_COMMIT_TASK_FAILURE");

    await assert.rejects(
      h.execute(contextFor(run, claim)),
      (error: unknown) => {
        assert.ok(error instanceof WriteParkedError);
        assert.match(error.message, /PRIMARY_COMMIT_TASK_FAILURE/u);
        assert.ok(error.cause instanceof Error);
        assert.ok(error.cause.cause instanceof AggregateError);
        assert.equal(error.cause.cause.cause, h.world.commitThrows);
        assert.deepEqual(
          error.cause.cause.errors.map((entry: unknown) => entry instanceof Error ? entry.message : String(entry)),
          ["PRIMARY_COMMIT_TASK_FAILURE", "injected transaction.fenced writer failure"],
        );
        return true;
      },
    );

    assert.ok(!h.world.events.some((event) => event.startsWith("commit-click")));
    assert.equal(intentByKey(h.database)?.status, "parked");
    assert.equal(
      h.database.authority.runCheckpoints.latest(
        WRITE_FIXTURE_WORKFLOW_ID,
        WRITE_FIXTURE_ITEM_ID,
        WRITE_FIXTURE_NODE_ID,
      ),
      undefined,
      "a dual failure never reports a committed side effect",
    );
  });

  it("parks intent and run when the commit impl throws after the fence", async () => {
    const h = harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h.world.commitThrows = new Error("browser crashed mid-click");
    await assert.rejects(
      h.execute(contextFor(run, claim)),
      (error: unknown) => error instanceof WriteParkedError && error.parkCode === "unknown",
    );
    const intent = intentByKey(h.database);
    assert.ok(intent && intent.status === "parked");
    assert.equal(intent.parkedCode, "unknown");
    assert.equal(intent.authorityReason?.code, "post-fence-commit-exception");
    assert.equal(intent.authorityReason?.evidence.kind, "exception");
    assert.match(intent.authorityReason?.evidence.digest ?? "", /^[a-f0-9]{64}$/u);
    const current = h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(current && current.lifecycle.state === "parked-write");
    assert.equal(current.lifecycle.writeIntentId, intent.writeIntentId);
    assert.equal(current.lifecycle.intentGeneration, 1);
    assert.deepEqual(h.sessions.closeReasons(), ["poisoned"]);
  });

  it("parks when the receipt fails its proof schema — clicked, cannot prove it landed", async () => {
    const h = harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h.world.commitOutput = { transactionId: "" };
    await assert.rejects(
      h.execute(contextFor(run, claim)),
      (error: unknown) => error instanceof WriteParkedError && error.parkCode === "unknown",
    );
    const intent = intentByKey(h.database);
    assert.ok(intent && intent.status === "parked");
    assert.equal(intent.authorityReason?.code, "commit-output-schema-failure");
    assert.equal(h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.lifecycle.state, "parked-write");
  });

  it("save-verify: a present read-back commits; an absent read-back parks", async () => {
    const h = harness();
    const first = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h.world.verifyResults.push({ state: "present", proof: { transactionId: "T222222" } });
    const outcome = await h.execute(
      contextFor(first.run, first.claim, writeFixtureSaveDescriptor),
    );
    assert.deepEqual(outcome, {
      disposition: "committed",
      proofSource: "normal-output",
      output: { transactionId: "T123456" },
      proof: { transactionId: "T222222" },
    });
    assert.ok(h.world.events.includes("verify"));

    const h2 = harness();
    const second = claimRunning(h2.database, h2.clock);
    h2.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h2.world.verifyResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    await assert.rejects(
      h2.execute(contextFor(second.run, second.claim, writeFixtureSaveDescriptor)),
      (error: unknown) => error instanceof WriteParkedError && error.parkCode === "unknown",
    );
    assert.equal(intentByKey(h2.database)?.status, "parked");
  });
});
