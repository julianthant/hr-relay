import { createWriteSequencerTestWorld } from "../../../support/helpers/backend/write-sequencer-world.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { WriteParkedError } from "../../../../src/backend/runtime/writes/write-sequencer.js";
import { withBrowserActionNotes } from "../../../../src/backend/systems/browser-shared/action-notes.js";
import { absentProbeEvidence, WRITE_FIXTURE_NOW, WRITE_FIXTURE_RUN_ID } from "../../../support/fixtures/write-sequencer-fixtures.js";

const {harness, claimRunning, contextFor, intentByKey, cleanup } = createWriteSequencerTestWorld();

afterEach(cleanup);

describe("completed transaction gesture binding", () => {

  it("parks a fenced write when the completed commit gesture cannot bind", async () => {
    const h = await harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    const drained: string[] = [];

    await assert.rejects(
      () => withBrowserActionNotes(
        h.clock,
        () => h.execute({
          ...contextFor(run, claim),
          operationActionBinders: {
            commit: () => { throw new Error("declared commit target mismatch"); },
          },
        }),
        (actions) => drained.push(...actions.map((action) => action.targetId)),
      ),
      (error: unknown) => error instanceof WriteParkedError && /declared commit target mismatch/u.test(error.message),
    );

    assert.ok(h.world.events.includes("commit-click:ucpath.write-fixture.save-submit"));
    assert.equal(intentByKey(h.database)?.status, "parked");
    assert.equal(h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.lifecycle.state, "parked-write");
    assert.deepEqual(drained, ["ucpath.write-fixture.eid-input"]);
  });
});
