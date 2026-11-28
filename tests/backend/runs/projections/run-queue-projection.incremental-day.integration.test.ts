import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, it, vi } from "vitest";
import { createOperatorProjection } from "../../../../src/backend/app/composition/dashboard/queue.js";
import { composeQueueSummaries } from "../../../../src/backend/app/composition/dashboard/queue-summaries.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { createDebugEventWriter } from "../../../../src/backend/logs/debug-events.js";
import { executeSettingsCommand } from "../../../../src/backend/runs/commands/settings-command.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createTransactionHistory } from "../../../../src/backend/storage/sqlite/transaction-history.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint, type SettingsPatch } from "../../../../src/models/config/settings.js";
import { APP_VERSION, DAY, DESCRIPTOR_SET_HASH, notificationRecordOf, queuedEventOf, runRecordOf, uuidOf } from "../../../support/helpers/backend/dashboard-harness.js";
import { runningWorkerView } from "../../../support/helpers/backend/fake-worker-port.js";
import { createRunQueueProjectionTestWorld } from "../../../support/helpers/backend/run-queue-projection-world.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { createCredentialStore } from "../../../support/helpers/synthetic-storage-admission.js";

const { world, cleanup } = createRunQueueProjectionTestWorld();
afterEach(cleanup);

async function fixture({ cancelledTarget = false, withWorkerAndNotices = false } = {}) {
  const w = await world();
  const descriptor = withWorkerAndNotices ? personLookupDescriptor : undefined;
  const independent = queuedEventOf(w, { seed: 1, descriptor });
  const target = queuedEventOf(w, { seed: 2, descriptor });
  const workers: ReturnType<typeof runningWorkerView>[] = [];
  if (withWorkerAndNotices) {
    const { workflow, ts } = independent;
    w.database.authority.workerPools.plan({ workflow, expectedVersion: 0, desiredWorkers: 1, requestedBy: "local-operator", now: ts });
    workers.push(runningWorkerView(w.database.authority.workerSlots.allocate({ workflow, poolIndex: 1, now: ts })));
    for (const seed of [1, 2]) {
      w.database.authority.notifications.create(notificationRecordOf({ seed, title: "Synthetic notice", lastSeenAt: ts }));
    }
  }
  const unexpected = (): never => assert.fail("unexpected publication or generated id");
  const service = new RunRecordService({ database: w.database, clock: w.clock, ids: { uuid: unexpected }, publishQueued: unexpected });
  const cancel = () => service.transition({ commandId: uuidOf(3), runId: target.runId, expectedVersion: 1,
    lifecycle: { state: "terminal", outcome: "cancelled", endedAt: w.clock.now().toISOString() } });
  const rename = () => service.transition({ commandId: uuidOf(4), runId: target.runId, expectedVersion: 1, displayName: "New title" });
  if (cancelledTarget) assert.equal(cancel().state, "applied");

  let failAfterRead = false;
  const makeProjection = (reads: string[], summarized: string[], counts: string[]) => {
    const summaries = composeQueueSummaries(w.database);
    const projection = createOperatorProjection({
      database: w.database, stateRoot: w.stateRoot, clock: w.clock,
      appVersion: APP_VERSION, descriptorSetHash: DESCRIPTOR_SET_HASH,
      ledger: createTransactionHistory(w.database.authority), descriptors: { resolve: () => descriptor }, workerMembers: () => workers,
      reader: {
        read(runId) { reads.push(runId); return service.read(runId); },
        list: input => service.list(input),
        withRunTreeSnapshot: (ids, read) => service.withRunTreeSnapshot(ids, read),
        summaries: { ...summaries, activity: unexpected, dayCounts(from, to) {
          counts.push(from);
          return summaries.dayCounts(from, to);
        }, withSnapshot(read) {
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
  const warmCounts: string[] = [];
  const warm = makeProjection(warmReads, warmSummaries, warmCounts);
  const cold = makeProjection([], [], []);
  return { w, independent, target, workers, service, warm, cold, warmReads, warmSummaries, warmCounts, rename, cancel, failNextSnapshot: () => { failAfterRead = true; } };
}

it.each(["rename", "new run", "state change", "removal", "unrelated write"] as const)(
  "matches a full day build after %s without rebuilding an independent row", async change => {
    const { w, independent, target, service, warm, cold, warmReads, warmSummaries, rename, cancel } = await fixture({ cancelledTarget: change === "removal" });
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

it("reuses a day after a preferences save and rebuilds it after a runtime config change", async () => {
  const { w, warm, cold, warmSummaries } = await fixture();
  const { database, clock, stateRoot } = w;
  const host = hostConfigFacts({});
  const settings = createSettingsApplicationExecutor(value => resolveConfigWithProvenance(value, host, clock), createCredentialStore({ stateRoot }));
  const save = (patch: SettingsPatch) => {
    const current = database.authority.runtimeConfig.get();
    assert.ok(current);
    const result = executeSettingsCommand({ authority: database, clock, ids: { uuid: randomUUID }, settings }, {
      commandId: randomUUID(), family: "settings", type: "apply-settings", source: "settings-surface",
      requestedBy: "local-operator", requestedAt: clock.now().toISOString(), target: { expectedRevision: current.settingsRevision },
      payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch },
    });
    assert.equal(result.state, "applied");
  };
  save({ "browser.headless": { set: true } });
  const before = warm.buildDashboardDayWire(DAY);
  const fingerprint = database.authority.runtimeConfig.get()?.configFingerprint;
  warmSummaries.length = 0;

  save({ "preferences.notifications.sound": { set: "none" } });
  assert.equal(database.authority.runtimeConfig.get()?.configFingerprint, fingerprint);
  assert.equal(warm.buildDashboardDayWire(DAY), before);
  assert.deepEqual(warmSummaries, []);

  save({ "browser.headless": { set: false } });
  assert.notEqual(database.authority.runtimeConfig.get()?.configFingerprint, fingerprint);
  assert.deepEqual(warm.buildDashboardDayWire(DAY), cold.buildDashboardDayWire(DAY));
  assert.ok(warmSummaries.length > 0, "the day was rebuilt for the new runtime config");
});

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

it("reads one workflow page for changed runs separated by an independent workflow", async () => {
  const { w, target, warm, cold, rename } = await fixture();
  const independent = queuedEventOf(w, { seed: 3, workflow: "separations" });
  const second = queuedEventOf(w, { seed: 4 });
  warm.buildDashboardDayWire(DAY);
  assert.equal(rename().state, "applied");
  assert.equal(w.database.authority.runs.updatePresentation({ runId: second.runId, expectedVersion: 1,
    displayName: "Also renamed", now: target.ts }).state, "applied");
  const queries = vi.spyOn(w.database, "queryRunSummaries");
  const patched = warm.buildDashboardDayWire(DAY);
  const workflows = queries.mock.calls.map(([query]) => query.workflow);
  queries.mockRestore();
  assert.equal(JSON.stringify(patched), JSON.stringify(cold.buildDashboardDayWire(DAY)));
  assert.ok(patched.queueSurfaces.some(row => row.runId === independent.runId));
  assert.deepEqual(workflows, [target.workflow]);
});

it("shares the parent's review lookup with its member links within each rebuilt day", async () => {
  const { w, target, warm, cold, warmReads, rename } = await fixture();
  const member = queuedEventOf(w, { seed: 3, parentSeed: 2, shape: "operation-member" });
  warm.buildDashboardDayWire(DAY);
  assert.equal(rename().state, "applied");
  warmReads.length = 0;
  const patched = warm.buildDashboardDayWire(DAY);
  assert.equal(JSON.stringify(patched), JSON.stringify(cold.buildDashboardDayWire(DAY)));
  const parentRow = patched.queueSurfaces.find(row => row.runId === target.runId);
  const memberRow = patched.queueSurfaces.find(row => row.runId === member.runId);
  assert.ok(parentRow && memberRow?.parent);
  assert.equal(memberRow.parent.panelKind, parentRow.panelKind);
  // One read supplies the row and one admits the current review evidence.
  assert.equal(warmReads.filter(id => id === target.runId).length, 2);
});

it("reuses independent rows and derives the selected day count during a rename", async () => {
  const { w, warm, cold, warmCounts, independent, warmReads, warmSummaries, rename } = await fixture({ withWorkerAndNotices: true });
  queuedEventOf(w, { seed: 5, shape: "operation", descriptor: personLookupDescriptor });
  const member = queuedEventOf(w, { seed: 6, parentSeed: 5, shape: "operation-member", descriptor: personLookupDescriptor });
  warm.buildDashboardDayWire(DAY);
  assert.equal(rename().state, "applied");
  warmCounts.length = warmReads.length = warmSummaries.length = 0;
  const after = warm.buildDashboardDayWire(DAY);
  assert.equal(JSON.stringify(after), JSON.stringify(cold.buildDashboardDayWire(DAY)));
  assert.equal("notifications" in after, false);
  assert.deepEqual(warmCounts, []);
  assert.ok(!warmSummaries.includes(independent.runId));
  assert.ok(!warmReads.includes(independent.runId));
  assert.ok(!warmSummaries.includes(member.runId));
  assert.ok(!warmReads.includes(member.runId));
});

it("rebuilds worker-sensitive rows if a live worker exits during a rename", async () => {
  const { warm, cold, independent, workers, rename } = await fixture({ withWorkerAndNotices: true });
  const before = warm.buildDashboardDayWire(DAY);
  assert.equal(before.queueSurfaces.find(row => row.runId === independent.runId)?.notStarting, undefined);
  assert.equal(rename().state, "applied");
  const [worker] = workers;
  workers[0] = { ...worker, version: worker.version + 1, state: "exited",
    exit: { code: 1, signal: null, at: independent.ts, outcome: "crashed", settlement: "settled" } };
  const after = warm.buildDashboardDayWire(DAY);
  assert.equal(JSON.stringify(after), JSON.stringify(cold.buildDashboardDayWire(DAY)));
  assert.equal(after.queueSurfaces.find(row => row.runId === independent.runId)?.notStarting?.code, "NO_WORKER");
});

it("updates both dates when a rename coincides with an insertion on another day", async () => {
  const { w, warm, cold, warmCounts, rename } = await fixture();
  warm.buildDashboardDayWire(DAY);
  assert.equal(rename().state, "applied");
  queuedEventOf(w, { seed: 5, enqueuedAt: "2026-08-04T17:00:00.000Z" });
  warmCounts.length = 0;
  const after = warm.buildDashboardDayWire(DAY);
  assert.equal(JSON.stringify(after), JSON.stringify(cold.buildDashboardDayWire(DAY)));
  assert.deepEqual(warmCounts, ["2026-08-04"]);
  assert.deepEqual(after.monthCounts, [{ day: DAY, count: 2 }, { day: "2026-08-04", count: 1 }]);
});
