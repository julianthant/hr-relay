import { createDryRunPreviewResultTestWorld } from "../../../support/helpers/backend/dry-run-preview-result-world.js";
import assert from "node:assert/strict";

import { afterEach, describe, it } from "vitest";
import { buildRunPreviewResult } from "../../../../src/backend/runs/lifecycle/run-result.js";
import { WRITE_FIXTURE_NODE_ID, WRITE_FIXTURE_NOW, WRITE_FIXTURE_RUN_ID, WRITE_FIXTURE_WORKER_ID, writeFixtureDescriptor } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

const {PREVIEW_RESULT_SCHEMA_HASH, harness, cleanup } = createDryRunPreviewResultTestWorld();


afterEach(cleanup);

function terminalRun(database: AuthorityDatabase) {
  const record = database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
  assert.ok(record, "the run row must exist");
  return record;
}

describe("a dry run previews its transaction node and ends there", () => {

  it("refuses to build a preview result for a run the operator did not ask to preview", async () => {
    const h = await harness();
    await h.run({ dryRun: false });

    // The run committed for real, so its terminal record is the derived result.
    const result = h.database.authority.runResults.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(result);
    assert.notEqual(result.resultSchemaHash, PREVIEW_RESULT_SCHEMA_HASH);


    assert.throws(
      () => buildRunPreviewResult(
        writeFixtureDescriptor,
        { ...terminalRun(h.database), completion: undefined, lifecycle: { state: "running", workerId: WRITE_FIXTURE_WORKER_ID,
          claimedAt: WRITE_FIXTURE_NOW, heartbeatAt: WRITE_FIXTURE_NOW } },
        {
          kind: "transaction-dry-run-preview",
          nodeId: WRITE_FIXTURE_NODE_ID,
          prepare: { schemaHash: "a".repeat(64), value: {} },
          subject: { state: "unscoped", reviewedReasonId: "unscoped" },
          observedAt: WRITE_FIXTURE_NOW,
        },
        [],
        h.clock,
      ),
      /is not a dry run; a preview result may not be built for it/,
    );
  });
});
