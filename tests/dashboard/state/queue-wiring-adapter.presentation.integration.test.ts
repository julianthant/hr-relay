// @vitest-environment jsdom
import { createCommandKernelTestWorld } from "../../support/helpers/backend/command-kernel-harness.js";
import { planStart } from "../../../src/backend/runs/start/plan.js";
import { appliedRunIds } from "../../support/fixtures/operator-command-fixtures.js";
import { RunRecordService } from "../../../src/backend/runs/lifecycle/run-record-service.js";
import { createOperatorProjection } from "../../../src/backend/app/composition/dashboard/operator.js";
import { createTransactionHistory } from "../../../src/backend/storage/sqlite/transaction-history.js";
import { FingerprintSchema } from "../../../src/rules/identity/ids.js";
import { QueuePanel } from "../../../src/dashboard/surfaces/queue/queue.js";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, it } from "vitest";
import { useQueueWiring } from "../../../src/dashboard/state/queue-wiring-adapter.js";
import { groupQueueAttempts } from "../../../src/dashboard/surfaces/queue/queue-model.js";
import { createRunQueueProjectionTestWorld } from "../../support/helpers/backend/run-queue-projection-world.js";
import { personLookupDescriptor } from "../../support/helpers/registered-workflows.js";
import { seedPersonLookupPresentation } from "../../support/fixtures/person-lookup-presentation.js";
import { uuidOf } from "../../support/helpers/backend/dashboard-harness.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const { world, cleanup } = createRunQueueProjectionTestWorld();
afterEach(cleanup);
it("keeps attempts within the selected day and selects the exact run", async () => {
  const w = await world({ descriptors: { resolve: () => personLookupDescriptor } });
  for (let attempt = 1; attempt <= 7; attempt++) seedPersonLookupPresentation(w, {
    seed: 80 + attempt, attempt, itemId: uuidOf(5081),
    enqueuedAt: attempt <= 2 ? `2026-07-31T17:0${attempt}:00.000Z` : `2026-08-03T17:0${attempt}:00.000Z`,
  });
  const day = w.projection.buildDashboardDayWire("2026-08-03");
  const current = day.queueSurfaces;
  const selected: unknown[] = [];
  let wiring: ReturnType<typeof useQueueWiring> | undefined;
  function Probe() {
    wiring = useQueueWiring({ allRows: current, attemptHistory: day.attemptHistory, rows: current.filter(row => row.attempt === 7),
      activeWorkflowId: "person-lookup", filter: ["all"], selectedRunId: uuidOf(87), openWells: new Set(),
      nowIso: "2026-08-03T18:00:00.000Z",
      selectRun: (runId, partitionDay) => { selected.push([runId, partitionDay]); }, openRelatedRun: target => { selected.push([target.runId,target.partitionDay]); },
      onWells: () => undefined, setBatchGrouping: async () => undefined,
      runQueueAction: () => undefined });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Probe)));
    assert.ok(wiring);
    const groups = groupQueueAttempts(wiring.surfaces);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].attempts.map(row => row.attempt).toSorted((a, b) => a - b), [3, 4, 5, 6, 7]);
    assert.deepEqual([...groups[0].dayNumberByRunId.values()], [1, 2, 3, 4, 5]);
    wiring.queueHandlers.onSelect(uuidOf(83));
    assert.deepEqual(selected, [[uuidOf(83), undefined]]);
  } finally { await act(async () => root.unmount()); }
});

it("mounts a real multi-submission Lookup start as one presentation without changing native roots or delegation", async () => {
  const native = createCommandKernelTestWorld();
  const h = await native.createHarness(undefined, { descriptors: [personLookupDescriptor] });
  const reader = new RunRecordService({ database: h.database, clock: h.clock, ids: h.plannerIds, publishQueued: () => undefined });
  const projection = createOperatorProjection({ database: h.database, stateRoot: h.stateRoot, clock: h.clock,
    appVersion: "0.1.0", descriptorSetHash: FingerprintSchema.parse("a".repeat(64)),
    descriptors: { resolve: () => personLookupDescriptor }, ledger: createTransactionHistory(h.database.authority), reader });
  const start = (eids: readonly string[]) => {
    const config = h.database.authority.runtimeConfig.get(); assert.ok(config);
    const plan = planStart({ authority: h.database, clock: h.clock, ids: h.plannerIds, planTtlMs: 600_000 }, {
      descriptor: personLookupDescriptor, submissions: eids.map(emplId => ({ emplId })), dryRun: false, priority: "bulk", shape: "single",
      configFingerprint: config.configFingerprint, configSnapshotId: config.configSnapshotId, plannedBy: "local-operator",
    });
    assert.equal(plan.refused.length, 0);
    assert.equal(h.database.authority.startPlans.create(plan).state, "inserted");
    return appliedRunIds(h.kernel.execute(native.startCommand(plan)));
  };
  let snapshot = projection.buildDashboardDayWire(h.clock.now().toISOString().slice(0, 10));
  const selected: string[] = [];
  let current: ReturnType<typeof useQueueWiring> | undefined;
  function MountedQueue() {
    current = useQueueWiring({ allRows: snapshot.queueSurfaces, attemptHistory: snapshot.attemptHistory, rows: snapshot.queueSurfaces,
      activeWorkflowId: "person-lookup", filter: ["all"], selectedRunId: selected.at(-1), openWells: new Set(),
      nowIso: h.clock.now().toISOString(), selectRun: id => { selected.push(id); }, openRelatedRun: () => undefined,
      onWells: () => undefined, setBatchGrouping: async () => undefined,
      runQueueAction: () => undefined });
    return createElement(QueuePanel, { surfaces: current.surfaces, state: current.viewState, handlers: current.queueHandlers,
      actionsOf: current.actionsOf, outcomes: current.outcomes, workflowLabelOf: () => "Person Lookup", panelLabel: "Person Lookup", day: snapshot.day });
  }
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    const ids = start(["10800000", "10800001", "10800002"]);
    assert.equal(ids.length, 3);
    const before = ids.map(id => h.database.authority.runs.get(id));
    const sessionId = before[0]?.sessionId; assert.ok(sessionId);
    assert.equal(h.database.authority.runSessions.get(sessionId)?.groupInQueue, true);
    for (const run of before) {
      assert.ok(run); assert.equal(run.sessionId, sessionId); assert.equal(run.envelope.shape, "single");
      assert.equal(run.envelope.parent, undefined);
      assert.deepEqual(h.database.authority.runs.listChildren(run.envelope.runId), []);
    }
    const day = h.clock.now().toISOString().slice(0, 10);
    snapshot = projection.buildDashboardDayWire(day);
    await act(async () => root.render(createElement(MountedQueue)));
    assert.equal(host.querySelectorAll('[data-queue-batch-id]').length, 1);
    assert.equal(host.querySelectorAll('tr[data-demo-row-id]').length, 3);
    for (const id of ids) {
      const line = host.querySelector<HTMLTableRowElement>(`tr[data-demo-row-id="${id}"]`); assert.ok(line);
      await act(async () => line.cells[1].click());
      assert.equal(selected.at(-1), id);
      assert.ok(reader.read(id).state === "present");
    }
    await act(async () => root.render(createElement(MountedQueue)));
    assert.equal(host.querySelector(`tr[data-demo-row-id="${ids[2]}"] button`)?.getAttribute("aria-pressed"), "true");
    assert.deepEqual(ids.map(id => h.database.authority.runs.get(id)), before);
    for (const id of ids) {
      const run = h.database.authority.runs.get(id); assert.ok(run);
      assert.equal(h.kernel.execute(native.runCommand("cancel", id, run.version)).state, "applied");
    }
    const next = start(["10800000", "10800001"]);
    const one = start(["10800003"]);
    snapshot = projection.buildDashboardDayWire(day);
    await act(async () => root.render(createElement(MountedQueue)));
    assert.equal(host.querySelectorAll('[data-queue-batch-id]').length, 2);
    assert.equal(host.querySelectorAll('tr[data-demo-row-id]').length, 5);
    assert.ok(host.querySelector(`div[data-demo-row-id="${one[0]}"]`));
    for (const id of next) assert.ok(host.querySelector(`tr[data-demo-row-id="${id}"]`));
    assert.equal(h.database.authority.runSessions.list().length, 3);
    assert.equal(snapshot.queueSurfaces.length, 6);
  } finally {
    await act(async () => root.unmount()); host.remove();
    for (const database of native.openDatabases) database.close();
    for (const profile of native.profiles) await profile.close();
  }
});
