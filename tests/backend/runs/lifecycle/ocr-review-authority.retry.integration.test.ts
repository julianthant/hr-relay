import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, it } from "vitest";
import { ocrChildRetryAvailable,publishOcrReview, readOcrReviewAuthority } from "../../../../src/backend/runs/lifecycle/ocr-review-authority.js";
import { delegationEvidenceOutput } from "../../../../src/models/run/result.js";
import { OcrPageReadingSchema, accountOcrPages } from "../../../../src/models/workflows/ocr/page-accounting.js";
import { buildOcrReviewSeed } from "../../../../src/models/workflows/ocr/review-seed.js";
import { RunCheckpointRecordSchema, type RunCheckpointRecord } from "../../../../src/models/workflow/checkpoint.js";
import { createOcrReviewWorld } from "../../../support/helpers/backend/ocr-review-world.js";
import { observationLeafPaths } from "../../../../src/models/events/data-observation-origin.js";
import { taskSpanPath } from "../../../../src/backend/logs/span-emitter.js";

const world = createOcrReviewWorld();
afterEach(world.cleanup);

function publicationCheckpoint(checkpoint: RunCheckpointRecord, value: RunCheckpointRecord["output"]["value"], traceId: Parameters<typeof taskSpanPath>[0]) {
  const claimGeneration = Number(checkpoint.claimGeneration) + 1;
  return RunCheckpointRecordSchema.parse({ ...checkpoint, claimGeneration, output: { ...checkpoint.output, value },
    observationOrigins: observationLeafPaths(value).map(path => ({ path, origin: {
      runId: checkpoint.runId, attempt: checkpoint.attempt, spanPath: taskSpanPath(traceId, checkpoint.nodeId, 1, claimGeneration),
      nodeId: checkpoint.nodeId, taskId: "workflow:ocr/read-result", field: path[0], path: path.slice(1),
    } })),
  });
}

it("publishes a complete new review from retained pages and one authenticated failed-page replacement", async () => {
  const f = await world.fixture({ pageCount: 2, release: true, failManualPageOnce: 2 });
  const repositories = f.database.authority;
  const original = repositories.ocrReviews.latest(f.run.envelope.runId); assert.ok(original);
  assert.deepEqual(original.seed.review.pages.map(page => page.disposition), ["blank", "failed"]);
  const checkpoint = repositories.runCheckpoints.listByAttempt("ocr", f.run.envelope.itemId, "read-result", 1).at(-1); assert.ok(checkpoint);
  const children = repositories.runs.listChildren(f.run.envelope.runId).filter(child => child.envelope.workflow === "ocr-page");
  const failed = children.find(child => child.lifecycle.state === "terminal" && child.lifecycle.outcome === "failed"); assert.ok(failed);
  assert.equal(ocrChildRetryAvailable(repositories, f.canonical.lifecycle, failed), false);
  const retained = children.find(child => child.envelope.runId !== failed.envelope.runId); assert.ok(retained);
  const request = { commandId: randomUUID(), family: "run", type: "retry", requestedBy: "local-operator", source: "run-detail",
    requestedAt: f.clock.now().toISOString(), target: { runId: failed.envelope.runId, expectedVersion: failed.version } };
  const applied = f.canonical.kernel.execute(request); assert.equal(applied.state, "applied", JSON.stringify(applied));
  assert.equal(f.canonical.kernel.execute(request).state, "already-applied");
  const replacement = repositories.runs.listChildren(f.run.envelope.runId).find(child => child.envelope.retryOf === failed.envelope.runId); assert.ok(replacement);
  const outcome = await f.canonical.step(f.run, new AbortController().signal);
  assert.equal(outcome.run.envelope.runId, replacement.envelope.runId);
  assert.equal(outcome.outcome.state, "done");
  const pages = delegationEvidenceOutput(repositories.dependencies.evidence(f.run.envelope.runId, "read-pages"), OcrPageReadingSchema);
  assert.ok(Array.isArray(pages));
  const seed = { ...original.seed, review: buildOcrReviewSeed({ roster: original.seed.review.roster,
    accounting: accountOcrPages(original.seed.review.accounting.manifest, original.seed.review.accounting.readingId, pages) }) };
  const rebuilt = publicationCheckpoint(checkpoint, seed, f.run.envelope.traceId);
  f.database.withAuthorityTransaction(authority => {
    authority.runCheckpoints.insert(rebuilt);
    publishOcrReview(authority, f.canonical.lifecycle, f.run, rebuilt);
  });
  const review = readOcrReviewAuthority(repositories, f.canonical.lifecycle, f.run.envelope.runId); assert.ok(review);
  assert.equal(review.revision.revision, 2);
  assert.deepEqual(review.revision.seed.review.pages.map(page => page.disposition), ["blank", "blank"]);
  assert.deepEqual(review.revision.seed.review.accounting.outcomes.map(page => page.runId), [retained.envelope.runId, replacement.envelope.runId]);
  assert.deepEqual(repositories.ocrReviews.revision(f.run.envelope.runId, 1), original);
  assert.deepEqual(repositories.runs.get(retained.envelope.runId), retained);
  const generation = f.database.getMeta().authorityGeneration;
  publishOcrReview(repositories, f.canonical.lifecycle, f.run, rebuilt);
  assert.equal(f.database.getMeta().authorityGeneration, generation);
  assert.deepEqual(repositories.ocrReviews.latest(f.run.envelope.runId), review.revision);
  assert.equal(repositories.runs.get(f.run.envelope.runId)?.lifecycle.state, "parked-gate");
  assert.equal(f.database.readProfileResourceCustody().writeIntents.length, 0);
});

it("keeps operator corrections when the same child evidence is published again", async () => {
  const f = await world.fixture({ record: true, release: true });
  assert.equal(f.canonical.kernel.execute(f.command("correct-ocr-record", 1)).state, "applied");
  const repositories = f.database.authority;
  const current = repositories.ocrReviews.latest(f.run.envelope.runId); assert.ok(current);
  const checkpoint = repositories.runCheckpoints.listByAttempt("ocr", f.run.envelope.itemId, "read-result", 1).at(-1); assert.ok(checkpoint);
  const generation = f.database.getMeta().authorityGeneration;
  publishOcrReview(repositories, f.canonical.lifecycle, f.run, checkpoint);
  assert.deepEqual(repositories.ocrReviews.latest(f.run.envelope.runId), current);
  assert.equal(f.database.getMeta().authorityGeneration, generation);
  const approval = f.approval();
  assert.equal(f.canonical.kernel.execute(approval).state, "applied");
  const snapshots = repositories.ocrReviews.snapshots(f.run.envelope.runId);
  const approvedGeneration = f.database.getMeta().authorityGeneration;
  const rebuilt = publicationCheckpoint(checkpoint, { ...current.seed, review: { ...current.seed.review, sourceRunId: f.run.envelope.runId } }, f.run.envelope.traceId);
  assert.throws(() => f.database.withAuthorityTransaction(authority => {
    authority.runCheckpoints.insert(rebuilt);
    publishOcrReview(authority, f.canonical.lifecycle, f.run, rebuilt);
  }), /OCR_REVIEW_REFUSED/u);
  assert.equal(f.database.getMeta().authorityGeneration, approvedGeneration);
  assert.deepEqual(repositories.ocrReviews.snapshots(f.run.envelope.runId), snapshots);
  assert.deepEqual(repositories.ocrReviews.latest(f.run.envelope.runId), current);
});

it("offers retry only for the current failed member while OCR can still join it", async () => {
  const f = await world.fixture({ pageCount: 2, release: true, failManualPageOnce: 2, stopAfterPageFailure: true });
  const repositories = f.database.authority;
  const children = repositories.runs.listChildren(f.run.envelope.runId);
  const failed = children.find(child => child.lifecycle.state === "terminal" && child.lifecycle.outcome === "failed"); assert.ok(failed);
  const done = children.find(child => child.lifecycle.state === "terminal" && child.lifecycle.outcome === "done"); assert.ok(done);
  repositories.dependencies.reconcile(f.run.envelope.runId, f.clock.now().toISOString());
  assert.equal(ocrChildRetryAvailable(repositories, f.canonical.lifecycle, failed), true);
  assert.equal(ocrChildRetryAvailable(repositories, f.canonical.lifecycle, done), false);
  const request = { commandId: randomUUID(), family: "run", type: "retry", requestedBy: "local-operator", source: "run-detail",
    requestedAt: f.clock.now().toISOString(), target: { runId: failed.envelope.runId, expectedVersion: failed.version } };
  assert.equal(f.canonical.kernel.execute(request).state, "applied");
  assert.equal(ocrChildRetryAvailable(repositories, f.canonical.lifecycle, failed), false);
  const duplicate = f.canonical.kernel.execute({ ...request, commandId: randomUUID() });
  assert.notEqual(duplicate.state, "applied");
  assert.equal(repositories.runs.listChildren(f.run.envelope.runId).filter(child => child.envelope.retryOf === failed.envelope.runId).length, 1);
});

it("refuses retry of a failed page after a selected subset has been approved", async () => {
  const f = await world.fixture({ pageCount: 2, record: true, release: true, failManualPageOnce: 2 });
  const repositories = f.database.authority;
  assert.equal(f.canonical.kernel.execute(f.command("correct-ocr-record", 1)).state, "applied");
  assert.equal(f.canonical.kernel.execute(f.approval()).state, "applied");
  const failed = repositories.runs.listChildren(f.run.envelope.runId).find(child => child.lifecycle.state === "terminal" && child.lifecycle.outcome === "failed"); assert.ok(failed);
  const snapshots = repositories.ocrReviews.snapshots(f.run.envelope.runId);
  const request = { commandId: randomUUID(), family: "run", type: "retry", requestedBy: "local-operator", source: "run-detail",
    requestedAt: f.clock.now().toISOString(), target: { runId: failed.envelope.runId, expectedVersion: failed.version } };
  const reply = f.canonical.kernel.execute(request);
  assert.ok(reply.state === "rejected" && reply.code === "RUN_CONTINUATION_REFUSED");
  assert.equal(repositories.runs.listChildren(f.run.envelope.runId).some(child => child.envelope.retryOf === failed.envelope.runId), false);
  assert.deepEqual(repositories.ocrReviews.snapshots(f.run.envelope.runId), snapshots);
  assert.equal(f.database.readProfileResourceCustody().writeIntents.length, 0);
});
