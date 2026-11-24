import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { createCrossDateSearchService } from "../../../../src/backend/runs/queries/search.js";
import { ocrRecordName } from "../../../../src/models/ocr/review.js";
import { createOcrReviewWorld } from "../../../support/helpers/backend/ocr-review-world.js";
import { scaledMs } from "../../../support/time-scale.js";

const world = createOcrReviewWorld();
afterEach(world.cleanup);

it("finds an OCR run by a name or Employee ID carried only by its reviewed record", async () => {
  const name = "Example, Avery", eid = "10800000";
  const { clock, database, resolve, run } = await world.fixture({
    record: true, lookupNames: [name], employeeIds: [eid],
  });
  const { runId } = run.envelope;
  const review = database.authority.ocrReviews.latest(runId);
  assert.equal(review?.records.length, 1);
  const record = review?.records[0];
  assert.ok(record);
  assert.equal(ocrRecordName(record.fields), name);
  assert.ok(record.fields.answers.some(answer => answer.path === "employee.employeeId" && answer.state === "read" && answer.value === eid));

  const search = createCrossDateSearchService({ clock, sourceIdentity: database.getSourceDatabaseIdentity(),
    cursorSigningKey: new Uint8Array(32).fill(9), descriptors: { resolve },
    authority: { readSnapshot: read => database.withAuthorityReadSnapshot(() => read({
      authorityGeneration: database.getMeta().authorityGeneration,
      searchRuns: input => database.authority.runs.search(input),
    })) } });
  const unfiltered = search.search({ q: "" });
  assert.ok(unfiltered.results.some(row => row.runId === runId));
  assert.ok(unfiltered.results.every(row => row.metadata.subject.state === "unavailable"));

  const matches = [name, eid].map(q => search.search({ q, scope: "subject" }).results.map(row => row.runId));
  assert.deepEqual(matches, [[runId], [runId]]);
}, scaledMs(30_000));
