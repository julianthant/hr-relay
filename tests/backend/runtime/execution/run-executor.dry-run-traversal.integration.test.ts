import { buildRunLogsSection } from "../../../../src/backend/runs/queries/run-logs.js";
import { makeWorld } from "../../../support/helpers/backend/dashboard-harness.js";
import { testRunService } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { createDryRunPreviewResultTestWorld } from "../../../support/helpers/backend/dry-run-preview-result-world.js";
import { RunDryRunPreviewResultSchema } from "../../../../src/models/run/result.js";
import { absentProbeEvidence, WRITE_FIXTURE_NOW, WRITE_FIXTURE_RUN_ID, writeFixtureTraversalDescriptor } from "../../../support/fixtures/write-sequencer-fixtures.js";

const { harness, cleanup } = createDryRunPreviewResultTestWorld();
afterEach(cleanup);

it("previews both ordered writes and accounts for a skipped gate and unavailable dependent read without committing", async () => {
  const h = await harness(writeFixtureTraversalDescriptor);
  h.world.commitThrows = new Error("preview must never invoke a commit task");
  h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
  await h.run();
  const result = h.database.authority.runResults.get(WRITE_FIXTURE_RUN_ID);
  assert.ok(result);
  const preview = RunDryRunPreviewResultSchema.parse(result.result.value);
  assert.deepEqual(preview.steps.map(step => [step.nodeId, step.state]), [
    ["submit-write", "transaction-preview"], ["second-write", "transaction-preview"],
    ["not-required", "not-run"], ["after-write", "unavailable"],
  ]);
  assert.deepEqual(preview.steps.find(step => step.nodeId === "not-required"), {
    nodeId: "not-required", state: "not-run", reason: "condition-false",
  });
  assert.equal(h.database.authority.gateResults.get(`${WRITE_FIXTURE_RUN_ID}:not-required`), undefined);
  assert.equal(preview.coverage.state, "full");
  assert.equal(h.world.events.filter(event => event === "prepare").length, 2);
  assert.equal(h.world.events.filter(event => event.startsWith("commit-click:")).length, 0);
  assert.deepEqual(h.database.authority.writeIntents.listByRun(WRITE_FIXTURE_RUN_ID), []);
  assert.deepEqual(h.database.authority.writeIntents.countDryRunEvidenceByRun(WRITE_FIXTURE_RUN_ID), { writeIntents: 0, writeAttempts: 0, confirmedOperations: 0 });
  const run = h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID); assert.ok(run);
  assert.deepEqual(h.database.authority.runCheckpoints.listByItem(run.envelope.workflow, run.envelope.itemId), []);
  assert.equal(h.emitter.events().filter(event => event.t === "transaction.previewed").length, 2);
  const world = await makeWorld();
  try {
    const section = buildRunLogsSection({ stateRoot: world.stateRoot, authority: world.authority,
      timeline: h.database.authority.timelineEvents, projection: world.projection,
      canonical: { database: h.database, reader: testRunService(h.database, h.clock), descriptors: { resolve: () => writeFixtureTraversalDescriptor } },
      descriptors: { resolve: () => writeFixtureTraversalDescriptor },
    }, WRITE_FIXTURE_RUN_ID, undefined, run);
    assert.ok(section.section === "logs");
    assert.ok(section.payload.dryRunPreview?.state === "available");
    assert.deepEqual(section.payload.dryRunPreview.stages.map(stage => stage.state), ["exercised", "exercised", "skipped", "unavailable"]);
  } finally { await world.dispose(); }
});
