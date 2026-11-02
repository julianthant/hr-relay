import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, describe, it } from "vitest";
import { RunRecordService, requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { selectRunRuntime } from "../../../../src/backend/runs/settings/run-settings.js";
import { readRunCheckpoint } from "../../../../src/backend/runtime/checkpoints/run-checkpoint-reader.js";
import { captureRunContinuation, continuationEvidenceDigest } from "../../../../src/backend/storage/sqlite/run-continuation.js";
import { buildNodeFailureRecord } from "../../../../src/backend/runtime/execution/run-failure.js";
import { createWriteSequencer } from "../../../../src/backend/runtime/writes/write-sequencer.js";
import type { AuthorityRepositories } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { FailureRecordSchema } from "../../../../src/models/trust/failure.js";
import { RunRecordSchema, runClaim, type RunRecord } from "../../../../src/models/run/record.js";
import { SourceBoundRunSchema, repeatOccurrenceKey, repeatEvidenceDigest } from "../../../../src/models/run/rerun.js";
import { RunCheckpointRecordSchema, type RunCheckpointRecord } from "../../../../src/models/workflow/checkpoint.js";
import { deriveItemId } from "../../../../src/rules/identity/identifiers.js";
import { FingerprintSchema, NodeIdSchema } from "../../../../src/rules/identity/ids.js";
import { TransactionOutcomeSchema, WriteIntentRecordSchema, deriveWriteAuthorityReason, deriveIdempotencyKeyDigest } from "../../../../src/rules/write-safety/write-safety.js";
import { createWriteSequencerTestWorld } from "../../../support/helpers/backend/write-sequencer-world.js";
import { recordingLogger } from "../../../support/helpers/phase1f-executor-harness.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { testRunLifecycle, testWorkerLifetime } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { absentProbeEvidence, buildWriteFixtureRegistry, WRITE_FIXTURE_EID, WRITE_FIXTURE_IMPL_FINGERPRINT,
  WRITE_FIXTURE_KEY_DIGEST, WRITE_FIXTURE_NODE_ID, WRITE_FIXTURE_WORKFLOW_ID, WriteFixtureCommit,
  writeFixtureDescriptor, writeFixtureQueuedRun } from "../../../support/fixtures/write-sequencer-fixtures.js";

const { harness, claimRunning, contextFor, cleanup } = createWriteSequencerTestWorld();
afterEach(cleanup);
const matchKey = `eid:${WRITE_FIXTURE_EID}`;
type Harness = Awaited<ReturnType<typeof harness>>;

function fresh(h: Harness, run: RunRecord): RunRecord {
  const current = h.database.authority.runs.get(run.envelope.runId); assert.ok(current); return current;
}

function failAfterTransaction(h: Harness, run: RunRecord) {
  const current = fresh(h, run);
  const heldClaim = runClaim(current); assert.ok(heldClaim);
  const claim = { workerId: heldClaim.workerId, claimGeneration: heldClaim.claimGeneration };
  const before = effects(h);
  const checkpoint = readRunCheckpoint(h.database.authority, current.envelope, WRITE_FIXTURE_NODE_ID);
  assert.ok(checkpoint);
  assert.equal(TransactionOutcomeSchema.parse(checkpoint.output.value).disposition, "committed");
  assert.equal(current.lifecycle.state, "running");
  assert.ok(current.lifecycle.state === "running" && current.lifecycle.currentNodeId === WRITE_FIXTURE_NODE_ID);
  const now = h.clock.now().toISOString();
  const failure = FailureRecordSchema.parse({ ...buildNodeFailureRecord({ run: current, failureId: randomUUID(),
    nodeId: NodeIdSchema.parse(WRITE_FIXTURE_NODE_ID), taskId: WriteFixtureCommit.id,
    error: new Error("Synthetic failure after the settled transaction"), occurredAt: now }), writeState: "committed" });
  const failed = h.database.terminalizeFailure(writeFixtureDescriptor, { failure,
    authorization: { kind: "failed", runId: current.envelope.runId, workflowId: current.envelope.workflow,
      attempt: current.envelope.attempt, descriptorVersion: current.envelope.descriptorVersion,
      contractFingerprint: current.envelope.contractFingerprint, expectedVersion: current.version,
      claim, authorizedAt: now, failureId: failure.failureId } });
  assert.equal(failed.state, "applied");
  assert.deepEqual(h.database.authority.failures.get(failure.failureId), failure);
  assert.deepEqual(effects(h), before);
  return failed.run;
}

function effects(h: Harness) {
  return { gestures: [...h.world.events], intents: h.database.authority.writeIntents.listByBusinessKey("ucpath", WRITE_FIXTURE_KEY_DIGEST),
    checkpoints: h.database.authority.runCheckpoints.listByItem(WRITE_FIXTURE_WORKFLOW_ID, deriveItemId(WRITE_FIXTURE_WORKFLOW_ID, matchKey)),
    confirmations: h.database.authority.timelineEvents.page({}).filter(row => row.payload.kind === "operation-confirmed") };
}

function claimQueued(h: Harness, lifecycle: RunRecordService, queued: RunRecord) {
  const lifetime = testWorkerLifetime(h.database, WRITE_FIXTURE_WORKFLOW_ID, 1);
  let run = requireLifecycleApplied(lifecycle.claimNext({ commandId: randomUUID(), workflow: WRITE_FIXTURE_WORKFLOW_ID,
    workerId: lifetime.workerId, workerLifetime: lifetime.workerLifetime,
    runtimeConfig: selectRunRuntime(h.database.authority) }));
  assert.equal(run.envelope.runId, queued.envelope.runId);
  const claim = { workerId: lifetime.workerId, claimGeneration: run.claimGeneration };
  const base = { workerId: lifetime.workerId, workerLifetime: lifetime.workerLifetime,
    claimedAt: h.clock.now().toISOString(), heartbeatAt: h.clock.now().toISOString() };
  for (const state of ["validating", "running"] as const) {
    const moved = h.database.authority.runs.transition({ runId: run.envelope.runId, expectedVersion: run.version, claim,
      now: h.clock.now().toISOString(), lifecycle: { state, ...base, ...(state === "running" ? { currentNodeId: WRITE_FIXTURE_NODE_ID } : {}) } });
    assert.equal(moved.state, "applied"); run = fresh(h, run);
  }
  return contextFor(run, claim);
}

async function fixture(changeCheckpoint?: (row: RunCheckpointRecord) => RunCheckpointRecord, reference?: "node" | "digest" | "none" | "repeat") {
  const h = await harness();
  const held = claimRunning(h.database, h.clock, writeFixtureQueuedRun({ itemId: deriveItemId(WRITE_FIXTURE_WORKFLOW_ID, matchKey) }));
  h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
  const original = await h.execute(contextFor(held.run, held.claim));
  const source = failAfterTransaction(h, held.run);
  const stored = h.database.authority.runCheckpoints.latest(WRITE_FIXTURE_WORKFLOW_ID, source.envelope.itemId, WRITE_FIXTURE_NODE_ID);
  assert.ok(stored);
  const checkpoint = changeCheckpoint?.(stored) ?? stored;
  const lifecycle = new RunRecordService({ database: h.database, clock: h.clock, ids: sequentialIdFactory("f"), publishQueued: () => {} });
  const intent = h.database.authority.writeIntents.listByRun(source.envelope.runId)[0]; assert.ok(intent);
  const sourceBound = SourceBoundRunSchema.parse({ source: { runId: source.envelope.runId, expectedVersion: source.version,
    intent: "rerun", selectedStepKeys: [WRITE_FIXTURE_NODE_ID] },
    warnings: reference === "repeat" ? [{ nodeId: WRITE_FIXTURE_NODE_ID, taskId: WriteFixtureCommit.id, system: "ucpath",
      businessKeyDigest: WRITE_FIXTURE_KEY_DIGEST, writeIntentId: intent.writeIntentId, evidenceDigest: repeatEvidenceDigest(intent) }] : [],
    ...(reference === "repeat" ? { acknowledgment: "a".repeat(64) } : {}),
    warningDigest: "a".repeat(64), confirmationCommandId: randomUUID() });
  function issue(from: RunRecord, retain = reference !== "none" && reference !== "repeat") {
    const captured = captureRunContinuation(h.database.authority, from);
    const continuation = { ...captured, checkpoints: captured.checkpoints.map(row => row.nodeId !== WRITE_FIXTURE_NODE_ID || row.runId !== source.envelope.runId ? row : {
      ...row, digest: reference === "digest" ? FingerprintSchema.parse("b".repeat(64)) : continuationEvidenceDigest(checkpoint),
      ...(reference === "node" ? { nodeId: "other-transaction" as typeof row.nodeId } : {}),
    }) };
    return requireLifecycleApplied(lifecycle.create({ commandId: randomUUID(), code: "wf", matchKey,
      workflow: WRITE_FIXTURE_WORKFLOW_ID, descriptorVersion: from.envelope.descriptorVersion,
      contractFingerprint: from.envelope.contractFingerprint, configFingerprint: from.envelope.configFingerprint,
      configSnapshotId: from.envelope.configSnapshotId, resolvedInstance: from.envelope.resolvedInstance,
      priority: from.envelope.priority, shape: from.envelope.shape, dryRun: false,
      ...(from.envelope.browserMode === undefined ? {} : { browserMode: from.envelope.browserMode }),
      input: from.input, retryOf: from.envelope.runId, sourceBound,
      ...(retain ? { continuation } : {}), runtimeConfig: selectRunRuntime(h.database.authority) }));
  }
  const context = claimQueued(h, lifecycle, issue(source));
  const authority = h.database.authority;
  const repositories: AuthorityRepositories = changeCheckpoint === undefined ? authority : { ...authority,
    runCheckpoints: { ...authority.runCheckpoints, get: (...args) => {
      const row = authority.runCheckpoints.get(...args);
      return row?.runId === checkpoint.runId && row.nodeId === checkpoint.nodeId ? checkpoint : row;
    } } };
  function execute(overrides: AuthorityRepositories = repositories, candidate = context) {
    const sequencer = createWriteSequencer({ authority: { authority: overrides,
      withAuthorityTransaction: work => h.database.withAuthorityTransaction(work),
      commitWriteAttempt: h.database.commitWriteAttempt.bind(h.database),
      commitRecheckedParkedWrite: h.database.commitRecheckedParkedWrite.bind(h.database) }, lifecycle: testRunLifecycle(h.database, h.clock),
      stores: buildWriteFixtureRegistry(h.world), sessions: h.manager, emitter: h.emitter.emitter,
      clock: h.clock, ids: h.ids, scheduler: h.scheduler, taskDeadlineMs: 60_000, operator: "local-operator",
      log: recordingLogger().log, resolveImplFingerprint: () => WRITE_FIXTURE_IMPL_FINGERPRINT });
    return sequencer.executeTransaction(candidate);
  }
  return { h, original, source, checkpoint, context, lifecycle, repositories, execute, issue };
}

function pauseResume(f: Awaited<ReturnType<typeof fixture>>) {
  const current = fresh(f.h, f.context.run);
  const paused = requireLifecycleApplied(f.lifecycle.pause({ commandId: randomUUID(), runId: current.envelope.runId,
    expectedVersion: current.version }));
  const acknowledged = requireLifecycleApplied(f.lifecycle.acknowledgePause({ commandId: randomUUID(), runId: paused.envelope.runId,
    claim: f.context.claim }));
  const queued = requireLifecycleApplied(f.lifecycle.resumePaused({ commandId: randomUUID(), runId: acknowledged.envelope.runId,
    expectedVersion: acknowledged.version }));
  assert.equal(queued.envelope.runId, f.context.run.envelope.runId);
  return claimQueued(f.h, f.lifecycle, queued);
}

async function completedRepeat() {
  const f = await fixture(undefined, "repeat");
  f.h.world.probeResults.push({ state: "present", proof: { transactionId: "T123456" } });
  f.h.world.commitOutput = { transactionId: "T234567" };
  return { ...f, repeated: await f.h.execute(f.context) };
}

describe("authenticated completed transaction continuation", () => {
  it("reuses the exact failed-source settlement with zero browser, intent or checkpoint effects across bounded continuations", async () => {
    const f = await fixture(); const before = effects(f.h);
    assert.equal(before.checkpoints.length, 1);
    assert.equal(before.intents.length, 1);
    assert.ok(before.gestures.some(event => event.startsWith("commit-click:")));
    let context = f.context;
    for (let index = 0; index < 3; index++) {
      const retained = readRunCheckpoint(f.repositories, context.run.envelope, WRITE_FIXTURE_NODE_ID);
      assert.equal(retained?.runId, f.source.envelope.runId);
      assert.deepEqual(await f.execute(f.repositories, context), f.original);
      assert.deepEqual(effects(f.h), before);
      if (index < 2) context = claimQueued(f.h, f.lifecycle, f.issue(failAfterTransaction(f.h, context.run)));
    }
  });

  it("keeps same-run pause and resume bound to the retained checkpoint without republishing it", async () => {
    const f = await fixture(); const before = effects(f.h);
    assert.deepEqual(await f.execute(f.repositories, pauseResume(f)), f.original);
    assert.deepEqual(effects(f.h), before);
  });

  it("preserves an own-run acknowledged repeat's occurrence key and distinct proof through Resume", async () => {
    const f = await completedRepeat();
    assert.notDeepEqual(f.repeated, f.original);
    const before = effects(f.h);
    assert.equal(before.intents.length, 2);
    assert.notEqual(before.intents[0].idempotencyKey, before.intents[1].idempotencyKey);
    assert.equal(before.checkpoints.at(-1)?.runId, f.context.run.envelope.runId);
    assert.deepEqual(await f.execute(f.repositories, pauseResume(f)), f.repeated);
    assert.deepEqual(effects(f.h), before);
  });

  it("refuses unsupported predecessor repeat replay instead of substituting its original natural-key proof", async () => {
    const f = await completedRepeat();
    const context = claimQueued(f.h, f.lifecycle, f.issue(failAfterTransaction(f.h, f.context.run), true));
    assert.equal(readRunCheckpoint(f.repositories, context.run.envelope, WRITE_FIXTURE_NODE_ID)?.runId, f.context.run.envelope.runId);
    const before = effects(f.h);
    await assert.rejects(f.execute(f.repositories, context), /proof is not the proof/);
    assert.deepEqual(effects(f.h), before);
  });

  for (const change of ["deleted", "version", "input", "config"] as const) it(`refuses a ${change} continuation source before browser effects`, async () => {
    const f = await fixture(); const before = effects(f.h);
    const repositories = { ...f.repositories, runs: { ...f.repositories.runs, get: (id: string) => {
      const run = f.repositories.runs.get(id);
      if (id !== f.source.envelope.runId || run === undefined) return run;
      if (change === "deleted") return undefined;
      return RunRecordSchema.parse({ ...run, ...(change === "version" ? { version: run.version + 1 }
        : change === "input" ? { input: { ...run.input, raw: { eid: "10899999" } } }
          : { envelope: { ...run.envelope, configSnapshotId: randomUUID() } }) });
    } } };
    await assert.rejects(f.execute(repositories), /run-continuation-source-unavailable/);
    assert.deepEqual(effects(f.h), before);
  });

  it("refuses a serialized continuation without native issuance", async () => {
    const f = await fixture(); const before = effects(f.h);
    await assert.rejects(f.execute({ ...f.repositories, lifecycleJournal: { ...f.repositories.lifecycleJournal,
      findContinuationIssue: () => undefined } }), /run-continuation-issuance-unavailable/);
    assert.deepEqual(effects(f.h), before);
  });

  it("refuses a fabricated continuation that disagrees with the durable owner", async () => {
    const f = await fixture(); const before = effects(f.h);
    const continuation = f.context.run.envelope.continuation; assert.ok(continuation);
    const run = RunRecordSchema.parse({ ...f.context.run, envelope: { ...f.context.run.envelope,
      continuation: { ...continuation, checkpoints: [] } } });
    await assert.rejects(f.execute(f.repositories, { ...f.context, run }), /run-continuation-owner-mismatch/);
    assert.deepEqual(effects(f.h), before);
  });

  for (const reference of ["node", "digest", "none"] as const) it(`refuses ${reference} checkpoint authority without treating it as retained completion`, async () => {
    const f = await fixture(undefined, reference); const before = effects(f.h);
    await assert.rejects(f.execute(), reference === "digest" ? /run-continuation-checkpoint-unavailable/ : /confirmation-required/);
    assert.deepEqual(effects(f.h), before);
  });

  it("refuses missing retained checkpoint bytes", async () => {
    const f = await fixture(); const before = effects(f.h);
    await assert.rejects(f.execute({ ...f.repositories, runCheckpoints: { ...f.repositories.runCheckpoints,
      get: () => undefined } }), /run-continuation-checkpoint-unavailable/);
    assert.deepEqual(effects(f.h), before);
  });

  for (const field of ["contractFingerprint", "implFingerprint", "schemaHash", "proof-schema", "output-schema", "output-value"] as const) {
    it(`refuses retained ${field} drift even when its reference digest matches`, async () => {
      const changed = FingerprintSchema.parse("b".repeat(64));
      const f = await fixture(row => {
        const outcome = TransactionOutcomeSchema.parse(row.output.value);
        return RunCheckpointRecordSchema.parse(field === "contractFingerprint" || field === "implFingerprint" ? { ...row, [field]: changed }
          : { ...row, output: field === "schemaHash" ? { ...row.output, schemaHash: changed } : { ...row.output, value: {
            ...outcome, ...(field === "proof-schema" ? { proof: { ...outcome.proof, schemaHash: changed } }
              : { output: { ...outcome.output, ...(field === "output-schema" ? { schemaHash: changed } : { value: { transactionId: 42 } }) } }),
          } } });
      });
      const before = effects(f.h);
      await assert.rejects(f.execute(), field === "proof-schema" ? /proof is not the proof|different proof schema/
        : field === "output-schema" ? /different output schema/ : field === "output-value" ? /invalid_type|Invalid input/ : /drifted/);
      assert.deepEqual(effects(f.h), before);
    });
  }

  it("refuses changed commit mapping rather than relabelling a completed write", async () => {
    const f = await fixture(); const before = effects(f.h);
    const node = { ...f.context.node, commit: { ...f.context.node.commit, bind: () => ({ eid: "10899999" }) } };
    await assert.rejects(f.execute(f.repositories, { ...f.context, node }), /names no permanent write intent/);
    assert.deepEqual(effects(f.h), before);
  });

  it("refuses missing durable completion proof", async () => {
    const f = await fixture(); const before = effects(f.h);
    await assert.rejects(f.execute({ ...f.repositories, writeIntents: { ...f.repositories.writeIntents,
      findByPermanentKey: () => undefined } }), /names no permanent write intent/);
    assert.deepEqual(effects(f.h), before);
  });

  it("keeps a parked UNKNOWN durable intent behind its existing refusal", async () => {
    const f = await fixture(); const before = effects(f.h);
    const committed = before.intents[0]; assert.ok(committed?.status === "committed");
    const { completionProof: _proof, confirmedAt: _confirmedAt, ...identity } = committed;
    const parked = WriteIntentRecordSchema.parse({ ...identity, status: "parked", parkedCode: "unknown",
      message: "Synthetic UNKNOWN", authorityReason: deriveWriteAuthorityReason("recovery-probe-unknown", "probe", "synthetic") });
    await assert.rejects(f.execute({ ...f.repositories, writeIntents: { ...f.repositories.writeIntents,
      findByPermanentKey: () => parked } }), /permanent intent.*parked/);
    assert.deepEqual(effects(f.h), before);
  });

  it("refuses an unresolved sibling occurrence before replaying the completed checkpoint", async () => {
    const f = await fixture(); const before = effects(f.h);
    const committed = before.intents[0]; assert.ok(committed?.status === "committed");
    const { completionProof: _proof, confirmedAt: _confirmedAt, ...identity } = committed;
    const confirmationCommandId = randomUUID();
    const key = repeatOccurrenceKey(WRITE_FIXTURE_KEY_DIGEST, confirmationCommandId, WRITE_FIXTURE_NODE_ID);
    const sibling = WriteIntentRecordSchema.parse({ ...identity, writeIntentId: randomUUID(), currentAttemptId: randomUUID(),
      idempotencyKey: key, idempotencyKeyDigest: deriveIdempotencyKeyDigest("ucpath", key),
      status: "parked", parkedCode: "unknown", message: "Synthetic unresolved repeat",
      authorityReason: deriveWriteAuthorityReason("recovery-probe-unknown", "probe", "synthetic"),
      occurrence: { confirmationCommandId, nodeId: WRITE_FIXTURE_NODE_ID, taskId: WriteFixtureCommit.id, system: "ucpath",
        businessKeyDigest: WRITE_FIXTURE_KEY_DIGEST, writeIntentId: committed.writeIntentId, evidenceDigest: "a".repeat(64),
        sourceRunId: f.source.envelope.runId, sourceVersion: f.source.version, warningDigest: "a".repeat(64),
        baselineEvidence: [{ writeIntentId: committed.writeIntentId, evidenceDigest: "a".repeat(64) }] } });
    await assert.rejects(f.execute({ ...f.repositories, writeIntents: { ...f.repositories.writeIntents,
      listByBusinessKey: () => [...before.intents, sibling] } }), /business key has an unresolved write occurrence/);
    assert.deepEqual(effects(f.h), before);
  });
});
