import { createCommandKernel } from "../../../src/backend/runs/commands/command-kernel.js";
import { RunRecordService,runContinuationPort } from "../../../src/backend/runs/lifecycle/run-record-service.js";
import { admitDirectWorker } from "../../../src/backend/storage/sqlite/worker-slots.js";
import { reconstructConfirmedOperation } from "../../../src/models/events/confirmed-operation.js";
import { PositiveIntSchema } from "../../../src/rules/identity/ids.js";
import { NO_INTAKE_PROJECTIONS,UNWIRED_INTAKE_PARSER } from "../../support/fixtures/intake-kernel-seams.js";
import { testRunContinuation } from "../../support/fixtures/run-lifecycle-fixtures.js";

import assert from "node:assert/strict";
import { mkdtempSync,realpathSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,describe,it } from "vitest";
import type { WriteResolutionContext } from "../../../src/backend/runs/commands/command-kernel.js";
import type { WorkerSessionManager } from "../../../src/backend/runtime/workers/worker-sessions.js";
import {
createWriteRecoveryService,
createWriteResolutionExecutor,
type WriteRecoveryService,
} from "../../../src/backend/runtime/writes/write-recovery.js";
import type { RunRecord } from "../../../src/models/run/record.js";
import { deriveSchemaHash } from "../../../src/models/validation/schema-bound-value.js";
import { CommandRequestSchema } from "../../../src/rules/commands/commands.js";
import { manualClock,type TestClock } from "../../../src/rules/time/clock.js";
import {
deriveWriteAuthorityReason,
deriveWriteBindingProofDigest,
} from "../../../src/rules/write-safety/write-safety.js";
import { CONFIG_SNAPSHOT,UUID_5,UUID_6,UUID_7,UUID_8 } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../support/fixtures/phase1f-run-fixtures.js";
import {
WRITE_FIXTURE_IMPL_FINGERPRINT,
WRITE_FIXTURE_ITEM_ID,
WRITE_FIXTURE_KEY,
WRITE_FIXTURE_KEY_DIGEST,
WRITE_FIXTURE_NODE_ID,
WRITE_FIXTURE_NOW,
WRITE_FIXTURE_OBSERVATION,
WRITE_FIXTURE_RUN_ID,
WRITE_FIXTURE_STAGED_STATE,
WRITE_FIXTURE_WORKER_ID,
WRITE_FIXTURE_WORKFLOW_ID,
WriteFixtureProofSchema,
buildWriteFixtureRegistry,
createWriteFixtureWorld,
writeFixtureDescriptor,
writeFixtureDescriptorAfterUnrelatedEdit,
writeFixtureQueuedRun,
writeFixtureSessionManager,
writeFixtureSessions,
type WriteFixtureWorld
} from "../../support/fixtures/write-sequencer-fixtures.js";
import {
ManualScheduler,
recordingLogger,
type SessionFactoryHarness,
} from "../../support/helpers/phase1f-executor-harness.js";
import { AuthorityDatabase } from "../../support/helpers/synthetic-storage-admission.js";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

interface Harness {
  readonly world: WriteFixtureWorld;
  readonly database: AuthorityDatabase;
  readonly clock: TestClock;
  readonly manager: WorkerSessionManager;
  readonly ids: ReturnType<typeof sequentialIdFactory>;
  readonly recovery: WriteRecoveryService;

  readonly openedFingerprints: () => readonly string[];
  readonly restart: () => void;
}

function harness(refuseContinuation = false): Harness {
  const clock = manualClock(new Date(WRITE_FIXTURE_NOW));
  const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-write-recovery-"));
  const open=()=>AuthorityDatabase.open({path:join(root,"authority.sqlite"),busyTimeoutMs:250,migrationOwner:"write-recovery-test"},clock);
  let database=open();
  disposers.push(() => {
    database.close();
    rmSync(root, { recursive: true, force: true });
  });
  database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  database.withAuthorityTransaction(repositories => {
    const slot = admitDirectWorker(repositories, {commandId: "10000000-0000-4000-8000-000000000001",
      workflow: WRITE_FIXTURE_WORKFLOW_ID, poolIndex: 1, expectedPoolVersion: 0, processId: process.pid,
      processAcquisitionId: "10000000-0000-4000-8000-000000000002", authorityPath: join(root,"authority.sqlite"),
      processLockRoot: join(root,"locks"), now: WRITE_FIXTURE_NOW}, "10000000-0000-4000-8000-000000000003");
    assert.equal(slot.workerId, WRITE_FIXTURE_WORKER_ID);
    assert.equal(repositories.workerLeases.start({workerId: slot.workerId,workflow: WRITE_FIXTURE_WORKFLOW_ID,
      browserSystems: ["ucpath"],processId: process.pid,requestedBy:"local-operator",now: WRITE_FIXTURE_NOW}).state,"started");
  });
  const world = createWriteFixtureWorld();
  const registry = buildWriteFixtureRegistry(world);
  const inner = writeFixtureSessions(world);
  // Record the session-open fingerprint to prove recovery leases the target run snapshot.
  const opened: string[] = [];
  const spied: SessionFactoryHarness = {
    ...inner,
    factory: {
      open: (input) => {
        opened.push(String(input.configFingerprint));
        return inner.factory.open(input);
      },
    },
  };
  const manager = writeFixtureSessionManager(spied, registry, clock);
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
  });
  return {
    world, get database(){return database;}, clock, manager, ids, recovery,
    restart:()=>{database.close();database=open();},
    openedFingerprints: () => Object.freeze([...opened]),
  };
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
  const claimed = h.database.authority.runs.claimNext({
    workflow: WRITE_FIXTURE_WORKFLOW_ID,
    workerId: WRITE_FIXTURE_WORKER_ID,
    now,
  });
  if (claimed.state !== "claimed") throw new Error("claim failed");
  const claim = { workerId: WRITE_FIXTURE_WORKER_ID, claimGeneration: claimed.run.claimGeneration };
  const base = { workerId: WRITE_FIXTURE_WORKER_ID, claimedAt: now, heartbeatAt: now };
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
  assert.equal(h.database.authority.writeIntents.fenceAttempt({ intent, attempt }).state, "fenced");

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

function intentByKey(database: AuthorityDatabase) {
  return database.authority.writeIntents.findByPermanentKey("ucpath", WRITE_FIXTURE_KEY);
}

describe("ref write-safety §4.1 typed operator resolutions (the kernel seam)", () => {
  function resolutionHarness(descriptor = writeFixtureDescriptor) {
    const h = harness();
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

  function commandFor(type: "resolve-write-present" | "resolve-write-absent", run: RunRecord, payload: Record<string, unknown>) {
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

  it.each([writeFixtureDescriptor,writeFixtureDescriptorAfterUnrelatedEdit])("confirmed-present parses the exact proof schema and resumes under closure $contractFingerprint", descriptor => {
    const { h, kernel,makeKernel } = resolutionHarness(descriptor);
    const { run, writeIntentId } = parkedAttemptingWrite(h);
    // Park the intent the way recovery would have before the operator acts.
    h.database.withAuthorityTransaction((repositories) =>
      repositories.writeIntents.parkAttempt({
        writeIntentId, generation: 1, expectedVersion: 1,
        code: "unknown", message: "clicked, cannot prove it landed", now: h.clock.now().toISOString(),
        authorityReason: deriveWriteAuthorityReason("recovery-probe-unknown", "probe", "test operator park"),
      }));
    const originalAttempt=h.database.authority.writeAttempts.get(UUID_5);
    const command = commandFor("resolve-write-present", run, {
      proof: {
        schemaHash: deriveSchemaHash(WriteFixtureProofSchema, "output"),
        value: { transactionId: "T999999" },
      },
      evidenceNote: "Verified transaction T999999 in the target system",
    });
    if (command.family !== "run" || command.type !== "resolve-write-present") throw new Error("unreachable");
    assert.equal(kernel.execute(command).state,"applied");
    const resolved=h.database.authority.runs.get(run.envelope.runId);
    assert.ok(resolved);
    assert.equal(resolved.envelope.runId,run.envelope.runId);
    assert.equal(resolved.lifecycle.state,"queued");

    const intent = intentByKey(h.database);
    assert.ok(intent && intent.status === "committed");
    assert.deepEqual(intent.completionProof.value, { transactionId: "T999999" });
    const checkpoint = h.database.authority.runCheckpoints.latest(
      WRITE_FIXTURE_WORKFLOW_ID, WRITE_FIXTURE_ITEM_ID, WRITE_FIXTURE_NODE_ID);
    assert.ok(checkpoint);
    assert.equal((checkpoint.output.value as { proofSource: string }).proofSource, "operator-attestation");
    assert.equal(checkpoint.contractFingerprint,descriptor.contractFingerprint);
    assert.deepEqual(h.database.authority.writeAttempts.get(UUID_5),originalAttempt);
    const audit=h.database.authority.commandAudits.findByCommand(command.commandId);
    assert.ok(audit);
    const generation=h.database.getMeta().authorityGeneration;
    const timeline=h.database.authority.timelineEvents.page({runId:run.envelope.runId,limit:100});
    assert.equal(timeline.filter(event=>event.payload.kind==="operation-confirmed").length,1);
    const confirmed=timeline.find(event=>event.payload.kind==="operation-confirmed");
    assert.ok(confirmed);
    assert.deepEqual(reconstructConfirmedOperation(h.database.authority,confirmed).ledger.proof,command.payload.proof);
    assert.equal(h.database.authority.writeIntents.getPublication(writeIntentId)?.checkpoint.contractFingerprint,descriptor.contractFingerprint);
    assert.equal(kernel.execute(command).state,"already-applied");
    assert.equal(h.database.getMeta().authorityGeneration,generation);
    assert.deepEqual(h.database.authority.timelineEvents.page({runId:run.envelope.runId,limit:100}),timeline);
    assert.deepEqual(h.database.authority.commandAudits.findByCommand(command.commandId),audit);
    assert.deepEqual(h.database.authority.writeAttempts.get(UUID_5),originalAttempt);
    h.database.authority.runs.advanceRevision({runId:run.envelope.runId,expectedVersion:resolved.version,now:WRITE_FIXTURE_NOW});
    h.restart();
    const restartedKernel=makeKernel();
    const reopenedGeneration=h.database.getMeta().authorityGeneration;
    assert.equal(restartedKernel.execute(command).state,"already-applied");
    assert.equal(h.database.getMeta().authorityGeneration,reopenedGeneration);
    assert.deepEqual(h.database.authority.commandAudits.findByCommand(command.commandId),audit);
    assert.deepEqual(h.database.authority.writeAttempts.get(UUID_5),originalAttempt);
    assert.deepEqual(h.database.authority.timelineEvents.page({runId:run.envelope.runId,limit:100}),timeline);
    assert.deepEqual(reconstructConfirmedOperation(h.database.authority,confirmed).ledger.proof,command.payload.proof);
    assert.deepEqual(h.world.events,[],"operator attestation performs no external effects");
  });

  it("confirmed-present with a wrong proof schema hash changes nothing", () => {
    const { h, executor } = resolutionHarness();
    const { run, writeIntentId } = parkedAttemptingWrite(h);
    const parkedIntent = h.database.withAuthorityTransaction((repositories) =>
      repositories.writeIntents.parkAttempt({
        writeIntentId, generation: 1, expectedVersion: 1,
        code: "unknown", message: "clicked, cannot prove it landed", now: h.clock.now().toISOString(),
        authorityReason: deriveWriteAuthorityReason("recovery-probe-unknown", "probe", "test operator park"),
      }));
    const command = commandFor("resolve-write-present", run, {
      proof: { schemaHash: "1".repeat(64), value: { transactionId: "T999999" } },
      evidenceNote: "wrong schema",
    });
    if (command.family !== "run" || command.type !== "resolve-write-present") throw new Error("unreachable");
    const context: WriteResolutionContext = Object.freeze({
      auditId:UUID_6, command, run, intent: parkedIntent, now: h.clock.now().toISOString(),
    });
    assert.throws(
      () => h.database.withAuthorityTransaction((repositories) => executor.resolvePresent(repositories, context)),
      /bound to schema/,
    );
    assert.equal(intentByKey(h.database)?.status, "parked", "the refused resolution changed nothing");
    assert.equal(h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.lifecycle.state, "parked-write");
  });

  it("confirmed-absent records the typed operator settlement and resumes for a fresh generation", () => {
    const { h, kernel } = resolutionHarness();
    const { run, writeIntentId } = parkedAttemptingWrite(h);
    h.database.authority.writeIntents.parkAttempt({writeIntentId,generation:1,expectedVersion:1,code:"unknown",
      message:"operator absence requires parked authority",now:h.clock.now().toISOString(),
      authorityReason:deriveWriteAuthorityReason("recovery-probe-unknown","probe","test operator park")});
    const command = commandFor("resolve-write-absent", run, {
      evidenceNote: "Checked UCPath directly; the transaction is absent",
    });
    if (command.family !== "run" || command.type !== "resolve-write-absent") throw new Error("unreachable");
    assert.equal(kernel.execute(command).state,"applied");
    assert.equal(h.database.authority.runs.get(run.envelope.runId)?.lifecycle.state,"queued");
    const settled = intentByKey(h.database);
    assert.ok(settled && settled.status === "retryable");
    assert.equal(settled.settlement.state, "operator-confirmed-absent");
    if (settled.settlement.state === "operator-confirmed-absent") {
      assert.equal(settled.settlement.operator, "local-operator");
      assert.match(settled.settlement.evidenceNote, /transaction is absent/);
    }
    assert.equal(settled.generation, 1, "the resolution never itself advances the generation");
  });
});
