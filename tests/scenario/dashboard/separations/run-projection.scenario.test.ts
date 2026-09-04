/**
 * T2 — the `separations` dashboard feature over the REAL projection
 * (ref guards-and-tests §10.12, doc 03.1 "Dashboard · wire separations").
 *
 * These scenarios keep only claims that cross the real start command, queue
 * projection, checkpoint read, or run-detail timeline. Pure Explorer
 * declarations live with the Explorer query's unit owner.
 *
 * §9.22's live Track C pass remains the external-world evidence. This file
 * checks the same composition contracts with reserved synthetic inputs.
 *
 * Every run here is a REHEARSAL (`dryRun: true`) and reaches no browser: the
 * world composes no write sequencer and no worker supervisor, and both throw by
 * name if anything tries.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { localDatePart } from "../../../../src/domain/clock.js";
import { buildRunDetail } from "../../../../src/server/dashboard/queries/run-detail.js";
import { SeparationsCanonicalInput } from "../../../../src/workflows/separations/workflow.js";
import {
  FIXTURE_DOCUMENT_NUMBER,
  createSeparationsWorld,
  disposeWorlds,
  seedJobSummaryCheckpoint,
  startFromTypedText,
} from "./world.js";

afterEach(disposeWorlds);

function filedBySubtitle(world: ReturnType<typeof createSeparationsWorld>, runId: string) {
  const run = world.database.authority.runs.get(runId);
  if (run === undefined) throw new Error(`run ${runId} is not in authority`);
  const input = SeparationsCanonicalInput.parse(run.input.parsed.value);
  return { state: "present", value: `Filed by ${input.timekeeperName}` } as const;
}

describe("separations dashboard — the start door the operator types into", () => {
  it("turns ONE typed box into one run per document, through the descriptor's own parser", () => {
    const world = createSeparationsWorld();
    // D261's whole claim: an operator types document numbers and nothing else.
    const started = startFromTypedText(world, `${FIXTURE_DOCUMENT_NUMBER}; 4445`);

    assert.equal(started.length, 2);
    const rows = started.map(({ runId }) => world.projection.queueSurface(runId));
    for (const [index, row] of rows.entries()) {
      assert.ok(row, `run ${String(index)} produced no queue row`);
      assert.equal(row.workflowId, "separations");
      assert.equal(row.dryRun, true);
    }
    // Two documents, two ITEMS — never one item run twice, which is what would
    // let a second document collide with the first document's checkpoints.
    assert.equal(new Set(rows.map((row) => row?.itemId)).size, 2);
  });
});

describe("separations dashboard — what the queue row calls a run", () => {
  it("titles a fresh row by the DOCUMENT, because that is all the start input knows", () => {
    const world = createSeparationsWorld();
    const [started] = startFromTypedText(world, FIXTURE_DOCUMENT_NUMBER);
    assert.ok(started);

    const row = world.projection.queueSurface(started.runId);
    assert.ok(row);
    // `presentation.title` / `presentation.subtitle`, composed at PLAN time and
    // carried onto the row through the run.queued span.
    assert.equal(row.title, `Separation ${FIXTURE_DOCUMENT_NUMBER}`);
    assert.deepEqual({ ...row.subtitle }, filedBySubtitle(world, started.runId));
  });

  it("replaces the document title with the PERSON once UCPath's Job Summary has answered", () => {
    const world = createSeparationsWorld();
    const [started] = startFromTypedText(world, FIXTURE_DOCUMENT_NUMBER);
    assert.ok(started);
    const before = world.projection.queueSurface(started.runId);
    assert.equal(before?.title, `Separation ${FIXTURE_DOCUMENT_NUMBER}`);

    // §9.22's reason for this square: three separations rows on one real day
    // carried the same document number, so the column an operator scans
    // distinguished nothing.
    const displayedName = seedJobSummaryCheckpoint(world, started.runId);
    world.projection.refreshRun(started.runId);

    const after = world.projection.queueSurface(started.runId);
    assert.equal(after?.title, displayedName);
    // The subtitle is NOT a second subject line: it still says who filed.
    assert.deepEqual({ ...after?.subtitle }, filedBySubtitle(world, started.runId));
  });

  it("keeps the document title when the declared subject node has not run", () => {
    const world = createSeparationsWorld();
    const [started] = startFromTypedText(world, FIXTURE_DOCUMENT_NUMBER);
    assert.ok(started);
    // No checkpoint at the declared address is one of the three honest reasons
    // to keep the composed title — never a blank row, never a guess.
    const day = world.projection.buildDashboardDayWire(localDatePart(world.clock.now()));
    const row = day.queueSurfaces.find((surface) => surface.runId === started.runId);
    assert.equal(row?.title, `Separation ${FIXTURE_DOCUMENT_NUMBER}`);
  });
});

describe("separations dashboard — the categorical timeline the run detail draws", () => {
  it("serves D225's six operator-approved categories, in the order the graph files them", () => {
    const world = createSeparationsWorld();
    const [started] = startFromTypedText(world, FIXTURE_DOCUMENT_NUMBER);
    assert.ok(started);

    const detail = buildRunDetail(world.runDetail, started.runId);
    assert.ok(detail.timeline.steps, "a registered descriptor must serve categorical steps");
    assert.deepEqual(detail.timeline.steps?.map(({ label }) => label), [
      "Kuali extraction",
      "Identity check",
      "Job summary",
      "Kronos timecard",
      "UCPath transaction",
      "Kuali finalization",
    ]);
  });

  it("reports a category nobody has executed as pending, never as done", () => {
    const world = createSeparationsWorld();
    const [started] = startFromTypedText(world, FIXTURE_DOCUMENT_NUMBER);
    assert.ok(started);

    const detail = buildRunDetail(world.runDetail, started.runId);
    // A just-enqueued run has emitted no task span, so every category is
    // pending. The opposite defect — a category folding to `done` off nothing —
    // is exactly what §9.22 item 1 found on the replayed arm.
    assert.deepEqual(
      [...new Set(detail.timeline.steps?.map(({ state }) => state) ?? [])],
      ["pending"],
    );
  });
});
