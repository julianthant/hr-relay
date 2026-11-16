import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { publishOcrReview, readOcrReviewAuthority } from "../../../../src/backend/runs/lifecycle/ocr-review-authority.js";
import { OcrReviewRefusedError } from "../../../../src/backend/processing/ocr/review-authority.js";
import type { AuthorityRepositories } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { initialOcrReviewRecords, OcrReviewRevisionSchema } from "../../../../src/models/ocr/review.js";
import { RunCheckpointRecordSchema, checkpointRecordKey, checkpointLookupKey, type RunCheckpointRecord } from "../../../../src/models/workflow/checkpoint.js";
import { timelineCheckpointReference, TimelineEventRecordSchema } from "../../../../src/models/events/timeline.js";
import { observationLeafPaths } from "../../../../src/models/events/data-observation-origin.js";
import { taskSpanPath } from "../../../../src/backend/logs/span-emitter.js";
import { deriveStableUuid } from "../../../../src/rules/identity/identifiers.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { createOcrReviewWorld } from "../../../support/helpers/backend/ocr-review-world.js";
import { compactOcrResult } from "../../../../src/models/workflows/ocr/result.js";
import { compactOcrReviewSeed } from "../../../../src/models/workflows/ocr/review-seed.js";

const world = createOcrReviewWorld();
afterEach(world.cleanup);

function candidateCheckpoint(checkpoint: RunCheckpointRecord, seed: RunCheckpointRecord["output"]["value"], claimGeneration: number,
  traceId: Parameters<typeof taskSpanPath>[0]) {
  return RunCheckpointRecordSchema.parse({ ...checkpoint, claimGeneration, output: { ...checkpoint.output, value: seed },
    observationOrigins: observationLeafPaths(seed).map(path => ({ path, origin: { runId: checkpoint.runId, attempt: checkpoint.attempt,
      spanPath: taskSpanPath(traceId, checkpoint.nodeId, 1, claimGeneration), nodeId: checkpoint.nodeId,
      taskId: checkpoint.nodeId === "build-review" ? "workflow:ocr/read-review-seed" : "workflow:ocr/read-result", field: path[0], path: path.slice(1) } })) });
}

it("refuses a changed review publication whose checkpoint generation does not advance", async () => {
  const f = await world.fixture({ record: true, release: true });
  const repositories = f.database.authority;
  const original = repositories.ocrReviews.latest(f.run.envelope.runId); assert.ok(original);
  const checkpoint = repositories.runCheckpoints.listByAttempt("ocr", f.run.envelope.itemId, "read-result", 1).at(-1); assert.ok(checkpoint);
  const { sourceRunId: _sourceRunId, ...review } = original.seed.review;
  const seed = { ...original.seed, review: original.seed.review.sourceRunId === undefined ? { ...review, sourceRunId: f.run.envelope.runId } : review };
  assert.notDeepEqual(seed, original.seed);
  const candidate = candidateCheckpoint(checkpoint, compactOcrResult(seed), checkpoint.claimGeneration, f.run.envelope.traceId);
  const reviewed = repositories.runCheckpoints.listByAttempt("ocr", f.run.envelope.itemId, "build-review", 1).at(-1); assert.ok(reviewed);
  const changed = candidateCheckpoint(reviewed, compactOcrReviewSeed(seed.review), reviewed.claimGeneration, f.run.envelope.traceId);
  const tampered: AuthorityRepositories = { ...repositories, runCheckpoints: { ...repositories.runCheckpoints, listByAttempt: (...args) =>
    [...repositories.runCheckpoints.listByAttempt(...args), ...(args[2] === "build-review" ? [changed] : [])] } };
  const generation = f.database.getMeta().authorityGeneration;
  assert.throws(() => publishOcrReview(tampered, f.canonical.lifecycle, f.run, candidate), OcrReviewRefusedError);
  assert.equal(f.database.getMeta().authorityGeneration, generation);
  assert.deepEqual(repositories.ocrReviews.latest(f.run.envelope.runId), original);
});

it.each(["non-monotonic generation", "duplicate seed"] as const)("refuses a forged checkpoint-origin revision with %s", async fault => {
  const f = await world.fixture({ record: true, release: true });
  const repositories = f.database.authority;
  const original = repositories.ocrReviews.latest(f.run.envelope.runId); assert.ok(original);
  const checkpoint = repositories.runCheckpoints.listByAttempt("ocr", f.run.envelope.itemId, "read-result", 1).at(-1); assert.ok(checkpoint);
  assert.ok(checkpoint.claimGeneration > 1);
  const { sourceRunId: _sourceRunId, ...review } = original.seed.review;
  const seed = fault === "duplicate seed" ? original.seed : { ...original.seed,
    review: original.seed.review.sourceRunId === undefined ? { ...review, sourceRunId: f.run.envelope.runId } : review };
  const claimGeneration = checkpoint.claimGeneration + (fault === "duplicate seed" ? 1 : -1);
  const candidate = candidateCheckpoint(checkpoint, compactOcrResult(seed), claimGeneration, f.run.envelope.traceId);
  const forged = OcrReviewRevisionSchema.parse({ ...original, id: `${f.run.envelope.runId}#2`, revision: 2,
    seed, records: initialOcrReviewRecords(seed), origin: { kind: "checkpoint", key: checkpointRecordKey(candidate),
      digest: sha256Hex(canonicalJsonStringify(candidate)), checkpoint: timelineCheckpointReference(candidate) } });
  const publicationId = deriveStableUuid("timeline-checkpoint-recorded", checkpointLookupKey(checkpoint.workflowId, checkpoint.itemId,
    checkpoint.nodeId, checkpoint.attempt, checkpoint.claimGeneration));
  const publication = repositories.timelineEvents.get(publicationId); assert.ok(publication?.payload.kind === "checkpoint-recorded");
  const candidateId = deriveStableUuid("timeline-checkpoint-recorded", checkpointLookupKey(candidate.workflowId, candidate.itemId,
    candidate.nodeId, candidate.attempt, candidate.claimGeneration));
  const candidatePublication = TimelineEventRecordSchema.parse({ ...publication, eventId: candidateId,
    payload: { ...publication.payload, claimGeneration: candidate.claimGeneration, checkpoint: timelineCheckpointReference(candidate) } });
  const tampered: AuthorityRepositories = { ...repositories,
    ocrReviews: { ...repositories.ocrReviews, latest: runId => runId === f.run.envelope.runId ? forged : repositories.ocrReviews.latest(runId),
      revision: (runId, revision) => runId === f.run.envelope.runId && revision === 2 ? forged : repositories.ocrReviews.revision(runId, revision) },
    runCheckpoints: { ...repositories.runCheckpoints, listByAttempt: (...args) => {
      const rows = repositories.runCheckpoints.listByAttempt(...args);
      return args[0] === "ocr" && args[1] === checkpoint.itemId && args[2] === "read-result" && args[3] === 1 ? [...rows, candidate] : rows;
    } },
    timelineEvents: { ...repositories.timelineEvents, get: id => id === candidateId ? candidatePublication : repositories.timelineEvents.get(id) },
  };
  assert.throws(() => readOcrReviewAuthority(tampered, f.canonical.lifecycle, f.run.envelope.runId), OcrReviewRefusedError);
  assert.deepEqual(repositories.ocrReviews.latest(f.run.envelope.runId), original);
});
