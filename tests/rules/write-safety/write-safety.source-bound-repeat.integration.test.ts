import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { repeatOccurrenceKey } from "../../../src/models/run/rerun.js";
import { WriteIntentRecordSchema,deriveIdempotencyKeyDigest } from "../../../src/rules/write-safety/write-safety.js";
import { sourceBoundHarness } from "../../support/fixtures/integration/source-bound-fixtures.js";
import { absentProbeEvidence,writeFixtureDescriptor,writeFixtureParallelDescriptor } from "../../support/fixtures/write-sequencer-fixtures.js";

const disposers: (() => void)[] = [];
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); });
function harness(parallel = false) { const h = sourceBoundHarness(parallel ? writeFixtureParallelDescriptor : writeFixtureDescriptor); disposers.push(h.dispose); return h; }
async function completed(h: ReturnType<typeof harness>) {
  const run = h.start(h.proposal());
  h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
  const outcome = await h.execute(run);
  assert.equal(outcome.state, "done", JSON.stringify(outcome.state === "failed" ? h.database.authority.failures.get(outcome.failureId) : outcome));
  return h.fresh(run);
}

describe("source-bound repeat through planner, kernel, service and interpreter", () => {

  it("serializes distinct confirmations against an unresolved sibling and keeps orphan intents fenced", async () => {
    const h = harness(true); const source = await completed(h);
    const warning = h.proposal(source); assert.ok(warning.rerun);
    const one = h.start(h.proposal(source, warning.rerun.warningDigest));
    const two = h.start(h.proposal(source, warning.rerun.warningDigest));
    h.world.probeResults.push({ state: "present", proof: { transactionId: "T123456" } });
    await h.execute(one); assert.equal(h.fresh(one).lifecycle.state, "parked-write");
    const clicks = h.world.events.filter((event) => event.startsWith("commit-click")).length;
    await h.execute(two);
    assert.equal(h.world.events.filter((event) => event.startsWith("commit-click")).length, clicks);
    assert.deepEqual(h.database.authority.writeIntents.listByRun(two.envelope.runId), []);
    const ordinary = h.start(h.proposal()); await h.execute(ordinary);
    assert.equal(h.world.events.filter((event) => event.startsWith("commit-click")).length, clicks, "ordinary writes also honor the repeat fence");
    assert.deepEqual(h.database.authority.writeIntents.listByRun(ordinary.envelope.runId), []);
    const unresolved = h.database.authority.writeIntents.listByRun(one.envelope.runId)[0];
    assert.equal(unresolved.status, "parked"); assert.ok(unresolved.occurrence);
    // Feed the real fenced record to a fresh adapter with no originating lifecycle row.
    const orphan = harness();
    const attempt = h.database.authority.writeAttempts.listByIntent(unresolved.writeIntentId)[0];
    const { parkedCode, message, authorityReason, ...identity } = unresolved;
    void parkedCode; void message; void authorityReason;
    const fenced = WriteIntentRecordSchema.parse({ ...identity, status: "attempting" });
    // The baseline is copied as immutable settled evidence; neither originating run exists here.
    const baseline = h.database.authority.writeIntents.listByRun(source.envelope.runId)[0];
    assert.equal(baseline.status, "committed");
    const { runId, runAttempt, currentAttemptId, bindingProof, bindingProofDigest, fencedAt, confirmedAt, completionProof, ...baseIdentity } = baseline;
    void runId; void runAttempt; void currentAttemptId; void bindingProof; void bindingProofDigest; void fencedAt;
    orphan.database.authority.writeIntents.recordObservedPresent({ ...baseIdentity, status: "observed-present", observedProof: completionProof, observedAt: confirmedAt });
    orphan.database.authority.writeIntents.fenceAttempt({ intent: fenced, attempt: { ...attempt, outcome: { state: "attempting" } } });
    assert.equal(orphan.database.authority.runs.get(one.envelope.runId), undefined);
    const otherCommand = orphan.ids.uuid();
    const key = repeatOccurrenceKey(unresolved.occurrence.businessKeyDigest, otherCommand, unresolved.occurrence.nodeId);
    const next = { ...fenced, writeIntentId: orphan.ids.uuid(), idempotencyKey: key, idempotencyKeyDigest: deriveIdempotencyKeyDigest("ucpath", key),
      occurrence: { ...unresolved.occurrence, confirmationCommandId: otherCommand } };
    assert.throws(() => orphan.database.authority.writeIntents.fenceAttempt({ intent: next,
      attempt: { ...attempt, writeIntentId: next.writeIntentId, outcome: { state: "attempting" } } }), /unresolved write occurrence/);
  });



});
