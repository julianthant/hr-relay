/**
 * Shared durable fixtures for the write-safety and subject-binding guards: a
 * crashed fenced write (running run parked the way the D118 sweep parks it,
 * with its `attempting` intent retained) and a same-key foreign fence input.
 */
import assert from "node:assert/strict";
import type { TestClock } from "../../../src/domain/clock.js";
import { deriveWriteBindingProofDigest } from "../../../src/domain/write-safety.js";
import type { RunRecord } from "../../../src/domain/run/record.js";
import type { AuthorityDatabase } from "../../../src/backend/storage/sqlite/index.js";
import { UUID_5, UUID_6, UUID_7, UUID_8 } from "../../fixtures/phase1c-contract-fixtures.js";
import {
  WRITE_FIXTURE_ITEM_ID,
  WRITE_FIXTURE_KEY,
  WRITE_FIXTURE_KEY_DIGEST,
  WRITE_FIXTURE_NODE_ID,
  WRITE_FIXTURE_OBSERVATION,
  WRITE_FIXTURE_RUN_ID,
  WRITE_FIXTURE_STAGED_STATE,
  WRITE_FIXTURE_WORKER_ID,
  WRITE_FIXTURE_WORKFLOW_ID,
  writeFixtureQueuedRun,
} from "../../fixtures/write-sequencer-fixtures.js";

export function writeGuardBindingProof(runId: string, proofId = UUID_7, leaseId = UUID_6) {
  return {
    kind: "subject-match",
    version: 1,
    proofId,
    runId,
    attempt: 1,
    leaseId,
    taskId: "ucpath/submit-write-fixture",
    observationId: WRITE_FIXTURE_OBSERVATION,
    pageStateId: WRITE_FIXTURE_STAGED_STATE,
    expected: { kind: "person", identifierKind: "eid", bindingDigest: "a".repeat(64), displaySuffix: "2345" },
    observed: { kind: "person", identifierKind: "eid", bindingDigest: "a".repeat(64), displaySuffix: "2345" },
    match: "match",
    observedAt: "2026-08-03T09:00:00.000Z",
    afterPrepareSpanPath: "wf-090000-2222/submit-write/prepare",
  };
}

/** A same-key attempting fence input owned by a DIFFERENT run. */
export function foreignAttemptingIntent(runId: string, attemptId: string) {
  const bindingProof = writeGuardBindingProof(runId, UUID_7, UUID_6);
  const bindingProofDigest = deriveWriteBindingProofDigest(bindingProof);
  const now = "2026-08-03T09:00:00.000Z";
  const intent = {
    writeIntentId: UUID_7,
    workflowId: WRITE_FIXTURE_WORKFLOW_ID,
    itemId: WRITE_FIXTURE_ITEM_ID,
    taskId: "ucpath/submit-write-fixture",
    system: "ucpath",
    idempotencyKey: WRITE_FIXTURE_KEY,
    idempotencyKeyDigest: WRITE_FIXTURE_KEY_DIGEST,
    currentAttemptId: attemptId,
    generation: 1,
    runId,
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
    writeAttemptId: attemptId,
    writeIntentId: UUID_7,
    generation: 1,
    runId,
    runAttempt: 1,
    leaseId: UUID_6,
    bindingProof,
    bindingProofDigest,
    fencedAt: now,
    outcome: { state: "attempting" },
    recordedAt: now,
  };
  return { intent, attempt };
}

/**
 * Enqueue + claim + run the fixture run, fence its `attempting` intent, then
 * park the run exactly the way the D118 sweep's `parked:true` arm does.
 */
export function parkedAttemptingWriteFixture(
  database: AuthorityDatabase,
  clock: TestClock,
): { run: RunRecord; writeIntentId: string } {
  const now = clock.now().toISOString();
  assert.equal(database.authority.runs.enqueue(writeFixtureQueuedRun()).state, "inserted");
  const claimed = database.authority.runs.claimNext({
    workflow: WRITE_FIXTURE_WORKFLOW_ID,
    workerId: WRITE_FIXTURE_WORKER_ID,
    now,
  });
  if (claimed.state !== "claimed") throw new Error("guard fixture claim failed");
  const claim = { workerId: WRITE_FIXTURE_WORKER_ID, claimGeneration: claimed.run.claimGeneration };
  const base = { workerId: WRITE_FIXTURE_WORKER_ID, claimedAt: now, heartbeatAt: now };
  assert.equal(database.authority.runs.transition({
    runId: WRITE_FIXTURE_RUN_ID, expectedVersion: claimed.run.version, claim,
    lifecycle: { state: "validating", ...base }, now,
  }).state, "applied");
  assert.equal(database.authority.runs.transition({
    runId: WRITE_FIXTURE_RUN_ID, expectedVersion: claimed.run.version + 1, claim,
    lifecycle: { state: "running", ...base, currentNodeId: WRITE_FIXTURE_NODE_ID }, now,
  }).state, "applied");

  const bindingProof = writeGuardBindingProof(WRITE_FIXTURE_RUN_ID);
  const bindingProofDigest = deriveWriteBindingProofDigest(bindingProof);
  const intent = {
    writeIntentId: UUID_8,
    workflowId: WRITE_FIXTURE_WORKFLOW_ID,
    itemId: WRITE_FIXTURE_ITEM_ID,
    taskId: "ucpath/submit-write-fixture",
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
  assert.equal(database.authority.writeIntents.fenceAttempt({ intent, attempt }).state, "fenced");

  const parked = database.authority.runs.transition({
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
  if (parked.state !== "applied") throw new Error("guard fixture park failed");
  return { run: parked.run, writeIntentId: UUID_8 };
}
