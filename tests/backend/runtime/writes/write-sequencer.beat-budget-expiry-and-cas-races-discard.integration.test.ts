import { createWriteSequencerTestWorld } from "../../../support/helpers/backend/write-sequencer-world.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { StagedPageDiscardedError } from "../../../../src/backend/runtime/writes/write-sequencer.js";
import { absentProbeEvidence, WRITE_FIXTURE_NOW } from "../../../support/fixtures/write-sequencer-fixtures.js";

const {harness, claimRunning, contextFor, intentByKey, cleanup } = createWriteSequencerTestWorld();

afterEach(cleanup);

describe("beat ④ — budget expiry and CAS races discard the staged page", () => {
  it("discards on an elapsed probe→fence budget and never clicks", async () => {
    const h = await harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h.world.onPrepare = () => h.clock.advanceMonotonic(30_001);
    await assert.rejects(
      h.execute(contextFor(run, claim)),
      (error: unknown) => error instanceof StagedPageDiscardedError && /probe-to-fence budget/.test(error.message),
    );
    assert.equal(intentByKey(h.database), undefined);
    assert.ok(!h.world.events.some((event) => event.startsWith("commit-click")));
    assert.deepEqual(h.sessions.closeReasons(), ["poisoned"]);
  });
});
