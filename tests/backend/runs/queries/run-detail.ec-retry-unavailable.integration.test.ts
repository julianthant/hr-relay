import { createReceiptService } from "../../../../src/backend/runs/trust/receipt-service.js";
import { createOperatorProjection } from "../../../../src/backend/app/composition/dashboard/queue.js";
import { createOperatorRunDetail } from "../../../../src/backend/app/composition/dashboard/run-detail.js";
import { createTransactionHistory } from "../../../../src/backend/storage/sqlite/transaction-history.js";
import { descriptorSetHash } from "../../../../src/backend/app/registries/workflow-registry.js";
import { buildRunDetail } from "../../../../src/backend/runs/queries/run-detail.js";
import type { RunRecord } from "../../../../src/models/run/record.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
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

function retryFromLogs(f: Awaited<ReturnType<typeof world.fixture>>, failed: RunRecord) {
  const repos = f.database.authority, view = detailPorts(f), detail = view.detail(failed.envelope.runId);
  assert.equal(detail.runId, failed.envelope.runId);
  assert.equal(detail.header.runId, failed.envelope.runId);
  assert.equal(detail.header.parentRunId, f.parentRun.envelope.runId);
  assert.equal(detail.rowRevision, failed.version);
  assert.deepEqual(detail.childRetry, { key: "retry-child", label: "Retry", kind: "command", command: "retry",
    expectedVersion: failed.version, intent: "neutral", icon: "retry", placement: ["banner"] });
  // D9: the member decision sends exactly the served child retry.
  assert.equal(detail.decision?.type, "member-failed");
  assert.deepEqual(detail.decision?.options.map(({ id, send }) => [id, send]), [["retry", { via: "action", actionKey: "retry-child" }]]);
  const action = detail.childRetry; assert.ok(action);
  const command = retryCommand(f, detail.runId, action.expectedVersion);
  const parent = repos.runs.get(f.parentRun.envelope.runId); assert.ok(parent);
  const children = repos.runs.listChildren(parent.envelope.runId), before = writeFacts(f);
  const stale = f.canonical.kernel.execute({ ...command, commandId: randomUUID(),
    target: { ...command.target, expectedVersion: action.expectedVersion - 1 } });
  assert.ok(stale.state === "conflict"); assert.equal(stale.currentVersion, failed.version);
  assert.deepEqual(repos.runs.get(parent.envelope.runId), parent);
  assert.deepEqual(repos.runs.listChildren(parent.envelope.runId), children); assert.deepEqual(writeFacts(f), before);
  const applied = f.canonical.kernel.execute(command); assert.equal(applied.state, "applied", JSON.stringify(applied));
  assert.deepEqual(f.canonical.kernel.execute(command), { ...applied, state: "already-applied" });
  const after = repos.runs.listChildren(parent.envelope.runId);
  assert.equal(after.length, children.length + 1);
  const replacement = after.filter(run => run.envelope.retryOf === failed.envelope.runId);
  assert.equal(replacement.length, 1); const next = replacement[0]; assert.ok(next);
  assert.equal(next.lifecycle.state, "queued");
  assert.equal(next.envelope.workflow, failed.envelope.workflow);
  assert.equal(next.envelope.itemId, failed.envelope.itemId);
  assert.equal(next.envelope.parent?.runId, parent.envelope.runId);
  assert.equal(next.envelope.attempt, failed.envelope.attempt + 1);
  assert.equal(next.envelope.dryRun, failed.envelope.dryRun);
  assert.deepEqual(next.input, failed.input);
  const held = repos.runs.get(parent.envelope.runId); assert.ok(held);
  assert.equal(held.pause?.state, "paused");
  if (parent.pause !== undefined) assert.deepEqual(held.pause, parent.pause);
  assert.deepEqual(held.envelope, parent.envelope);
  for (const child of children) assert.deepEqual(repos.runs.get(child.envelope.runId), child);
  assert.deepEqual(writeFacts(f), before);
  assert.equal(view.detail(failed.envelope.runId).childRetry, undefined);
  assert.equal(view.detail(next.envelope.runId).childRetry, undefined);
  return next;
}

function retainedParentBytes(f: Awaited<ReturnType<typeof world.fixture>>) {
  const raw = new DatabaseSync(f.path, { readOnly: true });
  try {
    return { results: raw.prepare("SELECT id,payload_json,terminal_run_json FROM run_results WHERE run_id=? ORDER BY settlement_version").all(f.parentRun.envelope.runId),
      receipts: raw.prepare("SELECT id,settlement_version,payload_json FROM run_receipts WHERE run_id=? ORDER BY id").all(f.parentRun.envelope.runId) };
  } finally { raw.close(); }
}

describe("EC Logs member Retry", () => {
  beforeEach(async () => { current = await world.fixture(); });
  for (const paused of [false, true]) it(`admits the exact failed member under a ${paused ? "paused" : "waiting"} parent without another Save`, async () => {
    const f = current, repos = f.database.authority;
    await f.canonical.execute(f.parentRun, new AbortController().signal);
    const parent = repos.runs.get(f.parentRun.envelope.runId); assert.ok(parent?.lifecycle.state === "queued");
    const failed = repos.runs.listChildren(parent.envelope.runId).find(run => run.envelope.workflow === "emergency-contact-member" && run.lifecycle.state === "terminal" && run.lifecycle.outcome === "failed"); assert.ok(failed);
    if (paused) {
      assert.equal(f.canonical.kernel.execute({ ...retryCommand(f, parent.envelope.runId, parent.version), type: "pause" }).state, "applied");
      assert.equal(repos.runs.get(parent.envelope.runId)?.pause?.state, "paused");
    }
    retryFromLogs(f, failed);
  });
});

for (const dryRun of [false, true]) describe(`settled EC ${dryRun ? "dry run" : "ordinary"} Retry`, () => {
  beforeEach(async () => { current = await world.fixture({ dryRun }); });
  it("admits a held replacement while retaining the exact old settlement and receipt bytes without another Save", async () => {
    const f = current, repos = f.database.authority;
    await f.canonical.execute(f.parentRun, new AbortController().signal);
    const waitingFailure = repos.runs.listChildren(f.parentRun.envelope.runId).find(run => run.envelope.workflow === "emergency-contact-member" && run.lifecycle.state === "terminal" && run.lifecycle.outcome === "failed"); assert.ok(waitingFailure);
    assert.equal(detailPorts(f).detail(waitingFailure.envelope.runId).childRetry?.expectedVersion, waitingFailure.version);
    await f.canonical.execute(f.parentRun, new AbortController().signal);
    const parent = repos.runs.get(f.parentRun.envelope.runId); assert.ok(parent?.lifecycle.state === "terminal" && parent.lifecycle.outcome === "done");
    const children = repos.runs.listChildren(parent.envelope.runId);
    const failed = children.find(run => run.envelope.workflow === "emergency-contact-member" && run.lifecycle.state === "terminal" && run.lifecycle.outcome === "failed"); assert.ok(failed);
    const receipts = createReceiptService({ database: f.database, runReader: f.canonical.lifecycle, descriptors: [f.root.descriptor, f.member.descriptor] });
    const receipt = receipts.ensureReceipt(parent.envelope.runId);
    assert.deepEqual(repos.evidenceReceipts.findByRun(parent.envelope.runId), receipt);
    assert.ok(parent.completion);
    const settlementVersion = parent.completion.expectedVersion + 1;
    const settlement = repos.runResults.getSettlement(parent.envelope.runId, settlementVersion); assert.ok(settlement);
    const bytes = retainedParentBytes(f);
    retryFromLogs(f, failed);
    const refreshed = repos.runs.get(parent.envelope.runId); assert.ok(refreshed);
    assert.equal(refreshed.lifecycle.state, "queued");
    assert.equal(refreshed.completion, undefined);
    assert.deepEqual(repos.runResults.getSettlement(parent.envelope.runId, settlementVersion), settlement);
    assert.deepEqual(settlement.run, parent);
    assert.deepEqual(repos.evidenceReceipts.get(receipt.receiptId), receipt);
    assert.deepEqual(retainedParentBytes(f), bytes);
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
