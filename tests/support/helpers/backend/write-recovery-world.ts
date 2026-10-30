import { retainAuthoritySourceClosure } from '../../../../src/backend/storage/source-closure.js';
import assert from "node:assert/strict";

import { createBoundProfileFixture } from "../admission-fixture.js";
import { duoCeremonyGatesOver } from "../duo-ceremony-fixtures.js";
import { createCommandKernel } from "../../../../src/backend/runs/commands/command-kernel.js";
import { RunRecordService,runContinuationPort } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { type WorkerSessionManager } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import { createWriteRecoveryService,createWriteResolutionExecutor,type WriteRecoveryService } from "../../../../src/backend/runtime/writes/write-recovery.js";

import { type RunRecord } from "../../../../src/models/run/record.js";
import { CommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { PositiveIntSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock,type TestClock } from "../../../../src/rules/time/clock.js";
import { deriveWriteBindingProofDigest } from "../../../../src/rules/write-safety/write-safety.js";
import { NO_INTAKE_PROJECTIONS,UNWIRED_INTAKE_PARSER } from "../../fixtures/intake-kernel-seams.js";
import { CONFIG_SNAPSHOT,UUID_5,UUID_6,UUID_7,UUID_8 } from "../../fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../fixtures/phase1f-run-fixtures.js";
import { testRunContinuation, testAdmittedWorker, testWorkerLifetime } from "../../fixtures/run-lifecycle-fixtures.js";
import { WRITE_FIXTURE_IMPL_FINGERPRINT,WRITE_FIXTURE_ITEM_ID,WRITE_FIXTURE_KEY,WRITE_FIXTURE_KEY_DIGEST,WRITE_FIXTURE_NODE_ID,WRITE_FIXTURE_NOW,WRITE_FIXTURE_OBSERVATION,WRITE_FIXTURE_RUN_ID,WRITE_FIXTURE_STAGED_STATE,WRITE_FIXTURE_WORKER_ID,WRITE_FIXTURE_WORKFLOW_ID,buildWriteFixtureRegistry,createWriteFixtureWorld,writeFixtureDescriptor,writeFixtureQueuedRun,writeFixtureSessionManager,writeFixtureSessions,type WriteFixtureWorld } from "../../fixtures/write-sequencer-fixtures.js";
import { ManualScheduler,recordingLogger,type SessionFactoryHarness } from "../phase1f-executor-harness.js";
import { AuthorityDatabase } from "../synthetic-storage-admission.js";
import { boundFixtureWorker, detachBoundFixtureWorkers } from "../synthetic-database-admission.js";
import { fenceWriteFixture } from "../write-fence-fixture.js";

interface Harness {
  readonly world: WriteFixtureWorld;
  readonly workerId: string;
  readonly database: AuthorityDatabase;
  readonly clock: TestClock;
  readonly manager: WorkerSessionManager;
  readonly ids: ReturnType<typeof sequentialIdFactory>;
  readonly recovery: WriteRecoveryService;

  readonly openedFingerprints: () => readonly string[];
  readonly restart: () => void;
}



const retainedWriteRecoveryOwners = new Set<object>();

export function createWriteRecoveryTestWorld() {
  const disposers: (() => void | Promise<void>)[] = [];

  const SIGNAL = new AbortController().signal;

  async function harness(refuseContinuation = false): Promise<Harness> {
    const held: { profile?: Awaited<ReturnType<typeof createBoundProfileFixture>>; database?: AuthorityDatabase; worker?: ReturnType<typeof testAdmittedWorker>; manager?: WorkerSessionManager; world?: WriteFixtureWorld; recovery?: WriteRecoveryService; primary?: unknown; failure?: Error } = {};
    retainedWriteRecoveryOwners.add(held);
    try {
    const clock = manualClock(new Date(WRITE_FIXTURE_NOW));
    const profile = await createBoundProfileFixture(); held.profile = profile;

    const open=()=>AuthorityDatabase.open({path:profile.path,busyTimeoutMs:250,migrationOwner:"write-recovery-test"},clock);
    let database=open(); held.database = database;
    let disposeAttempted = false, disposeFailure: Error | undefined;
    disposers.push(async () => {
      if (held.failure !== undefined) throw held.failure;
      if (disposeAttempted) { if (disposeFailure !== undefined) throw disposeFailure; return; }
      disposeAttempted = true;
      try { await held.manager?.closeAll("worker-stop"); detachBoundFixtureWorkers(database); database.close(); await profile.close(); }
      catch (error) { held.primary = error; disposeFailure = retainAuthoritySourceClosure([error], { admission: held }); held.failure = disposeFailure; retainedWriteRecoveryOwners.add(held); throw disposeFailure; }
    });
    database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    const admitted = testAdmittedWorker(database, clock, { path: profile.path, workflow: WRITE_FIXTURE_WORKFLOW_ID, poolIndex: 1, browserSystems: ["ucpath"] });
    held.worker = admitted;
    const slot = admitted.member;
    assert.equal(slot.workerId, WRITE_FIXTURE_WORKER_ID);
    assert.ok(boundFixtureWorker(database, profile.path, slot.workerId));
    assert.equal(slot.workflow, WRITE_FIXTURE_WORKFLOW_ID);
    assert.equal(slot.poolIndex, 1);
    assert.equal(slot.ordinal, 1);
    assert.ok(admitted.started);
    assert.equal(admitted.started.state, "started");
    const world = createWriteFixtureWorld(); held.world = world;
    const registry = buildWriteFixtureRegistry(world);
    const inner = writeFixtureSessions(world);
    // Record the session-open fingerprint to prove recovery leases the target run snapshot.
    const opened: string[] = [];
    const spied: SessionFactoryHarness = {
      ...inner,
      factory: { probeProfile: async () => undefined,
        open: (input) => {
          opened.push(String(input.configFingerprint));
          return inner.factory.open(input);
        },
      },
    };
    const scheduler = new ManualScheduler(clock);
    const manager = await writeFixtureSessionManager(spied, registry, clock, {
      openGate: input => duoCeremonyGatesOver(database, clock, scheduler).openGate(input),
    }); held.manager = manager;
    const ids = sequentialIdFactory("c");
    const recovery = createWriteRecoveryService({
      continuation: { transition: (input) => {
        if (refuseContinuation) {
          assert.ok(database.authority.runCheckpoints.latest(WRITE_FIXTURE_WORKFLOW_ID, WRITE_FIXTURE_ITEM_ID, WRITE_FIXTURE_NODE_ID));
          return { state: "refused", refusal: { reason: "conflict", currentVersion: PositiveIntSchema.parse(input.expectedVersion + 1) } };
        }
        return testRunContinuation(database, clock).transition(input);
      } },
      stores: registry,
      authority: database,
      sessions: manager,
      clock,
      ids,
      scheduler: new ManualScheduler(clock),
      taskDeadlineMs: 60_000,
      operator: "local-operator",
      log: recordingLogger().log,
      resolveImplFingerprint: () => WRITE_FIXTURE_IMPL_FINGERPRINT,
    }); held.recovery = recovery;
    retainedWriteRecoveryOwners.delete(held);
    return {
      world, workerId: slot.workerId, get database(){return database;}, clock, manager, ids, recovery,
      restart:()=>{try { database.close(); database=open(); held.database=database; } catch(error) { held.primary=error; retainedWriteRecoveryOwners.add(held); held.failure=retainAuthoritySourceClosure([error], { admission: held }); throw held.failure; }},
      openedFingerprints: () => Object.freeze([...opened]),
    };
  } catch(error) { held.primary=error; held.failure=retainAuthoritySourceClosure([error], { admission: held }); throw held.failure; }
  }

  function ownBindingProof() {
    return {
      kind: "subject-match",
      version: 1,
      proofId: UUID_7,
      runId: WRITE_FIXTURE_RUN_ID,
      attempt: 1,
      leaseId: UUID_6,
      taskId: "ucpath/submit-write-fixture",
      observationId: WRITE_FIXTURE_OBSERVATION,
      pageStateId: WRITE_FIXTURE_STAGED_STATE,
      expected: { kind: "person", identifierKind: "eid", bindingDigest: "a".repeat(64), displaySuffix: "2345" },
      observed: { kind: "person", identifierKind: "eid", bindingDigest: "a".repeat(64), displaySuffix: "2345" },
      match: "match",
      observedAt: WRITE_FIXTURE_NOW,
      afterPrepareSpanPath: "wf-090000-2222/submit-write/prepare",
    };
  }

  function parkedAttemptingWrite(h: Harness, taskIdValue = "ucpath/submit-write-fixture", queued: unknown = writeFixtureQueuedRun()): {
    run: RunRecord;
    writeIntentId: string;
  } {
    const now = h.clock.now().toISOString();
    assert.equal(h.database.authority.runs.enqueue(queued).state, "inserted");
    const lifetime = testWorkerLifetime(h.database, WRITE_FIXTURE_WORKFLOW_ID, 1);
    assert.equal(lifetime.workerId, WRITE_FIXTURE_WORKER_ID);
    const claimed = h.database.authority.runs.claimNext({
      workflow: WRITE_FIXTURE_WORKFLOW_ID,
      workerId: h.workerId,
      now, workerLifetime: lifetime.workerLifetime });
    if (claimed.state !== "claimed") throw new Error("claim failed");
    const claim = { workerId: h.workerId, claimGeneration: claimed.run.claimGeneration };
    const base = { workerLifetime: lifetime.workerLifetime,  workerId: h.workerId, claimedAt: now, heartbeatAt: now };
    assert.equal(h.database.authority.runs.transition({
      runId: WRITE_FIXTURE_RUN_ID, expectedVersion: claimed.run.version, claim,
      lifecycle: { state: "validating", ...base }, now,
    }).state, "applied");
    assert.equal(h.database.authority.runs.transition({
      runId: WRITE_FIXTURE_RUN_ID, expectedVersion: claimed.run.version + 1, claim,
      lifecycle: { state: "running", ...base, currentNodeId: WRITE_FIXTURE_NODE_ID }, now,
    }).state, "applied");

    const bindingProof = { ...ownBindingProof(), taskId: taskIdValue };
    const bindingProofDigest = deriveWriteBindingProofDigest(bindingProof);
    const intent = {
      writeIntentId: UUID_8,
      workflowId: WRITE_FIXTURE_WORKFLOW_ID,
      itemId: WRITE_FIXTURE_ITEM_ID,
      taskId: taskIdValue,
      system: "ucpath",
      idempotencyKey: WRITE_FIXTURE_KEY,
      idempotencyKeyDigest: WRITE_FIXTURE_KEY_DIGEST,
      currentAttemptId: UUID_5,
      generation: 1,
      runId: WRITE_FIXTURE_RUN_ID,
      runAttempt: 1,
      bindingProof,
      bindingProofDigest,
      fencedAt: now,
      version: 1,
      createdAt: now,
      updatedAt: now,
      status: "attempting",
    };
    const attempt = {
      writeAttemptId: UUID_5,
      writeIntentId: UUID_8,
      generation: 1,
      runId: WRITE_FIXTURE_RUN_ID,
      runAttempt: 1,
      leaseId: UUID_6,
      bindingProof,
      bindingProofDigest,
      fencedAt: now,
      outcome: { state: "attempting" },
      recordedAt: now,
    };
    assert.equal(fenceWriteFixture(h.database, { intent, attempt }).state, "fenced");

    const parked = h.database.authority.runs.transition({
      runId: WRITE_FIXTURE_RUN_ID,
      expectedVersion: claimed.run.version + 2,
      claim,
      lifecycle: {
        state: "parked-write",
        writeIntentId: UUID_8,
        intentGeneration: 1,
        parkedAt: now,
        code: "unknown",
        message: "claim expired mid-write; routed to recovery",
      },
      now,
    });
    if (parked.state !== "applied") throw new Error("park transition failed");
    return { run: parked.run, writeIntentId: UUID_8 };
  }
  async function resolutionHarness(descriptor = writeFixtureDescriptor) {
    const h = await harness();
    const executor = createWriteResolutionExecutor({
      continuation: testRunContinuation(h.database, h.clock),
      descriptors: {
        resolve: (workflowId) =>
          String(descriptor.id) === workflowId ? descriptor : undefined,
      },
      authority: h.database,
      ids: h.ids,
      resolveImplFingerprint: () => WRITE_FIXTURE_IMPL_FINGERPRINT,
    });
    const makeKernel=()=>{
    const lifecycle = new RunRecordService({database:h.database,clock:h.clock,ids:h.ids,publishQueued:()=>{}});
    const unused=():never=>{throw new Error("unused operator resolution port");};
    const kernel=createCommandKernel({authority:h.database,lifecycle,clock:h.clock,ids:h.ids,appVersion:"1.0.0",
      descriptors:{resolve:workflow=>workflow===String(descriptor.id)?descriptor:undefined},
      configIdentity:{configSnapshotId:CONFIG_SNAPSHOT.configSnapshotId,configFingerprint:CONFIG_SNAPSHOT.fingerprint},
      intakeParser:UNWIRED_INTAKE_PARSER,intakeProjections:NO_INTAKE_PROJECTIONS,
      workerRuntime:{pool:{planPoolWorkerCount:unused,spawnPoolWorker:unused,refreshPoolBrowser:unused,reopenPoolBrowser:unused,
        stopPoolWorker:unused,pausePoolWorker:unused,resumePoolWorker:unused}},
      writeResolution:createWriteResolutionExecutor({authority:h.database,continuation:runContinuationPort(lifecycle),
        descriptors:{resolve:workflow=>workflow===String(descriptor.id)?descriptor:undefined},ids:h.ids,
        resolveImplFingerprint:()=>WRITE_FIXTURE_IMPL_FINGERPRINT})});
    return kernel;
    };
    return { h, executor, kernel:makeKernel(),makeKernel };
  }

  function commandFor(type: "recheck-write" | "resolve-write-absent", run: RunRecord, payload: Record<string, unknown>) {
    return CommandRequestSchema.parse({
      commandId: UUID_7,
      requestedAt: WRITE_FIXTURE_NOW,
      requestedBy: "local-operator",
      source: "dashboard",
      family: "run",
      type,
      target: {
        runId: run.envelope.runId,
        expectedVersion: run.version,
        writeIntentId: UUID_8,
        intentGeneration: 1, writeAttemptId: UUID_5, bindingProofDigest: deriveWriteBindingProofDigest(ownBindingProof()),
      },
      payload: {...payload,occurrenceKeyDigest:WRITE_FIXTURE_KEY_DIGEST},
    });
  }

  const cleanup = async () => {
    const failures: unknown[] = [];
    for (const dispose of disposers.splice(0)) { try { await dispose(); } catch (error) { failures.push(error); } }
    if (failures.length > 0) throw new AggregateError(failures, 'Write recovery fixture cleanup failed', { cause: failures[0] });
  };
  return { disposers, SIGNAL, harness, ownBindingProof, parkedAttemptingWrite, resolutionHarness, commandFor, cleanup };
}
