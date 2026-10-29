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
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { ATOMIC_WRITE_COMMIT, WRITE_ATTEMPT, WRITE_INTENT_ATTEMPTING } from "../../../support/fixtures/phase1c-contract-fixtures.js";

const { composeStorageCommand, attemptingDrillPaths, cleanup } = createStorageRestoreTestWorld();
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
  const { paths: p, closeDatabase, manifestPath, beforeManifestPath } = await attemptingDrillPaths(undefined, { backupAfterCommit });
  closeDatabase();
  CLOCK.setWall(new Date(ATOMIC_WRITE_COMMIT.confirmedAt));
  const inspect = (path: string) => withAuthorityDatabaseReadOnly(p.admission,path,db=>{
    const row=db.prepare("SELECT * FROM runs WHERE id=?").get(WRITE_INTENT_ATTEMPTING.runId);assert.ok(row);const run=runRecordFromRow(row);
    const attemptRow=db.prepare("SELECT * FROM write_attempts WHERE id=?").get(WRITE_ATTEMPT.writeAttemptId);assert.ok(attemptRow);const attempt=WriteAttemptRecordSchema.parse(nativeOrdinaryRecordFromRow("write_attempts",attemptRow));
    const intentRow=db.prepare("SELECT * FROM write_intents WHERE id=?").get(WRITE_INTENT_ATTEMPTING.writeIntentId);assert.ok(intentRow);const intent=WriteIntentRecordSchema.parse(nativeOrdinaryRecordFromRow("write_intents",intentRow));
    return {runId:run.envelope.runId,version:run.version,lifecycle:run.lifecycle.state,
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
    const healthy = AuthorityDatabase.open(p.admission,{ path: p.authorityPath, busyTimeoutMs: 500, migrationOwner: "restore-control" }, CLOCK, undefined, undefined, undefined, p.credentials);
    useDatabase(healthy, () => {
      const service = new RunRecordService({ database: healthy, clock: CLOCK, ids: { uuid: randomUUID },
        publishQueued: () => { throw new Error("test must not enqueue"); } });
      assert.equal(service.renewClaim({ commandId: randomUUID(), runId: current.runId,
        claim: { workerId:WorkerIdSchema.parse(current.workerId), claimGeneration: current.claimGeneration } }).state, "applied");
    });
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
  assert.equal(doctorAfter.exitCode, 1, doctorAfter.output);
  const afterReport = z.object({ spanAuthority: SpanAuthorityReconciliationWireSchema }).parse(JSON.parse(doctorAfter.output));
  assert.equal(afterReport.spanAuthority.state, "degraded");
  if (afterReport.spanAuthority.state !== "degraded") throw new Error("expected restore-loss warning");
  assert.ok(afterReport.spanAuthority.problems.some((problem) => problem.state === "restore-loss"
    && problem.runId === current.runId && problem.possibleExternalWrite === true));
});

});
