import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, it } from "vitest";
import { buildRunLogsSection } from "../../../../src/backend/runs/queries/run-logs.js";
import { RunRecordSchema, type RunRecord } from "../../../../src/models/run/record.js";
import { makeWorld } from "../../../support/helpers/backend/dashboard-harness.js";
import { testRunService } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { createDryRunPreviewResultTestWorld } from "../../../support/helpers/backend/dry-run-preview-result-world.js";
import { absentProbeEvidence, WRITE_FIXTURE_NOW, WRITE_FIXTURE_RUN_ID, writeFixtureTraversalDescriptor } from "../../../support/fixtures/write-sequencer-fixtures.js";

const { harness, cleanup } = createDryRunPreviewResultTestWorld();
afterEach(cleanup);

it("shows a dry-run parent reopened by a waiting delegation refresh as pending, not its earlier preview", async () => {
  const h = await harness(writeFixtureTraversalDescriptor);
  h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
  await h.run();
  const finished = h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
  assert.ok(finished?.lifecycle.state === "terminal" && finished.lifecycle.outcome === "done");
  assert.ok(h.database.authority.runResults.get(WRITE_FIXTURE_RUN_ID));
  const { completion: _completion, ...withoutCompletion } = finished;
  const reopened = RunRecordSchema.parse({ ...withoutCompletion, lifecycle: { state: "queued" }, version: finished.version + 1,
    delegationRefresh: { commandId: randomUUID(), nodeId: "submit-write", phase: "waiting", retryCommandIds: [randomUUID()] } });
  const world = await makeWorld();
  try {
    const preview = (run: RunRecord) => {
      const section = buildRunLogsSection({ stateRoot: world.stateRoot, authority: world.authority,
        timeline: h.database.authority.timelineEvents, projection: world.projection,
        canonical: { database: h.database, reader: testRunService(h.database, h.clock), descriptors: { resolve: () => writeFixtureTraversalDescriptor } },
        descriptors: { resolve: () => writeFixtureTraversalDescriptor },
      }, WRITE_FIXTURE_RUN_ID, undefined, run);
      assert.ok(section.section === "logs");
      return section.payload.dryRunPreview;
    };
    assert.equal(preview(finished)?.state, "available");
    assert.deepEqual(preview(reopened), { state: "pending" });
  } finally { await world.dispose(); }
});
