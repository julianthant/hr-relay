import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, it } from "vitest";
import { WriteParkedError } from "../../../../src/backend/runtime/writes/write-sequencer.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { repeatEvidenceDigest } from "../../../../src/models/run/rerun.js";
import { ProtectedInputBindingsSchema } from "../../../../src/models/write-safety/protected-input.js";
import { absentProbeEvidence, WRITE_FIXTURE_NODE_ID, WRITE_FIXTURE_NOW, writeFixtureQueuedRun } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { createWriteSequencerTestWorld } from "../../../support/helpers/backend/write-sequencer-world.js";

const { harness, claimRunning, contextFor, intentByKey, cleanup } = createWriteSequencerTestWorld();
afterEach(cleanup);

for (const repeatedReceipt of ["same", "new"] as const) {
  it(`checks a ${repeatedReceipt} receipt against the protected baseline of an authorized repeat`, async () => {
    const h = await harness();
    const original = claimRunning(h.database, h.clock);
    const proof = { transactionId: "T123456", documentNumber: "12345678" };
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h.world.commitOutput = proof;
    await h.execute(contextFor(original.run, original.claim));
    const baseline = intentByKey(h.database);
    assert.ok(baseline?.status === "committed");
    const current = h.database.authority.runs.get(original.run.envelope.runId);
    assert.ok(current);
    const source = h.database.authority.runs.transition({
      runId: current.envelope.runId, expectedVersion: current.version, claim: original.claim, now: WRITE_FIXTURE_NOW,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: WRITE_FIXTURE_NOW },
    });
    assert.ok(source.state === "applied");

    const protectedBindings = ProtectedInputBindingsSchema.parse([{ kind: "test-data-local", inputPath: "documentNumber",
      name: "separationsKualiFinalizationCanaryDocumentNumber", sourceId: randomUUID() }]);
    const warning = { nodeId: WRITE_FIXTURE_NODE_ID, taskId: baseline.taskId, system: baseline.system,
      businessKeyDigest: baseline.idempotencyKeyDigest, writeIntentId: baseline.writeIntentId,
      evidenceDigest: repeatEvidenceDigest(baseline, protectedBindings) };
    const queued = RunRecordSchema.parse(writeFixtureQueuedRun({ runId: randomUUID() }));
    const repeat = claimRunning(h.database, h.clock, { ...queued, envelope: { ...queued.envelope,
      attempt: 2, retryOf: current.envelope.runId, sourceBound: {
        source: { runId: current.envelope.runId, expectedVersion: source.run.version, intent: "rerun", selectedStepKeys: [WRITE_FIXTURE_NODE_ID] },
        warnings: [warning], acknowledgment: "a".repeat(64), warningDigest: "a".repeat(64),
        confirmationCommandId: randomUUID(), protectedBindings,
      } } });
    h.world.events.length = 0;
    h.world.probeResults.push({ state: "present", proof });
    h.world.commitOutput = repeatedReceipt === "same" ? proof : { ...proof, transactionId: "T234567" };

    const execution = h.execute(contextFor(repeat.run, repeat.claim));
    if (repeatedReceipt === "same") {
      await assert.rejects(execution, (error: unknown) => error instanceof WriteParkedError && error.parkCode === "unknown");
    } else {
      await execution;
    }
    const [intent] = h.database.authority.writeIntents.listByRun(repeat.run.envelope.runId);
    assert.equal(intent?.status, repeatedReceipt === "same" ? "parked" : "committed");
    assert.equal(h.world.events.filter(event => event.startsWith("commit-click:")).length, 1);
    assert.deepEqual(intentByKey(h.database), baseline);
  });
}
