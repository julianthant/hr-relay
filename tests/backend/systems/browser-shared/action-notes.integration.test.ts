import { createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";
import { createWriteSequencerTestWorld } from "../../../support/helpers/backend/write-sequencer-world.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { executeClaimedRun } from "../../../../src/backend/runtime/execution/run-executor.js";
import { withBrowserActionNotes, recordBrowserAction } from "../../../../src/backend/systems/browser-shared/action-notes.js";
import { RUN_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { absentProbeEvidence, WRITE_FIXTURE_NOW } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { healthyCrmDriver, healthyUcpathDriver, personLookupQueuedRun, sessionFactoryHarness } from "../../../support/helpers/phase1f-executor-harness.js";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { NoteWireSchema } from "../../../../src/models/events/types.js";

{

const { disposers, harness, claimRunning, contextFor } = createWriteSequencerTestWorld();

const cleanupOriginalFixture = async () => {
  for (const dispose of disposers.splice(0)) await dispose();
};

describe("completed transaction gestures", () => {
afterEach(cleanupOriginalFixture);

  it("drains prepare and commit gestures after the transaction settles", async () => {
    const h = await harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    const drained: string[] = [];

    const outcome = await withBrowserActionNotes(
      h.clock,
      () => h.execute(contextFor(run, claim)),
      (actions) => drained.push(...actions.map((action) => action.targetId)),
    );

    assert.deepEqual(outcome, {
      disposition: "committed",
      proofSource: "normal-output",
      output: { transactionId: "T123456" },
      proof: { transactionId: "T123456" },
    });
    assert.deepEqual(drained, ["ucpath.write-fixture.eid-input", "ucpath.write-fixture.save-submit"]);
  });
});
}

{

const { readPersistedNotes, executorHarness, enqueueAndClaim, SIGNAL, cleanup } = createRunExecutorTestWorld();

describe("person-lookup full walk", () => {
afterEach(cleanup);

  it("records every completed browser gesture on the task span", async () => {
    const sessions = sessionFactoryHarness({
      ucpath: () => {
        const driver = healthyUcpathDriver();
        return Object.freeze({ ...driver,
          async searchPersonOrg(...args: Parameters<typeof driver.searchPersonOrg>) {
            const result = await driver.searchPersonOrg(...args);
            for (let index = 0; index < 258; index += 1) {
              recordBrowserAction("clicked", "ucpath.person-org.search-button");
            }
            return result;
          },
        });
      },
      crm: () => healthyCrmDriver(),
    });
    const harness = await executorHarness({ sessions });
    const { database, clock, stateRoot: _stateRoot } = harness.authority;
    const writer = createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock, pid: 4242 });
    const claimed = enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());
    const outcome = await executeClaimedRun({ ...harness.deps, taskNotes: writer }, { ...claimed, signal: SIGNAL });
    assert.deepEqual(outcome, { state: "done", runId: RUN_ID });
    const notes = readPersistedNotes(database)
      .map((note) => NoteWireSchema.parse(note));
    const actions = notes.filter((note) => note.action !== undefined);
    assert.equal(actions.length, 258);
    assert.equal(actions.every((note) => note.message === "Clicked ucpath person org search button"), true);
    assert.equal(actions.every((note) => note.spanPath.includes("searching")), true);
    assert.equal(notes.some((note) => note.message === "Further browser actions were omitted after the 256-action operation limit."), false);
  });
});
}
