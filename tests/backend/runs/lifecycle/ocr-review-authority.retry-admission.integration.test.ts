import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, it } from "vitest";
import { assertOcrChildRetryCurrent, ocrChildRetryAvailable } from "../../../../src/backend/runs/lifecycle/ocr-review-authority.js";
import { createOcrReviewWorld } from "../../../support/helpers/backend/ocr-review-world.js";
import { testWorkerLifetime } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { deriveStableUuid, lifecycleCommandId } from "../../../../src/rules/identity/identifiers.js";
import { checkpointLookupKey } from "../../../../src/models/workflow/checkpoint.js";

const world = createOcrReviewWorld();
afterEach(world.cleanup);

function claimParent(f: Awaited<ReturnType<typeof world.fixture>>, activeState: "claimed" | "validating" | "running") {
  const owner = testWorkerLifetime(f.database, "ocr", 1);
  const runtime = f.database.authority.runtimeConfig.get(); assert.ok(runtime);
  const claimed = f.canonical.lifecycle.claimNext({ commandId: randomUUID(), workflow: "ocr", workerId: owner.workerId,
    runtimeConfig: { generation: runtime.generation, settingsRevision: runtime.settingsRevision,
      settingsFingerprint: runtime.settingsFingerprint, configFingerprint: runtime.configFingerprint } });
  assert.ok(claimed.state === "applied" && "run" in claimed);
  assert.equal(claimed.run.envelope.runId, f.run.envelope.runId);
  assert.ok(claimed.run.lifecycle.state === "claimed");
  let parent = claimed.run;
  for (const state of ["validating", "running"] as const) {
    if (activeState === "claimed") break;
    const advanced = f.canonical.lifecycle.workerTransition({ commandId: randomUUID(), runId: parent.envelope.runId,
      claim: { workerId: owner.workerId, claimGeneration: parent.claimGeneration }, lifecycle: { ...claimed.run.lifecycle, state } });
    assert.ok(advanced.state === "applied"); parent = advanced.run;
    if (state === activeState) break;
  }
  assert.equal(parent.lifecycle.state, activeState);
  return parent;
}

it("refuses a failed page retry after the queued OCR parent has admitted lookups", async () => {
  const f = await world.fixture({ record: true, release: true, pageCount: 2, failManualPageOnce: 2,
    stopAfterPageFailure: true, signerLookup: { firstNames: ["Avery", "Morgan"] } });
  const repositories = f.database.authority;
  const failed = repositories.runs.listChildren(f.run.envelope.runId).find(child => child.envelope.workflow === "ocr-page"
    && child.lifecycle.state === "terminal" && child.lifecycle.outcome === "failed"); assert.ok(failed);
  const admitted = await f.canonical.step(f.run, new AbortController().signal);
  assert.equal(admitted.run.envelope.runId, f.run.envelope.runId);
  assert.equal(admitted.outcome.state, "yielded-delegation");
  const parent = repositories.runs.get(f.run.envelope.runId); assert.ok(parent);
  assert.equal(parent.lifecycle.state, "queued");
  assert.equal(parent.delegationRefresh, undefined);
  const lookups = repositories.runs.listChildren(parent.envelope.runId).filter(child => child.envelope.workflow === "i9-lookup");
  assert.equal(lookups.length, 1);
  assert.equal(lookups[0]?.lifecycle.state, "queued");
  const reply = f.canonical.kernel.execute({ commandId: randomUUID(), family: "run", type: "retry",
    requestedBy: "local-operator", source: "run-detail", requestedAt: f.clock.now().toISOString(),
    target: { runId: failed.envelope.runId, expectedVersion: failed.version } });
  assert.ok(reply.state === "rejected" && reply.code === "RUN_CONTINUATION_REFUSED", JSON.stringify(reply));
  assert.equal(ocrChildRetryAvailable(repositories, f.canonical.lifecycle, failed, f.resolve), false);
  assert.deepEqual(repositories.runs.get(parent.envelope.runId), parent);
  assert.equal(repositories.runs.listChildren(parent.envelope.runId).some(child => child.envelope.retryOf === failed.envelope.runId), false);
  const completed = await f.canonical.execute(f.run, new AbortController().signal);
  assert.equal(completed.run?.lifecycle.state, "parked-gate");
  assert.equal(ocrChildRetryAvailable(repositories, f.canonical.lifecycle, failed, f.resolve), true);
});

it.each(["claimed", "validating", "running"] as const)("refuses an operator retry when a worker claims the OCR parent after Retry was offered (%s)", async activeState => {
  const f = await world.fixture({ release: true, pageCount: 2, failManualPageOnce: 2, stopAfterPageFailure: true });
  const repositories = f.database.authority;
  const failed = repositories.runs.listChildren(f.run.envelope.runId).find(child => child.lifecycle.state === "terminal"
    && child.lifecycle.outcome === "failed"); assert.ok(failed);
  assert.equal(ocrChildRetryAvailable(repositories, f.canonical.lifecycle, failed, f.resolve), true);
  const parent = claimParent(f, activeState);
  const reply = f.canonical.kernel.execute({ commandId: randomUUID(), family: "run", type: "retry",
    requestedBy: "local-operator", source: "run-detail", requestedAt: f.clock.now().toISOString(),
    target: { runId: failed.envelope.runId, expectedVersion: failed.version } });
  assert.ok(reply.state === "rejected" && reply.code === "RUN_CONTINUATION_REFUSED", JSON.stringify(reply));
  assert.equal(ocrChildRetryAvailable(repositories, f.canonical.lifecycle, failed, f.resolve), false);
  assert.deepEqual(repositories.runs.get(f.run.envelope.runId), parent);
  assert.equal(repositories.runs.listChildren(f.run.envelope.runId).some(child => child.envelope.retryOf === failed.envelope.runId), false);
  assert.doesNotThrow(() => assertOcrChildRetryCurrent(repositories, f.canonical.lifecycle, failed,
    { runId: parent.envelope.runId, version: parent.version, attempt: parent.envelope.attempt }));
});

it("refuses current-revision approval of a parked parent whose retained review has mismatched child evidence", async () => {
  const f = await world.fixture({ record: true, release: true, pageCount: 2, failManualPageOnce: 2 });
  const repositories = f.database.authority;
  assert.equal(f.canonical.kernel.execute(f.command("correct-ocr-record", 1)).state, "applied");
  const parked = repositories.runs.get(f.run.envelope.runId); assert.ok(parked?.lifecycle.state === "parked-gate");
  const failed = repositories.runs.listChildren(f.run.envelope.runId).find(child => child.lifecycle.state === "terminal"
    && child.lifecycle.outcome === "failed"); assert.ok(failed);
  assert.equal(f.canonical.kernel.execute({ commandId: randomUUID(), family: "run", type: "retry", requestedBy: "local-operator",
    source: "run-detail", requestedAt: f.clock.now().toISOString(), target: { runId: failed.envelope.runId, expectedVersion: failed.version } }).state, "applied");
  assert.equal((await f.canonical.step(f.run, new AbortController().signal)).outcome.state, "done");
  const claimed = claimParent(f, "running");
  assert.ok(claimed.lifecycle.state === "running");
  const checkpoint = repositories.runCheckpoints.listByAttempt("ocr", f.run.envelope.itemId, "read-result", 1).at(-1); assert.ok(checkpoint);
  const publication = repositories.timelineEvents.get(deriveStableUuid("timeline-checkpoint-recorded",
    checkpointLookupKey(checkpoint.workflowId, checkpoint.itemId, checkpoint.nodeId, checkpoint.attempt, checkpoint.claimGeneration)));
  assert.ok(publication?.payload.kind === "checkpoint-recorded");
  const { cursor: _cursor, ...event } = publication;
  repositories.timelineEvents.append({ ...event,
    eventId: lifecycleCommandId("timeline-checkpoint-replayed", { runId: claimed.envelope.runId, nodeId: "read-result", claimGeneration: claimed.claimGeneration }),
    payload: { ...publication.payload, kind: "checkpoint-replayed", claimGeneration: claimed.claimGeneration } });
  const reparked = f.canonical.lifecycle.workerTransition({ commandId: randomUUID(), runId: claimed.envelope.runId,
    claim: { workerId: claimed.lifecycle.workerId, claimGeneration: claimed.claimGeneration }, lifecycle: parked.lifecycle });
  assert.ok(reparked.state === "applied");
  const approval = f.approval();
  assert.equal(approval.target.expectedVersion, reparked.run.version);
  assert.equal(approval.payload.ocrApproval.expectedRevision, repositories.ocrReviews.latest(f.run.envelope.runId)?.revision);
  const reply = f.canonical.kernel.execute(approval);
  assert.ok(reply.state === "rejected" && reply.code === "OCR_REVIEW_REFUSED", JSON.stringify(reply));
  assert.deepEqual(repositories.ocrReviews.snapshots(f.run.envelope.runId), []);
  assert.equal(repositories.gateResults.get(`${f.run.envelope.runId}:approve-records`), undefined);
});

it.each(["correct-ocr-record", "discard-ocr-record", "restore-ocr-record"] as const)("refuses %s while a child replacement is awaiting a rebuilt review", async type => {
  const f = await world.fixture({ record: true, release: true, pageCount: 2, failManualPageOnce: 2 });
  const repositories = f.database.authority;
  const original = repositories.ocrReviews.latest(f.run.envelope.runId); assert.ok(original);
  const failed = repositories.runs.listChildren(f.run.envelope.runId).find(child => child.lifecycle.state === "terminal"
    && child.lifecycle.outcome === "failed"); assert.ok(failed);
  assert.equal(f.canonical.kernel.execute({ commandId: randomUUID(), family: "run", type: "retry",
    requestedBy: "local-operator", source: "run-detail", requestedAt: f.clock.now().toISOString(),
    target: { runId: failed.envelope.runId, expectedVersion: failed.version } }).state, "applied");
  const parent = repositories.runs.get(f.run.envelope.runId); assert.ok(parent?.lifecycle.state === "queued");
  const reply = f.canonical.kernel.execute(f.command(type, original.revision));
  assert.ok(reply.state === "rejected" && reply.code === "invalid-state", JSON.stringify(reply));
  assert.deepEqual(repositories.ocrReviews.latest(f.run.envelope.runId), original);
  assert.deepEqual(repositories.runs.get(f.run.envelope.runId), parent);
  assert.equal((await f.canonical.execute(f.run, new AbortController().signal)).run?.lifecycle.state, "parked-gate");
  const current = repositories.ocrReviews.latest(f.run.envelope.runId); assert.ok(current);
  assert.equal(f.canonical.kernel.execute(f.command(type, current.revision)).state, "applied");
});
