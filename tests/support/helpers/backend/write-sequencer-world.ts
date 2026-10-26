import { retainAuthoritySourceClosure } from "../../../../src/backend/storage/source-closure.js";
import { randomUUID } from "node:crypto";
import { runClaim } from "../../../../src/models/run/record.js";
import { CONFIG_SNAPSHOT, UUID_5, UUID_6, UUID_7, UUID_8 } from "../../fixtures/phase1c-contract-fixtures.js";
import { testRunLifecycle, testWorkerPorts, testRunService } from "../../fixtures/run-lifecycle-fixtures.js";
import assert from "node:assert/strict";
import { createBoundProfileFixture } from "../admission-fixture.js";
import { duoCeremonyGatesOver } from "../duo-ceremony-fixtures.js";
import { type WriteSequencerContext } from "../../../../src/backend/runtime/execution/run-executor.js";
import { withBoundRunConfigFingerprint, type WorkerSessionManager } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import { createWriteSequencer, type ProductionWriteSequencer, type TransactionDryRunPreview, type WriteSequencerHooks } from "../../../../src/backend/runtime/writes/write-sequencer.js";
import { type RunRecord } from "../../../../src/models/run/record.js";
import { manualClock, type TestClock } from "../../../../src/rules/time/clock.js";
import { type AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { sequentialIdFactory } from "../../fixtures/phase1f-run-fixtures.js";
import { buildWriteFixtureRegistry, createWriteFixtureWorld, WRITE_FIXTURE_EID, WRITE_FIXTURE_IMPL_FINGERPRINT, WRITE_FIXTURE_KEY, WRITE_FIXTURE_NODE_ID, WRITE_FIXTURE_NOW, WRITE_FIXTURE_RUN_ID, WRITE_FIXTURE_WORKFLOW_ID, writeFixtureDescriptor, writeFixtureQueuedRun, writeFixtureSessionManager, writeFixtureSessions, writeFixtureTransactionNode, type WriteFixtureWorld, WRITE_FIXTURE_ITEM_ID, WRITE_FIXTURE_KEY_DIGEST, WRITE_FIXTURE_OBSERVATION, WRITE_FIXTURE_STAGED_STATE } from "../../fixtures/write-sequencer-fixtures.js";
import { ManualScheduler, recordingEmitter, recordingLogger } from "../phase1f-executor-harness.js";
import { AuthorityDatabase, type AuthorityWriteCommitHooks } from "../synthetic-storage-admission.js";
import { deriveWriteBindingProofDigest } from "../../../../src/rules/write-safety/write-safety.js";

interface Harness {
  readonly world: WriteFixtureWorld;
  readonly retain: (error: unknown) => Error;
  readonly admitWorker: (poolIndex: number) => void;
  readonly database: AuthorityDatabase;
  readonly clock: TestClock;
  readonly manager: WorkerSessionManager;
  readonly sessions: ReturnType<typeof writeFixtureSessions>;
  readonly scheduler: ManualScheduler;
  readonly emitter: ReturnType<typeof recordingEmitter>;
  readonly ids: ReturnType<typeof sequentialIdFactory>;
  readonly sequencer: ProductionWriteSequencer;
  readonly execute: (context: WriteSequencerContext) => Promise<unknown>;
  readonly executeDryRun: (context: WriteSequencerContext) => Promise<TransactionDryRunPreview>;
}

const retainedWriteSequencerOwners = new Set<object>();

export function createWriteSequencerTestWorld() {
  const disposers: (() => void)[] = [];

  function harness(options: Readonly<{
    hooks?: WriteSequencerHooks;
    commitHooks?: AuthorityWriteCommitHooks;
    emitterThrowsOn?: "data.observed" | "failed-task-span" | "transaction.fenced" | "verify-start";
  }> = {}): Harness {
    const held: { profile?: ReturnType<typeof createBoundProfileFixture>; database?: AuthorityDatabase; manager?: WorkerSessionManager; primary?: { error: unknown }; failure?: Error } = {};
    retainedWriteSequencerOwners.add(held);
    try {
    const clock = manualClock(new Date(WRITE_FIXTURE_NOW));
    const profile = createBoundProfileFixture(); held.profile = profile;
    const database = AuthorityDatabase.open(
      { path: profile.path, busyTimeoutMs: 250, migrationOwner: "write-sequencer-test" },
      clock,
      options.commitHooks,
    );
    held.database = database;
    let closeAttempted = false;
    disposers.push(() => {
      if (held.failure !== undefined) throw held.failure;
      if (closeAttempted) return;
      closeAttempted = true;
      try { database.close(); profile.close(); retainedWriteSequencerOwners.delete(held); }
      catch (error) { held.primary ??= { error }; held.failure = retainAuthoritySourceClosure(held.primary.error === error ? [error] : [held.primary.error, error], { admission: held }); throw held.failure; }
    });
    database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    const admitWorker = (poolIndex: number): void => {
      testWorkerPorts(database, clock, { path: profile.path, descriptor: writeFixtureDescriptor, poolIndex });
    };
    admitWorker(1);
    const world = createWriteFixtureWorld();
    const registry = buildWriteFixtureRegistry(world);
    const sessions = writeFixtureSessions(world);
    const manager = writeFixtureSessionManager(sessions, registry, clock, duoCeremonyGatesOver(database, clock, new ManualScheduler(clock))); held.manager = manager;
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
    const retain = (error: unknown): Error => {
      held.primary ??= { error };
      held.failure ??= retainAuthoritySourceClosure([held.primary.error], { admission: held });
      return held.failure;
    };
    return { world, retain, admitWorker, database, clock, manager, sessions, scheduler, emitter, ids, sequencer, execute, executeDryRun };
    } catch (error) {
      held.primary = { error }; held.failure = retainAuthoritySourceClosure([error], { admission: held }); throw held.failure;
    }
  }

  function claimRunning(
    database: AuthorityDatabase,
    clock: TestClock,
    runInput: Record<string, unknown> = writeFixtureQueuedRun(),
    requestedWorkerId?: string,
  ): { run: RunRecord; claim: { workerId: string; claimGeneration: number } } {
    const now = clock.now().toISOString();
    const enqueued = database.authority.runs.enqueue(runInput);
    assert.equal(enqueued.state, "inserted");
    const member = requestedWorkerId === undefined
      ? database.authority.workerSlots.list(WRITE_FIXTURE_WORKFLOW_ID).find(slot => slot.poolIndex === 1 && slot.retiredAt === null)
      : database.authority.workerSlots.get(requestedWorkerId);
    assert.ok(member && member.workflow === WRITE_FIXTURE_WORKFLOW_ID && member.retiredAt === null);
    const workerId = member.workerId;
    if (requestedWorkerId !== undefined) assert.equal(workerId, requestedWorkerId);
    const lease = database.authority.workerLeases.get(workerId);
    if (lease === undefined || member === undefined || member.retiredAt !== null) throw new Error("fixture claim authority unavailable");
    const workerLifetime = { leaseGeneration: lease.leaseGeneration, membershipRevision: member.membershipRevision };
    const claimed = database.authority.runs.claimNext({
      workerLifetime,
      workflow: WRITE_FIXTURE_WORKFLOW_ID,
      workerId,
      now,
    });
    if (claimed.state !== "claimed") throw new Error(`claim outcome was ${claimed.state}`);
    const claim = { workerId, claimGeneration: claimed.run.claimGeneration };
    const base = { workerId, claimedAt: now, heartbeatAt: now, workerLifetime };
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

  function releaseClaim(database: AuthorityDatabase, clock: TestClock, run: RunRecord, claim: { workerId: string; claimGeneration: number }): void {
    const current = database.authority.runs.get(run.envelope.runId); assert.ok(current);
    assert.deepEqual(database.authority.writeIntents.listByRun(current.envelope.runId), []);
    const currentClaim = runClaim(current); assert.ok(currentClaim);
    assert.equal(currentClaim.workerId, claim.workerId);
    assert.equal(currentClaim.claimGeneration, claim.claimGeneration);
    assert.equal(testRunService(database, clock).requeue({ commandId: randomUUID(), runId: current.envelope.runId,
      expectedVersion: current.version, claim, cause: 'recovery' }).state, "applied");
    assert.equal(runClaim(database.authority.runs.get(current.envelope.runId) ?? (() => { throw new Error("write-fixture-run-missing"); })()), undefined);
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
      itemId: runId === WRITE_FIXTURE_RUN_ID ? WRITE_FIXTURE_ITEM_ID : runId,
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
  const cleanup = () => {
    for (const dispose of disposers.splice(0)) dispose();
  };
  return { disposers, harness, claimRunning, releaseClaim, contextFor, intentByKey, attemptingIntentFixture, cleanup };
}
