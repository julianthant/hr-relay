import { CONFIG_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { testRunLifecycle,testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";

import assert from "node:assert/strict";
import { mkdtempSync,realpathSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,describe,it } from "vitest";
import type { WriteSequencerContext } from "../../../../src/backend/runtime/execution/run-executor.js";
import { withBoundRunConfigFingerprint,type WorkerSessionManager } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import {
createWriteSequencer,
WriteParkedError,
type ProductionWriteSequencer,
type TransactionDryRunPreview,
type WriteSequencerHooks
} from "../../../../src/backend/runtime/writes/write-sequencer.js";
import { withBrowserActionNotes } from "../../../../src/backend/systems/browser-shared/action-notes.js";
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
WRITE_FIXTURE_KEY,
WRITE_FIXTURE_NODE_ID,
WRITE_FIXTURE_NOW,
WRITE_FIXTURE_RUN_ID,
WRITE_FIXTURE_WORKER_ID,
WRITE_FIXTURE_WORKFLOW_ID,
writeFixtureDescriptor,
writeFixtureQueuedRun,
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

describe("completed transaction gesture binding", () => {

  it("parks a fenced write when the completed commit gesture cannot bind", async () => {
    const h = harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    const drained: string[] = [];

    await assert.rejects(
      () => withBrowserActionNotes(
        h.clock,
        () => h.execute({
          ...contextFor(run, claim),
          operationActionBinders: {
            commit: () => { throw new Error("declared commit target mismatch"); },
          },
        }),
        (actions) => drained.push(...actions.map((action) => action.targetId)),
      ),
      (error: unknown) => error instanceof WriteParkedError && /declared commit target mismatch/u.test(error.message),
    );

    assert.ok(h.world.events.includes("commit-click:ucpath.write-fixture.save-submit"));
    assert.equal(intentByKey(h.database)?.status, "parked");
    assert.equal(h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.lifecycle.state, "parked-write");
    assert.deepEqual(drained, ["ucpath.write-fixture.eid-input"]);
  });
});
