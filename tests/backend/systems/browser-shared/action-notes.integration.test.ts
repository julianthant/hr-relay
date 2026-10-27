import { createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";
import { createWriteSequencerTestWorld } from "../../../support/helpers/backend/write-sequencer-world.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { executeClaimedRun } from "../../../../src/backend/runtime/execution/run-executor.js";
import { withBrowserActionNotes, recordBrowserAction } from "../../../../src/backend/systems/browser-shared/action-notes.js";
import { RUN_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { absentProbeEvidence, WRITE_FIXTURE_EID, WRITE_FIXTURE_NOW, writeFixtureSaveDescriptor } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { healthyCrmDriver, healthyUcpathDriver, personLookupQueuedRun, sessionFactoryHarness } from "../../../support/helpers/phase1f-executor-harness.js";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { NoteWireSchema } from "../../../../src/models/events/types.js";

{

const { disposers, harness, claimRunning, contextFor, intentByKey } = createWriteSequencerTestWorld();

const cleanupOriginalFixture = async () => {
  for (const dispose of disposers.splice(0)) await dispose();
};

describe("completed transaction gesture binding", () => {
afterEach(cleanupOriginalFixture);

  it("binds prepare and commit inside their bounded task roles before the post-settlement drain", async () => {
    const h = await harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    const bound: { role: "prepare" | "commit"; targetId: string; physicalSessionId?: string }[] = [];
    const drained: string[] = [];

    const outcome = await withBrowserActionNotes(
      h.clock,
      () => h.execute({
        ...contextFor(run, claim),
        operationActionBinders: {
          prepare: (action) => {
            bound.push({ role: "prepare", targetId: action.targetId, physicalSessionId: action.physicalSessionId });
            return action;
          },
          commit: (action) => {
            bound.push({ role: "commit", targetId: action.targetId, physicalSessionId: action.physicalSessionId });
            return action;
          },
        },
      }),
      (actions) => drained.push(...actions.map((action) => action.targetId)),
    );

    assert.deepEqual(outcome, {
      disposition: "committed",
      proofSource: "normal-output",
      output: { transactionId: "T123456" },
      proof: { transactionId: "T123456" },
    });
    assert.deepEqual(bound.map(({ role, targetId }) => [role, targetId]), [
      ["prepare", "ucpath.write-fixture.eid-input"],
      ["commit", "ucpath.write-fixture.save-submit"],
    ]);
    assert.ok(bound.every(({ physicalSessionId }) => physicalSessionId !== undefined));
    assert.equal(bound[0]?.physicalSessionId, bound[1]?.physicalSessionId);
    assert.deepEqual(drained, ["ucpath.write-fixture.eid-input", "ucpath.write-fixture.save-submit"]);
  });

  it("binds probe and verifier from their parsed task inputs and drains only after settlement", async () => {
    const h = await harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h.world.verifyResults.push({ state: "present", proof: { transactionId: "T123456" } });
    const roles: string[] = [];
    const states: string[] = [];
    let drained = false;
    await withBrowserActionNotes(h.clock, () => h.execute({ ...contextFor(run, claim, writeFixtureSaveDescriptor),
      operationReadBinder: (role, taskId, parsedInput) => {
        assert.deepEqual(parsedInput, { eid: WRITE_FIXTURE_EID });
        assert.equal(taskId, `ucpath/read-write-fixture-${role}`);
        roles.push(role);
        return (action) => { assert.equal(drained, false); states.push(`${role}:${action.state}`); return action; };
      },
    }), () => { drained = true; });
    assert.deepEqual(roles, ["probe", "verify"]);
    assert.deepEqual(states, ["probe:started", "probe:completed", "verify:started", "verify:completed"]);
    assert.equal(drained, true);
    assert.equal(intentByKey(h.database)?.status, "committed");
  });
});
}

{

const { readPersistedNotes, disposers, executorHarness, enqueueAndClaim, SIGNAL } = createRunExecutorTestWorld();

const cleanupOriginalFixture = async () => {
  for (const dispose of disposers.splice(0)) await dispose();
};

describe("person-lookup full walk", () => {
afterEach(cleanupOriginalFixture);

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
