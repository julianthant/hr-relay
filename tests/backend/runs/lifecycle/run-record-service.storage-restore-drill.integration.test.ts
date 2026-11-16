import { readFileSync } from "node:fs";
import { workerSlotFromRow } from "../../../../src/backend/storage/sqlite/worker-slots.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { confirmationPublicationFromRow } from "../../../../src/models/events/confirmed-operation.js";
import { createStorageRestoreTestWorld, type DrillPaths } from "../../../support/helpers/backend/storage-restore-world.js";
import { randomUUID } from "node:crypto";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { nativeOrdinaryRecordFromRow } from "../../../../src/backend/storage/sqlite/native-record-row.js";
import { withAuthorityDatabaseReadOnly } from "../../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";
import { runRecordFromRow } from "../../../../src/backend/storage/sqlite/run-record-row.js";
import { timelineEventFromRow } from "../../../../src/backend/storage/sqlite/timeline-repository.js";
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

const world = createStorageRestoreTestWorld();
const { repairAutomatically } = world;
const { composeStorageCommand, attemptingDrillPaths, cleanup } = world;
afterEach(cleanup);

function useDatabase(database: AuthorityDatabase, work: () => void): void {
  let primary: { error: unknown } | undefined;
  try { work(); } catch (error) { primary = { error }; }
  try { database.close(); }
  catch (error) { throw new AggregateError(primary === undefined ? [error] : [primary.error, error], "restore-accounting-database-close-failed", { cause: error }); }
  if (primary !== undefined) throw primary.error;
}

function inspectDrill(p: DrillPaths, path: string) { return withAuthorityDatabaseReadOnly(p.admission,path,db=>{
  const row=db.prepare("SELECT * FROM runs WHERE id=?").get(WRITE_INTENT_ATTEMPTING.runId);assert.ok(row);const run=runRecordFromRow(row);
  const attemptRow=db.prepare("SELECT * FROM write_attempts WHERE id=?").get(WRITE_ATTEMPT.writeAttemptId);assert.ok(attemptRow);const attempt=WriteAttemptRecordSchema.parse(nativeOrdinaryRecordFromRow("write_attempts",attemptRow));
  const intentRow=db.prepare("SELECT * FROM write_intents WHERE id=?").get(WRITE_INTENT_ATTEMPTING.writeIntentId);assert.ok(intentRow);const intent=WriteIntentRecordSchema.parse(nativeOrdinaryRecordFromRow("write_intents",intentRow));
  const checkpoints = db.prepare("SELECT * FROM run_checkpoints WHERE run_id=? ORDER BY id").all(run.envelope.runId)
    .map(row => RunCheckpointRecordSchema.parse(nativeOrdinaryRecordFromRow("run_checkpoints", row)));
  const members = db.prepare("SELECT * FROM worker_slots ORDER BY ordinal").all().map(workerSlotFromRow);
  return {runRecord: run, intent, attempt, checkpoints, members, publication: confirmationPublicationFromRow(intent, intentRow.publication_json),
    runId:run.envelope.runId,version:run.version,lifecycle:run.lifecycle.state,
    workerId:"workerId" in run.lifecycle?run.lifecycle.workerId:undefined,
    claimedAt:"claimedAt" in run.lifecycle?run.lifecycle.claimedAt:undefined,claimGeneration:run.claimGeneration,
    attemptId:attempt.writeAttemptId,outcome:attempt.outcome.state,operationStatus:intent.status,
    checkpoint:db.prepare("SELECT 1 FROM run_checkpoints WHERE run_id=?").get(run.envelope.runId)!==undefined,
    events:db.prepare("SELECT * FROM timeline_events ORDER BY cursor").all().map(timelineEventFromRow).map(record=>record.payload.kind==="span"?record.payload.event.t:record.payload.kind)};
}); }

describe("restore-loss warning after real worker recovery", () => {
  const CLOCK = manualClock(new Date("2026-09-03T12:00:00.000Z"));
it.each([false, true])("restore confirmation evidence survives recovery accounting (backup after commit: %s)", async (backupAfterCommit) => {
  const { paths: p, closeDatabase, manifestPath, beforeManifestPath } = await attemptingDrillPaths(undefined, { backupAfterCommit });
  closeDatabase();
  CLOCK.setWall(new Date(ATOMIC_WRITE_COMMIT.confirmedAt));
  const inspect = (path: string) => inspectDrill(p, path);
  const before = inspect(beforeManifestPath.slice(0, -".manifest.json".length));
  const committed = inspect(p.authorityPath);
  assert.equal(before.lifecycle, "running"); assert.equal(before.outcome, "attempting");
  assert.equal(committed.version, before.version + 1); assert.equal(committed.attemptId, before.attemptId);
  assert.equal(committed.outcome, "committed"); assert.equal(committed.checkpoint, true);
  assert.equal(backupAfterCommit ? manifestPath !== beforeManifestPath : manifestPath === beforeManifestPath, true);
  if (!backupAfterCommit) {
    const bytes = readFileSync(p.authorityPath);
    await assert.rejects(repairAutomatically(p, CLOCK), /automatic-repair-verified-backup-missing/u);
    assert.deepEqual(readFileSync(p.authorityPath), bytes); assert.deepEqual(inspect(p.authorityPath), committed);
    return;
  }
  const restore = await repairAutomatically(p, CLOCK);
  assert.equal(restore.exitCode, 0, restore.output);
  const restoredReport = z.object({ suspectFileName: z.string() }).parse(JSON.parse(restore.output));
  p.renewAfterRestore();
  const doctor = await composeStorageCommand(rebuildRuntimeIsolation, ["doctor", "--json"], CLOCK, p.repoRoot);
  const current = inspect(p.authorityPath);
  const preserved = inspect(join(p.stateRoot, "backups", "suspects", restoredReport.suspectFileName));
  assert.deepEqual(current, committed); assert.deepEqual(preserved, committed);
  assert.equal(doctor.exitCode, 0, doctor.output);
});

it("boot startup recovery, before any worker, settles the pre-restore claim of an automatic restore", async () => {
  const { paths: p, closeDatabase, originalChild } = await attemptingDrillPaths(undefined, { backupAfterCommit: true });
  const spawnedBeforeRestore = world.childrenSpawned;
  closeDatabase();
  CLOCK.setWall(new Date(ATOMIC_WRITE_COMMIT.confirmedAt));
  const inspect = (path: string) => inspectDrill(p, path);
  const committed = inspect(p.authorityPath);
  assert.equal(committed.outcome, "committed"); assert.ok(committed.workerId); assert.ok(committed.claimGeneration > 0);
  const restore = await repairAutomatically(p, CLOCK);
  assert.equal(restore.exitCode, 0, restore.output);
  // The restore retires the admission that held the store; a live open needs the next boot's admission.
  assert.throws(() => AuthorityDatabase.open(p.admission, { path: p.authorityPath, busyTimeoutMs: 500, migrationOwner: "restore-control" },
    CLOCK, undefined, undefined, undefined, p.credentials));
  const recoverAtStartup = p.recoverAtStartup; assert.ok(recoverAtStartup);
  await recoverAtStartup(CLOCK);
  assert.equal(world.childrenSpawned, spawnedBeforeRestore); assert.equal(originalChild.signal, "SIGKILL");
  const recovered = inspect(p.authorityPath);
  assert.ok(recovered.runRecord.lifecycle.state === "terminal" && recovered.runRecord.lifecycle.outcome === "failed", JSON.stringify(recovered.runRecord.lifecycle));
  assert.equal(recovered.version, committed.version + 1); assert.equal(recovered.claimGeneration, committed.claimGeneration);
  assert.deepEqual(recovered.intent, committed.intent); assert.deepEqual(recovered.attempt, committed.attempt);
  assert.deepEqual(recovered.checkpoints, committed.checkpoints); assert.deepEqual(recovered.publication, committed.publication);
  assert.deepEqual(withAuthorityDatabaseReadOnly(p.admission, p.authorityPath, db => db.prepare("SELECT code FROM run_failures WHERE run_id=?").all(committed.runId).map(row => row.code)),
    ["RUN_INTERRUPTED_BY_CRASH"]);
  const live = AuthorityDatabase.open(p.admission, { path: p.authorityPath, busyTimeoutMs: 500, migrationOwner: "restore-control" }, CLOCK, undefined, undefined, undefined, p.credentials);
  useDatabase(live, () => {
    const service = new RunRecordService({ database: live, clock: CLOCK, ids: { uuid: randomUUID },
      publishQueued: () => { throw new Error("test must not enqueue"); } });
    const fingerprint = AuthorityDatabase.inspectExistingReadOnly(p.admission, p.authorityPath).authorityContentFingerprint;
    const metadata = live.getMeta();
    assert.deepEqual(service.renewClaim({ commandId: randomUUID(), runId: committed.runId,
      claim: { workerId: WorkerIdSchema.parse(committed.workerId), claimGeneration: committed.claimGeneration } }),
    { state: "refused", refusal: { reason: "lost" } });
    assert.deepEqual(live.getMeta(), metadata);
    assert.equal(AuthorityDatabase.inspectExistingReadOnly(p.admission, p.authorityPath).authorityContentFingerprint, fingerprint);
    assert.deepEqual(inspect(p.authorityPath), recovered);
  });
  const doctor = await composeStorageCommand(rebuildRuntimeIsolation, ["doctor", "--json"], CLOCK, p.repoRoot);
  assert.equal(doctor.exitCode, 0, doctor.output);
});

});
