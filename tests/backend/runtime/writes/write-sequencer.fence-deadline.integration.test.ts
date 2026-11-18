import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { StagedPageDiscardedError, WriteParkedError } from "../../../../src/backend/runtime/writes/write-sequencer.js";
import { absentProbeEvidence, WRITE_FIXTURE_NOW } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { createWriteSequencerTestWorld } from "../../../support/helpers/backend/write-sequencer-world.js";

const { harness, claimRunning, contextFor, intentByKey, attemptingIntentFixture, cleanup } = createWriteSequencerTestWorld();
afterEach(cleanup);

for (const fence of ["initial", "retryable"] as const) {
  it(`discards the staged page when the ${fence} fence acquires the writer past its deadline`, async () => {
    const h = await harness({
      onCapture: async boundary => {
        if (boundary !== "before-submit") return;
        const transact = h.database.withAuthorityTransaction.bind(h.database);
        h.database.withAuthorityTransaction = work => {
          h.database.withAuthorityTransaction = transact;
          return transact(repositories => {
            h.clock.advanceMonotonic(30_001);
            return work(repositories);
          });
        };
      },
    });
    const { run, claim } = claimRunning(h.database, h.clock);
    if (fence === "retryable") {
      const initial = attemptingIntentFixture(run.envelope.runId);
      assert.equal(h.database.authority.writeIntents.fenceAttempt({ ...initial, claim }).state, "fenced");
      h.database.authority.writeIntents.settleRetryable({
        writeIntentId: initial.intent.writeIntentId, generation: 1, expectedVersion: 1, now: WRITE_FIXTURE_NOW,
        settlement: { state: "operator-confirmed-absent", writeIntentId: initial.intent.writeIntentId,
          generation: 1, operator: "local-operator", confirmedAt: WRITE_FIXTURE_NOW },
      });
    }
    const before = intentByKey(h.database);
    const footprint = h.database.authority.writeIntents.countDryRunEvidenceByRun(run.envelope.runId);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    await assert.rejects(h.execute(contextFor(run, claim)), StagedPageDiscardedError);
    assert.deepEqual(intentByKey(h.database), before);
    assert.deepEqual(h.database.authority.writeIntents.countDryRunEvidenceByRun(run.envelope.runId), footprint);
    assert.ok(!h.world.events.some(event => event.startsWith("commit-click:")));
    assert.deepEqual(h.sessions.closeReasons(), ["poisoned"]);
  });
}

it("parks without clicking if the deadline passes while the granted fence commits", async () => {
  const h = await harness({
    onCapture: async boundary => {
      if (boundary !== "before-submit") return;
      const transact = h.database.withAuthorityTransaction.bind(h.database);
      h.database.withAuthorityTransaction = work => {
        h.database.withAuthorityTransaction = transact;
        const result = transact(work);
        h.clock.advanceMonotonic(30_001);
        return result;
      };
    },
  });
  const { run, claim } = claimRunning(h.database, h.clock);
  h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));

  await assert.rejects(h.execute(contextFor(run, claim)), WriteParkedError);
  assert.ok(!h.world.events.some(event => event.startsWith("commit-click:")));
  assert.equal(intentByKey(h.database)?.status, "parked");
  assert.equal(h.database.authority.runs.get(run.envelope.runId)?.lifecycle.state, "parked-write");
});
