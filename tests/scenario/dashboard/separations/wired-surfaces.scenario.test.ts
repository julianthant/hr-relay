/**
 * T2 — the `separations` dashboard feature over the REAL projection
 * (ref guards-and-tests §10.12, doc 03b "Dashboard · wire separations").
 *
 * Six of the migration's nine wired squares are DECLARATIONS on the descriptor
 * (`surfaces.inputRun`, `verdicts`, `subjectProjection`, `timeline`,
 * `presentation`, `nodePurposes`). Their unit halves are already pinned where
 * each declaration is authored; what has never been pinned is the JOIN — that
 * the composition hands the registered descriptor to the projection, the
 * explorer and the run-detail query, and that what those three serve for a real
 * run is what the descriptor said.
 *
 * §9.22's live Track C pass is the evidence these squares work against a real
 * UCPath day. This file re-states the same claims over a recorded run so they
 * are checked on every commit rather than on the day somebody boots a BFF.
 *
 * Every run here is a REHEARSAL (`dryRun: true`) and reaches no browser: the
 * world composes no write sequencer and no worker supervisor, and both throw by
 * name if anything tries.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { localDatePart } from "../../../../src/domain/clock.js";
import { buildRunDetail } from "../../../../src/server/dashboard/queries/run-detail.js";
import { buildWorkflowExplorer } from "../../../../src/server/dashboard/queries/explorer.js";
import { descriptorSetHash } from "../../../../src/server/dashboard/compose.js";
import { explorerQueryDeps } from "../../../fixtures/explorer-seams.js";
import {
  DOCUMENT_NUMBER,
  createSeparationsWorld,
  disposeWorlds,
  seedJobSummaryCheckpoint,
  startFromTypedText,
  type SeparationsDashboardWorld,
} from "./world.js";

afterEach(disposeWorlds);

/** The registered `separations` entry of the REAL explorer wire. */
function separationsExplorerEntry(world: SeparationsDashboardWorld) {
  const wire = buildWorkflowExplorer(
    explorerQueryDeps(world.clock, descriptorSetHash([world.descriptor.contractFingerprint])),
  );
  const entry = wire.workflows.find((workflow) => workflow.id === String(world.descriptor.id));
  assert.ok(entry, "the explorer serves no separations workflow");
  return entry;
}

describe("separations dashboard — the start door the operator types into", () => {
  it("turns ONE typed box into one run per document, through the descriptor's own parser", () => {
    const world = createSeparationsWorld();
    // D261's whole claim: an operator types document numbers and nothing else.
    const started = startFromTypedText(world, `${DOCUMENT_NUMBER}; 4510`);

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

  it("declares the typed-text surface the explorer serves, dry-run support and all", () => {
    const world = createSeparationsWorld();
    const entry = separationsExplorerEntry(world);

    assert.equal(entry.surfaces.inputRun.state, "declared");
    if (entry.surfaces.inputRun.state !== "declared") return;
    // The prose an operator reads BEFORE pasting forty lines, and the D209
    // answer derived from the graph rather than from a stamped flag.
    assert.match(entry.surfaces.inputRun.placeholder, /Kuali document numbers/u);
    assert.equal(entry.surfaces.inputRun.supportsDryRun, true);
  });
});

describe("separations dashboard — what the queue row calls a run", () => {
  it("titles a fresh row by the DOCUMENT, because that is all the start input knows", () => {
    const world = createSeparationsWorld();
    const [started] = startFromTypedText(world, DOCUMENT_NUMBER);
    assert.ok(started);

    const row = world.projection.queueSurface(started.runId);
    assert.ok(row);
    // `presentation.title` / `presentation.subtitle`, composed at PLAN time and
    // carried onto the row through the run.queued span.
    assert.equal(row.title, `Separation ${DOCUMENT_NUMBER}`);
    assert.deepEqual({ ...row.subtitle }, { state: "present", value: "Filed by Julian Zaw" });
  });

  it("replaces the document title with the PERSON once UCPath's Job Summary has answered", () => {
    const world = createSeparationsWorld();
    const [started] = startFromTypedText(world, DOCUMENT_NUMBER);
    assert.ok(started);
    const before = world.projection.queueSurface(started.runId);
    assert.equal(before?.title, `Separation ${DOCUMENT_NUMBER}`);

    // §9.22's reason for this square: three separations rows on one real day
    // carried the same document number, so the column an operator scans
    // distinguished nothing.
    const displayedName = seedJobSummaryCheckpoint(world, started.runId);
    world.projection.refreshRun(started.runId);

    const after = world.projection.queueSurface(started.runId);
    assert.equal(after?.title, displayedName);
    // The subtitle is NOT a second subject line: it still says who filed.
    assert.deepEqual({ ...after?.subtitle }, { state: "present", value: "Filed by Julian Zaw" });
  });

  it("keeps the document title when the declared subject node has not run", () => {
    const world = createSeparationsWorld();
    const [started] = startFromTypedText(world, DOCUMENT_NUMBER);
    assert.ok(started);
    // No checkpoint at the declared address is one of the three honest reasons
    // to keep the composed title — never a blank row, never a guess.
    const day = world.projection.buildDashboardDayWire(localDatePart(world.clock.now()));
    const row = day.queueSurfaces.find((surface) => surface.runId === started.runId);
    assert.equal(row?.title, `Separation ${DOCUMENT_NUMBER}`);
  });
});

describe("separations dashboard — the categorical timeline the run detail draws", () => {
  it("serves D225's six operator-approved categories, in the order the graph files them", () => {
    const world = createSeparationsWorld();
    const [started] = startFromTypedText(world, DOCUMENT_NUMBER);
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
    const [started] = startFromTypedText(world, DOCUMENT_NUMBER);
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

describe("separations dashboard — what the explorer says the graph declares", () => {
  it("serves the four operator verdicts with their tones, keyed as the descriptor keys them", () => {
    const world = createSeparationsWorld();
    const entry = separationsExplorerEntry(world);

    assert.deepEqual(entry.verdicts.map(({ key, label, tone }) => ({ key, label, tone })), [
      { key: "name-differs", label: "Name differs from UCPath", tone: "warning" },
      { key: "eid-name-resolved", label: "EID resolved by name", tone: "warning" },
      { key: "dates-moved", label: "Kronos moved the dates", tone: "neutral" },
      { key: "unclassified-pay-codes", label: "Unclassified pay codes", tone: "warning" },
    ]);
  });

  it("gives every graph node the descriptor's OWN words, with none left as prose-absent", () => {
    const world = createSeparationsWorld();
    const entry = separationsExplorerEntry(world);

    // D229's contract: the explorer projects the descriptor's `nodePurposes`,
    // and a node with no authored purpose is served as a NAMED absence rather
    // than an empty string an operator would read as "nothing happens here".
    const unauthored = entry.nodes.filter((node) => node.purpose.state !== "authored");
    assert.deepEqual(unauthored.map(({ id }) => id), []);

    const resolveAction = entry.nodes.find((node) => node.id === "resolve-action");
    assert.ok(resolveAction, "the D261 head node is missing from the explorer");
    assert.equal(resolveAction.purpose.state, "authored");
    if (resolveAction.purpose.state !== "authored") return;
    assert.match(resolveAction.purpose.text, /refuses two actions for one number/u);
  });
});
