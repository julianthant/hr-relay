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

describe("completed transaction gesture binding", () => {
  it("binds prepare and commit inside their bounded task roles before the post-settlement drain", async () => {
    const h = harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    const bound: { role: "prepare" | "commit"; targetId: string; physicalSessionId?: string }[] = [];
    const drained: string[] = [];

    const outcome = await withBrowserActionNotes(
      h.clock,
      () => h.execute({
        ...contextFor(run, claim),
        operationActionBinders: {
          prepare: (action) => {
            bound.push({ role: "prepare", targetId: action.targetId, physicalSessionId: action.physicalSessionId });
            return action;
          },
          commit: (action) => {
            bound.push({ role: "commit", targetId: action.targetId, physicalSessionId: action.physicalSessionId });
            return action;
          },
        },
      }),
      (actions) => drained.push(...actions.map((action) => action.targetId)),
    );

    assert.deepEqual(outcome, {
      disposition: "committed",
      proofSource: "normal-output",
      output: { transactionId: "T123456" },
      proof: { transactionId: "T123456" },
    });
    assert.deepEqual(bound.map(({ role, targetId }) => [role, targetId]), [
      ["prepare", "ucpath.write-fixture.eid-input"],
      ["commit", "ucpath.write-fixture.save-submit"],
    ]);
    assert.ok(bound.every(({ physicalSessionId }) => physicalSessionId !== undefined));
    assert.equal(bound[0]?.physicalSessionId, bound[1]?.physicalSessionId);
    assert.deepEqual(drained, ["ucpath.write-fixture.eid-input", "ucpath.write-fixture.save-submit"]);
  });

  it("binds probe and verifier from their parsed task inputs and drains only after settlement", async () => {
    const h = harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h.world.verifyResults.push({ state: "present", proof: { transactionId: "T123456" } });
    const roles: string[] = [];
    const states: string[] = [];
    let drained = false;
    await withBrowserActionNotes(h.clock, () => h.execute({ ...contextFor(run, claim, writeFixtureSaveDescriptor),
      operationReadBinder: (role, taskId, parsedInput) => {
        assert.deepEqual(parsedInput, { eid: WRITE_FIXTURE_EID });
        assert.equal(taskId, `ucpath/read-write-fixture-${role}`);
        roles.push(role);
        return (action) => { assert.equal(drained, false); states.push(`${role}:${action.state}`); return action; };
      },
    }), () => { drained = true; });
    assert.deepEqual(roles, ["probe", "verify"]);
    assert.deepEqual(states, ["probe:started", "probe:completed", "verify:started", "verify:completed"]);
    assert.equal(drained, true);
    assert.equal(intentByKey(h.database)?.status, "committed");
  });
});
