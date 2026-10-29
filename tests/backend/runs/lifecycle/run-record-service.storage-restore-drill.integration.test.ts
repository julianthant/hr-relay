import { storageTree } from "../../../support/helpers/integration/storage-recovery-fixture.js";
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { workerSlotFromRow } from "../../../../src/backend/storage/sqlite/worker-slots.js";
import { workerPoolMember } from "../../../../src/models/run/worker-slot.js";
import { WorkerLeaseRecordSchema } from "../../../../src/models/run/worker.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { confirmationPublicationFromRow } from "../../../../src/models/events/confirmed-operation.js";
import { recoverInterruptedTestRun } from "../../../support/helpers/backend/run-record-service-world.js";
import { createStorageRestoreTestWorld } from "../../../support/helpers/backend/storage-restore-world.js";
import { randomUUID } from "node:crypto";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { nativeOrdinaryRecordFromRow } from "../../../../src/backend/storage/sqlite/native-record-row.js";
import { withAuthorityDatabaseReadOnly } from "../../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";
import { runRecordFromRow } from "../../../../src/backend/storage/sqlite/run-record-row.js";
import { timelineEventFromRow } from "../../../../src/backend/storage/sqlite/timeline-repository.js";
import { SpanAuthorityReconciliationWireSchema } from "../../../../src/models/dashboard/storage.js";
import { WorkerIdSchema } from "../../../../src/rules/identity/ids.js";
import { WriteAttemptRecordSchema, WriteIntentRecordSchema } from "../../../../src/rules/write-safety/write-safety.js";
import assert from "node:assert/strict";
import { join, relative } from "node:path";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { ATOMIC_WRITE_COMMIT, WRITE_ATTEMPT, WRITE_INTENT_ATTEMPTING } from "../../../support/fixtures/phase1c-contract-fixtures.js";

const world = createStorageRestoreTestWorld();
const { composeStorageCommand, attemptingDrillPaths, cleanup } = world;
afterEach(cleanup);

function useDatabase(database: AuthorityDatabase, work: () => void): void {
  let primary: { error: unknown } | undefined;
  try { work(); } catch (error) { primary = { error }; }
  try { database.close(); }
  catch (error) { throw new AggregateError(primary === undefined ? [error] : [primary.error, error], "restore-accounting-database-close-failed", { cause: error }); }
  if (primary !== undefined) throw primary.error;
}

describe("restore-loss warning after real worker recovery", () => {
  const CLOCK = manualClock(new Date("2026-09-03T12:00:00.000Z"));
it.each([false, true])("restore confirmation evidence survives recovery accounting (backup after commit: %s)", async (backupAfterCommit) => {
  const permitsBefore = world.successorPermitsIssued;
  const { paths: p, closeDatabase, manifestPath, beforeManifestPath, originalChild } = await attemptingDrillPaths(undefined, { backupAfterCommit });
  closeDatabase();
  CLOCK.setWall(new Date(ATOMIC_WRITE_COMMIT.confirmedAt));
  const inspect = (path: string) => withAuthorityDatabaseReadOnly(p.admission,path,db=>{
    const row=db.prepare("SELECT * FROM runs WHERE id=?").get(WRITE_INTENT_ATTEMPTING.runId);assert.ok(row);const run=runRecordFromRow(row);
    const attemptRow=db.prepare("SELECT * FROM write_attempts WHERE id=?").get(WRITE_ATTEMPT.writeAttemptId);assert.ok(attemptRow);const attempt=WriteAttemptRecordSchema.parse(nativeOrdinaryRecordFromRow("write_attempts",attemptRow));
    const intentRow=db.prepare("SELECT * FROM write_intents WHERE id=?").get(WRITE_INTENT_ATTEMPTING.writeIntentId);assert.ok(intentRow);const intent=WriteIntentRecordSchema.parse(nativeOrdinaryRecordFromRow("write_intents",intentRow));
    const checkpoints = db.prepare("SELECT * FROM run_checkpoints WHERE run_id=? ORDER BY id").all(run.envelope.runId)
      .map(row => RunCheckpointRecordSchema.parse(nativeOrdinaryRecordFromRow("run_checkpoints", row)));
    const members = db.prepare("SELECT * FROM worker_slots ORDER BY ordinal").all().map(workerSlotFromRow);
    const leases = db.prepare("SELECT * FROM worker_leases ORDER BY id").all()
      .map(row => WorkerLeaseRecordSchema.parse(nativeOrdinaryRecordFromRow("worker_leases", row)));
    return {runRecord: run, intent, attempt, checkpoints, members, leases, publication: confirmationPublicationFromRow(intent, intentRow.publication_json),
      runId:run.envelope.runId,version:run.version,lifecycle:run.lifecycle.state,
      workerId:"workerId" in run.lifecycle?run.lifecycle.workerId:undefined,
      claimedAt:"claimedAt" in run.lifecycle?run.lifecycle.claimedAt:undefined,claimGeneration:run.claimGeneration,
      workerLifetime:"workerLifetime" in run.lifecycle?run.lifecycle.workerLifetime:undefined,
      attemptId:attempt.writeAttemptId,outcome:attempt.outcome.state,operationStatus:intent.status,
      checkpoint:db.prepare("SELECT 1 FROM run_checkpoints WHERE run_id=?").get(run.envelope.runId)!==undefined,
      events:db.prepare("SELECT * FROM timeline_events ORDER BY cursor").all().map(timelineEventFromRow).map(record=>record.payload.kind==="span"?record.payload.event.t:record.payload.kind)};
  });
  const before = inspect(beforeManifestPath.slice(0, -".manifest.json".length));
  const committed = inspect(p.authorityPath);
  assert.equal(before.lifecycle, "running"); assert.equal(before.outcome, "attempting");
  assert.equal(committed.version, before.version + 1); assert.equal(committed.attemptId, before.attemptId);
  assert.equal(committed.outcome, "committed"); assert.equal(committed.checkpoint, true);
  assert.equal(backupAfterCommit ? manifestPath !== beforeManifestPath : manifestPath === beforeManifestPath, true);
  const restore = await composeStorageCommand(rebuildRuntimeIsolation,
    ["restore", "--from", manifestPath, "--json"], CLOCK, p.repoRoot);
  assert.equal(restore.exitCode, 0, restore.output);
  const restoredReport = z.object({ suspectFileName: z.string() }).parse(JSON.parse(restore.output));
  p.renewAfterRestore();
  const doctor = await composeStorageCommand(rebuildRuntimeIsolation, ["doctor", "--json"], CLOCK, p.repoRoot);
  const current = inspect(p.authorityPath);
  const preserved = inspect(join(p.stateRoot, "backups", "suspects", restoredReport.suspectFileName));
  assert.deepEqual(current, backupAfterCommit ? committed : before); assert.deepEqual(preserved, committed);
  assert.equal(doctor.exitCode, backupAfterCommit ? 0 : 1, doctor.output);
  if (backupAfterCommit) {
    assert.equal(current.members.length, 1); assert.equal(current.leases.length, 1);
    const oldMember = current.members[0], oldLease = current.leases[0]; assert.ok(oldMember); assert.ok(oldLease);
    const member = workerPoolMember(oldMember);
    assert.equal(oldLease.processId, originalChild.pid); assert.equal(originalChild.signal, "SIGKILL");
    const captureIndependentCustody = () => {
      for (const suffix of ["-wal", "-shm", "-journal"]) assert.equal(existsSync(p.authorityPath + suffix), false);
      const files = storageTree(p.repoRoot), authority = relative(p.repoRoot, p.authorityPath);
      assert.ok(files[authority] !== undefined); delete files[authority];
      const identities = Object.fromEntries(Object.keys(files).map(path => {
        const stat = lstatSync(join(p.repoRoot, path));
        return [path, { device: stat.dev, inode: stat.ino, mode: stat.mode, owner: stat.uid, links: stat.nlink,
          size: stat.size, modifiedAt: stat.mtimeMs, changedAt: stat.ctimeMs }];
      }));
      const entries = readdirSync(p.repoRoot, { recursive: true, encoding: "utf8" }).sort();
      const directories = Object.fromEntries(["", ...entries].filter(path => lstatSync(join(p.repoRoot, path)).isDirectory()).map(path => {
        const stat = lstatSync(join(p.repoRoot, path));
        return [path, { device: stat.dev, inode: stat.ino, mode: stat.mode, owner: stat.uid }];
      }));
      const live = lstatSync(p.authorityPath);
      return { files, identities, directories, entries,
        authorityIdentity: { device: live.dev, inode: live.ino, mode: live.mode, owner: live.uid, links: live.nlink } };
    };
    const independentBefore = captureIndependentCustody();
    assert.equal(oldLease.workerId, member.workerId); assert.ok(current.workerLifetime);
    assert.deepEqual(current.workerLifetime, { membershipRevision: member.membershipRevision, leaseGeneration: oldLease.leaseGeneration });
    assert.equal(current.intent.status, "committed"); assert.ok(current.publication); assert.equal(current.checkpoints.length, 1);
    const successorInput = { runId: current.runId, member, oldLeaseGeneration: oldLease.leaseGeneration,
      oldProcessId: oldLease.processId, oldLeaseStartedAt: oldLease.lifecycle.startedAt,
      oldClaimGeneration: current.claimGeneration, oldAttempt: current.runRecord.envelope.attempt,
      expectedPoolVersion: 0, now: CLOCK.now().toISOString() };
    const healthy = AuthorityDatabase.open(p.admission,{ path: p.authorityPath, busyTimeoutMs: 500, migrationOwner: "restore-control" }, CLOCK, undefined, undefined, undefined, p.credentials);
    useDatabase(healthy, () => {
      const service = new RunRecordService({ database: healthy, clock: CLOCK, ids: { uuid: randomUUID },
        publishQueued: () => { throw new Error("test must not enqueue"); } });
      const fingerprint = AuthorityDatabase.inspectExistingReadOnly(p.admission, p.authorityPath).authorityContentFingerprint;
      const metadata = healthy.getMeta();
      assert.deepEqual(service.renewClaim({ commandId: randomUUID(), runId: current.runId,
        claim: { workerId: WorkerIdSchema.parse(current.workerId), claimGeneration: current.claimGeneration } }),
      { state: "refused", refusal: { reason: "lost" } });
      assert.deepEqual(healthy.getMeta(), metadata);
      assert.equal(AuthorityDatabase.inspectExistingReadOnly(p.admission, p.authorityPath).authorityContentFingerprint, fingerprint);
      assert.deepEqual(inspect(p.authorityPath), current);
      assert.equal(healthy.authority.writeIntents.listByRun(current.runId).every(intent => intent.status === "committed" || intent.status === "observed-present"), true);
      const request = { commandId: randomUUID(), runId: current.runId, expectedVersion: current.version,
        claim: { workerId: member.workerId, claimGeneration: current.claimGeneration }, cause: "recovery" as const };
      const queued = service.requeue(request);
      assert.equal(queued.state, "applied");
      if (queued.state !== "applied") throw new Error("confirmed-continuation-recovery-refused", { cause: queued });
      assert.equal(queued.run.lifecycle.state, "queued"); assert.equal(queued.run.version, current.version + 1);
      assert.equal(queued.run.claimGeneration, current.claimGeneration);
      const replayGeneration = healthy.getMeta().authorityGeneration;
      assert.deepEqual(service.requeue(request), queued); assert.equal(healthy.getMeta().authorityGeneration, replayGeneration);
      healthy.settleInterruptedWorker(p.lifetime, member.workerId, oldLease.leaseGeneration, CLOCK.now().toISOString());
      const stopped = healthy.authority.workerLeases.get(member.workerId); assert.ok(stopped);
      assert.equal(stopped.lifecycle.state, "stopped"); assert.equal(stopped.processId, oldLease.processId);
      assert.equal(stopped.leaseGeneration, oldLease.leaseGeneration);
      healthy.assertStoppedWorkerLifetime(member, { leaseGeneration: oldLease.leaseGeneration,
        processId: oldLease.processId, startedAt: oldLease.lifecycle.startedAt });
      assert.deepEqual(healthy.authority.writeIntents.get(current.intent.writeIntentId), current.intent);
      assert.deepEqual(healthy.authority.writeAttempts.get(current.attempt.writeAttemptId), current.attempt);
      assert.deepEqual(inspect(p.authorityPath).checkpoints, current.checkpoints);
      const pool = healthy.authority.workerPools.get(member.workflowId); assert.ok(pool);
      successorInput.expectedPoolVersion = pool.version;
    });
    const renewed = await world.renewConfirmedInSuccessor(p, successorInput);
    assert.equal(world.successorPermitsIssued, permitsBefore + 1);
    assert.deepEqual(captureIndependentCustody(), independentBefore);
    assert.equal(renewed.ownedExit.code, 0); assert.equal(renewed.ownedExit.signal, null);
    assert.equal(renewed.lease.processId, renewed.ownedExit.pid);
    assert.deepEqual(renewed.previousLifetime, { workerId: oldLease.workerId, processId: originalChild.pid,
      leaseGeneration: oldLease.leaseGeneration, startedAt: oldLease.lifecycle.startedAt });
    const advanced = inspect(p.authorityPath);
    assert.deepEqual(advanced.runRecord, renewed.run); assert.deepEqual(advanced.members.map(workerPoolMember), current.members.map(workerPoolMember));
    assert.equal(advanced.claimGeneration, current.claimGeneration + 1); assert.equal(advanced.runRecord.envelope.attempt, current.runRecord.envelope.attempt);
    assert.deepEqual(advanced.intent, current.intent); assert.deepEqual(advanced.attempt, current.attempt);
    assert.deepEqual(advanced.checkpoints, current.checkpoints); assert.deepEqual(advanced.publication, current.publication);
    assert.equal(advanced.leases[0]?.leaseGeneration, oldLease.leaseGeneration + 1);
    const accounted = await composeStorageCommand(rebuildRuntimeIsolation, ["doctor", "--json"], CLOCK, p.repoRoot);
    assert.equal(accounted.exitCode, 0, accounted.output);
    assert.ok(inspect(p.authorityPath).version > committed.version);
    return;
  }
  CLOCK.advanceWall(60 * 60 * 1000);
  const mutationDb = AuthorityDatabase.open(p.admission,{ path: p.authorityPath, busyTimeoutMs: 500, migrationOwner: "restore-crash-recovery" }, CLOCK, undefined, undefined, undefined, p.credentials);
  useDatabase(mutationDb, () => {
    const recovered = recoverInterruptedTestRun(mutationDb, CLOCK, before.runId, p.lifetime);
    assert.equal(recovered.lifecycle.state, "parked-write");
  });
  const afterSweep = inspect(p.authorityPath);
  assert.equal(afterSweep.version, committed.version);
  assert.equal(afterSweep.lifecycle, "parked-write");
  assert.equal(afterSweep.outcome, "attempting"); assert.equal(afterSweep.checkpoint, false);
  const doctorAfter = await composeStorageCommand(rebuildRuntimeIsolation, ["doctor", "--json"], CLOCK, p.repoRoot);
  assert.equal(world.successorPermitsIssued, permitsBefore);
  assert.equal(doctorAfter.exitCode, 1, doctorAfter.output);
  const afterReport = z.object({ spanAuthority: SpanAuthorityReconciliationWireSchema }).parse(JSON.parse(doctorAfter.output));
  assert.equal(afterReport.spanAuthority.state, "degraded");
  if (afterReport.spanAuthority.state !== "degraded") throw new Error("expected restore-loss warning");
  assert.ok(afterReport.spanAuthority.problems.some((problem) => problem.state === "restore-loss"
    && problem.runId === current.runId && problem.possibleExternalWrite === true));
});

});
