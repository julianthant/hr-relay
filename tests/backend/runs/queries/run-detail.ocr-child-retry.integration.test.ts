import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { descriptorSetHash } from "../../../../src/backend/app/registries/workflow-registry.js";
import { createOperatorProjection } from "../../../../src/backend/app/composition/dashboard/queue.js";
import { createOperatorRunDetail } from "../../../../src/backend/app/composition/dashboard/run-detail.js";
import { createTransactionHistory } from "../../../../src/backend/storage/sqlite/transaction-history.js";
import { buildRunDetail } from "../../../../src/backend/runs/queries/run-detail.js";
import { buildOcrReviewSection } from "../../../../src/backend/runs/queries/ocr-review.js";
import { initialOcrReviewRecords, ocrReviewDigest } from "../../../../src/models/ocr/review.js";
import { randomUUID } from "node:crypto";
import { correctOcrField } from "../../../support/fixtures/ocr/source-pages.js";
import { createDashboardClient } from "../../../../src/dashboard/client/index.js";
import { composeCommandRequest, verifyShellCommandEffect } from "../../../../src/dashboard/app/commands/command-dispatch.js";
import { CommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { createOcrReviewWorld } from "../../../support/helpers/backend/ocr-review-world.js";
import { createDashboardModelFixtures } from "../../../support/helpers/dashboard-model-fixtures.js";

const world = createOcrReviewWorld();
afterEach(world.cleanup);

function detailPorts(f: Awaited<ReturnType<typeof world.fixture>>) {
  const { stateRoot } = f.harness.authority;
  const reader = f.canonical.lifecycle;
  const projection = createOperatorProjection({ database: f.database, stateRoot, clock: f.clock, reader, appVersion: "0.1.0",
    descriptorSetHash: descriptorSetHash([f.root.descriptor.contractFingerprint]), ledger: createTransactionHistory(f.database.authority),
    descriptors: { resolve: f.resolve } });
  projection.rebuildFromTimeline();
  assert.equal(projection.health().state, "live");
  const deps = createOperatorRunDetail({ database: f.database, stateRoot, projection, runReader: reader,
    canonical: { reader, database: f.database, descriptors: { resolve: f.resolve } } });
  return { deps, projection };
}

it("serves a parked parent's failed-page retry and verifies its native parent/replacement effect through the typed client", async () => {
  const f = await world.fixture({ pageCount: 2, release: true, failManualPageOnce: 2 });
  const { deps, projection } = detailPorts(f);
  projection.ingestFromTimeline();
  const parent = buildRunDetail(deps, f.run.envelope.runId);
  const parentRow = projection.queueSurface(parent.runId); assert.ok(parentRow);
  assert.equal(parentRow.panelKind, "review");
  assert.equal(parent.panelKind, parentRow.panelKind);
  assert.ok(parent.availableSections.includes("review"));
  const failed = f.database.authority.runs.listChildren(f.run.envelope.runId)
    .find(child => child.lifecycle.state === "terminal" && child.lifecycle.outcome === "failed"); assert.ok(failed);
  const detail = buildRunDetail(deps, failed.envelope.runId);
  assert.equal(projection.queueSurface(failed.envelope.runId)?.parent?.panelKind, parent.panelKind);
  const action = detail.childRetry; assert.ok(action?.kind === "command");
  const command = composeCommandRequest(action, { runId: detail.runId, expectedVersion: detail.rowRevision }, {
    actorId: "local-operator", source: "run-detail", childRetry: action, requestedAt: f.clock.now().toISOString(),
  });
  assert.ok(command.state === "ready");
  const request = CommandRequestSchema.parse(command.request);
  const reply = f.canonical.kernel.execute(request); assert.ok(reply.state === "applied");
  assert.equal(reply.affectedTargets.length, 3);
  const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async input => {
    const runId = new URL(String(input)).pathname.split("/").at(-1); assert.ok(runId);
    projection.ingestFromTimeline();
    return Response.json(buildRunDetail(deps, runId));
  } });
  assert.equal((await verifyShellCommandEffect(client, createDashboardModelFixtures().DAY.day, request, reply)).state, "matched");
  assert.equal(buildRunDetail(deps, failed.envelope.runId).childRetry, undefined);
  const resumed = await f.canonical.execute(f.run, new AbortController().signal);
  assert.equal(resumed.run?.lifecycle.state, "parked-gate");
  assert.equal(f.database.authority.ocrReviews.latest(f.run.envelope.runId)?.revision, 2);
});

it("preserves unchanged record choices and serves invalidated corrections for only the retried record", async () => {
  const f = await world.fixture({ record: true, release: true, pageCount: 2,
    signerLookup: { firstNames: ["Avery", "Morgan"], failOnce: "Morgan" } });
  const repositories = f.database.authority;
  let revision = 1;
  for (const [index, name] of ["Ava", "Mo"].entries()) {
    const correction = f.command("correct-ocr-record", revision, index);
    const page = repositories.ocrReviews.latest(f.run.envelope.runId)?.seed.review.accounting.outcomes[index]; assert.ok(page?.state === "done");
    assert.equal(f.canonical.kernel.execute({ ...correction, payload: { ...correction.payload,
      fields: correctOcrField(page.output.extraction, "firstName", name) } }).state, "applied");
    revision++;
    if (index === 0) {
      assert.equal(f.canonical.kernel.execute(f.command("discard-ocr-record", revision, index)).state, "applied");
      revision++;
    }
  }
  const previous = repositories.ocrReviews.latest(f.run.envelope.runId); assert.ok(previous);
  assert.equal(previous.revision, 4);
  const retained = Array.from({ length: previous.revision }, (_, index) => repositories.ocrReviews.revision(f.run.envelope.runId, index + 1));
  const failed = repositories.runs.listChildren(f.run.envelope.runId).find(child => child.envelope.workflow === "i9-lookup"
    && child.lifecycle.state === "terminal" && child.lifecycle.outcome === "failed"); assert.ok(failed);
  assert.equal(f.canonical.kernel.execute({ commandId: randomUUID(), family: "run", type: "retry", requestedBy: "local-operator",
    source: "run-detail", requestedAt: f.clock.now().toISOString(), target: { runId: failed.envelope.runId, expectedVersion: failed.version } }).state, "applied");
  assert.equal((await f.canonical.execute(f.run, new AbortController().signal)).run?.lifecycle.state, "parked-gate");
  const current = repositories.ocrReviews.latest(f.run.envelope.runId); assert.ok(current);
  assert.deepEqual(current.records[0], previous.records[0]);
  assert.equal(current.records[0]?.discarded, true);
  assert.equal(current.records[0]?.assertedEid, "10800000");
  const correctedName = current.records[0]?.fields.answers.find(answer => answer.path === "firstName"); assert.ok(correctedName?.state === "read");
  assert.equal(correctedName.raw, "Ava");
  assert.deepEqual(current.records[1], initialOcrReviewRecords(current.seed)[1]);
  assert.notDeepEqual(current.records[1], previous.records[1]);
  const lastRetained = retained.at(-1); assert.ok(lastRetained);
  assert.equal(ocrReviewDigest(previous), ocrReviewDigest(lastRetained));
  assert.deepEqual(retained.map((_, index) => repositories.ocrReviews.revision(f.run.envelope.runId, index + 1)), retained);
  const { deps, projection } = detailPorts(f); projection.ingestFromTimeline();
  const warning = [{ sourcePage: 2, revision: current.revision }];
  assert.deepEqual(f.database.withAuthorityReadSnapshot(() => buildRunDetail(deps, f.run.envelope.runId)).ocrReviewChanges, warning);
  const section = buildOcrReviewSection(deps, f.run.envelope.runId); assert.ok(section.section === "review");
  assert.deepEqual(section.payload.ocr?.invalidatedCorrections, warning);
});

it("clears an invalidated correction warning after an explicit edit of the rebuilt record", async () => {
  const f = await world.fixture({ record: true, release: true, signerLookup: { firstNames: ["Avery"], failOnce: "Avery" } });
  const repositories = f.database.authority;
  assert.equal(f.canonical.kernel.execute(f.command("correct-ocr-record", 1)).state, "applied");
  const failed = repositories.runs.listChildren(f.run.envelope.runId).find(child => child.envelope.workflow === "i9-lookup"
    && child.lifecycle.state === "terminal" && child.lifecycle.outcome === "failed"); assert.ok(failed);
  assert.equal(f.canonical.kernel.execute({ commandId: randomUUID(), family: "run", type: "retry", requestedBy: "local-operator",
    source: "run-detail", requestedAt: f.clock.now().toISOString(), target: { runId: failed.envelope.runId, expectedVersion: failed.version } }).state, "applied");
  assert.equal((await f.canonical.execute(f.run, new AbortController().signal)).run?.lifecycle.state, "parked-gate");
  const current = repositories.ocrReviews.latest(f.run.envelope.runId); assert.ok(current);
  const { deps, projection } = detailPorts(f); projection.ingestFromTimeline();
  assert.deepEqual(f.database.withAuthorityReadSnapshot(() => buildRunDetail(deps, f.run.envelope.runId)).ocrReviewChanges,
    [{ sourcePage: 1, revision: current.revision }]);
  assert.equal(f.canonical.kernel.execute(f.command("correct-ocr-record", current.revision)).state, "applied");
  projection.ingestFromTimeline();
  assert.equal(f.database.withAuthorityReadSnapshot(() => buildRunDetail(deps, f.run.envelope.runId)).ocrReviewChanges, undefined);
});
