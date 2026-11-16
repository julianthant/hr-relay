import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";

import { TargetNotFoundError } from "../../../../src/backend/runs/commands/refusals.js";
import { createNotificationInbox } from "../../../../src/backend/runs/notifications/inbox.js";
import { RunLifecycleSchema, RunRecordSchema } from "../../../../src/models/run/record.js";
import { uuidOf } from "../../../support/helpers/backend/dashboard-harness.js";
import { trustWorld } from "../../../support/helpers/backend/trust-authority-fixture.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";

import { ProjectionDegradedError } from "../../../../src/backend/runs/commands/refusals.js";

import { DAY, makeWorld, queuedEventOf as queuedEventBase_m1, runRecordOf as runRecordBase_m1, traceOf, type DashboardWorld } from "../../../support/helpers/backend/dashboard-harness.js";

{

const worlds: Awaited<ReturnType<typeof trustWorld>>[] = [];
async function fixture() { const value = await trustWorld(); worlds.push(value); return value; }
const _afterEachFixture0 = async () => { vi.restoreAllMocks(); for (const value of worlds.splice(0).reverse()) await value.dispose(); };

function inbox(value: Awaited<ReturnType<typeof trustWorld>>) {
  let id = 7000;
  return createNotificationInbox({ authority: value.database, runReader: value.reader, clock: value.world.clock,
    ids: { uuid: () => uuidOf(id++) }, actorId: "local-operator" });
}

describe("canonical trust linkage", () => {
afterEach(_afterEachFixture0);

  it("keeps independent retry receipts and notification replay, then refuses deleted live doors", async () => {
    const f = await fixture(); const source = f.fail(f.create(10), 11); const id = source.envelope.runId;
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
});
}

{

/** C completion contract: projection fixtures still carry a valid terminal settlement. */
function runRecordOf(input: Parameters<typeof runRecordBase_m1>[0]) {
  const lifecycle = RunLifecycleSchema.parse(input.lifecycle ?? {state:"queued"});
  if (lifecycle.state !== "terminal" || !["done","failed"].includes(lifecycle.outcome)) return runRecordBase_m1(input);
  const base = runRecordBase_m1({...input,lifecycle:{state:"queued"}});
  const version = Math.max(2,base.version), claimGeneration = Math.max(1,base.claimGeneration);
  return RunRecordSchema.parse({...base,lifecycle,version,claimGeneration,updatedAt:lifecycle.endedAt,completion:{
    schemaVersion:1,kind:lifecycle.outcome,expectedVersion:version-1,
    claim:{workerId:"queue-fixture-worker",claimGeneration},authorizedAt:lifecycle.endedAt,
    ...(lifecycle.outcome === "done" ? {resultDigest:"a".repeat(64)} : {failureId:lifecycle.failureId}),
  }});
}
function queuedEventOf(w: DashboardWorld, input: Parameters<typeof runRecordBase_m1>[0]) {
  const event = queuedEventBase_m1(w,{...input,lifecycle:{state:"queued"}});
  if (input.lifecycle !== undefined) w.authority.put(runRecordOf({...input,enqueuedAt:input.enqueuedAt ?? w.clock.now().toISOString()}));
  return event;
}

const worlds: DashboardWorld[] = [];

async function world(...args: Parameters<typeof makeWorld>): Promise<DashboardWorld> {
  const created = await makeWorld(...args);
  worlds.push(created);
  return created;
}

const _afterEachFixture0 = async () => {
  for (const w of worlds.splice(0)) await w.dispose();
};

describe("THE run/queue projection", () => {
afterEach(_afterEachFixture0);

  it("degrades on an unfoldable event, schedules the guarded rebuild, and recovers from JSONL", async () => {
    const w = await world({ collectRebuilds: true });
    queuedEventOf(w, { seed: 1 });
    // A claim for a run with no run.queued cannot fold; apply must not throw
    // into the emitting path.
    w.projection.apply({
      t: "run.claimed", ts: w.clock.now().toISOString(), workflow: "person-lookup", pid: 4242,
      runId: uuidOf(60), attempt: 1, traceId: traceOf(60), spanPath: traceOf(60),
      workerId: "person-lookup-worker-1",
    } as never);
    assert.equal(w.projection.health().state, "degraded");
    assert.match(w.projection.health().lastError ?? "", /no run\.queued span/);
    assert.throws(() => w.projection.buildDashboardDayWire(DAY), /degraded and refuses to serve counts/);

    assert.throws(
      () => w.projection.buildActivityReportWire(DAY, DAY),
      /degraded and refuses to serve activity aggregates/,
    );
    try {
      w.projection.buildActivityReportWire(DAY, DAY);
      assert.fail("expected buildActivityReportWire to throw while degraded");
    } catch (error) {
      assert.ok(error instanceof ProjectionDegradedError, "must throw the typed refusal, not a plain Error");
    }
    assert.equal(w.scheduledRebuilds.length, 1);

    w.scheduledRebuilds[0]();
    assert.equal(w.projection.health().state, "live");
    assert.equal(w.projection.buildDashboardDayWire(DAY).queueSurfaces.length, 1);
    assert.equal(w.changes.some((change) => change.kind === "generation"), true);
  });
});
}
