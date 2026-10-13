// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it } from "vitest";
import { useQueueWiring } from "../../../src/dashboard/state/queue-wiring-adapter.js";
import { FIXTURE_DAY_WIRE } from "../../support/fixtures/dashboard/fixture-queue.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
it("owns Queue state/actions and keeps refused workflow jumps from navigating", async () => {
  const row = FIXTURE_DAY_WIRE.queueSurfaces[0]; assert.ok(row);
  const selected: string[] = [], scopes: string[] = [], wells: ReadonlySet<string>[] = [], bulk: ReadonlySet<string>[] = [];
  let wiring: ReturnType<typeof useQueueWiring> | undefined;
  const input = {
    allRows: FIXTURE_DAY_WIRE.queueSurfaces, rows: FIXTURE_DAY_WIRE.queueSurfaces, activeWorkflowId: row.workflowId,
    filter: ["all"] as const, selectedRunId: row.runId, openWells: new Set<string>(), selectMode: true, bulkIds: new Set<string>(),
    nowIso: row.updatedAt, workflowLabelOf: (id: string) => id, selectRun: (id: string) => selected.push(id),
    setActiveWorkflowId: (id: string) => { scopes.push(id); return false; }, onWells: (next: ReadonlySet<string>) => wells.push(next),
    onBulkIds: (next: ReadonlySet<string>) => bulk.push(next), setBatchGrouping: async () => undefined,
    exitQueueSelection: () => undefined, runPreviewAction: () => undefined, runQueueAction: () => undefined,
  };
  function Probe() { wiring = useQueueWiring(input); return null; }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Probe)));
    assert.ok(wiring); assert.equal(wiring.viewState.selectedRunId, row.runId);
    assert.equal(wiring.actionsOf(row), row.actions);
    assert.ok(wiring.surfaces.every(surface => surface.workflowId === row.workflowId));
    wiring.queueHandlers.onToggleWell?.(row.runId); wiring.queueHandlers.onToggleBulk?.(row.runId);
    assert.deepEqual([...wells[0]], [row.runId]); assert.deepEqual([...bulk[0]], [row.runId]);
    wiring.queueHandlers.onOpenParent?.(row.runId);
    assert.deepEqual(scopes, [row.workflowId]); assert.deepEqual(selected, []);
    wiring.queueHandlers.onSelect(row.runId); assert.deepEqual(selected, [row.runId]);
    const first = wiring;
    await act(async () => root.render(createElement(Probe)));
    assert.equal(wiring.viewState, first.viewState); assert.equal(wiring.queueHandlers, first.queueHandlers);
  } finally { await act(async () => root.unmount()); }
});
