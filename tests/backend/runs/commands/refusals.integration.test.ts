import assert_m0 from "node:assert/strict";
import { afterEach as afterEach_m0,describe as describe_m0,it as it_m0,vi } from "vitest";
import { canonicalJsonStringify as canonicalJsonStringify_m0 } from "../../../../src/rules/validation/canonical-json.js";

import { TargetNotFoundError as TargetNotFoundError_m0 } from "../../../../src/backend/runs/commands/refusals.js";
import { createNotificationInbox as createNotificationInbox_m0 } from "../../../../src/backend/runs/notifications/inbox.js";
import { RunLifecycleSchema as RunLifecycleSchema_m1,RunRecordSchema as RunRecordSchema_m1 } from "../../../../src/models/run/record.js";
import { uuidOf as uuidOf_m0 } from "../../../support/helpers/backend/dashboard-harness.js";
import { trustWorld as trustWorld_m0 } from "../../../support/helpers/backend/trust-authority-fixture.js";
import { personLookupDescriptor as personLookupDescriptor_m0 } from "../../../support/helpers/registered-workflows.js";

import assert_m1 from "node:assert/strict";
import { afterEach as afterEach_m1,describe as describe_m1,it as it_m1 } from "vitest";
import { ProjectionDegradedError as ProjectionDegradedError_m1 } from "../../../../src/backend/runs/commands/refusals.js";
import { HASH_A as HASH_A_m1,HASH_B as HASH_B_m1,UUID_4 as UUID_4_m1 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import {
DAY as DAY_m1,
makeWorld as makeWorld_m1,
queuedEventOf as queuedEventBase_m1,
runRecordOf as runRecordBase_m1,
traceOf as traceOf_m1,
uuidOf as uuidOf_m1,
type DashboardWorld as DashboardWorld_m1
} from "../../../support/helpers/backend/dashboard-harness.js";


{


const worlds: ReturnType<typeof trustWorld_m0>[] = [];
function fixture() { const value = trustWorld_m0(); worlds.push(value); return value; }
const _afterEachFixture0 = () => { vi.restoreAllMocks(); for (const value of worlds.splice(0).reverse()) value.dispose(); };

function inbox(value: ReturnType<typeof trustWorld_m0>) {
  let id = 7000;
  return createNotificationInbox_m0({ authority: value.database, runReader: value.reader, clock: value.world.clock,
    ids: { uuid: () => uuidOf_m0(id++) }, actorId: "local-operator" });
}

describe_m0("canonical trust linkage", () => {
afterEach_m0(_afterEachFixture0);


  it_m0("keeps independent retry receipts and notification replay, then refuses deleted live doors", async () => {
    const f = fixture(); const source = f.fail(f.create(10), 11); const id = source.envelope.runId;
    const sourceReceipt = canonicalJsonStringify_m0(f.receipts.ensureReceipt(id));
    const notifications = inbox(f);
    const failedEvent = (runId: string) => {
      const failure = f.database.authority.failures.listByRun(runId).at(-1);
      assert_m0.ok(failure);
      return { kind: "run-failed" as const, runId: failure.runId, workflowId: failure.workflowId,
        failureId: failure.failureId, failureFingerprint: failure.fingerprint, code: failure.code };
    };
    const sourceEvent = failedEvent(id);
    await notifications.publish(sourceEvent);
    const retried = f.service.retry({ commandId: uuidOf_m0(12), runId: id, expectedVersion: source.version,
      runtimeConfig: f.runtimeConfig }, personLookupDescriptor_m0);
    assert_m0.equal(retried.state, "applied"); if (retried.state !== "applied") throw new Error("retry refused");
    const retry = f.fail(retried.run, 13);
    const retryReceipt = f.receipts.ensureReceipt(retry.envelope.runId);
    assert_m0.notEqual(retryReceipt.receiptId, f.receipts.ensureReceipt(id).receiptId);
    assert_m0.equal(retryReceipt.attempt, source.envelope.attempt + 1);
    assert_m0.equal(canonicalJsonStringify_m0(f.receipts.ensureReceipt(id)), sourceReceipt);
    await notifications.publish(failedEvent(retry.envelope.runId));
    assert_m0.equal(notifications.list("local-operator").length, 2);
    const inboxBeforeDeletion = canonicalJsonStringify_m0(notifications.list("local-operator"));

    assert_m0.equal((await notifications.publish(sourceEvent)).durable, "existing");
    assert_m0.equal(canonicalJsonStringify_m0(f.receipts.ensureReceipt(id)), sourceReceipt);
    assert_m0.equal(f.service.delete({ commandId: uuidOf_m0(15), runId: id, expectedVersion: source.version }).state, "deleted");
    assert_m0.throws(() => f.receipts.ensureReceipt(id), TargetNotFoundError_m0);
    assert_m0.equal((await notifications.publish(sourceEvent)).durable, "existing", "exact immutable publication replay survives owner deletion");
    await assert_m0.rejects(notifications.publish({ ...sourceEvent, failureFingerprint: "e".repeat(64) },
      { identity: "f".repeat(64), occurredAt: f.world.clock.now().toISOString() }), /deleted/);
    assert_m0.equal(canonicalJsonStringify_m0(notifications.list("local-operator")), inboxBeforeDeletion, "terminal deletion preserves immutable notification ownership and replay");
    assert_m0.equal(canonicalJsonStringify_m0(f.receipts.ensureReceipt(retry.envelope.runId)), canonicalJsonStringify_m0(retryReceipt));
    assert_m0.equal(f.database.authority.evidenceReceipts.findByRun(id), undefined);
  });
});
}

{


/** C completion contract: projection fixtures still carry a valid terminal settlement. */
function runRecordOf(input: Parameters<typeof runRecordBase_m1>[0]) {
  const lifecycle = RunLifecycleSchema_m1.parse(input.lifecycle ?? {state:"queued"});
  if (lifecycle.state !== "terminal" || !["done","failed"].includes(lifecycle.outcome)) return runRecordBase_m1(input);
  const base = runRecordBase_m1({...input,lifecycle:{state:"queued"}});
  const version = Math.max(2,base.version), claimGeneration = Math.max(1,base.claimGeneration);
  return RunRecordSchema_m1.parse({...base,lifecycle,version,claimGeneration,updatedAt:lifecycle.endedAt,completion:{
    schemaVersion:1,kind:lifecycle.outcome,expectedVersion:version-1,
    claim:{workerId:"queue-fixture-worker",claimGeneration},authorizedAt:lifecycle.endedAt,
    ...(lifecycle.outcome === "done" ? {resultDigest:"a".repeat(64)} : {failureId:lifecycle.failureId}),
  }});
}
function queuedEventOf(w: DashboardWorld_m1, input: Parameters<typeof runRecordBase_m1>[0]) {
  const event = queuedEventBase_m1(w,{...input,lifecycle:{state:"queued"}});
  if (input.lifecycle !== undefined) w.authority.put(runRecordOf({...input,enqueuedAt:input.enqueuedAt ?? w.clock.now().toISOString()}));
  return event;
}

const worlds: DashboardWorld_m1[] = [];

function world(...args: Parameters<typeof makeWorld_m1>): DashboardWorld_m1 {
  const created = makeWorld_m1(...args);
  worlds.push(created);
  return created;
}

const _afterEachFixture0 = () => {
  for (const w of worlds.splice(0)) w.dispose();
};

describe_m1("THE run/queue projection", () => {
afterEach_m1(_afterEachFixture0);


  it_m1("degrades on an unfoldable event, schedules the guarded rebuild, and recovers from JSONL", () => {
    const w = world({ collectRebuilds: true });
    queuedEventOf(w, { seed: 1 });
    // A claim for a run with no run.queued cannot fold; apply must not throw
    // into the emitting path.
    w.projection.apply({
      t: "run.claimed", ts: w.clock.now().toISOString(), workflow: "person-lookup", pid: 4242,
      runId: uuidOf_m1(60), attempt: 1, traceId: traceOf_m1(60), spanPath: traceOf_m1(60),
      workerId: "person-lookup-worker-1",
    } as never);
    assert_m1.equal(w.projection.health().state, "degraded");
    assert_m1.match(w.projection.health().lastError ?? "", /no run\.queued span/);
    assert_m1.throws(() => w.projection.buildDashboardDayWire(DAY_m1), /degraded and refuses to serve counts/);

    assert_m1.throws(
      () => w.projection.buildActivityReportWire(DAY_m1, DAY_m1),
      /degraded and refuses to serve activity aggregates/,
    );
    try {
      w.projection.buildActivityReportWire(DAY_m1, DAY_m1);
      assert_m1.fail("expected buildActivityReportWire to throw while degraded");
    } catch (error) {
      assert_m1.ok(error instanceof ProjectionDegradedError_m1, "must throw the typed refusal, not a plain Error");
    }
    assert_m1.equal(w.scheduledRebuilds.length, 1);

    w.scheduledRebuilds[0]();
    assert_m1.equal(w.projection.health().state, "live");
    assert_m1.equal(w.projection.buildDashboardDayWire(DAY_m1).queueSurfaces.length, 1);
    assert_m1.equal(w.changes.some((change) => change.kind === "generation"), true);
  });



  /** A raw stream line as ANOTHER process would append it — no writer, no apply. */
  function _rawQueuedLineOf(w: DashboardWorld_m1, seed: number, workflow: string): string {
    return JSON.stringify({
      t: "run.queued", kind: "run", pid: 777,
      ts: w.clock.now().toISOString(),
      workflow,
      runId: uuidOf_m1(seed), attempt: 1,
      traceId: traceOf_m1(seed), spanPath: traceOf_m1(seed),
      itemId: uuidOf_m1(seed + 5000),
      shape: "single", priority: "interactive", dryRun: false,
      actorId: "local-operator",
      title: `raw #${String(seed)}`,
      descriptorVersion: 1,
      contractFingerprint: HASH_A_m1,
      resolvedInstance: { ucpath: "prod" },
      configFingerprint: HASH_B_m1,
      configSnapshotId: UUID_4_m1,
    });
  }
});
}
