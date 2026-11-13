import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { OcrPageReadingSchema } from "../../../../src/models/workflows/ocr/page-accounting.js";
import { createOcrReviewWorld } from "../../../support/helpers/backend/ocr-review-world.js";

const world = createOcrReviewWorld();
afterEach(world.cleanup);
for (const actorId of ["local-operator", "foreign-operator"]) {
  it(`publishes manual page evidence only for the authenticated actor (${actorId})`, async () => {
    const f = await world.fixture({ actorId });
    const child = f.database.authority.runs.listChildren(f.run.envelope.runId)[0]; assert.ok(child);
    const checkpoints = f.database.authority.runCheckpoints.listByAttempt(child.envelope.workflow,
      child.envelope.itemId, "manual-reading", child.envelope.attempt).filter(row => row.runId === child.envelope.runId);
    if (actorId === "local-operator") {
      assert.ok(f.result.run?.lifecycle.state === "terminal" && f.result.run.lifecycle.outcome === "done");
      assert.equal(checkpoints.length, 1);
      assert.deepEqual(OcrPageReadingSchema.parse(checkpoints[0]?.output.value), f.reading);
      assert.deepEqual(f.database.authority.ocrExtractions.get(f.reading.extractionId), { ...f.reading, binding: "source-bound" });
      assert.equal(f.database.authority.ocrReviews.latest(f.run.envelope.runId)?.sourceRunId, f.run.envelope.runId);
    } else {
      assert.equal(checkpoints.length, 0);
      assert.equal(f.database.authority.ocrExtractions.get(f.reading.extractionId), undefined);
      assert.ok(child.lifecycle.state === "terminal" && child.lifecycle.outcome === "failed");
    }
    assert.equal(f.database.readProfileResourceCustody().writeIntents.length, 0);
  });
}
