import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { descriptorSetHash } from "../../../../src/backend/app/registries/workflow-registry.js";
import { createOperatorProjection } from "../../../../src/backend/app/composition/dashboard/queue.js";
import { createOperatorRunDetail } from "../../../../src/backend/app/composition/dashboard/run-detail.js";
import { createTransactionHistory } from "../../../../src/backend/storage/sqlite/transaction-history.js";
import { buildRunDetail } from "../../../../src/backend/runs/queries/run-detail.js";
import { createDashboardClient } from "../../../../src/dashboard/client/index.js";
import { composeCommandRequest, verifyShellCommandEffect } from "../../../../src/dashboard/app/commands/command-dispatch.js";
import { CommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { createOcrReviewWorld } from "../../../support/helpers/backend/ocr-review-world.js";
import { createDashboardModelFixtures } from "../../../support/helpers/dashboard-model-fixtures.js";

const world = createOcrReviewWorld();
afterEach(world.cleanup);

it("serves a parked parent's failed-page retry and verifies its native parent/replacement effect through the typed client", async () => {
  const f = await world.fixture({ pageCount: 2, release: true, failManualPageOnce: 2 });
  const { stateRoot } = f.harness.authority;
  const reader = f.canonical.lifecycle;
  const projection = createOperatorProjection({ database: f.database, stateRoot, clock: f.clock, reader, appVersion: "0.1.0",
    descriptorSetHash: descriptorSetHash([f.root.descriptor.contractFingerprint]), ledger: createTransactionHistory(f.database.authority),
    descriptors: { resolve: f.resolve } });
  const deps = createOperatorRunDetail({ database: f.database, stateRoot, projection, runReader: reader,
    canonical: { reader, database: f.database, descriptors: { resolve: f.resolve } } });
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
