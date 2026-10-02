// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it } from "vitest";
import { QueueSurfaceWireSchema, type QueueSurfaceWire } from "../../../src/domain/dashboard/projection.js";
import { QueuePanel, type QueueHandlers } from "../../../src/dashboard/surfaces/queue.js";
import { RunSessionRecordSchema } from "../../../src/domain/run/session.js";
import { applyDashboardDayPatch } from "../../../src/dashboard/client/day-state.js";
import { makeWorld, queuedEventOf, runRecordOf, taskEventsOf, uuidOf as runUuidOf, instantOffsetOf, DAY as PROJECTION_DAY } from "../../helpers/backend/dashboard-harness.js";
import { queueBatches, visibleRunIds } from "../../../src/dashboard/surfaces/queue-model.js";
import { FIXTURE_DAY, FIXTURE_DAY_WIRE, FIXTURE_NOW, uuidOf } from "../../parity/helpers/fixture-day.js";

const base = FIXTURE_DAY_WIRE.queueSurfaces.find((row) => row.surfaceKind === "single" && row.status === "queued");
if (base === undefined) throw new Error("batch fixture requires a queued single run");
function row(n: number, grouped = true, item = n, attempt = 1): QueueSurfaceWire {
  return QueueSurfaceWireSchema.parse({ ...base, runId: uuidOf(900 + n), itemId: uuidOf(800 + item), attempt,
    title: ["Alice", "Ben", "Cara", "Ben retry"][n - 1] ?? "Ben retry again",
    session: { state: "present", sessionId: uuidOf(700), presentation: { groupInQueue: grouped, version: 1, startedAt: base?.startedAt } },
  });
}
let root: Root | undefined;
afterEach(async () => { if (root !== undefined) await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); });
async function render(rows: readonly QueueSurfaceWire[], handlers: QueueHandlers = { onSelect: () => undefined }, selectedRunId?: string): Promise<void> {
  if (root === undefined) { const host = document.createElement("div"); document.body.append(host); root = createRoot(host); }
  await act(async () => root?.render(createElement(QueuePanel, { surfaces: rows, handlers,
    state: { nowIso: FIXTURE_NOW, openWells: new Set<string>(), ...(selectedRunId === undefined ? {} : { selectedRunId }) },
    workflowLabelOf: () => "Separations", panelLabel: "Separations", day: FIXTURE_DAY,
  })));
}
function button(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find((element) => element.textContent?.includes(text));
  assert.ok(found, `missing button ${text}`); return found;
}
async function press(text: string): Promise<void> { await act(async () => button(text).click()); }

describe("workflow batches in the queue", () => {
  it("shows one expandable batch for three runs and sends its exact persisted setting on ungroup", async () => {
    const rows = [row(1), row(2), row(3)];
    const changes: unknown[] = [];
    await render(rows, { onSelect: () => undefined, onSetBatchGrouping: async (batch, grouped) => { changes.push([batch.id, batch.version, grouped]); } });
    assert.equal(document.querySelectorAll('section[aria-label="Separations batch"]').length, 1);
    assert.ok(!document.body.textContent?.includes("Alice"));
    await press("Separations · 3 items");
    assert.ok(document.body.textContent?.includes("Alice"));
    assert.ok(document.body.textContent?.includes("Ben"));
    assert.ok(document.body.textContent?.includes("Cara"));
    await press("Show separately");
    assert.deepEqual(changes, [[uuidOf(700), 1, false]]);
  });
  it("shows separate runs with a regroup control and leaves single-item batches flat", async () => {
    const changes: boolean[] = [];
    await render([row(1, false), row(2, false), row(3, false)], { onSelect: () => undefined, onSetBatchGrouping: async (_, grouped) => { changes.push(grouped); } });
    assert.equal(document.querySelectorAll('section[aria-label="Separations batch"]').length, 0);
    assert.ok(document.body.textContent?.includes("Alice"));
    await press("Group batch");
    assert.deepEqual(changes, [true]);
    await render([row(1)]);
    assert.equal(document.querySelectorAll('section[aria-label="Separations batch"]').length, 0);
    assert.ok(document.body.textContent?.includes("Alice"));
  });
  it("counts a retry once and keeps the selected older attempt inside its logical item", async () => {
    const rows = [row(1), row(2), row(3), row(4, true, 2, 2)];
    const batch = queueBatches(rows)[0];
    assert.ok(batch);
    assert.equal(batch.members.length, 3);
    assert.deepEqual(batch.history.map((entry) => entry.runId), [row(2).runId]);
    assert.deepEqual(visibleRunIds(rows), [row(1).runId, row(2).runId, row(4).runId, row(3).runId]);
    await render(rows, undefined, row(2).runId);
    assert.equal(document.querySelectorAll('section[aria-label="Separations batch"]').length, 1);
    assert.ok(document.body.textContent?.includes("3 items"));
    assert.ok(document.body.textContent?.includes("Attempts · 2"));
    assert.equal(document.querySelectorAll(`[data-demo-row-id="${String(row(2).runId)}"]`).length, 1);
    assert.ok(document.body.querySelector('button[aria-current="true"]'));
  });
  it("keeps the focused attempt and open batch when a newer retry arrives out of order", async () => {
    const rows = [row(1), row(2), row(3), row(4, true, 2, 2)];
    await render(rows, undefined, row(2).runId);
    const oldAttempt = document.querySelector<HTMLButtonElement>('button[aria-current="true"]');
    assert.ok(oldAttempt);
    await act(async () => oldAttempt.focus());

    const retry = row(5, true, 2, 3);
    await render([retry, ...rows], undefined, row(2).runId);

    const selected = document.querySelector<HTMLButtonElement>('button[aria-current="true"]');
    assert.equal(document.activeElement, selected);
    assert.equal(selected?.getAttribute("aria-label"), "Open Ben — attempt 1 — queued");
    assert.equal(button("Separations · 3 items").getAttribute("aria-expanded"), "true");
    assert.ok(document.body.textContent?.includes("Attempts · 3"));
    assert.equal(document.querySelectorAll(`[data-demo-row-id="${String(row(2).runId)}"]`).length, 1);
  });
  it("allows collapsing a selected batch and opens it for another selected run", async () => {
    const rows = [row(1), row(2)];
    await render(rows, undefined, row(1).runId);
    assert.equal(button("Separations · 2 items").getAttribute("aria-expanded"), "true");
    await press("Separations · 2 items");
    assert.equal(button("Separations · 2 items").getAttribute("aria-expanded"), "false");
    await render(rows, undefined, row(2).runId);
    assert.equal(button("Separations · 2 items").getAttribute("aria-expanded"), "true");
  });
  it("keeps the served grouping when saving fails and exposes the error", async () => {
    await render([row(1), row(2)], { onSelect: () => undefined, onSetBatchGrouping: async () => { throw new Error("Batch presentation changed; reload."); } });
    await press("Show separately");
    assert.match(document.querySelector('[role="alert"]')?.textContent ?? "", /Batch presentation changed/u);
    assert.equal(document.querySelectorAll('section[aria-label="Separations batch"]').length, 1);
    await render([row(1, false), row(2, false)], { onSelect: () => undefined, onSetBatchGrouping: async () => { throw new Error("Connection lost"); } });
    await press("Group batch");
    assert.match(document.querySelector('[role="alert"]')?.textContent ?? "", /Connection lost/u);
  });
  it("navigates through the displayed batch before the next standalone row", () => {
    const first = row(1);
    const standalone = QueueSurfaceWireSchema.parse({ ...row(3), session: { state: "absent", reason: "historical run" } });
    const second = QueueSurfaceWireSchema.parse({ ...row(2), status: "failed" });
    assert.deepEqual(visibleRunIds([first, standalone, second]), [second.runId, first.runId, standalone.runId]);
  });
  it("keeps unavailable historical grouping separate and refuses conflicting batch facts", () => {
    const old = QueueSurfaceWireSchema.parse({ ...row(1), session: { state: "present", sessionId: uuidOf(700) } });
    assert.equal(queueBatches([old]).length, 0);
    assert.throws(() => queueBatches([row(1), row(2, false)]), /disagree/u);
    assert.throws(() => queueBatches([row(1), row(2, true, 1)]), /duplicate item attempt/u);
  });
});


describe("batch presentation publication", () => {
  it.each(["command", "span"] as const)("keeps every rendered batch consistent when a %s update beats the poll", (trigger) => {
    const w = makeWorld();
    try {
      const batch = RunSessionRecordSchema.parse({ sessionId: runUuidOf(70), workflow: "person-lookup",
        origin: { kind: "start-plan", startPlanId: runUuidOf(71), actorId: "local-operator" },
        startedAt: instantOffsetOf(0), createdAt: instantOffsetOf(0), groupInQueue: true, version: 1 });
      w.authority.batches.set(batch.sessionId, batch);
      queuedEventOf(w, { seed: 1, sessionId: batch.sessionId });
      queuedEventOf(w, { seed: 2, sessionId: batch.sessionId });
      w.projection.reconcileWorkerAuthority();
      let wire = w.projection.buildDashboardDayWire(PROJECTION_DAY);
      w.changes.length = 0;
      w.authority.batches.set(batch.sessionId, RunSessionRecordSchema.parse({ ...batch, groupInQueue: false, version: 2 }));
      if (trigger === "command") {
        w.authority.put(runRecordOf({ seed: 1, sessionId: batch.sessionId, displayName: "Renamed run", version: 2 }));
        w.projection.refreshRun(runUuidOf(1));
      } else taskEventsOf(w, 1, "searching");
      assert.ok(w.changes.length > 0);
      for (const change of w.changes) {
        if (change.kind === "patch") wire = applyDashboardDayPatch(wire, change.patch);
        else if (change.kind === "snapshot") wire = w.projection.buildDashboardDayWire(PROJECTION_DAY);
        // Every intermediate client state must render, not merely the final snapshot.
        assert.doesNotThrow(() => queueBatches(wire.queueSurfaces));
      }
      assert.deepEqual(w.changes.map((change) => change.kind), ["snapshot"]);
      assert.deepEqual(queueBatches(wire.queueSurfaces).map(({ groupInQueue, version }) => ({ groupInQueue, version })), [{ groupInQueue: false, version: 2 }]);
      assert.deepEqual(wire, w.projection.buildDashboardDayWire(PROJECTION_DAY));
      w.changes.length = 0;
      w.projection.reconcileWorkerAuthority();
      assert.equal(w.changes.length, 0, "the poll must not duplicate an already published batch change");
      const listBatches = w.authority.listRunBatches.bind(w.authority);
      let batchScans = 0;
      w.authority.listRunBatches = () => { batchScans++; return listBatches(); };
      w.projection.refreshRun(runUuidOf(2));
      assert.equal(batchScans, 0, "ordinary row patches must not scan all retained batches");
      assert.deepEqual(w.changes.map((change) => change.kind), ["patch"], "unchanged batch presentation retains granular row updates");
    } finally { w.dispose(); }
  });
});
