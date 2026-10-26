import { retainAuthoritySourceClosure } from '../../../../src/backend/storage/source-closure.js';
import { createBoundProfileFixture } from '../../../support/helpers/admission-fixture.js';
import { testRunService } from '../../../support/fixtures/run-lifecycle-fixtures.js';
import { runClaim } from '../../../../src/models/run/record.js';
import { randomUUID } from 'node:crypto';
import { fenceWriteFixture } from "../../../support/helpers/write-fence-fixture.js";
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { manualClock } from "../../../../src/rules/time/clock.js";
import {
ATOMIC_WRITE_COMMIT as NATIVE_ATOMIC_WRITE_COMMIT,
NOW,
WRITE_ATTEMPT,
WRITE_INTENT_ATTEMPTING,
} from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";
import { atomicWriteCheckpoint,currentAtomicWriteFixture,seedAtomicWriteOwner } from "../../../support/helpers/timeline-write-fixture.js";

const ATOMIC_WRITE_COMMIT = currentAtomicWriteFixture(NATIVE_ATOMIC_WRITE_COMMIT);

const retainedCountFixtureOwners = new Set<object>();

describe("dry-run write-safety evidence query", () => {
  it("counts only rows joined from the named run's intents", () => {
    const held: { profile?: ReturnType<typeof createBoundProfileFixture>; database?: AuthorityDatabase; primary?: { error: unknown } } = {};
    retainedCountFixtureOwners.add(held);
    try {
    const profile = createBoundProfileFixture(); held.profile = profile;
    const clock = manualClock(new Date(NOW));
    const database = AuthorityDatabase.open(
      { path: profile.path, busyTimeoutMs: 250, migrationOwner: "dry-run-count-test" },
      clock,
    );
    held.database = database;

    fenceWriteFixture(database, {
      intent: WRITE_INTENT_ATTEMPTING,
      attempt: WRITE_ATTEMPT,
    });
    assert.deepEqual(
      database.authority.writeIntents.countDryRunEvidenceByRun(WRITE_INTENT_ATTEMPTING.runId),
      { writeIntents: 1, writeAttempts: 1, confirmedOperations: 0 },
    );
    assert.deepEqual(
      database.authority.writeIntents.countDryRunEvidenceByRun("55555555-5555-4555-8555-555555555555"),
      { writeIntents: 0, writeAttempts: 0, confirmedOperations: 0 },
    );

    seedAtomicWriteOwner(database, ATOMIC_WRITE_COMMIT, profile.path);
    database.commitWriteAttempt(ATOMIC_WRITE_COMMIT, atomicWriteCheckpoint(ATOMIC_WRITE_COMMIT));
    assert.deepEqual(
      database.authority.writeIntents.countDryRunEvidenceByRun(WRITE_INTENT_ATTEMPTING.runId),
      { writeIntents: 1, writeAttempts: 1, confirmedOperations: 1 },
    );

    const confirmed = database.authority.writeIntents.listByRun(WRITE_INTENT_ATTEMPTING.runId);
    assert.ok(confirmed.length > 0);
    for (const intent of confirmed) assert.equal(intent.status, 'committed');
    const confirmedSnapshot = structuredClone(confirmed);
    const current = database.authority.runs.get(WRITE_INTENT_ATTEMPTING.runId); assert.ok(current);
    const claim = runClaim(current); assert.ok(claim);
    assert.equal(testRunService(database, clock).requeue({ commandId: randomUUID(), runId: current.envelope.runId, expectedVersion: current.version,
      claim: { workerId: claim.workerId, claimGeneration: claim.claimGeneration }, cause: 'recovery' }).state, 'applied');
    assert.deepEqual(database.authority.writeIntents.listByRun(WRITE_INTENT_ATTEMPTING.runId), confirmedSnapshot);
    const after = database.authority.runs.get(current.envelope.runId); assert.ok(after);
    assert.equal(runClaim(after), undefined);
    database.close(); profile.close(); retainedCountFixtureOwners.delete(held);
    } catch (error) { held.primary = { error }; throw retainAuthoritySourceClosure([error], { admission: held }); }
  });
});
