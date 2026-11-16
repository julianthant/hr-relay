import { openConfirmedRetentionDatabase } from "../../../support/helpers/storage/confirmed-retention-fixtures.js";
import { randomUUID } from "node:crypto";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import type { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { afterEach,describe,expect,it } from "vitest";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { ATOMIC_WRITE_COMMIT as HISTORICAL_ATOMIC_WRITE_COMMIT,UUID_5,UUID_6,WRITE_ATTEMPT,WRITE_INTENT_ATTEMPTING } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { atomicWriteCheckpoint,currentAtomicWriteFixture } from "../../../support/helpers/timeline-write-fixture.js";

const ATOMIC_WRITE_COMMIT = currentAtomicWriteFixture(HISTORICAL_ATOMIC_WRITE_COMMIT);

const profiles: Awaited<ReturnType<typeof createBoundProfileFixture>>[] = [];
const databases: AuthorityDatabase[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  for (const profile of profiles.splice(0)) await profile.close();
});
const ts = "2026-09-08T12:00:00.000Z";
describe("retained confirmed history and shared retry deletion", () => {
  async function committed() {
    const profile = await createBoundProfileFixture(); profiles.push(profile);
    const fixture = openConfirmedRetentionDatabase(profile.path, ts, ATOMIC_WRITE_COMMIT, WRITE_INTENT_ATTEMPTING, WRITE_ATTEMPT);
    databases.push(fixture.database);
    return fixture;
  }
  it("preserves permanent ancestor proof across intermediate and descendant deletion", async () => {
    const { database, run } = await committed();
    const permanent = {
      intent: database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId),
      attempt: database.authority.writeAttempts.get(WRITE_ATTEMPT.writeAttemptId),
      publication: database.authority.writeIntents.getPublication(WRITE_INTENT_ATTEMPTING.writeIntentId),
    };
    const service = new RunRecordService({ database, clock: manualClock(new Date(ts)),
      ids: { uuid: randomUUID }, publishQueued: () => { throw new Error("deletion must not publish"); } });
    const remove = (runId: string, commandId: string): void => {
      const retained = database.authority.runs.get(runId);
      if (retained === undefined) throw new Error("missing deletion owner");
      expect(service.delete({ runId, commandId, expectedVersion: retained.version }).state).toBe("deleted");
    };
    try {
      const retry = RunRecordSchema.parse({ ...run,
        envelope: { ...run.envelope, runId: UUID_6, traceId: "se-120000-6666", attempt: 2,
          retryOf: run.envelope.runId, enqueuedAt: ts },
        lifecycle: { state: "queued" }, version: 1, createdAt: ts, updatedAt: ts });
      database.authority.runs.enqueue(retry);
      remove(run.envelope.runId, UUID_5);
      database.authority.runs.transition({ runId: retry.envelope.runId, expectedVersion: retry.version,
        lifecycle: { state: "terminal", outcome: "cancelled", endedAt: ts }, now: ts });
      const descendant = RunRecordSchema.parse({ ...retry, envelope: { ...retry.envelope,
        runId: "87000000-0000-4000-8000-000000000003", traceId: "se-120000-7777", attempt: 3,
        retryOf: retry.envelope.runId } });
      database.authority.runs.enqueue(descendant);
      const checkpoint = atomicWriteCheckpoint(ATOMIC_WRITE_COMMIT);
      const readCheckpoint = () => database.authority.runCheckpoints.get(checkpoint.workflowId, checkpoint.itemId,
        checkpoint.nodeId, checkpoint.attempt, checkpoint.claimGeneration);
      remove(retry.envelope.runId, UUID_6);
      expect(database.authority.runs.get(descendant.envelope.runId)).toBeDefined();
      expect(database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId)?.status).toBe("committed");
      expect(readCheckpoint()).toBeUndefined();
      database.authority.runs.transition({ runId: descendant.envelope.runId, expectedVersion: descendant.version,
        lifecycle: { state: "terminal", outcome: "cancelled", endedAt: ts }, now: ts });
      remove(descendant.envelope.runId, "87000000-0000-4000-8000-000000000004");
      expect(database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId)?.status).toBe("committed");
      expect(database.authority.writeAttempts.get(WRITE_ATTEMPT.writeAttemptId)?.outcome.state).toBe("committed");
      expect({ intent: database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId),
        attempt: database.authority.writeAttempts.get(WRITE_ATTEMPT.writeAttemptId),
        publication: database.authority.writeIntents.getPublication(WRITE_INTENT_ATTEMPTING.writeIntentId) }).toEqual(permanent);
      expect(readCheckpoint()).toBeUndefined();
      expect(database.authority.deletedRuns.get(descendant.envelope.runId)?.removed.find(
        (entry) => entry.table === "run_checkpoints")).toBeUndefined();
    } finally { database.close(); }
  });

});
