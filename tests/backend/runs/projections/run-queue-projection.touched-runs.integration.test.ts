import assert from "node:assert/strict";
import { afterAll, afterEach, describe, it } from "vitest";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import { claimEventOf, makeWorld, queuedEventOf, taskEventsOf, uuidOf, type DashboardWorld } from "../../../support/helpers/backend/dashboard-harness.js";

const profileFixtures = createProfileFixtureSet();
afterAll(() => profileFixtures.close());

const worlds: DashboardWorld[] = [];
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.dispose();
});

async function claimedWorld(): Promise<DashboardWorld> {
  const w = await makeWorld({ profileFixture: profileFixtures.create });
  worlds.push(w);
  queuedEventOf(w, { seed: 1 });
  queuedEventOf(w, { seed: 2 });
  claimEventOf(w, 1);
  claimEventOf(w, 2);
  w.changes.splice(0);
  return w;
}

function noteFor(w: DashboardWorld, seed: number): void {
  const owner = w.authority.getRun(uuidOf(seed));
  if (owner === undefined) assert.fail("the seeded run is missing");
  createNoteTimelineWriter({ repository: w.timeline, clock: w.clock, pid: 4242 }).emitNote({
    workflow: owner.envelope.workflow,
    address: { runId: owner.envelope.runId, attempt: owner.envelope.attempt, traceId: owner.envelope.traceId, spanPath: owner.envelope.traceId },
    level: "step", message: "opened UCPath person search",
  });
}

describe("the ingest reports the runs it read", () => {
  it("reports a note-only commit's run, with no cursor taken", async () => {
    const w = await claimedWorld();
    const cursor = w.projection.cursor();
    noteFor(w, 2);
    w.projection.ingestFromTimeline();
    assert.deepEqual(w.changes, [{ kind: "runs", runIds: [uuidOf(2)], position: w.projection.position() }]);
    assert.equal(w.projection.cursor(), cursor, "the hub takes a cursor only when a connection is owed the run");
  });

  it("reports the runs beside a patch of the same ingest, never the patched run", async () => {
    const w = await claimedWorld();
    noteFor(w, 1);
    noteFor(w, 2);
    taskEventsOf(w, 2, "searching"); // one ingest: two notes and the span that moves run 2's row
    assert.deepEqual(w.changes.map(change => change.kind), ["patch", "runs"]);
    const [patch, runs] = w.changes;
    assert.equal(patch?.kind === "patch" ? patch.patch.target.runId : undefined, uuidOf(2));
    assert.deepEqual(runs?.kind === "runs" ? runs.runIds : undefined, [uuidOf(1)]);
  });

  it("reports nothing for a span that moved its own row", async () => {
    const w = await claimedWorld();
    taskEventsOf(w, 2, "searching");
    assert.deepEqual(w.changes.map(change => change.kind), ["patch"]);
  });
});
