import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "vitest";
import { deriveWriteBindingProofDigest } from "../../../src/rules/write-safety/write-safety.js";
import { WRITE_ATTEMPT, WRITE_INTENT_ATTEMPTING } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { NOW as FOUNDATION_NOW, id } from "../../support/helpers/database-foundation/fixtures.js";
import { resolutionCommand, resolutionFixture } from "../../support/helpers/failure-resolution/fixtures.js";
import { afterEach } from "vitest";
import { repeatOccurrenceKey } from "../../../src/models/run/rerun.js";
import { WriteIntentRecordSchema, deriveIdempotencyKeyDigest } from "../../../src/rules/write-safety/write-safety.js";
import { sourceBoundHarness } from "../../support/fixtures/integration/source-bound-fixtures.js";
import { absentProbeEvidence, writeFixtureDescriptor, writeFixtureParallelDescriptor } from "../../support/fixtures/write-sequencer-fixtures.js";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { manualClock } from "../../../src/rules/time/clock.js";
import { ATOMIC_WRITE_COMMIT as HISTORICAL_ATOMIC_WRITE_COMMIT, NOW, UUID_1, UUID_8 } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { AuthorityDatabase } from "../../support/helpers/synthetic-storage-admission.js";
import { currentAtomicWriteFixture, seedAtomicWriteOwner } from "../../support/helpers/timeline-write-fixture.js";
import { createCommandKernel } from "../../../src/backend/runs/commands/command-kernel.js";
import { RunRecordService, runContinuationPort } from "../../../src/backend/runs/lifecycle/run-record-service.js";
import { admitDirectWorker } from "../../../src/backend/storage/sqlite/worker-slots.js";
import { reconstructConfirmedOperation } from "../../../src/models/events/confirmed-operation.js";
import { PositiveIntSchema } from "../../../src/rules/identity/ids.js";
import { NO_INTAKE_PROJECTIONS, UNWIRED_INTAKE_PARSER } from "../../support/fixtures/intake-kernel-seams.js";
import { testRunContinuation } from "../../support/fixtures/run-lifecycle-fixtures.js";
import type { WriteResolutionContext } from "../../../src/backend/runs/commands/command-kernel.js";
import type { WorkerSessionManager } from "../../../src/backend/runtime/workers/worker-sessions.js";
import { createWriteRecoveryService, createWriteResolutionExecutor, type WriteRecoveryService } from "../../../src/backend/runtime/writes/write-recovery.js";
import type { RunRecord } from "../../../src/models/run/record.js";
import { deriveSchemaHash } from "../../../src/models/validation/schema-bound-value.js";
import { CommandRequestSchema } from "../../../src/rules/commands/commands.js";
import { type TestClock } from "../../../src/rules/time/clock.js";
import { deriveWriteAuthorityReason } from "../../../src/rules/write-safety/write-safety.js";
import { CONFIG_SNAPSHOT, UUID_5, UUID_6, UUID_7 } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../support/fixtures/phase1f-run-fixtures.js";
import { WRITE_FIXTURE_IMPL_FINGERPRINT, WRITE_FIXTURE_ITEM_ID, WRITE_FIXTURE_KEY, WRITE_FIXTURE_KEY_DIGEST, WRITE_FIXTURE_NODE_ID, WRITE_FIXTURE_NOW, WRITE_FIXTURE_OBSERVATION, WRITE_FIXTURE_RUN_ID, WRITE_FIXTURE_STAGED_STATE, WRITE_FIXTURE_WORKER_ID, WRITE_FIXTURE_WORKFLOW_ID, WriteFixtureProofSchema, buildWriteFixtureRegistry, createWriteFixtureWorld, writeFixtureDescriptorAfterUnrelatedEdit, writeFixtureQueuedRun, writeFixtureSessionManager, writeFixtureSessions, type WriteFixtureWorld } from "../../support/fixtures/write-sequencer-fixtures.js";
import { ManualScheduler, recordingLogger, type SessionFactoryHarness } from "../../support/helpers/phase1f-executor-harness.js";
import { createWriteSequencerTestWorld } from "../../support/helpers/backend/write-sequencer-world.js";
import { z } from "zod";
import { WriteSafetyAuthorityError } from "../../../src/rules/write-safety/write-safety.js";
import { ambiguousProbeVerdict, unknownProbeVerdict } from "../../support/fixtures/write-sequencer-fixtures.js";

{
const NOW = FOUNDATION_NOW;

describe("D resolution command authority", () => {
  it("annotation cannot settle a parked UNKNOWN write or admit its generic retry", () => {
    const f = resolutionFixture();
    try {
      const run = f.createRun(id(83));
      assert.equal(run.lifecycle.state, "running");
      if (run.lifecycle.state !== "running") throw new Error("fixture not running");
      const bindingProof = { ...WRITE_INTENT_ATTEMPTING.bindingProof, runId: run.envelope.runId };
      const bindingProofDigest = deriveWriteBindingProofDigest(bindingProof);
      const intent = { ...WRITE_INTENT_ATTEMPTING, runId: run.envelope.runId, bindingProof, bindingProofDigest,
        workflowId: run.envelope.workflow, itemId: run.envelope.itemId };
      assert.equal(f.db.authority.writeIntents.fenceAttempt({ intent,
        attempt: { ...WRITE_ATTEMPT, runId: run.envelope.runId, bindingProof, bindingProofDigest } }).state, "fenced");
      const parked = f.db.authority.runs.transition({ runId: run.envelope.runId, expectedVersion: run.version,
        claim: { workerId: run.lifecycle.workerId, claimGeneration: run.claimGeneration },
        lifecycle: { state: "parked-write", writeIntentId: intent.writeIntentId, intentGeneration: 1,
          parkedAt: NOW, code: "unknown", message: "Synthetic UNKNOWN submit" }, now: NOW });
      assert.equal(parked.state, "applied");
      if (parked.state !== "applied") throw new Error("fixture not parked");
      const retry = () => f.kernel.execute({ commandId: randomUUID(), requestedAt: NOW,
        requestedBy: "local-operator", source: "dashboard", reason: "Synthetic retry",
        family: "run", type: "retry", target: { runId: run.envelope.runId, expectedVersion: parked.run.version } });
      const before = JSON.stringify({ run: f.db.authority.runs.get(run.envelope.runId),
        intent: f.db.authority.writeIntents.get(intent.writeIntentId) });
      const first = retry(); assert.equal(first.state, "rejected");
      if (first.state === "rejected") assert.match(first.message, /never generic retry/u);
      assert.equal(f.kernel.execute(resolutionCommand()).state, "applied");
      const after = retry(); assert.equal(after.state, "rejected");
      if (after.state === "rejected") assert.match(after.message, /never generic retry/u);
      assert.equal(JSON.stringify({ run: f.db.authority.runs.get(run.envelope.runId),
        intent: f.db.authority.writeIntents.get(intent.writeIntentId) }), before);
      assert.equal(f.db.authority.failures.get(f.record.failureId)?.writeState, "unknown");
    } finally { f.dispose(); }
  });
});
}

{
const disposers: (() => void)[] = [];
function harness(parallel = false) { const h = sourceBoundHarness(parallel ? writeFixtureParallelDescriptor : writeFixtureDescriptor); disposers.push(h.dispose); return h; }
async function completed(h: ReturnType<typeof harness>) {
  const run = h.start(h.proposal());
  h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
  const outcome = await h.execute(run);
  assert.equal(outcome.state, "done", JSON.stringify(outcome.state === "failed" ? h.database.authority.failures.get(outcome.failureId) : outcome));
  return h.fresh(run);
}

describe("source-bound repeat through planner, kernel, service and interpreter", () => {
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); });


  it("serializes distinct confirmations against an unresolved sibling and keeps orphan intents fenced", async () => {
    const h = harness(true); const source = await completed(h);
    const warning = h.proposal(source); assert.ok(warning.rerun);
    const one = h.start(h.proposal(source, warning.rerun.warningDigest));
    const two = h.start(h.proposal(source, warning.rerun.warningDigest));
    h.world.probeResults.push({ state: "present", proof: { transactionId: "T123456" } });
    await h.execute(one); assert.equal(h.fresh(one).lifecycle.state, "parked-write");
    const clicks = h.world.events.filter((event) => event.startsWith("commit-click")).length;
    await h.execute(two);
    assert.equal(h.world.events.filter((event) => event.startsWith("commit-click")).length, clicks);
    assert.deepEqual(h.database.authority.writeIntents.listByRun(two.envelope.runId), []);
    const ordinary = h.start(h.proposal()); await h.execute(ordinary);
    assert.equal(h.world.events.filter((event) => event.startsWith("commit-click")).length, clicks, "ordinary writes also honor the repeat fence");
    assert.deepEqual(h.database.authority.writeIntents.listByRun(ordinary.envelope.runId), []);
    const unresolved = h.database.authority.writeIntents.listByRun(one.envelope.runId)[0];
    assert.equal(unresolved.status, "parked"); assert.ok(unresolved.occurrence);
    // Feed the real fenced record to a fresh adapter with no originating lifecycle row.
    const orphan = harness();
    const attempt = h.database.authority.writeAttempts.listByIntent(unresolved.writeIntentId)[0];
    const { parkedCode, message, authorityReason, ...identity } = unresolved;
    void parkedCode; void message; void authorityReason;
    const fenced = WriteIntentRecordSchema.parse({ ...identity, status: "attempting" });
    // The baseline is copied as immutable settled evidence; neither originating run exists here.
    const baseline = h.database.authority.writeIntents.listByRun(source.envelope.runId)[0];
    assert.equal(baseline.status, "committed");
    const { runId, runAttempt, currentAttemptId, bindingProof, bindingProofDigest, fencedAt, confirmedAt, completionProof, ...baseIdentity } = baseline;
    void runId; void runAttempt; void currentAttemptId; void bindingProof; void bindingProofDigest; void fencedAt;
    orphan.database.authority.writeIntents.recordObservedPresent({ ...baseIdentity, status: "observed-present", observedProof: completionProof, observedAt: confirmedAt });
    orphan.database.authority.writeIntents.fenceAttempt({ intent: fenced, attempt: { ...attempt, outcome: { state: "attempting" } } });
    assert.equal(orphan.database.authority.runs.get(one.envelope.runId), undefined);
    const otherCommand = orphan.ids.uuid();
    const key = repeatOccurrenceKey(unresolved.occurrence.businessKeyDigest, otherCommand, unresolved.occurrence.nodeId);
    const next = { ...fenced, writeIntentId: orphan.ids.uuid(), idempotencyKey: key, idempotencyKeyDigest: deriveIdempotencyKeyDigest("ucpath", key),
      occurrence: { ...unresolved.occurrence, confirmationCommandId: otherCommand } };
    assert.throws(() => orphan.database.authority.writeIntents.fenceAttempt({ intent: next,
      attempt: { ...attempt, writeIntentId: next.writeIntentId, outcome: { state: "attempting" } } }), /unresolved write occurrence/);
  });



});
}

{
const ATOMIC_WRITE_COMMIT = currentAtomicWriteFixture(HISTORICAL_ATOMIC_WRITE_COMMIT);

const roots: string[] = [];
const openDatabases: AuthorityDatabase[] = [];
const databasePaths = new WeakMap<AuthorityDatabase, string>();
const CLOCK = manualClock(new Date(NOW));

function databasePath(name = "authority.sqlite"): string {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-rebuild-sqlite-"));
  roots.push(root);
  return join(root, name);
}

function openDatabase(path = databasePath(), busyTimeoutMs = 250): AuthorityDatabase {
  const database = AuthorityDatabase.open({ path, busyTimeoutMs, migrationOwner: "unit-test" }, CLOCK);
  openDatabases.push(database);
  databasePaths.set(database, path);
  return database;
}

describe("authority generation accounting", () => {
afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});


  it("rolls back a caught nested fence failure to its savepoint without leaking an intent", () => {
    const database = openDatabase();
    seedAtomicWriteOwner(database, ATOMIC_WRITE_COMMIT, databasePaths.get(database) ?? (() => { throw new Error("missing fixture path"); })());
    database.authority.writeIntents.fenceAttempt({ intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT });
    const generationBefore = database.getMeta().authorityGeneration;
    const competingKey = "10001573|termination|2026-08-03";
    const competingIntent = {
      ...WRITE_INTENT_ATTEMPTING,
      writeIntentId: UUID_8,
      idempotencyKey: competingKey,
      idempotencyKeyDigest: deriveIdempotencyKeyDigest("ucpath", competingKey),
    };
    const competingAttempt = { ...WRITE_ATTEMPT, writeIntentId: UUID_8 };

    database.withAuthorityTransaction(() => {
      assert.throws(
        () => database.authority.writeIntents.fenceAttempt({ intent: competingIntent, attempt: competingAttempt }),
        /retained-identity-conflict/u,
      );
    });

    assert.equal(database.authority.writeIntents.get(UUID_8), undefined);
    assert.equal(database.authority.writeIntents.get(UUID_1)?.status, "attempting");
    assert.equal(database.getMeta().authorityGeneration, generationBefore);
  });
});
}

{
const disposers: (() => void)[] = [];

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
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

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
}

{
const { disposers, harness, claimRunning, contextFor, intentByKey } = createWriteSequencerTestWorld();

describe("the seven-beat happy path", () => {
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});


  it("keeps a probe observation emitted when that task throws later", async () => {
    const h = harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h.world.probeThrowsAfterRecord = new Error("probe failed after observing the page");

    await assert.rejects(h.execute(contextFor(run, claim)), (error: unknown) => {
      assert.ok(error instanceof WriteSafetyAuthorityError);
      assert.equal(error.authorityReason.code, "prewrite-probe-exception");
      assert.doesNotMatch(error.message, /probe failed after observing the page/u);
      assert.equal(error.cause, h.world.probeThrowsAfterRecord);
      return true;
    });

    assert.deepEqual(h.emitter.events().map((event) => [
      event.t,
      "outcome" in event ? event.outcome : "",
    ]), [
      ["span.started", ""],
      ["data.observed", ""],
      ["span.ended", "failed"],
    ]);
    assert.equal(intentByKey(h.database), undefined, "a pre-fence throw creates no intent");
  });

  it("preserves a probe task error first when its failed-span writer also throws", async () => {
    const h = harness({ emitterThrowsOn: "failed-task-span" });
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h.world.probeThrowsAfterRecord = new Error("PRIMARY_PROBE_TASK_FAILURE");

    await assert.rejects(
      h.execute(contextFor(run, claim)),
      (error: unknown) => {
        assert.ok(error instanceof WriteSafetyAuthorityError);
        assert.ok(error.cause instanceof AggregateError);
        assert.equal(error.cause.cause, h.world.probeThrowsAfterRecord);
        assert.deepEqual(
          error.cause.errors.map((entry: unknown) => entry instanceof Error ? entry.message : String(entry)),
          ["PRIMARY_PROBE_TASK_FAILURE", "injected failed-task-span writer failure"],
        );
        return true;
      },
    );

    assert.equal(intentByKey(h.database), undefined);
    assert.ok(!h.world.events.some((event) => event.startsWith("commit-click")));
  });

  it("fails an undeclared transaction observation by task and field before staging", async () => {
    const h = harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h.world.recordUndeclaredProbeField = true;

    await assert.rejects(
      h.execute(contextFor(run, claim)),
      (error: unknown) => {
        assert.ok(error instanceof WriteSafetyAuthorityError);
        assert.ok(error.cause instanceof z.ZodError);
        assert.match(
          error.cause.message,
          /no declared evidence classification.*ucpath\/read-write-fixture-probe.*undeclaredProbeField/u,
        );
        assert.doesNotMatch(error.message, /undeclaredProbeField/u);
        return true;
      },
    );

    assert.deepEqual(h.world.events, ["probe"]);
    assert.equal(
      h.emitter.events().filter((event) => event.t === "data.observed").length,
      1,
      "the earlier valid batch remains; the undeclared batch emits nothing",
    );
    assert.equal(intentByKey(h.database), undefined);
  });
});

describe("beat ① — pre-fence probe indeterminacy refuses loudly", () => {
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

  for (const [verdict, expected] of [
    [ambiguousProbeVerdict(WRITE_FIXTURE_NOW), /found 2 matches/],
    [unknownProbeVerdict(WRITE_FIXTURE_NOW), /is indeterminate; refusing to fence or click/],
  ] as const) {
    it(`${verdict.state} means no fence and no click`, async () => {
      const h = harness();
      const { run, claim } = claimRunning(h.database, h.clock);
      h.world.probeResults.push(verdict);
      await assert.rejects(h.execute(contextFor(run, claim)), (error: unknown) => {
        assert.ok(error instanceof WriteSafetyAuthorityError);
        assert.equal(
          error.authorityReason.code,
          verdict.state === "ambiguous" ? "prewrite-probe-ambiguous" : "prewrite-probe-unknown",
        );
        assert.match(String(error), expected);
        assert.doesNotMatch(String(error), /grid did not render/u);
        return true;
      });
      assert.equal(intentByKey(h.database), undefined);
      assert.deepEqual(h.world.events, ["probe"]);
    });
  }

  it("a throwing pre-write probe preserves classified authority evidence without fencing", async () => {
    const h = harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(new Error("UCPath grid exposed 10001573 before it failed"));
    await assert.rejects(h.execute(contextFor(run, claim)), (error: unknown) => {
      assert.ok(error instanceof WriteSafetyAuthorityError);
      assert.equal(error.authorityReason.code, "prewrite-probe-exception");
      assert.equal(error.authorityReason.evidence.kind, "exception");
      assert.doesNotMatch(error.message, /10001573/u);
      return true;
    });
    assert.equal(intentByKey(h.database), undefined);
  });
});

describe("dry-run — structurally zero intent, zero fence, zero commit", () => {
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});


  it("identifies a refused preview by safe key digest without exposing the person identifier", async () => {
    const h = harness();
    const { run, claim } = claimRunning(h.database, h.clock, writeFixtureQueuedRun({ dryRun: true }));
    h.world.probeResults.push(unknownProbeVerdict(WRITE_FIXTURE_NOW));

    await assert.rejects(
      h.executeDryRun(contextFor(run, claim, writeFixtureDescriptor, true)),
      (error: unknown) => {
        assert.ok(error instanceof WriteSafetyAuthorityError);
        assert.equal(error.authorityReason.code, "preview-probe-unknown");
        assert.equal(error.authorityReason.evidence.kind, "probe");
        assert.match(error.message, /key digest a6409bc35921…/u);
        assert.doesNotMatch(error.message, /10812345|2345/u);
        assert.doesNotMatch(error.message, /grid did not render/u);
        return true;
      },
    );
  });
});

describe("a driver lease without the claimed run's bound fingerprint refuses", () => {
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

  it("refuses the probe lease loudly: no browser, no fence, no click, nothing settled", async () => {
    const h = harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    // Call outside the binding window to probe the real session-manager refusal.
    await assert.rejects(
      h.sequencer.executeTransaction(contextFor(run, claim)),
      (error: unknown) => {
        assert.ok(error instanceof WriteSafetyAuthorityError);
        assert.ok(error.cause instanceof Error);
        assert.match(error.cause.message, /driver lease requires the claimed run's bound config fingerprint; none is bound/);
        return true;
      },
    );
    assert.deepEqual(h.world.events, [], "no probe, prepare, observation, or click ran");
    assert.equal(intentByKey(h.database), undefined, "no fence");
    const current = h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.equal(current?.lifecycle.state, "running", "a pre-lease precondition refusal leaves settlement to the interpreter");
  });

  it("refuses executeDryRun's staging lease the same way — the preview arm is not an escape hatch", async () => {
    const h = harness();
    const { run, claim } = claimRunning(h.database, h.clock, writeFixtureQueuedRun({ dryRun: true }));
    await assert.rejects(
      h.sequencer.executeDryRun(contextFor(run, claim, writeFixtureDescriptor, true)),
      (error: unknown) => {
        assert.ok(error instanceof WriteSafetyAuthorityError);
        assert.ok(error.cause instanceof Error);
        assert.match(error.cause.message, /driver lease requires the claimed run's bound config fingerprint; none is bound/);
        return true;
      },
    );
    assert.deepEqual(h.world.events, [], "no prepare or observation ran");
  });
});
}
