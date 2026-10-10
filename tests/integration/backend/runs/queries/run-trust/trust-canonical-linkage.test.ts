import { join } from "node:path";
import { testWorkerPorts } from "../../../../../support/fixtures/run-lifecycle-fixtures.js";
import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";
import { canonicalJsonStringify } from "../../../../../../src/rules/validation/canonical-json.js";

import { buildTrustSection, buildRunGate } from "../../../../../../src/backend/runs/queries/run-trust.js";
import { createNoteJsonlWriter } from "../../../../../../src/backend/storage/events/note-jsonl-writer.js";
import { readEventStreamLines } from "../../../../../../src/backend/storage/events/jsonl-streams.js";
import { createNotificationInbox } from "../../../../../../src/backend/runs/notifications/inbox.js";
import { readGateParks } from "../../../../../../src/backend/app/composition/dashboard/trust.js";
import { explainRunFrom } from "../../../../../../src/backend/app/composition/explain-compose.js";
import { SectionUnavailableError, TargetNotFoundError } from "../../../../../../src/backend/runs/commands/refusals.js";
import { seedPersonLookupExitRun } from "../../../../../support/fixtures/receipt-run-fixtures.js";
import { personLookupDescriptor } from "../../../../../support/helpers/registered-workflows.js";
import { uuidOf } from "../../../../../support/helpers/backend/dashboard-harness.js";
import { trustWorld, foldTrustGate } from "../../../../../support/helpers/backend/trust-authority-fixture.js";

const worlds: ReturnType<typeof trustWorld>[] = [];
function fixture() { const value = trustWorld(); worlds.push(value); return value; }
afterEach(() => { vi.restoreAllMocks(); for (const value of worlds.splice(0).reverse()) value.dispose(); });

function inbox(value: ReturnType<typeof trustWorld>) {
  let id = 7000;
  return createNotificationInbox({ authority: value.database, runReader: value.reader, clock: value.world.clock,
    ids: { uuid: () => uuidOf(id++) }, actorId: "local-operator" });
}

describe("2.6.1-1 canonical trust linkage", () => {
  it("serves a real derived receipt and Explain by run or trace without any span fold", () => {
    const f = fixture();
    testWorkerPorts(f.database, f.world.clock, { path: join(f.world.stateRoot, "trust.sqlite"), descriptor: personLookupDescriptor, poolIndex: 1 });
    const { run } = seedPersonLookupExitRun(f.database);
    assert.equal(f.world.projection.runFold(run.envelope.runId), undefined);
    const result = buildTrustSection(f.deps, run.envelope.runId, "receipt");
    assert.equal(result.section, "receipt");
    const original = canonicalJsonStringify(f.receipts.ensureReceipt(run.envelope.runId));
    assert.deepEqual(explainRunFrom(f.database, run.envelope.runId), explainRunFrom(f.database, run.envelope.traceId));
    assert.equal(canonicalJsonStringify(f.receipts.ensureReceipt(run.envelope.runId)), original);
  });

  it("keeps no-fold log pages immutable and refuses retained lines after canonical deletion", () => {
    const f = fixture(); const run = f.create(1); const id = run.envelope.runId;
    const writer = createNoteJsonlWriter({ stateRoot: f.world.stateRoot, clock: f.world.clock, pid: 999 });
    const append = (message: string) => writer.emitNote({ workflow: run.envelope.workflow,
      address: { runId: id, traceId: run.envelope.traceId, spanPath: run.envelope.traceId, attempt: run.envelope.attempt },
      level: "step", message });
    for (let i = 0; i < 201; i++) append(`trust note ${String(i)}`);
    const first = buildTrustSection(f.deps, id, "logs");
    assert.equal(first.section, "logs"); if (first.section !== "logs") throw new Error("wrong section");
    assert.ok(first.payload.rows);
    assert.equal(first.payload.rows.length, 200);
    const cursor = first.payload.nextCursor; assert.equal(cursor.state, "present");
    if (cursor.state !== "present") throw new Error("missing next page");
    append("late note");
    const second = buildTrustSection(f.deps, id, "logs", cursor.value);
    assert.equal(second.section, "logs"); if (second.section !== "logs") throw new Error("wrong section");
    assert.ok(second.payload.rows);
    assert.equal(second.payload.rows.length, 1);
    const source = readEventStreamLines(f.world.stateRoot, "notes").map(line => line.text);
    const terminal = f.cancel(run, 2);
    assert.equal(f.service.delete({ commandId: uuidOf(3), runId: id, expectedVersion: terminal.version }).state, "deleted");
    assert.throws(() => buildTrustSection(f.deps, id, "logs", cursor.value), /deleted/);
    assert.deepEqual(readEventStreamLines(f.world.stateRoot, "notes").map(line => line.text), source);
    assert.throws(() => buildTrustSection(f.deps, uuidOf(88), "logs"), /absent/);
  });

  it("keeps independent retry receipts and notification replay, then refuses deleted live doors", async () => {
    const f = fixture(); const source = f.fail(f.create(10), 11); const id = source.envelope.runId;
    const sourceReceipt = canonicalJsonStringify(f.receipts.ensureReceipt(id));
    const notifications = inbox(f);
    const failedEvent = (runId: string) => {
      const failure = f.database.authority.failures.listByRun(runId).at(-1);
      assert.ok(failure);
      return { kind: "run-failed" as const, runId: failure.runId, workflowId: failure.workflowId,
        failureId: failure.failureId, failureFingerprint: failure.fingerprint, code: failure.code };
    };
    const sourceEvent = failedEvent(id);
    await notifications.publish(sourceEvent);
    const retried = f.service.retry({ commandId: uuidOf(12), runId: id, expectedVersion: source.version,
      runtimeConfig: f.runtimeConfig }, personLookupDescriptor);
    assert.equal(retried.state, "applied"); if (retried.state !== "applied") throw new Error("retry refused");
    const retry = f.fail(retried.run, 13);
    const retryReceipt = f.receipts.ensureReceipt(retry.envelope.runId);
    assert.notEqual(retryReceipt.receiptId, f.receipts.ensureReceipt(id).receiptId);
    assert.equal(retryReceipt.attempt, source.envelope.attempt + 1);
    assert.equal(canonicalJsonStringify(f.receipts.ensureReceipt(id)), sourceReceipt);
    await notifications.publish(failedEvent(retry.envelope.runId));
    assert.equal(notifications.list("local-operator").length, 2);
    const inboxBeforeDeletion = canonicalJsonStringify(notifications.list("local-operator"));

    assert.equal((await notifications.publish(sourceEvent)).durable, "existing");
    assert.equal(canonicalJsonStringify(f.receipts.ensureReceipt(id)), sourceReceipt);
    assert.equal(f.service.delete({ commandId: uuidOf(15), runId: id, expectedVersion: source.version }).state, "deleted");
    assert.throws(() => f.receipts.ensureReceipt(id), TargetNotFoundError);
    assert.equal((await notifications.publish(sourceEvent)).durable, "existing", "exact immutable publication replay survives owner deletion");
    await assert.rejects(notifications.publish({ ...sourceEvent, failureFingerprint: "e".repeat(64) },
      { identity: "f".repeat(64), occurredAt: f.world.clock.now().toISOString() }), /deleted/);
    assert.equal(canonicalJsonStringify(notifications.list("local-operator")), inboxBeforeDeletion, "terminal deletion preserves immutable notification ownership and replay");
    assert.equal(canonicalJsonStringify(f.receipts.ensureReceipt(retry.envelope.runId)), canonicalJsonStringify(retryReceipt));
    assert.equal(f.database.authority.evidenceReceipts.findByRun(id), undefined);
  });

  it("refuses a receipt's foreign identity and leaves its immutable source untouched", () => {
    const f = fixture(); const a = f.cancel(f.create(20), 21); const b = f.cancel(f.create(22), 23);
    const foreign = f.receipts.ensureReceipt(b.envelope.runId);
    const deps = { ...f.deps, trust: { ...f.receipts, ensureReceipt: () => foreign } };
    assert.throws(() => buildTrustSection(deps, a.envelope.runId, "receipt"), /TRUST_EVIDENCE_IDENTITY_MISMATCH/);
    assert.deepEqual(f.database.authority.evidenceReceipts.findByRun(b.envelope.runId), foreign);
    assert.equal(f.database.authority.evidenceReceipts.findByRun(a.envelope.runId), undefined);
  });

  it("uses canonical gate parks with no fold and refuses a stale list without publishing a partial set", () => {
    const f = fixture(); const run = f.create(30);
    const claimed = f.database.authority.runs.claimNext({ workflow: run.envelope.workflow, workerId: f.workerId, now: f.world.clock.now().toISOString() });
    assert.equal(claimed.state, "claimed"); if (claimed.state !== "claimed") throw new Error("not claimed");
    let parked = claimed.run;
    for (const lifecycle of [
      { state: "validating", workerId: f.workerId, claimedAt: parked.lifecycle.state === "claimed" ? parked.lifecycle.claimedAt : "", heartbeatAt: f.world.clock.now().toISOString() },
      { state: "running", workerId: f.workerId, claimedAt: f.world.clock.now().toISOString(), heartbeatAt: f.world.clock.now().toISOString() },
      { state: "parked-gate", gateId: "identity-approval", parkedAt: f.world.clock.now().toISOString(), resumeAt: "identity-approval" },
    ]) {
      const outcome = f.database.authority.runs.transition({ runId: run.envelope.runId, expectedVersion: parked.version,
        claim: { workerId: f.workerId, claimGeneration: claimed.run.claimGeneration }, now: f.world.clock.now().toISOString(), lifecycle });
      assert.equal(outcome.state, "applied"); if (outcome.state !== "applied") throw new Error("park refused");
      parked = outcome.run;
    }
    assert.equal(f.world.projection.runFold(run.envelope.runId), undefined);
    assert.equal((buildRunGate(f.deps, run.envelope.runId, undefined, parked) as {state:string}).state, "open");
    assert.deepEqual(readGateParks(f.database, f.reader), [{ runId: run.envelope.runId, workflowId: run.envelope.workflow, gateId: "identity-approval" }]);
    const identity = buildTrustSection(f.deps, run.envelope.runId, "identity-gate");
    assert.equal(identity.section, "identity-gate");
    assert.throws(() => buildRunGate({ ...f.deps, authority: { ...f.deps.authority,
      listGateResults: () => [{ runId: uuidOf(999) } as ReturnType<typeof f.deps.authority.listGateResults>[number]] } },
    run.envelope.runId, undefined, parked), /IDENTITY_MISMATCH/);
    let calls = 0;
    assert.throws(() => readGateParks(f.database, { ...f.reader, list: () => ++calls === 1
      ? { state: "listed", rows: [parked], cursor: { generation: 1, offset: 1, disposition: "live" } }
      : { state: "refused", refusal: { reason: "cursor-stale" } } }), /cursor-stale/);
    assert.equal(calls, 2);
    assert.equal(f.database.authority.notifications.listByActor("local-operator").length, 0);
    const resolvedFold = foldTrustGate(f.world, parked, "resolved");
    assert.equal((buildRunGate(f.deps, run.envelope.runId, resolvedFold, parked) as { state: string }).state, "open",
      "stale resolved evidence cannot close the real canonical gate");
    const queued = f.create(34); const openFold = foldTrustGate(f.world, queued, "open");
    assert.equal((buildRunGate(f.deps, queued.envelope.runId, openFold, queued) as { state: string }).state, "absent",
      "stale open evidence cannot grant a gate to a canonical queued run");
    assert.throws(() => buildTrustSection(f.deps, queued.envelope.runId, "parked-write"), SectionUnavailableError);

  });

  it("refuses unconfigured admission and mismatched notification workflow before durable writes or delivery", async () => {
    const f = fixture(); const run = f.create(40);
    const { runReader: _reader, ...unconfigured } = f.deps;
    assert.throws(() => buildTrustSection(unconfigured, run.envelope.runId, "logs"), /NOT_CONFIGURED/);
    const notifications = inbox(f);
    await assert.rejects(notifications.publish({ kind: "gate-opened", runId: run.envelope.runId,
      workflowId: "separations", gateId: "identity-approval" }), /IDENTITY_MISMATCH/);
    assert.equal(notifications.list("local-operator").length, 0);
  });
});
