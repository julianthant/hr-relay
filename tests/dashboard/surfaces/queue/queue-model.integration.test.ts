// @vitest-environment jsdom
import assert_m0 from "node:assert/strict";
import { describe as describe_m0,it as it_m0 } from "vitest";
import {
queueBatches as queueBatches_m0,
sortQueueBand as sortQueueBand_m0
} from "../../../../src/dashboard/surfaces/queue/queue-model.js";
import {
QueueSurfaceWireSchema as QueueSurfaceWireSchema_m0,
type QueueSurfaceWire as QueueSurfaceWire_m0
} from "../../../../src/models/dashboard/projection.js";
import { RunRecordSchema as RunRecordSchema_m0 } from "../../../../src/models/run/record.js";
import {
FIXTURE_DAY_WIRE as FIXTURE_DAY_WIRE_m0,
uuidOf as uuidOf_m0
} from "../../../support/fixtures/dashboard/fixture-day.js";
import { summaryFixture as summaryFixture_m0 } from "../../../support/helpers/backend/served-database-surfaces-fixtures.js";
import { id as id_m0 } from "../../../support/helpers/database-foundation/fixtures.js";
// @vitest-environment jsdom
import assert_m1 from "node:assert/strict";
import { act as act_m1,createElement as createElement_m1 } from "react";
import { createRoot as createRoot_m1,type Root as Root_m1 } from "react-dom/client";
import { afterEach as afterEach_m1,describe as describe_m1,it as it_m1 } from "vitest";
import { queueBatches as queueBatches_m1,visibleRunIds as visibleRunIds_m1 } from "../../../../src/dashboard/surfaces/queue/queue-model.js";
import { QueuePanel as QueuePanel_m1,type QueueHandlers as QueueHandlers_m1 } from "../../../../src/dashboard/surfaces/queue/queue.js";
import { QueueSurfaceWireSchema as QueueSurfaceWireSchema_m1,type QueueSurfaceWire as QueueSurfaceWire_m1 } from "../../../../src/models/dashboard/projection.js";
import { FIXTURE_DAY as FIXTURE_DAY_m1,FIXTURE_NOW as FIXTURE_NOW_m1,uuidOf as uuidOf_m1 } from "../../../support/fixtures/dashboard/fixture-identity.js";
import { FIXTURE_DAY_WIRE as FIXTURE_DAY_WIRE_m1 } from "../../../support/fixtures/dashboard/fixture-queue.js";


{


const rows = FIXTURE_DAY_WIRE_m0.queueSurfaces;

function rowWhere(predicate: (row: QueueSurfaceWire_m0) => boolean): QueueSurfaceWire_m0 {
  const row = rows.find(predicate);
  assert_m0.ok(row, "required strict Queue fixture row is missing");
  return row;
}

describe_m0("Queue consumes the served day boundary", () => {

  it_m0("folds repeated item attempts once in a served workflow batch and retains the prior attempt", () => {
    const base = rowWhere((row) => row.status === "queued" && row.surfaceKind === "single");
    const session = {
      state: "present" as const,
      sessionId: uuidOf_m0(9700),
      presentation: { groupInQueue: true, version: 2, startedAt: base.startedAt },
    };
    const first = QueueSurfaceWireSchema_m0.parse({ ...base, runId: uuidOf_m0(9701), itemId: uuidOf_m0(9711), attempt: 1, session });
    const previous = QueueSurfaceWireSchema_m0.parse({ ...base, runId: uuidOf_m0(9702), itemId: uuidOf_m0(9712), attempt: 1, session });
    const retry = QueueSurfaceWireSchema_m0.parse({ ...base, runId: uuidOf_m0(9703), itemId: previous.itemId, attempt: 2, session });

    const batch = queueBatches_m0([first, previous, retry])[0];
    assert_m0.ok(batch);
    assert_m0.deepEqual(new Set(batch.members.map((row) => row.runId)), new Set([first.runId, retry.runId]));
    assert_m0.deepEqual(batch.history.map((row) => row.runId), [previous.runId]);
  });

  it_m0("serves canonical priority/enqueue/id order and keeps explicit display sorts as pure presentation", async () => {
    const f = await summaryFixture_m0();
    try {
      const now = "2026-09-09T12:00:00.000Z";
      const bulkId = id_m0(9801);
      const interactiveId = id_m0(9802);
      f.db.authority.runs.enqueue(RunRecordSchema_m0.parse({
        ...f.run,
        envelope: { ...f.run.envelope, runId: bulkId, itemId: bulkId, enqueuedAt: "2026-09-09T11:59:00.000Z", priority: "bulk" },
        lifecycle: { state: "queued" }, version: 1, claimGeneration: 0, createdAt: "2026-09-09T11:59:00.000Z", updatedAt: "2026-09-09T11:59:00.000Z",
      }));
      f.db.authority.runs.enqueue(RunRecordSchema_m0.parse({
        ...f.run,
        envelope: { ...f.run.envelope, runId: interactiveId, itemId: interactiveId, enqueuedAt: "2026-09-09T12:00:00.000Z", priority: "interactive" },
        lifecycle: { state: "queued" }, version: 1, claimGeneration: 0, createdAt: "2026-09-09T12:00:00.000Z", updatedAt: "2026-09-09T12:00:00.000Z",
      }));

      const wire = f.projection.buildDashboardDayWire("2026-09-09");
      const prioritySorted = wire.queueSurfaces.filter((s) => s.runId === bulkId || s.runId === interactiveId);
      // Canonical order: interactive before bulk
      assert_m0.deepEqual(prioritySorted.map((s) => s.runId), [interactiveId, bulkId]);


      assert_m0.deepEqual(sortQueueBand_m0(prioritySorted, "oldest", now).map((s) => s.runId), [bulkId, interactiveId]);

      assert_m0.deepEqual(sortQueueBand_m0(prioritySorted, "newest", now).map((s) => s.runId), [interactiveId, bulkId]);
    } finally {
      await f.dispose();
    }
  });
});
}

{


const base = FIXTURE_DAY_WIRE_m1.queueSurfaces.find((row) => row.surfaceKind === "single" && row.status === "queued");
if (base === undefined) throw new Error("batch fixture requires a queued single run");
function row(n: number, grouped = true, item = n, attempt = 1): QueueSurfaceWire_m1 {
  return QueueSurfaceWireSchema_m1.parse({ ...base, runId: uuidOf_m1(900 + n), itemId: uuidOf_m1(800 + item), attempt,
    title: ["Alice", "Ben", "Cara", "Ben retry"][n - 1] ?? "Ben retry again",
    session: { state: "present", sessionId: uuidOf_m1(700), presentation: { groupInQueue: grouped, version: 1, startedAt: base?.startedAt } },
  });
}
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root_m1 | undefined;
const _afterEachFixture0 = async () => { if (root !== undefined) await act_m1(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); };
async function render(rows: readonly QueueSurfaceWire_m1[], handlers: QueueHandlers_m1 = { onSelect: () => undefined }, selectedRunId?: string): Promise<void> {
  if (root === undefined) { const host = document.createElement("div"); document.body.append(host); root = createRoot_m1(host); }
  await act_m1(async () => root?.render(createElement_m1(QueuePanel_m1, { surfaces: rows, handlers,
    state: { nowIso: FIXTURE_NOW_m1, openWells: new Set<string>(), ...(selectedRunId === undefined ? {} : { selectedRunId }) },
    workflowLabelOf: () => "Separations", panelLabel: "Separations", day: FIXTURE_DAY_m1,
  })));
}

describe_m1("workflow batches in the queue", () => {
afterEach_m1(_afterEachFixture0);

  it_m1("shows every grouped batch item separately without publishing a presentation change", async () => {
    const rows = [row(1), row(2), row(3)];
    const changes: unknown[] = [];
    await render(rows, { onSelect: () => undefined, onSetBatchGrouping: async (batch, grouped) => { changes.push([batch.id, batch.version, grouped]); } });
    assert_m1.equal(document.querySelectorAll('section[aria-label="Separations batch"]').length, 0);
    assert_m1.equal(document.querySelectorAll('[data-demo-row-id]').length, 3);
    for (const name of ["Alice", "Ben", "Cara"]) assert_m1.ok(document.body.textContent?.includes(name));
    assert_m1.ok(!document.body.textContent?.includes("Show separately"));
    assert_m1.deepEqual(changes, []);
  });
  it_m1("keeps separate and single-item batches flat without regroup controls", async () => {
    const changes: boolean[] = [];
    await render([row(1, false), row(2, false), row(3, false)], { onSelect: () => undefined, onSetBatchGrouping: async (_, grouped) => { changes.push(grouped); } });
    assert_m1.equal(document.querySelectorAll('[data-demo-row-id]').length, 3);
    assert_m1.ok(!document.body.textContent?.includes("Group batch"));
    assert_m1.deepEqual(changes, []);
    await render([row(1)]);
    assert_m1.equal(document.querySelectorAll('section[aria-label="Separations batch"]').length, 0);
    assert_m1.equal(document.querySelectorAll('[data-demo-row-id]').length, 1);
    assert_m1.ok(document.body.textContent?.includes("Alice"));
  });
  it_m1("counts a retry once and puts its previous attempts in the footer dropdown", async () => {
    const rows = [row(1), row(2), row(3), row(4, true, 2, 2)];
    const batch = queueBatches_m1(rows)[0];
    assert_m1.ok(batch);
    assert_m1.equal(batch.members.length, 3);
    assert_m1.deepEqual(batch.history.map((entry) => entry.runId), [row(2).runId]);
    assert_m1.deepEqual(visibleRunIds_m1(rows), [row(1).runId, row(2).runId, row(4).runId, row(3).runId]);
    await render(rows, undefined, row(2).runId);
    assert_m1.equal(document.querySelectorAll('[data-demo-row-id]').length, 3);
    assert_m1.equal(document.querySelectorAll(`[data-demo-row-id="${String(row(2).runId)}"]`).length, 1);
    assert_m1.equal(document.querySelectorAll(`[data-demo-row-id="${String(row(4).runId)}"]`).length, 0);
    const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="Attempts for Ben"]');
    assert_m1.ok(trigger);
    await act_m1(async () => trigger.click());
    assert_m1.ok(document.body.querySelector('[role="menuitemradio"][aria-checked="true"]'));
    assert_m1.ok(!document.body.textContent?.includes("Attempts ·"));
  });
  it_m1("keeps the focused attempt menu item when a newer retry arrives out of order", async () => {
    const rows = [row(1), row(2), row(3), row(4, true, 2, 2)];
    await render(rows, undefined, row(2).runId);
    const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="Attempts for Ben"]');
    assert_m1.ok(trigger);
    await act_m1(async () => trigger.click());
    const oldAttempt = document.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]');
    assert_m1.ok(oldAttempt);
    await act_m1(async () => oldAttempt.focus());
    await render([row(5, true, 2, 3), ...rows], undefined, row(2).runId);
    const selected = document.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]');
    assert_m1.equal(document.activeElement, selected);
    assert_m1.match(selected?.textContent ?? "", /#1.*Queued/u);
    assert_m1.equal(document.querySelector('[aria-label="Attempts for Ben"]')?.getAttribute("aria-expanded"), "true");
    assert_m1.equal(document.querySelectorAll('[data-demo-row-id]').length, 3);
    assert_m1.equal(document.querySelectorAll(`[data-demo-row-id="${String(row(2).runId)}"]`).length, 1);
  });
  it_m1("selects separate batch items directly without a disclosure", async () => {
    const rows = [row(1), row(2)];
    const selected: string[] = [];
    await render(rows, { onSelect: id => { selected.push(id); } }, row(1).runId);
    const second = document.querySelector<HTMLElement>(`[data-demo-row-id="${String(row(2).runId)}"]`);
    assert_m1.ok(second);
    await act_m1(async () => second.click());
    assert_m1.deepEqual(selected, [String(row(2).runId)]);
    await render(rows, undefined, row(2).runId);
    assert_m1.equal(document.querySelectorAll('[data-demo-row-id][aria-pressed="true"]').length, 1);
    assert_m1.equal(second.getAttribute("aria-pressed"), "true");
  });
  it_m1("does not invoke grouping commands for either served preference", async () => {
    for (const grouped of [true, false]) {
      let calls = 0;
      await render([row(1, grouped), row(2, grouped)], { onSelect: () => undefined, onSetBatchGrouping: async () => { calls++; throw new Error("Connection lost"); } });
      assert_m1.equal(document.querySelectorAll('[data-demo-row-id]').length, 2);
      assert_m1.equal(document.querySelectorAll('button[aria-label*="Group batch"]').length, 0);
      assert_m1.equal(document.querySelectorAll('[role="alert"]').length, 0);
      assert_m1.equal(calls, 0);
    }
  });
  it_m1("navigates in the visible status bands instead of synthetic batch order", () => {
    const first = row(1);
    const standalone = QueueSurfaceWireSchema_m1.parse({ ...row(3), session: { state: "absent", reason: "historical run" }, status: "running" });
    const second = QueueSurfaceWireSchema_m1.parse({ ...row(2), status: "failed" });
    assert_m1.deepEqual(visibleRunIds_m1([first, standalone, second]), [standalone.runId, first.runId, second.runId]);
  });
  it_m1("keeps unavailable historical grouping separate and refuses conflicting batch facts", () => {
    const old = QueueSurfaceWireSchema_m1.parse({ ...row(1), session: { state: "present", sessionId: uuidOf_m1(700) } });
    assert_m1.equal(queueBatches_m1([old]).length, 0);
    assert_m1.throws(() => queueBatches_m1([row(1), row(2, false)]), /disagree/u);
    assert_m1.throws(() => queueBatches_m1([row(1), row(2, true, 1)]), /duplicate item attempt/u);
  });
});
}
