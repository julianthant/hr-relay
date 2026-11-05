import { createReceiptService } from "../../../../src/backend/runs/trust/receipt-service.js";
import { createOperatorProjection } from "../../../../src/backend/app/composition/dashboard/queue.js";
import { createOperatorRunDetail } from "../../../../src/backend/app/composition/dashboard/run-detail.js";
import { createTransactionHistory } from "../../../../src/backend/storage/sqlite/transaction-history.js";
import { descriptorSetHash } from "../../../../src/backend/app/registries/workflow-registry.js";
import { buildRunDetail } from "../../../../src/backend/runs/queries/run-detail.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "vitest";
import { createEcRetryWorld } from "../../../support/helpers/backend/ec-retry-world.js";

const world = createEcRetryWorld();
afterEach(world.cleanup);
let current: Awaited<ReturnType<typeof world.fixture>>;

function detailPorts(f: Awaited<ReturnType<typeof world.fixture>>) {
  const { stateRoot } = f.harness.authority, reader = f.canonical.lifecycle;
  const projection = createOperatorProjection({ database: f.database, stateRoot, clock: f.clock, reader, appVersion: "0.1.0",
    descriptorSetHash: descriptorSetHash([f.root.descriptor.contractFingerprint]), ledger: createTransactionHistory(f.database.authority), descriptors: { resolve: f.resolve } });
  const deps = createOperatorRunDetail({ database: f.database, stateRoot, projection, runReader: reader,
    canonical: { reader, database: f.database, descriptors: { resolve: f.resolve } } });
  return { projection, detail: (runId: string) => buildRunDetail(deps, runId) };
}

function retryCommand(f: Awaited<ReturnType<typeof world.fixture>>, runId: string, expectedVersion: number) {
  return { commandId: randomUUID(), family: "run", type: "retry", requestedBy: "local-operator", source: "run-detail",
    requestedAt: f.clock.now().toISOString(), target: { runId, expectedVersion } };
}
function writeFacts(f: Awaited<ReturnType<typeof world.fixture>>) {
  const members = f.database.authority.runs.listChildren(f.parentRun.envelope.runId);
  const intents = members.flatMap(run => f.database.authority.writeIntents.listByRun(run.envelope.runId));
  return { intents, attempts: intents.flatMap(intent => f.database.authority.writeAttempts.listByIntent(intent.writeIntentId)),
    saves: [...f.persistence].map(([eid, backend]) => [eid, backend.submissions.length]) };
}

describe("EC Retry remains unavailable", () => {
  beforeEach(async () => { current = await world.fixture(); });
  it("serves no consumer Retry for either a waiting or explicitly paused parent", async () => {
    const f = current, repos = f.database.authority;
    await f.canonical.execute(f.parentRun, new AbortController().signal);
    const parent = repos.runs.get(f.parentRun.envelope.runId); assert.ok(parent?.lifecycle.state === "queued");
    const failed = repos.runs.listChildren(parent.envelope.runId).find(run => run.envelope.workflow === "emergency-contact-member" && run.lifecycle.state === "terminal" && run.lifecycle.outcome === "failed"); assert.ok(failed);
    const view = detailPorts(f), before = writeFacts(f), children = repos.runs.listChildren(parent.envelope.runId);
    assert.equal(view.detail(failed.envelope.runId).childRetry, undefined);
    assert.equal(f.canonical.kernel.execute({ ...retryCommand(f, parent.envelope.runId, parent.version), type: "pause" }).state, "applied");
    assert.equal(repos.runs.get(parent.envelope.runId)?.pause?.state, "paused");
    assert.equal(view.detail(failed.envelope.runId).childRetry, undefined);
    assert.deepEqual(repos.runs.listChildren(parent.envelope.runId), children); assert.deepEqual(writeFacts(f), before);
  });
});

for (const dryRun of [false, true]) describe(`settled EC ${dryRun ? "dry run" : "ordinary"} refusal`, () => {
  beforeEach(async () => { current = await world.fixture({ dryRun }); });
  it("keeps mixed all-settled parent completion immutable and creates no replacement, activation or Save", async () => {
    const f = current, repos = f.database.authority;
    await f.canonical.execute(f.parentRun, new AbortController().signal);
    const waitingFailure = repos.runs.listChildren(f.parentRun.envelope.runId).find(run => run.envelope.workflow === "emergency-contact-member" && run.lifecycle.state === "terminal" && run.lifecycle.outcome === "failed"); assert.ok(waitingFailure);
    assert.equal(detailPorts(f).detail(waitingFailure.envelope.runId).childRetry, undefined);
    await f.canonical.execute(f.parentRun, new AbortController().signal);
    const parent = repos.runs.get(f.parentRun.envelope.runId); assert.ok(parent?.lifecycle.state === "terminal" && parent.lifecycle.outcome === "done");
    const children = repos.runs.listChildren(parent.envelope.runId);
    const failed = children.find(run => run.envelope.workflow === "emergency-contact-member" && run.lifecycle.state === "terminal" && run.lifecycle.outcome === "failed"); assert.ok(failed);
    assert.equal(detailPorts(f).detail(failed.envelope.runId).childRetry, undefined);
    const receipts = createReceiptService({ database: f.database, runReader: f.canonical.lifecycle, descriptors: [f.root.descriptor, f.member.descriptor] });
    receipts.ensureReceipt(parent.envelope.runId);
    assert.ok(repos.evidenceReceipts.findByRun(parent.envelope.runId));
    const before = { parent, children, result: repos.runResults.get(parent.envelope.runId), receipt: repos.evidenceReceipts.findByRun(parent.envelope.runId),
      dependencies: repos.dependencies.listByParentRun(parent.envelope.runId), writes: writeFacts(f), generation: f.database.getMeta().authorityGeneration };
    assert.throws(() => f.canonical.kernel.execute(retryCommand(f, failed.envelope.runId, failed.version)), /delegation-retry-source-unavailable/);
    assert.deepEqual({ parent: repos.runs.get(parent.envelope.runId), children: repos.runs.listChildren(parent.envelope.runId), result: repos.runResults.get(parent.envelope.runId),
      receipt: repos.evidenceReceipts.findByRun(parent.envelope.runId), dependencies: repos.dependencies.listByParentRun(parent.envelope.runId), writes: writeFacts(f),
      generation: f.database.getMeta().authorityGeneration }, before);
  });
});

describe("UNKNOWN EC refusal", () => {
  beforeEach(async () => { current = await world.fixture({ failure: "unknown" }); });
  it("does not serve or admit generic Retry for a parked Save or repeat a lost Save reply", async () => {
    const f = current, repos = f.database.authority;
    await f.canonical.execute(f.parentRun, new AbortController().signal);
    const held = repos.runs.listChildren(f.parentRun.envelope.runId).find(run => run.lifecycle.state === "parked-write"); assert.ok(held);
    assert.equal(detailPorts(f).detail(held.envelope.runId).childRetry, undefined);
    const before = writeFacts(f), children = repos.runs.listChildren(f.parentRun.envelope.runId);
    const command = retryCommand(f, held.envelope.runId, held.version);
    for (const request of [command, command, { ...command, commandId: randomUUID() }]) {
      const refused = f.canonical.kernel.execute(request);
      assert.ok(refused.state === "rejected" && refused.code === "invalid-state");
      assert.deepEqual(writeFacts(f), before); assert.deepEqual(repos.runs.listChildren(f.parentRun.envelope.runId), children);
    }
  });
});
