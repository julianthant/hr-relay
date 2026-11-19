import assert from "node:assert/strict";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, it } from "vitest";
import { createOperatorProjection } from "../../../../src/backend/app/composition/dashboard/queue.js";
import { composeQueueSummaries } from "../../../../src/backend/app/composition/dashboard/queue-summaries.js";
import { createDebugEventWriter } from "../../../../src/backend/logs/debug-events.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createTransactionHistory } from "../../../../src/backend/storage/sqlite/transaction-history.js";
import { APP_VERSION, DAY, DESCRIPTOR_SET_HASH, queuedEventOf, runRecordOf, uuidOf } from "../../../support/helpers/backend/dashboard-harness.js";
import { createRunQueueProjectionTestWorld } from "../../../support/helpers/backend/run-queue-projection-world.js";

const { world, cleanup } = createRunQueueProjectionTestWorld();
afterEach(cleanup);

async function fixture(removal = false) {
  const w = await world();
  const independent = queuedEventOf(w, { seed: 1 });
  const target = queuedEventOf(w, { seed: 2 });
  const unexpected = (): never => assert.fail("unexpected publication or generated id");
  const service = new RunRecordService({ database: w.database, clock: w.clock, ids: { uuid: unexpected }, publishQueued: unexpected });
  const cancel = () => service.transition({ commandId: uuidOf(3), runId: target.runId, expectedVersion: 1,
    lifecycle: { state: "terminal", outcome: "cancelled", endedAt: w.clock.now().toISOString() } });
  const rename = () => service.transition({ commandId: uuidOf(4), runId: target.runId, expectedVersion: 1, displayName: "New title" });
  if (removal) assert.equal(cancel().state, "applied");

  let failAfterRead = false;
  const makeProjection = (reads: string[], summarized: string[]) => {
    const summaries = composeQueueSummaries(w.database);
    const projection = createOperatorProjection({
      database: w.database, stateRoot: w.stateRoot, clock: w.clock,
      appVersion: APP_VERSION, descriptorSetHash: DESCRIPTOR_SET_HASH,
      ledger: createTransactionHistory(w.database.authority), descriptors: { resolve: () => undefined }, workerMembers: () => [],
      reader: {
        read(runId) { reads.push(runId); return service.read(runId); },
        list: input => service.list(input),
        withRunTreeSnapshot: (ids, read) => service.withRunTreeSnapshot(ids, read),
        summaries: { ...summaries, activity: unexpected, withSnapshot(read) {
          return summaries.withSnapshot(() => {
            const result = read();
            if (failAfterRead) {
              failAfterRead = false;
              throw new Error("synthetic snapshot validation failure");
            }
            return result;
          });
        }, queue(input) {
          const page = summaries.queue(input);
          summarized.push(...page.items.map(item => item.runId));
          return page;
        } },
      },
    });
    projection.rebuildFromTimeline();
    assert.equal(projection.health().state, "live");
    return projection;
  };
  const warmReads: string[] = [];
  const warmSummaries: string[] = [];
  const warm = makeProjection(warmReads, warmSummaries);
  const cold = makeProjection([], []);
  return { w, independent, target, service, warm, cold, warmReads, warmSummaries, rename, cancel, failNextSnapshot: () => { failAfterRead = true; } };
}

it.each(["rename", "new run", "state change", "removal", "unrelated write"] as const)(
  "matches a full day build after %s without rebuilding an independent row", async change => {
    const { w, independent, target, service, warm, cold, warmReads, warmSummaries, rename, cancel } = await fixture(change === "removal");
    const before = warm.buildDashboardDayWire(DAY);
    switch (change) {
      case "rename":
        assert.equal(rename().state, "applied");
        break;
      case "new run":
        queuedEventOf(w, { seed: 5 });
        break;
      case "state change":
        assert.equal(cancel().state, "applied");
        break;
      case "removal":
        assert.equal(service.delete({ commandId: uuidOf(6), runId: target.runId, expectedVersion: 2 }).state, "deleted");
        break;
      case "unrelated write":
        assert.equal(createDebugEventWriter({ repository: w.timeline, clock: w.clock, build: APP_VERSION }).emit({
          category: "boot", phase: "failed", correlationId: uuidOf(7), area: "integration", reason: "unrelated-write",
        }).state, "inserted");
        break;
    }
    if (change === "rename") {
      warm.refreshRun(target.runId);
      cold.refreshRun(target.runId);
    }
    warmReads.length = 0;
    warmSummaries.length = 0;
    const actual = warm.buildDashboardDayWire(DAY);
    assert.equal(JSON.stringify(actual), JSON.stringify(cold.buildDashboardDayWire(DAY)));
    if (change === "unrelated write") assert.equal(actual, before);
    else assert.notEqual(JSON.stringify(actual), JSON.stringify(before));
    assert.ok(!warmSummaries.includes(independent.runId), "an independent run summary was requested");
    assert.ok(!warmReads.includes(independent.runId), "an independent run was read while rebuilding its day");
  },
);

it.each(["shared worker change", "journal gap"] as const)("fully rebuilds a renamed day across a %s", async change => {
  const { w, independent, target, warm, cold, rename, warmSummaries } = await fixture();
  const before = warm.buildDashboardDayWire(DAY);
  assert.equal(rename().state, "applied");
  if (change === "shared worker change") {
    assert.equal(w.database.authority.workerPools.plan({ workflow: target.workflow, expectedVersion: 0, desiredWorkers: 1,
      requestedBy: "local-operator", now: target.ts }).state, "applied");
  } else {
    const peer = new DatabaseSync(join(w.stateRoot, "state.db"));
    try { peer.exec("DELETE FROM authority_changes WHERE seq=(SELECT max(seq) FROM authority_changes)"); }
    finally { peer.close(); }
  }
  warmSummaries.length = 0;
  const actual = warm.buildDashboardDayWire(DAY);
  assert.notDeepEqual(actual, before);
  assert.equal(JSON.stringify(actual), JSON.stringify(cold.buildDashboardDayWire(DAY)));
  assert.ok(warmSummaries.includes(independent.runId), "every summary must be revalidated");
});

it("retries the build when snapshot validation fails after constructing the patch", async () => {
  const { independent, warm, cold, rename, warmSummaries, failNextSnapshot } = await fixture();
  warm.buildDashboardDayWire(DAY);
  assert.equal(rename().state, "applied");
  failNextSnapshot();
  assert.throws(() => warm.buildDashboardDayWire(DAY), /synthetic snapshot validation failure/);
  warmSummaries.length = 0;
  assert.equal(JSON.stringify(warm.buildDashboardDayWire(DAY)), JSON.stringify(cold.buildDashboardDayWire(DAY)));
  assert.ok(warmSummaries.includes(independent.runId), "the failed snapshot never published its candidate");
});

it("revalidates another attempt of the changed item across consecutive patches", async () => {
  const { w, independent, target, warm, cold, warmSummaries, rename } = await fixture();
  const peer = runRecordOf({ seed: 8, attempt: 2 });
  w.database.authority.runs.enqueue({ ...peer, envelope: { ...peer.envelope, itemId: target.itemId } });
  warm.buildDashboardDayWire(DAY);
  assert.equal(rename().state, "applied");
  warm.buildDashboardDayWire(DAY);

  assert.equal(w.database.authority.runs.updatePresentation({ runId: peer.envelope.runId,
    expectedVersion: 1, displayName: "Second attempt", now: target.ts }).state, "applied");
  warmSummaries.length = 0;
  assert.equal(JSON.stringify(warm.buildDashboardDayWire(DAY)), JSON.stringify(cold.buildDashboardDayWire(DAY)));
  assert.ok(warmSummaries.includes(target.runId));
  assert.ok(warmSummaries.includes(peer.envelope.runId));
  assert.ok(!warmSummaries.includes(independent.runId));
});
