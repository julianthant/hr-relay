import { recoverInterruptedTestRun } from "../../../support/helpers/backend/run-record-service-world.js";
import { fenceWriteFixture } from "../../../support/helpers/write-fence-fixture.js";
import { createStorageRestoreTestWorld, type DrillPaths } from "../../../support/helpers/backend/storage-restore-world.js";
import { randomUUID } from "node:crypto";
import { runQueuedSpanEvent } from "../../../../src/backend/runs/commands/run-queued-span.js";
import { RunRecordService, workerRunLifecyclePort } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { executeSequencedWriteCommit } from "../../../../src/backend/runtime/writes/write-sequencer.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { nativeOrdinaryRecordFromRow } from "../../../../src/backend/storage/sqlite/native-record-row.js";
import { withAuthorityDatabaseReadOnly } from "../../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";
import { runRecordFromRow } from "../../../../src/backend/storage/sqlite/run-record-row.js";
import { timelineEventFromRow } from "../../../../src/backend/storage/sqlite/timeline-repository.js";
import { SpanAuthorityReconciliationWireSchema } from "../../../../src/models/dashboard/storage.js";
import { LOCAL_OPERATOR_ACTOR_ID, PositiveIntSchema, WorkerIdSchema } from "../../../../src/rules/identity/ids.js";
import { deriveWriteBindingProofDigest, WriteAttemptRecordSchema, WriteIntentRecordSchema } from "../../../../src/rules/write-safety/write-safety.js";
import { ATOMIC_WRITE_COMMIT as HISTORICAL_COMMIT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { atomicWriteCheckpoint, currentAtomicWriteFixture, seedAtomicWriteOwner } from "../../../support/helpers/timeline-write-fixture.js";
import assert from "node:assert/strict";
import {readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { WRITE_ATTEMPT, WRITE_INTENT_ATTEMPTING } from "../../../support/fixtures/phase1c-contract-fixtures.js";

const {composeStorageCommand, drillPaths, open, cleanup } = createStorageRestoreTestWorld();


afterEach(cleanup);

describe("restore-loss warning after real worker recovery", () => {
  const CLOCK = manualClock(new Date("2026-09-03T12:00:00.000Z"));
  const proof = { ...WRITE_INTENT_ATTEMPTING.bindingProof,
    afterPrepareSpanPath: `${HISTORICAL_COMMIT.transaction.traceId}/write-${WRITE_INTENT_ATTEMPTING.writeIntentId}/prepare` };
  const bindingProofDigest = deriveWriteBindingProofDigest(proof);
  const intent = { ...WRITE_INTENT_ATTEMPTING, bindingProof: proof, bindingProofDigest };
  const attempt = { ...WRITE_ATTEMPT, bindingProof: proof, bindingProofDigest };
  const ATOMIC_WRITE_COMMIT = currentAtomicWriteFixture({ ...HISTORICAL_COMMIT,
    transaction: { ...HISTORICAL_COMMIT.transaction, bindingProofDigest },
    committedSpan: { ...HISTORICAL_COMMIT.committedSpan, bindingProofDigest },
  });
  async function paths(){return await drillPaths();}
  function createAuthority(p:DrillPaths){const db=open(p);db.close();}
it.each([false, true])("restore confirmation evidence survives recovery accounting (backup after commit: %s)", async (backupAfterCommit) => {
  CLOCK.setWall(new Date(WRITE_INTENT_ATTEMPTING.fencedAt));
  const p = await paths(); createAuthority(p);
  const checkpoint = atomicWriteCheckpoint(ATOMIC_WRITE_COMMIT);
  const inspect = (path: string) => withAuthorityDatabaseReadOnly(p.admission,path,db=>{
    const row=db.prepare("SELECT * FROM runs WHERE id=?").get(WRITE_INTENT_ATTEMPTING.runId);assert.ok(row);const run=runRecordFromRow(row);
    const attemptRow=db.prepare("SELECT * FROM write_attempts WHERE id=?").get(WRITE_ATTEMPT.writeAttemptId);assert.ok(attemptRow);const attempt=WriteAttemptRecordSchema.parse(nativeOrdinaryRecordFromRow("write_attempts",attemptRow));
    const intentRow=db.prepare("SELECT * FROM write_intents WHERE id=?").get(WRITE_INTENT_ATTEMPTING.writeIntentId);assert.ok(intentRow);const intent=WriteIntentRecordSchema.parse(nativeOrdinaryRecordFromRow("write_intents",intentRow));
    return {runId:run.envelope.runId,version:run.version,lifecycle:run.lifecycle.state,
      workerId:"workerId" in run.lifecycle?run.lifecycle.workerId:undefined,
      claimedAt:"claimedAt" in run.lifecycle?run.lifecycle.claimedAt:undefined,claimGeneration:run.claimGeneration,
      attemptId:attempt.writeAttemptId,outcome:attempt.outcome.state,operationStatus:intent.status,
      checkpoint:db.prepare("SELECT 1 FROM run_checkpoints WHERE run_id=?").get(run.envelope.runId)!==undefined,
      events:db.prepare("SELECT * FROM timeline_events ORDER BY cursor").all().map(timelineEventFromRow).map(record=>record.payload.kind==="span"?record.payload.event.t:record.payload.kind)};
  });
  const initial = AuthorityDatabase.open(p.admission,{ path: p.authorityPath, busyTimeoutMs: 500, migrationOwner: "r1c-seed" }, CLOCK, undefined, undefined, undefined, p.credentials);
  try {
    seedAtomicWriteOwner(initial, ATOMIC_WRITE_COMMIT,p.authorityPath);
    const queued = initial.authority.runs.get(WRITE_INTENT_ATTEMPTING.runId); assert.ok(queued);
    createTimelineEmitter({ repository: initial.authority.timelineEvents, clock: CLOCK }).emit(
      runQueuedSpanEvent({ run: queued, actorId: LOCAL_OPERATOR_ACTOR_ID, title: "Synthetic restored commit" }));
    assert.equal(queued.lifecycle.state,"claimed");
    if(queued.lifecycle.state!=="claimed")throw new Error("fixture owner was not claimed");
    const workerId=queued.lifecycle.workerId;
    const service = new RunRecordService({ database: initial, clock: CLOCK, ids: { uuid: randomUUID },
      publishQueued: () => { throw new Error("test must not enqueue"); } });
    const validating = service.workerTransition({ commandId: randomUUID(), runId: queued.envelope.runId,
      claim: { workerId, claimGeneration: 1 }, lifecycle: { state: "validating", workerLifetime: queued.lifecycle.workerLifetime,
        workerId, claimedAt: CLOCK.now().toISOString(), heartbeatAt: CLOCK.now().toISOString() } });
    assert.equal(validating.state, "applied", JSON.stringify(validating));
    const running = service.workerTransition({ commandId: randomUUID(), runId: queued.envelope.runId,
      claim: { workerId, claimGeneration: 1 }, lifecycle: { state: "running", workerLifetime: queued.lifecycle.workerLifetime,
        workerId, claimedAt: CLOCK.now().toISOString(), heartbeatAt: CLOCK.now().toISOString(),
        currentNodeId: checkpoint.nodeId } });
    assert.equal(running.state, "applied");
    fenceWriteFixture(initial, { intent, attempt });
  } finally { initial.close(); }
  const before = inspect(p.authorityPath);
  assert.equal(before.lifecycle, "running"); assert.equal(before.outcome, "attempting");
  let backup = await composeStorageCommand(rebuildRuntimeIsolation, ["backup"], CLOCK, p.repoRoot);
  assert.equal(backup.exitCode, 0, backup.output);
  let manifest = readdirSync(p.backupDirectory).find((name) => name.endsWith(".manifest.json")); assert.ok(manifest);
  CLOCK.setWall(new Date(ATOMIC_WRITE_COMMIT.confirmedAt));
  const newer = AuthorityDatabase.open(p.admission,{ path: p.authorityPath, busyTimeoutMs: 500, migrationOwner: "r1c-commit" }, CLOCK, undefined, undefined, undefined, p.credentials);
  try {
    const service = new RunRecordService({ database: newer, clock: CLOCK, ids: { uuid: randomUUID },
      publishQueued: () => { throw new Error("test must not enqueue"); } });
    const claim = { workerId: WorkerIdSchema.parse(before.workerId),
      claimGeneration: PositiveIntSchema.parse(before.claimGeneration) };
    executeSequencedWriteCommit(newer, { run: { runId: before.runId, expectedVersion: before.version, claim },
      commit: ATOMIC_WRITE_COMMIT, checkpoint }, { kind: "advance-running", claim, claimedAt: before.claimedAt!,
      port: workerRunLifecyclePort(service) });
  } finally { newer.close(); }
  const committed = inspect(p.authorityPath);
  assert.equal(committed.version, before.version + 1); assert.equal(committed.attemptId, before.attemptId);
  assert.equal(committed.outcome, "committed"); assert.equal(committed.checkpoint, true);
  if (backupAfterCommit) {
    // A preserved confirmation already present in the restored backup is accounted for.
    backup = await composeStorageCommand(rebuildRuntimeIsolation, ["backup"], CLOCK, p.repoRoot);
    assert.equal(backup.exitCode, 0, backup.output);
    manifest = readdirSync(p.backupDirectory).filter((name) => name.endsWith(".manifest.json")).sort().at(-1);
    assert.ok(manifest);
  }
  const restore = await composeStorageCommand(rebuildRuntimeIsolation,
    ["restore", "--from", join(p.backupDirectory, manifest), "--json"], CLOCK, p.repoRoot);
  assert.equal(restore.exitCode, 0, restore.output);
  const restoredReport = z.object({ suspectFileName: z.string() }).parse(JSON.parse(restore.output));
  const doctor = await composeStorageCommand(rebuildRuntimeIsolation, ["doctor", "--json"], CLOCK, p.repoRoot);
  const current = inspect(p.authorityPath);
  const preserved = inspect(join(p.stateRoot, "backups", "suspects", restoredReport.suspectFileName));
  assert.deepEqual(current, backupAfterCommit ? committed : before); assert.deepEqual(preserved, committed);
  assert.equal(doctor.exitCode, backupAfterCommit ? 0 : 1, doctor.output);
  if (backupAfterCommit) {
    const healthy = AuthorityDatabase.open(p.admission,{ path: p.authorityPath, busyTimeoutMs: 500, migrationOwner: "restore-control" }, CLOCK, undefined, undefined, undefined, p.credentials);
    try {
      const service = new RunRecordService({ database: healthy, clock: CLOCK, ids: { uuid: randomUUID },
        publishQueued: () => { throw new Error("test must not enqueue"); } });
      assert.equal(service.renewClaim({ commandId: randomUUID(), runId: current.runId,
        claim: { workerId:WorkerIdSchema.parse(current.workerId), claimGeneration: current.claimGeneration } }).state, "applied");
    } finally { healthy.close(); }
    const accounted = await composeStorageCommand(rebuildRuntimeIsolation, ["doctor", "--json"], CLOCK, p.repoRoot);
    assert.equal(accounted.exitCode, 0, accounted.output);
    assert.ok(inspect(p.authorityPath).version > committed.version);
    return;
  }
  CLOCK.advanceWall(60 * 60 * 1000);
  const mutationDb = AuthorityDatabase.open(p.admission,{ path: p.authorityPath, busyTimeoutMs: 500, migrationOwner: "restore-crash-recovery" }, CLOCK, undefined, undefined, undefined, p.credentials);
  try {
    const recovered = recoverInterruptedTestRun(mutationDb, CLOCK, before.runId, p.lifetime);
    assert.equal(recovered.lifecycle.state, "parked-write");
  } finally { mutationDb.close(); }
  const afterSweep = inspect(p.authorityPath);
  assert.equal(afterSweep.version, committed.version);
  assert.equal(afterSweep.lifecycle, "parked-write");
  assert.equal(afterSweep.outcome, "attempting"); assert.equal(afterSweep.checkpoint, false);
  const doctorAfter = await composeStorageCommand(rebuildRuntimeIsolation, ["doctor", "--json"], CLOCK, p.repoRoot);
  assert.equal(doctorAfter.exitCode, 1, doctorAfter.output);
  const afterReport = z.object({ spanAuthority: SpanAuthorityReconciliationWireSchema }).parse(JSON.parse(doctorAfter.output));
  assert.equal(afterReport.spanAuthority.state, "degraded");
  if (afterReport.spanAuthority.state !== "degraded") throw new Error("expected restore-loss warning");
  assert.ok(afterReport.spanAuthority.problems.some((problem) => problem.state === "restore-loss"
    && problem.runId === current.runId && problem.possibleExternalWrite === true));
});

});
