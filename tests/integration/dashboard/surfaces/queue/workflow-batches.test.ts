// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it } from "vitest";
import { QueueSurfaceWireSchema, type QueueSurfaceWire } from "../../../../../src/models/dashboard/projection.js";
import { QueuePanel, type QueueHandlers } from "../../../../../src/dashboard/surfaces/queue/queue.js";
import { queueBatches, visibleRunIds } from "../../../../../src/dashboard/surfaces/queue/queue-model.js";
import { FIXTURE_DAY, FIXTURE_NOW, uuidOf } from "../../../../support/fixtures/dashboard/fixture-identity.js";
import { FIXTURE_DAY_WIRE } from "../../../../support/fixtures/dashboard/fixture-queue.js";

const base = FIXTURE_DAY_WIRE.queueSurfaces.find((row) => row.surfaceKind === "single" && row.status === "queued");
if (base === undefined) throw new Error("batch fixture requires a queued single run");
function row(n: number, grouped = true, item = n, attempt = 1): QueueSurfaceWire {
  return QueueSurfaceWireSchema.parse({ ...base, runId: uuidOf(900 + n), itemId: uuidOf(800 + item), attempt,
    title: ["Alice", "Ben", "Cara", "Ben retry"][n - 1] ?? "Ben retry again",
    session: { state: "present", sessionId: uuidOf(700), presentation: { groupInQueue: grouped, version: 1, startedAt: base?.startedAt } },
  });
}
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
afterEach(async () => { if (root !== undefined) await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); });
async function render(rows: readonly QueueSurfaceWire[], handlers: QueueHandlers = { onSelect: () => undefined }, selectedRunId?: string): Promise<void> {
  if (root === undefined) { const host = document.createElement("div"); document.body.append(host); root = createRoot(host); }
  await act(async () => root?.render(createElement(QueuePanel, { surfaces: rows, handlers,
    state: { nowIso: FIXTURE_NOW, openWells: new Set<string>(), ...(selectedRunId === undefined ? {} : { selectedRunId }) },
    workflowLabelOf: () => "Separations", panelLabel: "Separations", day: FIXTURE_DAY,
  })));
}

describe("workflow batches in the queue", () => {
  it("shows every grouped batch item separately without publishing a presentation change", async () => {
    const rows = [row(1), row(2), row(3)];
    const changes: unknown[] = [];
    await render(rows, { onSelect: () => undefined, onSetBatchGrouping: async (batch, grouped) => { changes.push([batch.id, batch.version, grouped]); } });
    assert.equal(document.querySelectorAll('section[aria-label="Separations batch"]').length, 0);
    assert.equal(document.querySelectorAll('[data-demo-row-id]').length, 3);
    for (const name of ["Alice", "Ben", "Cara"]) assert.ok(document.body.textContent?.includes(name));
    assert.ok(!document.body.textContent?.includes("Show separately"));
    assert.deepEqual(changes, []);
  });
  it("keeps separate and single-item batches flat without regroup controls", async () => {
    const changes: boolean[] = [];
    await render([row(1, false), row(2, false), row(3, false)], { onSelect: () => undefined, onSetBatchGrouping: async (_, grouped) => { changes.push(grouped); } });
    assert.equal(document.querySelectorAll('[data-demo-row-id]').length, 3);
    assert.ok(!document.body.textContent?.includes("Group batch"));
    assert.deepEqual(changes, []);
    await render([row(1)]);
    assert.equal(document.querySelectorAll('section[aria-label="Separations batch"]').length, 0);
    assert.equal(document.querySelectorAll('[data-demo-row-id]').length, 1);
    assert.ok(document.body.textContent?.includes("Alice"));
  });
  it("counts a retry once and puts its previous attempts in the footer dropdown", async () => {
    const rows = [row(1), row(2), row(3), row(4, true, 2, 2)];
    const batch = queueBatches(rows)[0];
    assert.ok(batch);
    assert.equal(batch.members.length, 3);
    assert.deepEqual(batch.history.map((entry) => entry.runId), [row(2).runId]);
    assert.deepEqual(visibleRunIds(rows), [row(1).runId, row(2).runId, row(4).runId, row(3).runId]);
    await render(rows, undefined, row(2).runId);
    assert.equal(document.querySelectorAll('[data-demo-row-id]').length, 3);
    assert.equal(document.querySelectorAll(`[data-demo-row-id="${String(row(2).runId)}"]`).length, 1);
    assert.equal(document.querySelectorAll(`[data-demo-row-id="${String(row(4).runId)}"]`).length, 0);
    const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="Attempts for Ben"]');
    assert.ok(trigger);
    await act(async () => trigger.click());
    assert.ok(document.body.querySelector('[role="menuitemradio"][aria-checked="true"]'));
    assert.ok(!document.body.textContent?.includes("Attempts ·"));
  });
  it("keeps the focused attempt menu item when a newer retry arrives out of order", async () => {
    const rows = [row(1), row(2), row(3), row(4, true, 2, 2)];
    await render(rows, undefined, row(2).runId);
    const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="Attempts for Ben"]');
    assert.ok(trigger);
    await act(async () => trigger.click());
    const oldAttempt = document.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]');
    assert.ok(oldAttempt);
    await act(async () => oldAttempt.focus());
    await render([row(5, true, 2, 3), ...rows], undefined, row(2).runId);
    const selected = document.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]');
    assert.equal(document.activeElement, selected);
    assert.match(selected?.textContent ?? "", /#1.*Queued/u);
    assert.equal(document.querySelector('[aria-label="Attempts for Ben"]')?.getAttribute("aria-expanded"), "true");
    assert.equal(document.querySelectorAll('[data-demo-row-id]').length, 3);
    assert.equal(document.querySelectorAll(`[data-demo-row-id="${String(row(2).runId)}"]`).length, 1);
  });
  it("selects separate batch items directly without a disclosure", async () => {
    const rows = [row(1), row(2)];
    const selected: string[] = [];
    await render(rows, { onSelect: id => { selected.push(id); } }, row(1).runId);
    const second = document.querySelector<HTMLElement>(`[data-demo-row-id="${String(row(2).runId)}"]`);
    assert.ok(second);
    await act(async () => second.click());
    assert.deepEqual(selected, [String(row(2).runId)]);
    await render(rows, undefined, row(2).runId);
    assert.equal(document.querySelectorAll('[data-demo-row-id][aria-pressed="true"]').length, 1);
    assert.equal(second.getAttribute("aria-pressed"), "true");
  });
  it("does not invoke grouping commands for either served preference", async () => {
    for (const grouped of [true, false]) {
      let calls = 0;
      await render([row(1, grouped), row(2, grouped)], { onSelect: () => undefined, onSetBatchGrouping: async () => { calls++; throw new Error("Connection lost"); } });
      assert.equal(document.querySelectorAll('[data-demo-row-id]').length, 2);
      assert.equal(document.querySelectorAll('button[aria-label*="Group batch"]').length, 0);
      assert.equal(document.querySelectorAll('[role="alert"]').length, 0);
      assert.equal(calls, 0);
    }
  });
  it("navigates in the visible status bands instead of synthetic batch order", () => {
    const first = row(1);
    const standalone = QueueSurfaceWireSchema.parse({ ...row(3), session: { state: "absent", reason: "historical run" }, status: "running" });
    const second = QueueSurfaceWireSchema.parse({ ...row(2), status: "failed" });
    assert.deepEqual(visibleRunIds([first, standalone, second]), [standalone.runId, first.runId, second.runId]);
  });
  it("keeps unavailable historical grouping separate and refuses conflicting batch facts", () => {
    const old = QueueSurfaceWireSchema.parse({ ...row(1), session: { state: "present", sessionId: uuidOf(700) } });
    assert.equal(queueBatches([old]).length, 0);
    assert.throws(() => queueBatches([row(1), row(2, false)]), /disagree/u);
    assert.throws(() => queueBatches([row(1), row(2, true, 1)]), /duplicate item attempt/u);
  });
});
