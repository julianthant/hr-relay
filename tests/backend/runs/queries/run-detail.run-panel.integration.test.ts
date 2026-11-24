import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import { createRunDetailTestWorld } from "../../../support/helpers/backend/run-detail-world.js";
import assert from "node:assert/strict";
import { afterAll, afterEach, describe, it } from "vitest";
import { readRunDetail, readRunPanel, readRunSection, type RunDetailQueryDeps } from "../../../../src/backend/runs/queries/run-detail.js";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { RunPanelSchema } from "../../../../src/models/dashboard/subscription.js";
import { queuedEventOf, uuidOf, type DashboardWorld } from "../../../support/helpers/backend/dashboard-harness.js";

const profileFixtures = createProfileFixtureSet();
afterAll(() => profileFixtures.close());

const { world, cleanup } = createRunDetailTestWorld(profileFixtures.create);

afterEach(cleanup);

function depsOf(current: DashboardWorld): RunDetailQueryDeps {
  return {
    runReader: current.runReader, timeline: current.timeline,
    stateRoot: current.stateRoot,
    projection: current.projection,
    authority: current.authority,
    descriptors: { resolve: () => undefined },
  };
}

describe("the run panel read", () => {
  it("is the detail, every log page joined into one, and the routes' own values", async () => {
    const current = await world();
    queuedEventOf(current, { seed: 1 });
    const notes = createNoteTimelineWriter({ repository: current.timeline, clock: current.clock, pid: 4242 });
    for (let index = 0; index < 201; index += 1) {
      notes.emitNote({
        workflow: "person-lookup",
        address: { runId: uuidOf(1), attempt: 1, traceId: "pl-100001-0001", spanPath: "pl-100001-0001" },
        level: "step",
        message: `note ${String(index)}`,
      });
    }
    const deps = depsOf(current);

    const panel = RunPanelSchema.parse(await readRunPanel(deps, uuidOf(1), new AbortController().signal));
    if (panel.state !== "available") assert.fail("expected an available panel");
    assert.deepEqual(panel.detail, await readRunDetail(deps, uuidOf(1)));
    assert.deepEqual(panel.logs.nextCursor, { state: "absent", reason: "end-of-page" });
    assert.equal(panel.logs.rows?.length, 201);

    const first = await readRunSection(deps, uuidOf(1), "logs");
    if (first.section !== "logs" || first.payload.nextCursor.state !== "present") assert.fail("expected a paged log");
    const second = await readRunSection(deps, uuidOf(1), "logs", first.payload.nextCursor.value);
    if (second.section !== "logs") assert.fail("expected the second log page");
    assert.deepEqual(panel.logs.rows, [...first.payload.rows ?? [], ...second.payload.rows ?? []], "the same rows the pages serve, in order");
    assert.deepEqual(panel.logs.notes, [...first.payload.notes, ...second.payload.notes]);
    assert.deepEqual(panel.sections, [], "a queued run offers none of the panel's sections");
  });

  it("refuses as the detail route would for a run authority does not hold", async () => {
    const current = await world();
    await assert.rejects(readRunPanel(depsOf(current), uuidOf(2), new AbortController().signal), /absent from canonical authority/u);
  });

  it("stops at an aborted signal", async () => {
    const current = await world();
    queuedEventOf(current, { seed: 1 });
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(readRunPanel(depsOf(current), uuidOf(1), controller.signal), { name: "AbortError" });
  });
});
