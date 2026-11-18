import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { WriteParkedError } from "../../../../src/backend/runtime/writes/write-sequencer.js";
import { absentProbeEvidence, WRITE_FIXTURE_NOW, writeFixtureSaveDescriptor } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { createWriteSequencerTestWorld } from "../../../support/helpers/backend/write-sequencer-world.js";

const { harness, claimRunning, contextFor, intentByKey, cleanup } = createWriteSequencerTestWorld();
afterEach(cleanup);

it("parks after one click when the verifier finds a different receipt from the callback", async () => {
  const h = await harness();
  const { run, claim } = claimRunning(h.database, h.clock);
  h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
  h.world.commitOutput = { transactionId: "T123456" };
  h.world.verifyResults.push({ state: "present", proof: { transactionId: "T222222" } });

  await assert.rejects(h.execute(contextFor(run, claim, writeFixtureSaveDescriptor)),
    (error: unknown) => error instanceof WriteParkedError && error.parkCode === "unknown");
  assert.equal(h.world.events.filter(event => event.startsWith("commit-click:")).length, 1);
  assert.ok(h.world.events.includes("verify"));
  assert.equal(intentByKey(h.database)?.status, "parked");
  assert.equal(h.database.authority.runs.get(run.envelope.runId)?.lifecycle.state, "parked-write");
  assert.deepEqual(h.database.authority.runCheckpoints.listByItem(run.envelope.workflow, run.envelope.itemId), []);
  assert.ok(!h.database.authority.timelineEvents.page({ runId: run.envelope.runId })
    .some(row => row.payload.kind === "operation-confirmed"));
});
