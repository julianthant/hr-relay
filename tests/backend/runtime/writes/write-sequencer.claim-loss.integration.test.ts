import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { createWriteSequencerTestWorld } from "../../../support/helpers/backend/write-sequencer-world.js";
import { absentProbeEvidence, WRITE_FIXTURE_NOW } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { RunLifecycleRefusedError } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { deriveWriteBindingProofDigest } from "../../../../src/rules/write-safety/write-safety.js";
import { UUID_6 } from "../../../support/fixtures/phase1c-contract-fixtures.js";

const { harness, claimRunning, contextFor, intentByKey, attemptingIntentFixture, cleanup } = createWriteSequencerTestWorld();
afterEach(cleanup);

describe("write fence claim admission", () => {
  for (const operation of ["fenceAttempt", "refenceRetryable"] as const) {
    for (const violation of ["released", "wrong-worker", "stale-generation", "claimed", "cancelled"] as const) {
      it(`${operation} refuses ${violation} without changing write authority`, async () => {
        const h = await harness();
        const { run, claim } = claimRunning(h.database, h.clock);
        const original = attemptingIntentFixture(run.envelope.runId);
        let fence = original;
        if (operation === "refenceRetryable") {
          assert.equal(h.database.authority.writeIntents.fenceAttempt({ ...original, claim }).state, "fenced");
          h.database.authority.writeIntents.settleRetryable({ writeIntentId: original.intent.writeIntentId,
            generation: 1, expectedVersion: 1, now: WRITE_FIXTURE_NOW,
            settlement: { state: "operator-confirmed-absent", writeIntentId: original.intent.writeIntentId,
              generation: 1, operator: "local-operator", confirmedAt: WRITE_FIXTURE_NOW } });
          const bindingProof = { ...original.intent.bindingProof, proofId: UUID_6 };
          const bindingProofDigest = deriveWriteBindingProofDigest(bindingProof);
          fence = { intent: { ...original.intent, generation: 2, version: 3, bindingProof, bindingProofDigest },
            attempt: { ...original.attempt, generation: 2, bindingProof, bindingProofDigest } };
        }
        let presentedClaim = claim;
        if (violation === "wrong-worker") presentedClaim = { ...claim, workerId: "write-fixture-worker-2" };
        if (violation === "stale-generation") presentedClaim = { ...claim, claimGeneration: claim.claimGeneration + 1 };
        if (violation === "released") {
          assert.equal(h.database.authority.runs.requeue({ runId: run.envelope.runId, expectedVersion: run.version,
            claim, cause: "recovery", now: WRITE_FIXTURE_NOW }).state, "applied");
        }
        if (violation === "claimed") {
          assert.equal(h.database.authority.runs.requeue({ runId: run.envelope.runId, expectedVersion: run.version,
            claim, cause: "recovery", now: WRITE_FIXTURE_NOW }).state, "applied");
          const reclaimed = h.database.authority.runs.claimNext({ workflow: run.envelope.workflow,
            workerId: claim.workerId, now: WRITE_FIXTURE_NOW });
          assert.equal(reclaimed.state, "claimed");
          if (reclaimed.state !== "claimed") throw new Error("fixture reclaim failed");
          presentedClaim = { ...claim, claimGeneration: reclaimed.run.claimGeneration };
        }
        if (violation === "cancelled") {
          assert.equal(h.database.authority.runs.requestCancellation({ runId: run.envelope.runId,
            expectedVersion: run.version, now: WRITE_FIXTURE_NOW }).state, "applied");
        }
        const generationBefore = h.database.getMeta().authorityGeneration;
        const before = JSON.stringify({ intent: intentByKey(h.database),
          attempts: h.database.authority.writeAttempts.listByIntent(original.intent.writeIntentId) });
        const result = operation === "fenceAttempt"
          ? h.database.authority.writeIntents.fenceAttempt({ ...fence, claim: presentedClaim })
          : h.database.authority.writeIntents.refenceRetryable({ ...fence, claim: presentedClaim, expectedVersion: 2 });
        assert.equal(result.state, "refused");
        if (result.state !== "refused") throw new Error("write fence unexpectedly admitted");
        assert.equal(result.refusal.reason, violation === "claimed" || violation === "cancelled" ? "invalid-state" : "lost");
        assert.equal(h.database.getMeta().authorityGeneration, generationBefore);
        assert.equal(JSON.stringify({ intent: intentByKey(h.database),
          attempts: h.database.authority.writeAttempts.listByIntent(original.intent.writeIntentId) }), before);
      });
    }
  }
  it("refuses a released claim before creating an intent or clicking", async () => {
    const h = await harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h.world.onPrepare = () => {
      const current = h.database.authority.runs.get(run.envelope.runId);
      assert.ok(current);
      assert.equal(h.database.authority.runs.requeue({ runId: run.envelope.runId,
        expectedVersion: current.version, claim, cause: "recovery", now: WRITE_FIXTURE_NOW }).state, "applied");
    };

    await assert.rejects(h.execute(contextFor(run, claim)), (error: unknown) => error instanceof RunLifecycleRefusedError
      && error.outcome.state === "refused" && error.outcome.refusal.reason === "lost");
    assert.equal(h.world.events.some(event => event.startsWith("commit-click:")), false);
    assert.equal(intentByKey(h.database), undefined);
    assert.equal(h.database.authority.runs.get(run.envelope.runId)?.lifecycle.state, "queued");
  });
});
