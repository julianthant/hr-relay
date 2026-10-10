import { reconstructConfirmedOperation } from "../../../../../../src/models/events/confirmed-operation.js";
import { descriptorRuntimeNodes } from "../../../../../../src/workflow-kit/workflow.js";
import { personLookupDescriptor, separationsDescriptor } from "../../../../../support/helpers/registered-workflows.js";
import { RunClaimTokenSchema } from "../../../../../../src/backend/storage/sqlite/run-store-contracts.js";
import { lifecycleCommandId } from "../../../../../../src/backend/runs/lifecycle/run-record-service.js";
import { testRunLifecycle, testRunService } from "../../../../../support/fixtures/run-lifecycle-fixtures.js";

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { TaskError } from "../../../../../../src/workflow-kit/errors.js";
import type { WriteSequencerContext } from "../../../../../../src/backend/runtime/execution/run-executor.js";
import {
  createWriteSequencer,
  buildCommittedSettlement,
  executeSequencedWriteCommit,
  invokeBoundedTask,
  StagedPageDiscardedError,
  WriteParkedError,
  type ProductionWriteSequencer,
  type TransactionDryRunPreview,
  type WriteSequencerHooks,
} from "../../../../../../src/backend/runtime/writes/write-sequencer.js";
import { withBoundRunConfigFingerprint, type WorkerSessionManager } from "../../../../../../src/backend/runtime/workers/worker-sessions.js";
import { withBrowserActionNotes } from "../../../../../../src/backend/systems/browser-shared/action-notes.js";
import { manualClock, type TestClock } from "../../../../../../src/rules/time/clock.js";
import { ActorIdSchema, TaskIdSchema } from "../../../../../../src/rules/identity/ids.js";
import { classifyEvidenceLeaf } from "../../../../../../src/models/trust/evidence-classification.js";
import type { AnyWorkflowDescriptor } from "../../../../../../src/workflow-kit/workflow.js";
import { RunRecordSchema, type RunRecord } from "../../../../../../src/models/run/record.js";
import { deriveSchemaHash } from "../../../../../../src/models/validation/schema-bound-value.js";
import {
  deriveWriteAuthorityReason,
  deriveIdempotencyKeyDigest,
  deriveWriteBindingProofDigest,
  WriteSafetyAuthorityError,
} from "../../../../../../src/rules/write-safety/write-safety.js";
import {
  AtomicWriteCommitStorageStepSchema,
  AuthorityDatabase,
  SequencedWriteCommitStepSchema,
  type AuthorityWriteCommitHooks,
} from "../../../../../support/helpers/synthetic-storage-admission.js";
import { UUID_5, UUID_6, UUID_7, UUID_8 } from "../../../../../support/fixtures/phase1c-contract-fixtures.js";
import { ManualScheduler, recordingEmitter, recordingLogger } from "../../../../../support/helpers/phase1f-executor-harness.js";
import { sequentialIdFactory } from "../../../../../support/fixtures/phase1f-run-fixtures.js";
import {
  absentProbeEvidence,
  ambiguousProbeVerdict,
  buildWriteFixtureRegistry,
  createWriteFixtureWorld,
  WRITE_FIXTURE_EID,
  WRITE_FIXTURE_IMPL_FINGERPRINT,
  WRITE_FIXTURE_ITEM_ID,
  WRITE_FIXTURE_KEY,
  WRITE_FIXTURE_KEY_DIGEST,
  WRITE_FIXTURE_NODE_ID,
  WRITE_FIXTURE_NOW,
  WRITE_FIXTURE_OBSERVATION,
  WRITE_FIXTURE_RUN_ID,
  WRITE_FIXTURE_SECRET_CANARY,
  WRITE_FIXTURE_STAGED_STATE,
  unknownProbeVerdict,
  WRITE_FIXTURE_WORKER_ID,
  WRITE_FIXTURE_WORKFLOW_ID,
  WriteFixtureProofSchema,
  WriteFixtureCommit,
  writeFixtureDescriptor,
  writeFixtureQueuedRun,
  writeFixtureSaveDescriptor,
  writeFixtureSessionManager,
  writeFixtureSessions,
  writeFixtureTransactionNode,
  type WriteFixtureWorld,
} from "../../../../../support/fixtures/write-sequencer-fixtures.js";

describe("bounded transaction task recording", () => {
  it("publishes a whole recordData call before a later throw and reads the wall clock once", async () => {
    const baseClock = manualClock(new Date(WRITE_FIXTURE_NOW));
    let wallClockReads = 0;
    const clock: TestClock = {
      ...baseClock,
      now(): Date {
        wallClockReads += 1;
        return baseClock.now();
      },
    };
    const batches: { recordedAt: string; fields: readonly string[] }[] = [];

    await assert.rejects(
      invokeBoundedTask(
        {
          clock,
          scheduler: new ManualScheduler(clock),
          taskDeadlineMs: 60_000,
          log: recordingLogger().log,
        },
        TaskIdSchema.parse("ucpath/read-write-fixture-probe"),
        new AbortController().signal,
        async (_signal, recordData) => {
          recordData([
            { direction: "read", field: "state", value: "absent" },
            { direction: "read", field: "eid", value: WRITE_FIXTURE_EID },
          ]);
          assert.equal(batches.length, 1, "record-time sink runs before task continuation");
          throw new Error("later probe failure");
        },
        (batch) => batches.push({
          recordedAt: batch.recordedAt,
          fields: batch.points.map(({ field }) => field),
        }),
      ),
      /later probe failure/u,
    );

    assert.deepEqual(batches, [{ recordedAt: WRITE_FIXTURE_NOW, fields: ["state", "eid"] }]);
    assert.equal(wallClockReads, 1, "one recordData call owns one instant, not one per point or field");
  });

  it("declares every production probe and post-fence verifier point by its own task role", () => {
    const roles = [
      ["ucpath/match-existing-termination", ["state", "emplId", "effectiveDate"]],
      ["ucpath/match-pending-terminations", [
        "state", "emplId", "diagnostic.state", "diagnostic.banner", "diagnostic.oldRowCount",
        "diagnostic.route", "diagnostic.iframeCount", "diagnostic.errorRegionCount",
        "diagnostic.searchVisible", "diagnostic.searchEnabled", "diagnostic.cause",
      ]],
      ["kuali/match-separation-finalization", ["state", "documentNumber", "transactionNumber"]],
      ["ucpath/verify-termination", ["state", "emplId", "effectiveDate"]],
      ["ucpath/verify-pending-terminations-cleared", ["state", "emplId"]],
      ["kuali/verify-separation-finalization", ["state", "documentNumber", "transactionNumber"]],
    ] as const;

    for (const [taskId, paths] of roles) {
      const scope = { kind: "task-output" as const, taskId: TaskIdSchema.parse(taskId) };
      for (const path of paths) assert.doesNotThrow(() => classifyEvidenceLeaf(scope, path), `${taskId}:${path}`);
    }
  });
});

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
  const root = mkdtempSync(join(tmpdir(), "hrauto-write-sequencer-"));
  const database = AuthorityDatabase.open(
    { path: join(root, "authority.sqlite"), busyTimeoutMs: 250, migrationOwner: "write-sequencer-test" },
    clock,
    options.commitHooks,
  );
  disposers.push(() => {
    database.close();
    rmSync(root, { recursive: true, force: true });
  });
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

function parkLegacyAttemptingIntent(database: AuthorityDatabase, message: string): void {
  const attempting = attemptingIntentFixture(UUID_5);
  assert.equal(database.authority.writeIntents.fenceAttempt(attempting).state, "fenced");
  database.authority.writeIntents.parkAttempt({
    writeIntentId: attempting.intent.writeIntentId,
    generation: attempting.intent.generation,
    expectedVersion: attempting.intent.version,
    code: "unknown",
    message,
    authorityReason: deriveWriteAuthorityReason("recovery-probe-unknown", "probe", "seeded legacy park"),
    now: WRITE_FIXTURE_NOW,
  });
}

describe("the seven-beat happy path", () => {
  it("registered transaction policies probe an unseen key before any commit; person-lookup has no transaction node", async () => {
    assert.equal(descriptorRuntimeNodes(personLookupDescriptor).filter((node) => node.kind === "transaction").length, 0);
    const registered = descriptorRuntimeNodes(separationsDescriptor).filter((node) => node.kind === "transaction");
    assert.equal(registered.length, 3);
    for (const node of registered) {
      assert.equal(node.probePolicy, "always", node.id);
      const h = harness(); const { run, claim } = claimRunning(h.database, h.clock);
      assert.equal(intentByKey(h.database), undefined);
      h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
      const context = contextFor(run, claim);
      await h.execute({ ...context, node: { ...context.node, probePolicy: node.probePolicy } });
      assert.equal(h.world.events[0], "probe", node.id);
      assert.ok(h.world.events.indexOf("probe") < h.world.events.indexOf("commit-click:ucpath.write-fixture.save-submit"), node.id);
    }
  });
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

  it("streams the save-verify transaction as ordered probe, stage, fence, click, and read-back beats", async () => {
    const h = harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h.world.verifyResults.push({ state: "present", proof: { transactionId: "T123456" } });

    await h.execute(contextFor(run, claim, writeFixtureSaveDescriptor));

    assert.deepEqual(
      h.emitter.events().map((event) => [
        event.t,
        event.spanPath,
        event.t === "data.observed" ? event.taskId : "",
      ]),
      [
        ["span.started", "wf-090000-2222/submit-write/probe", ""],
        ["data.observed", "wf-090000-2222/submit-write/probe", "ucpath/read-write-fixture-probe"],
        ["span.ended", "wf-090000-2222/submit-write/probe", ""],
        ["span.started", "wf-090000-2222/submit-write/prepare", ""],
        ["data.observed", "wf-090000-2222/submit-write/prepare", "ucpath/fill-write-fixture"],
        ["span.ended", "wf-090000-2222/submit-write/prepare", ""],
        ["span.started", "wf-090000-2222/submit-write/commit", ""],
        ["transaction.fenced", "wf-090000-2222/submit-write/commit", ""],
        ["data.observed", "wf-090000-2222/submit-write/commit", "ucpath/save-write-fixture"],
        ["span.ended", "wf-090000-2222/submit-write/commit", ""],
        ["span.started", "wf-090000-2222/submit-write/verify", ""],
        ["data.observed", "wf-090000-2222/submit-write/verify", "ucpath/read-write-fixture-verify"],
        ["span.ended", "wf-090000-2222/submit-write/verify", ""],
      ],
    );

    const observed = h.emitter.events().filter((event) => event.t === "data.observed");
    assert.equal(observed.length, 4, "one recordData call from every executed task role");
    for (const event of observed) {
      assert.equal(event.runId, WRITE_FIXTURE_RUN_ID);
      assert.equal(event.nodeId, WRITE_FIXTURE_NODE_ID);
      assert.equal(event.attempt, 1);
      assert.equal(event.observedAt, event.ts, "the event reuses its record-time instant");
    }
    const probe = observed.find((event) => event.taskId === "ucpath/read-write-fixture-probe");
    assert.ok(probe);
    const probeValues = new Map(probe.points.flatMap((point) => point.values.map((value) => [value.key, value])));
    assert.equal(probeValues.get("eid")?.transform, "allow");
    assert.deepEqual(probeValues.get("secretCanary"), {
      key: "secretCanary",
      state: "allowed",
      classification: "secret",
      transform: "allow", value: WRITE_FIXTURE_SECRET_CANARY,
    });
    const bytes = JSON.stringify(h.emitter.events());
    assert.equal(bytes.includes(WRITE_FIXTURE_SECRET_CANARY), true, "already supplied classified local evidence remains complete");
    assert.equal(bytes.includes(WRITE_FIXTURE_EID), true, "complete classified local person identifier reaches the span sink");
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

  it("replays its own settled checkpoint byte-exact without re-clicking", async () => {
    const h = harness();
    const first = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    await h.execute(contextFor(first.run, first.claim));
    h.world.events.length = 0;

    const again = await h.execute(contextFor(
      h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID) ?? first.run,
      first.claim,
    ));
    assert.deepEqual(again, {
      disposition: "committed",
      proofSource: "normal-output",
      output: { transactionId: "T123456" },
      proof: { transactionId: "T123456" },
    });
    assert.deepEqual(h.world.events, [], "a replay runs no probe, prepare, observation, or click");
  });
});

describe("beat ③ — zero fence and zero click on any binding failure", () => {
  for (const [name, mutate, expected] of [
    ["mismatched subject", (world: WriteFixtureWorld) => { world.subjectEid = "10899999"; }, /subject mismatch/],
    ["unreadable subject", (world: WriteFixtureWorld) => {
      world.subjectReadThrows = new Error("stale element");
    }, /subject observation .* failed on the staged page/],
    ["driver without a semantic read", (world: WriteFixtureWorld) => { world.omitDriverRead = true; }, /exposes no semantic read/],
  ] as const) {
    it(`refuses on a ${name}`, async () => {
      const h = harness();
      const { run, claim } = claimRunning(h.database, h.clock);
      h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
      mutate(h.world);
      await assert.rejects(h.execute(contextFor(run, claim)), expected);
      assert.equal(intentByKey(h.database), undefined, "no fence");
      assert.ok(!h.world.events.some((event) => event.startsWith("commit-click")), "no click");
      assert.deepEqual(h.sessions.closeReasons(), ["poisoned"], "the staged page was poison-closed");
      const current = h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
      assert.equal(current?.lifecycle.state, "running", "a pre-fence refusal leaves settlement to the interpreter");
    });
  }
});

describe("beat ④ — budget expiry and CAS races discard the staged page", () => {
  it("discards on an elapsed probe→fence budget and never clicks", async () => {
    const h = harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h.world.onPrepare = () => h.clock.advanceMonotonic(30_001);
    await assert.rejects(
      h.execute(contextFor(run, claim)),
      (error: unknown) => error instanceof StagedPageDiscardedError && /probe-to-fence budget/.test(error.message),
    );
    assert.equal(intentByKey(h.database), undefined);
    assert.ok(!h.world.events.some((event) => event.startsWith("commit-click")));
    assert.deepEqual(h.sessions.closeReasons(), ["poisoned"]);
  });

  it("routes a lost fence race to the winner: attempting refuses, observed-present reuses", async () => {
    const h = harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    const foreign = attemptingIntentFixture(UUID_5);
    h.world.onPrepare = () => {
      assert.equal(h.database.authority.writeIntents.fenceAttempt(foreign).state, "fenced");
    };
    await assert.rejects(h.execute(contextFor(run, claim)), /lost the race .* nothing was clicked/s);
    assert.ok(!h.world.events.some((event) => event.startsWith("commit-click")));

    // Observed-present winner: the same race resolves to already-present reuse.
    const h2 = harness();
    const second = claimRunning(h2.database, h2.clock);
    h2.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h2.world.onPrepare = () => {
      const recorded = h2.database.authority.writeIntents.recordObservedPresent({
        writeIntentId: UUID_8,
        workflowId: WRITE_FIXTURE_WORKFLOW_ID,
        itemId: WRITE_FIXTURE_ITEM_ID,
        taskId: "ucpath/submit-write-fixture",
        system: "ucpath",
        idempotencyKey: WRITE_FIXTURE_KEY,
        idempotencyKeyDigest: WRITE_FIXTURE_KEY_DIGEST,
        generation: 1,
        status: "observed-present",
        observedProof: {
          schemaHash: deriveProofSchemaHash(),
          value: { transactionId: "T777777" },
        },
        observedAt: WRITE_FIXTURE_NOW,
        version: 1,
        createdAt: WRITE_FIXTURE_NOW,
        updatedAt: WRITE_FIXTURE_NOW,
      });
      assert.equal(recorded.state, "recorded-observed-present");
    };
    const outcome = await h2.execute(contextFor(second.run, second.claim));
    assert.deepEqual(outcome, {
      disposition: "already-present",
      proofSource: "durable-intent",
      output: { transactionId: "T777777" },
      proof: { transactionId: "T777777" },
    });
    assert.ok(!h2.world.events.some((event) => event.startsWith("commit-click")));
  });
});

function deriveProofSchemaHash(): string {
  return deriveSchemaHash(WriteFixtureProofSchema, "output");
}

describe("beat ① — durable same-key dedupe", () => {
  it("refuses loudly while another run is mid-submit, before any probe or browser", async () => {
    const h = harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    assert.equal(h.database.authority.writeIntents.fenceAttempt(attemptingIntentFixture(UUID_5)).state, "fenced");
    await assert.rejects(
      h.execute(contextFor(run, claim)),
      /another run .* is mid-submit .* refusing to double-fence/s,
    );
    assert.deepEqual(h.world.events, [], "no probe, no prepare, no click");
  });

  it("withholds a legacy parked message from real-run failure material", async () => {
    const h = harness();
    const legacyMessage = `legacy failure for ${WRITE_FIXTURE_KEY} and standalone suffix 2345`;
    parkLegacyAttemptingIntent(h.database, legacyMessage);
    const { run, claim } = claimRunning(h.database, h.clock);

    await assert.rejects(
      h.execute(contextFor(run, claim)),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /parked \(unknown\)/u);
        assert.doesNotMatch(error.message, /10812345|2345|legacy failure/u);
        return true;
      },
    );
    const parked = intentByKey(h.database);
    assert.ok(parked?.status === "parked");
    assert.equal(parked.message, legacyMessage, "presentation repair never rewrites authority evidence");
    assert.deepEqual(h.world.events, [], "no probe, prepare, recovery, or click ran");
  });

  it("reuses a committed permanent key for a later fresh item without a second fence or ledger row", async () => {
    const h = harness();
    const first = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    await h.execute(contextFor(first.run, first.claim));
    const confirmationsAfterCommit = h.database.authority.timelineEvents.page({}).filter((row) => row.payload.kind === "operation-confirmed");
    assert.equal(confirmationsAfterCommit.length, 1);
    h.world.events.length = 0;

    const second = claimRunning(
      h.database, h.clock,
      writeFixtureQueuedRun({ runId: UUID_5, itemId: UUID_6 }),
      "write-fixture-worker-2",
    );
    const outcome = await h.execute(contextFor(second.run, second.claim));
    assert.deepEqual(outcome, {
      disposition: "already-present",
      proofSource: "durable-intent",
      output: { transactionId: "T123456" },
      proof: { transactionId: "T123456" },
    });
    assert.deepEqual(h.world.events, [], "durable reuse runs no probe, prepare, or click");
    const intent = intentByKey(h.database);
    assert.ok(intent && intent.status === "committed" && intent.generation === 1);
    assert.deepEqual(h.database.authority.timelineEvents.page({}).filter((row) => row.payload.kind === "operation-confirmed"), confirmationsAfterCommit);
  });
});

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

describe("beat ① — pre-fence probe indeterminacy refuses loudly", () => {
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

  it("parks on an absent recovery probe — one observation is never retry authority", async () => {
    const h = harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    assert.equal(
      h.database.authority.writeIntents.fenceAttempt(attemptingIntentFixture(WRITE_FIXTURE_RUN_ID)).state,
      "fenced",
    );
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    await assert.rejects(
      h.execute(contextFor(run, claim)),
      (error: unknown) => error instanceof WriteParkedError && error.parkCode === "unknown",
    );
    assert.equal(intentByKey(h.database)?.status, "parked");
    assert.equal(h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.lifecycle.state, "parked-write");
  });
});

describe("retryable re-fence (only a settled retryable key mints a new generation)", () => {
  it("fences generation 2 with a fresh binding proof and commits", async () => {
    const h = harness();
    const now = h.clock.now().toISOString();
    const settled = attemptingIntentFixture(UUID_5);
    assert.equal(h.database.authority.writeIntents.fenceAttempt(settled).state, "fenced");
    h.database.withAuthorityTransaction((repositories) => {
      repositories.writeIntents.settleRetryable({
        writeIntentId: settled.intent.writeIntentId,
        generation: 1,
        expectedVersion: 1,
        settlement: {
          state: "operator-confirmed-absent",
          writeIntentId: settled.intent.writeIntentId,
          generation: 1,
          operator: "local-operator",
          confirmedAt: now,
          evidenceNote: "Checked the target system; the write is absent",
        },
        now,
      });
    });

    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    const outcome = await h.execute(contextFor(run, claim));
    assert.equal((outcome as { disposition: string }).disposition, "committed");
    const intent = intentByKey(h.database);
    assert.ok(intent && intent.status === "committed");
    assert.equal(intent.generation, 2, "the re-fence advanced exactly one generation");
    assert.equal(intent.writeIntentId, settled.intent.writeIntentId, "the permanent row identity is retained");
  });
});

describe("dry-run — structurally zero intent, zero fence, zero commit", () => {
  it("executeTransaction refuses a dry-run context before any side effect", async () => {
    const h = harness();
    const { run, claim } = claimRunning(h.database, h.clock, writeFixtureQueuedRun({ dryRun: true }));
    await assert.rejects(
      h.execute(contextFor(run, claim, writeFixtureDescriptor, true)),
      (error: unknown) => error instanceof TaskError && error.code === "capability-unavailable",
    );
    assert.deepEqual(h.world.events, []);
    assert.equal(intentByKey(h.database), undefined);
  });

  it("executeDryRun probes, stages, observes the subject, and creates nothing durable", async () => {
    const h = harness();
    const { run, claim } = claimRunning(h.database, h.clock, writeFixtureQueuedRun({ dryRun: true }));

    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    const preview = await h.executeDryRun(contextFor(run, claim, writeFixtureDescriptor, true));
    assert.equal(preview.kind, "transaction-dry-run-preview");
    assert.equal(preview.probe.state, "absent");
    assert.equal(
      preview.outcome.state === "would-prepare" ? preview.outcome.subject.state : undefined,
      "match",
    );
    assert.deepEqual(h.world.events, ["probe", "prepare", `subject-read:${WRITE_FIXTURE_OBSERVATION}`]);
    assert.deepEqual(h.emitter.events().map((event) => [event.t, event.spanPath]), [
      ["span.started", "wf-090000-2222/submit-write/probe"],
      ["data.observed", "wf-090000-2222/submit-write/probe"],
      ["span.ended", "wf-090000-2222/submit-write/probe"],
      ["span.started", "wf-090000-2222/submit-write/prepare"],
      ["data.observed", "wf-090000-2222/submit-write/prepare"],
      ["span.ended", "wf-090000-2222/submit-write/prepare"],
    ], "dry-run reports probe and stage only; it fabricates no fence, click, or read-back");
    assert.equal(intentByKey(h.database), undefined, "zero intents");
    assert.ok(!h.world.events.some((event) => event.startsWith("commit-click")), "zero clicks");
    assert.equal(h.database.authority.timelineEvents.page({}).filter((row) => row.payload.kind === "operation-confirmed").length, 0);
    assert.equal(
      h.database.authority.runCheckpoints.latest(WRITE_FIXTURE_WORKFLOW_ID, WRITE_FIXTURE_ITEM_ID, WRITE_FIXTURE_NODE_ID),
      undefined,
      "zero checkpoints",
    );
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

  it("withholds a legacy parked message from preview failure material", async () => {
    const h = harness();
    const legacyMessage = `legacy failure for ${WRITE_FIXTURE_KEY} and standalone suffix 2345`;
    parkLegacyAttemptingIntent(h.database, legacyMessage);
    const { run, claim } = claimRunning(h.database, h.clock, writeFixtureQueuedRun({ dryRun: true }));

    await assert.rejects(
      h.executeDryRun(contextFor(run, claim, writeFixtureDescriptor, true)),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /parked \(unknown\)/u);
        assert.doesNotMatch(error.message, /10812345|2345|legacy failure/u);
        return true;
      },
    );
    const parked = intentByKey(h.database);
    assert.ok(parked?.status === "parked");
    assert.equal(parked.message, legacyMessage, "presentation repair never rewrites authority evidence");
  });

  it("refuses a malformed staged EID without echoing the observed value", async () => {
    const h = harness();
    const { run, claim } = claimRunning(h.database, h.clock, writeFixtureQueuedRun({ dryRun: true }));
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h.world.subjectEid = "EID 10899999";

    await assert.rejects(
      h.executeDryRun(contextFor(run, claim, writeFixtureDescriptor, true)),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /does not normalize to an EID/);
        assert.doesNotMatch(error.message, /10899999/);
        return true;
      },
    );
  });
});

describe("a driver lease without the claimed run's bound fingerprint refuses", () => {
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
