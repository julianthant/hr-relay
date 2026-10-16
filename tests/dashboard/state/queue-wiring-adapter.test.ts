// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it } from "vitest";
import { useQueueWiring } from "../../../src/dashboard/state/queue-wiring-adapter.js";
import { FIXTURE_DAY_WIRE } from "../../support/fixtures/dashboard/fixture-queue.js";
import type { ActionDescriptorWire } from "../../../src/models/dashboard/actions.js";
import { QueueSurfaceWireSchema } from "../../../src/models/dashboard/projection.js";
import { RowRevisionSchema } from "../../../src/models/dashboard/primitives.js";

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
    exitQueueSelection: () => undefined, runQueueAction: () => undefined,
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

type WiringInput = Parameters<typeof useQueueWiring>[0];
function mountWiring(overrides: Partial<WiringInput> = {}) {
  const row = FIXTURE_DAY_WIRE.queueSurfaces[0]; assert.ok(row);
  let input: WiringInput = {
    allRows: FIXTURE_DAY_WIRE.queueSurfaces, rows: FIXTURE_DAY_WIRE.queueSurfaces.filter(surface => surface.workflowId === row.workflowId), activeWorkflowId: row.workflowId,
    filter: ["all"], selectedRunId: row.runId, openWells: new Set(), selectMode: false, bulkIds: new Set(),
    nowIso: row.updatedAt, workflowLabelOf: (id) => id, selectRun: () => undefined,
    setActiveWorkflowId: () => true, onWells: () => undefined, onBulkIds: () => undefined,
    setBatchGrouping: async () => undefined, exitQueueSelection: () => undefined,
    runQueueAction: () => undefined,
    ...overrides,
  };
  let wiring: ReturnType<typeof useQueueWiring> | undefined;
  function Probe() { wiring = useQueueWiring(input); return null; }
  const root = createRoot(document.createElement("div"));
  return {
    async draw(next: Partial<WiringInput> = {}) {
      input = { ...input, ...next };
      await act(async () => root.render(createElement(Probe)));
      assert.ok(wiring);
      return wiring;
    },
    async close() { await act(async () => root.unmount()); },
  };
}

it("uses served rows without local overlays or fictional actions and retains stable props", async () => {
  const mounted = mountWiring();
  try {
    const first = await mounted.draw();
    const expected = FIXTURE_DAY_WIRE.queueSurfaces.filter(row => row.workflowId === first.viewState.panelWorkflowId);
    assert.deepEqual(first.surfaces, expected);
    assert.ok(first.surfaces.every((row, index) => row === expected[index]));
    assert.equal(first.queueHandlers.onPreviewAction, undefined);
    const repeated = await mounted.draw();
    assert.equal(repeated.surfaces, first.surfaces);
    assert.equal(repeated.queueHandlers, first.queueHandlers);
    const unbacked = QueueSurfaceWireSchema.parse({ ...expected[0], runId: "00000000-8000-4000-8000-000000000001" });
    const changedPreview = await mounted.draw({ rows: [...expected.map(row => ({ ...row, title: "Fictional overlay", rowRevision: RowRevisionSchema.parse(row.rowRevision + 1) })), unbacked] });
    assert.deepEqual(changedPreview.surfaces, expected);
    assert.ok(changedPreview.surfaces.every((row, index) => row === expected[index]));
    assert.equal(changedPreview.queueHandlers, first.queueHandlers);
    assert.equal(changedPreview.viewState, first.viewState);
    assert.equal(changedPreview.actionsOf, first.actionsOf);
    const clock = await mounted.draw({ nowIso: "2026-10-14T12:00:00.000Z", selectedRunId: undefined });
    assert.equal(clock.surfaces, changedPreview.surfaces);
    assert.equal(clock.queueHandlers, first.queueHandlers);
    assert.equal(clock.parentOf, first.parentOf);
    assert.equal(clock.viewState.selectedRunId, undefined);
    const unavailable = await mounted.draw({ allRows: undefined, rows: expected });
    assert.deepEqual(unavailable.surfaces, []);
    assert.equal(unavailable.parentOf(expected[0].runId), undefined);
    assert.equal(unavailable.queueHandlers.onPreviewAction, undefined);
  } finally { await mounted.close(); }
});

it("preserves caller visibility and ordering instead of admitting every backend workflow", async () => {
  const first = FIXTURE_DAY_WIRE.queueSurfaces[0]; assert.ok(first);
  const excluded = QueueSurfaceWireSchema.parse({ ...first, workflowId: "separations", runId: "00000000-8000-4000-8000-000000000001" });
  const included = FIXTURE_DAY_WIRE.queueSurfaces.filter(row => row.workflowId === first.workflowId).toReversed();
  const mounted = mountWiring({ rows: included, allRows: [...FIXTURE_DAY_WIRE.queueSurfaces, excluded] });
  try {
    const visible = await mounted.draw();
    assert.deepEqual(visible.surfaces, included);
    assert.ok(visible.surfaces.every((row, index) => row === included[index]));
    const hidden = await mounted.draw({ activeWorkflowId: excluded.workflowId });
    assert.deepEqual(hidden.surfaces, []);
    const deleted = await mounted.draw({ activeWorkflowId: first.workflowId, rows: included.slice(1) });
    assert.deepEqual(deleted.surfaces, included.slice(1));
  } finally { await mounted.close(); }
});

it("retires Archive while preserving admitted footer descriptors and exact command targets", async () => {
  const base = FIXTURE_DAY_WIRE.queueSurfaces[0]; assert.ok(base);
  const admitted: ActionDescriptorWire = { kind: "command", key: "cancel", command: "cancel", label: "Cancel",
    intent: "neutral", placement: ["footer", "menu"], expectedVersion: base.rowRevision };
  const archive: ActionDescriptorWire = { ...admitted, key: "archive", command: "archive", label: "Archive", icon: "archive" };
  const row = { ...base, actions: [archive, admitted] };
  const sent: unknown[] = [];
  const runQueueAction: WiringInput["runQueueAction"] = (action, target) => { sent.push([action, target]); };
  const mounted = mountWiring({ allRows: [row], runQueueAction });
  try {
    const wiring = await mounted.draw();
    const served = wiring.surfaces[0]; assert.ok(served);
    assert.deepEqual(wiring.actionsOf(served), [admitted]);
    assert.equal(wiring.actionsOf(served)[0], admitted);
    assert.deepEqual(row.actions, [archive, admitted]);
    assert.equal(wiring.queueHandlers.onAction, runQueueAction);
    wiring.queueHandlers.onAction?.(admitted, { runId: served.runId, expectedVersion: served.rowRevision });
    assert.deepEqual(sent, [[admitted, { runId: row.runId, expectedVersion: row.rowRevision }]]);
    const empty = await mounted.draw({ allRows: [{ ...base, actions: [] }] });
    assert.deepEqual(empty.actionsOf(empty.surfaces[0]), []);
    assert.equal(empty.queueHandlers.onPreviewAction, undefined);
  } finally { await mounted.close(); }
});

it("keeps parent and linked navigation refusal and exact cross-day identity", async () => {
  const row = FIXTURE_DAY_WIRE.queueSurfaces[0]; assert.ok(row);
  const linked = QueueSurfaceWireSchema.parse({ ...row, linkedRuns: [{ runId: "00000000-8000-4000-8000-000000000001", partitionDay: "2026-10-13",
    workflowId: row.workflowId, label: "Linked child", panelKind: row.panelKind, status: row.status }] }).linkedRuns[0];
  assert.ok(linked);
  const selected: unknown[] = [], scopes: string[] = [];
  const mounted = mountWiring({ selectRun: (runId, day) => { selected.push([runId, day]); },
    setActiveWorkflowId: (id) => { scopes.push(id); return false; } });
  try {
    const refused = await mounted.draw();
    refused.queueHandlers.onOpenParent?.(row.runId);
    refused.queueHandlers.onOpenLinked?.(linked);
    assert.deepEqual(scopes, [row.workflowId, linked.workflowId]);
    assert.deepEqual(selected, []);
    const accepted = await mounted.draw({ setActiveWorkflowId: () => true });
    accepted.queueHandlers.onOpenParent?.(row.runId);
    accepted.queueHandlers.onOpenLinked?.(linked);
    assert.deepEqual(selected, [[row.runId, undefined], [linked.runId, linked.partitionDay]]);
  } finally { await mounted.close(); }
});

it("takes outcome maps only from visible canonical rows and refreshes/removes them", async () => {
  const row = FIXTURE_DAY_WIRE.queueSurfaces[0]; assert.ok(row);
  const canonical = { ...row, outcome: { label: "Active", tone: "success" as const } };
  const hidden = QueueSurfaceWireSchema.parse({ ...canonical, runId: "00000000-8000-4000-8000-000000000002" });
  const overlay = { ...row, outcome: { label: "Fictional", tone: "warning" as const } };
  const mounted = mountWiring({ rows: [overlay], allRows: [canonical, hidden] });
  try {
    const first = await mounted.draw();
    assert.deepEqual([...first.outcomes], [[row.runId, canonical.outcome]]);
    assert.equal(first.outcomes.get(row.runId), canonical.outcome);
    assert.equal((await mounted.draw()).outcomes, first.outcomes);
    const refreshed = await mounted.draw({ allRows: [{ ...canonical, outcome: { label: "Inactive", tone: "neutral" } }, hidden] });
    assert.deepEqual([...refreshed.outcomes], [[row.runId, { label: "Inactive", tone: "neutral" }]]);
    assert.deepEqual([...(await mounted.draw({ allRows: [row, hidden] })).outcomes], []);
    assert.deepEqual([...(await mounted.draw({ allRows: [canonical, hidden], rows: [] })).outcomes], []);
    assert.deepEqual([...(await mounted.draw({ rows: [overlay], activeWorkflowId: "other-workflow" })).outcomes], []);
    assert.deepEqual([...(await mounted.draw({ allRows: undefined, activeWorkflowId: row.workflowId })).outcomes], []);
  } finally { await mounted.close(); }
});
