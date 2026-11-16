import { fenceWriteFixture } from "../../../support/helpers/write-fence-fixture.js";
import { createWriteSequencerTestWorld } from "../../../support/helpers/backend/write-sequencer-world.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { WriteParkedError } from "../../../../src/backend/runtime/writes/write-sequencer.js";
import { absentProbeEvidence, WRITE_FIXTURE_NOW, WRITE_FIXTURE_RUN_ID } from "../../../support/fixtures/write-sequencer-fixtures.js";

const {harness, claimRunning, contextFor, intentByKey, attemptingIntentFixture, cleanup } = createWriteSequencerTestWorld();

afterEach(cleanup);

describe("inline recovery of this run's own attempting intent", () => {

  it("parks on an absent recovery probe — one observation is never retry authority", async () => {
    const h = await harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    assert.equal(
      fenceWriteFixture(h.database, attemptingIntentFixture(WRITE_FIXTURE_RUN_ID)).state,
      "fenced",
    );
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    await assert.rejects(
      h.execute(contextFor(run, claim)),
      (error: unknown) => error instanceof WriteParkedError && error.parkCode === "unknown",
    );
    assert.equal(intentByKey(h.database)?.status, "parked");
    assert.equal(h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.lifecycle.state, "parked-write");
  });
});
