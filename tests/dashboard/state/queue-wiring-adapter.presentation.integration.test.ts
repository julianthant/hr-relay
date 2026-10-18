// @vitest-environment jsdom
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
  const w = world({ descriptors: { resolve: () => personLookupDescriptor } });
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
      activeWorkflowId: "person-lookup", filter: ["all"], selectedRunId: uuidOf(87), openWells: new Set(), selectMode: false, bulkIds: new Set(),
      nowIso: "2026-08-03T18:00:00.000Z", workflowLabelOf: id => id,
      selectRun: (runId, partitionDay) => { selected.push([runId, partitionDay]); }, setActiveWorkflowId: () => true,
      onWells: () => undefined, onBulkIds: () => undefined, setBatchGrouping: async () => undefined,
      exitQueueSelection: () => undefined, runQueueAction: () => undefined });
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
