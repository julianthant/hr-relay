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
import { filterQueueSurfaces, queueItemLayout, queueMemberLines, attentionQueueKeys, queueBatches as queueBatches_m1,visibleQueueKeys as visibleQueueKeys_m1 } from "../../../../src/dashboard/surfaces/queue/queue-model.js";
import { QueuePanel as QueuePanel_m1,type QueueViewState, type QueueHandlers as QueueHandlers_m1 } from "../../../../src/dashboard/surfaces/queue/queue.js";
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
      itemScope: "session" as const,
      sessionId: uuidOf_m0(9700),
      presentation: { layout: "batch", groupInQueue: true, version: 2, startedAt: base.startedAt },
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
  return QueueSurfaceWireSchema_m1.parse({ ...base, workflowId: "separations", runId: uuidOf_m1(900 + n), itemId: uuidOf_m1(800 + item), attempt,
    title: ["Alice", "Ben", "Cara", "Ben retry"][n - 1] ?? "Ben retry again",
    session: { state: "present", itemScope: "workflow", sessionId: uuidOf_m1(700), presentation: { layout: "items", groupInQueue: grouped, version: 1, startedAt: base?.startedAt } },
  });
}
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root_m1 | undefined;
const _afterEachFixture0 = async () => { if (root !== undefined) await act_m1(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); };
async function render(rows: readonly QueueSurfaceWire_m1[], handlers: QueueHandlers_m1 = { onSelect: () => undefined }, selectedRunId?: string, view: Partial<QueueViewState> = {}): Promise<void> {
  if (root === undefined) { const host = document.createElement("div"); document.body.append(host); root = createRoot_m1(host); }
  await act_m1(async () => root?.render(createElement_m1(QueuePanel_m1, { surfaces: rows, handlers,
    state: { nowIso: FIXTURE_NOW_m1, openWells: new Set<string>(), ...(selectedRunId === undefined ? {} : { selectedRunId }), ...view },
    actionsOf: surface => surface.actions,
    workflowLabelOf: id => id === "person-lookup" ? "Person Lookup" : "Separations", panelLabel: rows[0]?.workflowId === "person-lookup" ? "Person Lookup" : "Separations", day: FIXTURE_DAY_m1,
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
    assert_m1.deepEqual(visibleQueueKeys_m1(rows), [row(1).runId, row(2).runId, row(4).runId, row(3).runId]);
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
    assert_m1.deepEqual(visibleQueueKeys_m1([first, standalone, second]), [second.runId, standalone.runId, first.runId]);
  });
  it_m1("keeps unavailable historical grouping separate and refuses conflicting batch facts", () => {
    const old = QueueSurfaceWireSchema_m1.parse({ ...row(1), session: { state: "present", itemScope: "workflow", sessionId: uuidOf_m1(700) } });
    assert_m1.equal(queueBatches_m1([old]).length, 0);
    assert_m1.throws(() => queueBatches_m1([row(1), row(2, false)]), /disagree/u);
    assert_m1.throws(() => queueBatches_m1([row(1), row(2, true, 1)]), /duplicate item attempt/u);
  });
});

function lookupRow(n: number, overrides: Record<string, unknown> = {}): QueueSurfaceWire_m1 {
  const source = QueueSurfaceWireSchema_m1.parse({ ...row(n), workflowId: "person-lookup", ...overrides });
  return QueueSurfaceWireSchema_m1.parse({ ...source, session: source.session.state === "absent" ? source.session : {
    ...source.session, itemScope: "session", ...(source.session.presentation === undefined ? {} : {
      presentation: { ...source.session.presentation, layout: source.session.presentation.groupInQueue ? "batch" : "items" },
    }),
  } });
}

describe_m1("nondelegated Lookup batch presentation", () => {
  afterEach_m1(_afterEachFixture0);

  it_m1("uses session identity and aggregate timing as members change, preserving independent overlapping starts", () => {
    const alice = lookupRow(1, { status: "done", outcome: { label: "Active", tone: "success" }, endedAt: { state: "present", value: "2026-08-03T17:14:30.000Z" } });
    const ben = lookupRow(2, { status: "running" });
    const failed = lookupRow(3, { status: "failed" });
    const initial = queueItemLayout([alice, ben, failed]).displayTop;
    assert_m1.equal(initial.length, 1);
    const batch = initial[0]; assert_m1.ok("kind" in batch);
    assert_m1.equal(batch.id, uuidOf_m1(700));
    assert_m1.equal(batch.status, "failed");
    assert_m1.equal(batch.startedAt, alice.session.state === "present" ? alice.session.presentation?.startedAt : undefined);
    assert_m1.deepEqual(queueMemberLines(batch, []).map(line => line.kind === "run" ? line.item.representative.runId : undefined), [failed.runId, ben.runId, alice.runId]);
    const retry = lookupRow(4, { itemId: ben.itemId, attempt: 2, startedAt: "2026-08-03T16:00:00.000Z" });
    const other = lookupRow(5, { itemId: alice.itemId, session: { state: "present", itemScope: "session", sessionId: uuidOf_m1(701),
      presentation: { layout: "batch", groupInQueue: true, version: 1, startedAt: "2026-08-03T18:30:00.000Z" } } });
    const refreshed = queueItemLayout([retry, alice, ben, failed, other]).displayTop;
    assert_m1.equal(refreshed.length, 2);
    const updated = refreshed[0]; assert_m1.ok("kind" in updated);
    assert_m1.equal(updated.key, batch.key);
    assert_m1.equal(updated.startedAt, batch.startedAt);
    assert_m1.equal(updated.members.length, 3);
    assert_m1.deepEqual(updated.history.map(row => row.runId), [ben.runId]);
    assert_m1.equal(updated.items.find(item => item.representative.itemId === ben.itemId)?.representative.runId, retry.runId);
    assert_m1.deepEqual(new Set(visibleQueueKeys_m1([retry, alice, ben, failed, other])), new Set([retry.runId, alice.runId, ben.runId, failed.runId, other.runId]));
    const waiting = lookupRow(2, { status: "blocked" });
    assert_m1.deepEqual(attentionQueueKeys([alice, waiting]), [alice.runId, waiting.runId].filter(id => id === waiting.runId));
  });

  it_m1("keeps the complete loaded day cohort through filters and counts negative outcomes as successful", async () => {
    const rows = ["Active", "Inactive", "Not found"].map((label, index) => lookupRow(index + 1, { status: "done",
      outcome: { label, tone: index === 0 ? "success" : "neutral" }, endedAt: { state: "present", value: `2026-08-03T17:1${index}:00.000Z` } }));
    const batch = queueBatches_m1(rows)[0]; assert_m1.ok(batch);
    assert_m1.equal(batch.status, "done");
    assert_m1.deepEqual(batch.endedAt, rows[2].endedAt);
    await render(rows);
    const group = document.querySelector(`[data-queue-batch-id="${batch.id}"]`); assert_m1.ok(group);
    assert_m1.equal(group.querySelector('[data-queue-member-count]')?.textContent?.trim(), "3/3");
    assert_m1.equal(group.querySelectorAll('tr[data-demo-row-id]').length, 3);
    assert_m1.match(group.textContent ?? "", /3 people on this day/u);
    const footer = group.querySelector('[data-queue-row-footer]'); assert_m1.ok(footer);
    for (const row of rows) assert_m1.ok(!footer.textContent?.includes(row.traceId));
    assert_m1.equal(footer.querySelectorAll('button').length, 0);
    for (const label of ["Active", "Inactive", "Not found"]) assert_m1.ok(group.textContent?.includes(label));
    const failed = lookupRow(2, { status: "failed" });
    assert_m1.deepEqual(filterQueueSurfaces([rows[0], failed, rows[2]], "failed"), [rows[0], failed, rows[2]]);
    await render([lookupRow(1, { status: "done" }), rows[1], rows[2]]);
    assert_m1.match(document.querySelector('[data-queue-row-footer]')?.textContent ?? "", /duration unknown/u);
  });

  it_m1("selects actual member runs from the full line or name, keeps old attempts reachable, and preserves the group across refresh", async () => {
    const rows = [lookupRow(1), lookupRow(2), lookupRow(3)];
    const selected: string[] = [];
    const handlers: QueueHandlers_m1 = { onSelect: id => { selected.push(id); } };
    await render(rows, handlers);
    const group = document.querySelector('[data-queue-batch-id]'); assert_m1.ok(group);
    await act_m1(async () => (group as HTMLElement).click());
    assert_m1.deepEqual(selected, []);
    for (const row of rows) {
      const line = document.querySelector<HTMLTableRowElement>(`tr[data-demo-row-id="${row.runId}"]`); assert_m1.ok(line);
      for (const target of [line, ...line.cells, line.querySelector('button')]) {
        assert_m1.ok(target); selected.length = 0;
        await act_m1(async () => target.dispatchEvent(new MouseEvent("click", { bubbles: true })));
        assert_m1.deepEqual(selected, [row.runId]);
      }
      assert_m1.ok(!line.querySelector('button')?.className.includes("underline"));
      assert_m1.equal(line.querySelectorAll('button[aria-label*="Retry"]').length, 0);
    }
    await render(rows, handlers, rows[1].runId);
    assert_m1.equal(document.querySelector(`tr[data-demo-row-id="${rows[1].runId}"] button`)?.getAttribute("aria-pressed"), "true");
    const retry = lookupRow(4, { itemId: rows[1].itemId, attempt: 2, startedAt: "2026-08-03T18:00:00.000Z" });
    await render([...rows, retry], handlers, rows[1].runId);
    assert_m1.equal(document.querySelector('[data-queue-batch-id]'), group);
    assert_m1.equal(group.querySelectorAll('tr[data-demo-row-id]').length, 3);
    const trigger = group.querySelector<HTMLButtonElement>('button[aria-label="Attempts for Ben"]'); assert_m1.ok(trigger);
    await act_m1(async () => trigger.click());
    const prior = document.querySelector<HTMLDivElement>('[role="menuitemradio"][aria-checked="true"]'); assert_m1.ok(prior);
    await act_m1(async () => prior.focus());
    const third = lookupRow(5, { itemId: rows[1].itemId, attempt: 3, startedAt: "2026-08-03T18:05:00.000Z" });
    await render([third, ...rows, retry], handlers, rows[1].runId);
    assert_m1.equal(document.activeElement, prior);
    assert_m1.equal(trigger.getAttribute("aria-expanded"), "true");
    const latest = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(item => item.textContent?.includes("#3")); assert_m1.ok(latest);
    selected.length = 0;
    await act_m1(async () => latest.click());
    assert_m1.deepEqual(selected, [third.runId]);
  });

  it_m1("retains every served footer action for the explicitly selected person and exact historical attempt", async () => {
    const actions = [
      { kind: "command", key: "cancel", command: "cancel", label: "Cancel run", expectedVersion: 11, intent: "destructive", placement: ["footer"], icon: "cancel" },
      { kind: "command", key: "pause", command: "pause", label: "Pause after this step", expectedVersion: 12, intent: "neutral", placement: ["footer"], icon: "pause" },
      { kind: "navigation", key: "rerun", navigate: { kind: "rerun", expectedVersion: 13 }, label: "Rerun", intent: "primary", placement: ["footer"], icon: "retry" },
      { kind: "command", key: "delete", command: "delete", label: "Delete run", expectedVersion: 14, intent: "destructive", placement: ["footer"], icon: "delete" },
      { kind: "command", key: "resume", command: "resume", label: "Resume", expectedVersion: 15, intent: "neutral", placement: ["footer"], icon: "resume" },
    ];
    const rows = actions.map((action, index) => lookupRow(index + 1, { rowRevision: 11 + index, actions: [action] }));
    const sent: unknown[] = [], selected: string[] = [];
    const handlers: QueueHandlers_m1 = { onSelect: id => { selected.push(id); }, onAction: (action, target) => { sent.push([action, target]); } };
    await render(rows, handlers);
    assert_m1.match(document.querySelector('[data-queue-member-actions]')?.textContent ?? "", /Select a person for run actions/u);
    assert_m1.equal(document.querySelector('[data-queue-member-actions] button'), null);
    const identity = document.querySelector('[data-queue-row-footer] > div')?.textContent;
    for (const row of rows) {
      await render(rows, handlers, row.runId);
      const footer = document.querySelector('[data-queue-member-actions]'); assert_m1.ok(footer);
      assert_m1.equal(footer.getAttribute("aria-label"), `Actions for ${row.title}, attempt ${row.attempt}`);
      assert_m1.match(footer.getAttribute("title") ?? "", new RegExp(row.runId, "u"));
      const button = footer.querySelector<HTMLButtonElement>("button"); assert_m1.ok(button);
      await act_m1(async () => button.click());
      assert_m1.deepEqual(sent.at(-1), [row.actions[0], { runId: row.runId, expectedVersion: row.rowRevision }]);
      assert_m1.equal(document.querySelector('[data-queue-row-footer] > div')?.textContent, identity);
      assert_m1.equal(document.querySelectorAll('[data-queue-batch-id] > [data-queue-row-footer]').length, 1);
      assert_m1.ok(footer.closest('[data-queue-row-footer]'));
    }
    assert_m1.deepEqual(selected, []);
    const retry = lookupRow(6, { itemId: rows[0].itemId, attempt: 2, rowRevision: 16, actions: [] });
    await render([...rows, retry], handlers, rows[0].runId);
    const previous = document.querySelector<HTMLButtonElement>('[data-queue-member-actions] button'); assert_m1.ok(previous);
    await act_m1(async () => previous.click());
    assert_m1.deepEqual(sent.at(-1), [rows[0].actions[0], { runId: rows[0].runId, expectedVersion: rows[0].rowRevision }]);
    await render([...rows, retry], handlers, retry.runId);
    assert_m1.equal(document.querySelector('[data-queue-member-actions] button'), null);
    await render(rows.map(row => ({ ...row, actions: [] })), handlers, rows[1].runId);
    assert_m1.equal(document.querySelector('[data-queue-member-actions] button'), null);
  });

  it_m1("keeps batch and individual selection local with partial-selection state", async () => {
    const rows = [lookupRow(1), lookupRow(2), lookupRow(3)];
    const toggled: string[] = [], opened: string[] = [];
    const handlers: QueueHandlers_m1 = { onSelect: id => { opened.push(id); }, onToggleBulk: id => { toggled.push(id); } };
    await render(rows, handlers, undefined, { selectMode: true, bulkIds: new Set([rows[0].runId]) });
    const groupSelection = document.querySelector<HTMLElement>('[role="checkbox"]'); assert_m1.ok(groupSelection);
    assert_m1.equal(groupSelection.getAttribute("data-state"), "indeterminate");
    const memberSelection = document.querySelector<HTMLElement>(`tr[data-demo-row-id="${rows[1].runId}"] [role="checkbox"]`); assert_m1.ok(memberSelection);
    await act_m1(async () => memberSelection.click());
    await act_m1(async () => groupSelection.click());
    assert_m1.deepEqual(toggled, [rows[1].runId, `batch:${uuidOf_m1(700)}`]);
    assert_m1.deepEqual(opened, []);
    await render(rows, handlers, undefined, { selectMode: true, bulkIds: new Set(rows.map(row => row.runId)) });
    assert_m1.equal(groupSelection.getAttribute("data-state"), "checked");
  });

  it_m1("keeps a single-person start flat and expands a large group by its stable session key", async () => {
    const single = lookupRow(1, { session: { state: "present", itemScope: "session", sessionId: uuidOf_m1(702), presentation: { layout: "items", groupInQueue: false, version: 1, startedAt: base.startedAt } } });
    assert_m1.equal(queueItemLayout([single]).displayTop[0], single);
    const rows = Array.from({ length: 7 }, (_, index) => lookupRow(index + 1));
    const toggled: string[] = [];
    await render(rows, { onSelect: () => undefined, onToggleWell: key => { toggled.push(key); } });
    const expand = [...document.querySelectorAll('button')].find(button => button.textContent === "Expand"); assert_m1.ok(expand);
    await act_m1(async () => expand.click());
    assert_m1.deepEqual(toggled, [`batch:${uuidOf_m1(700)}`]);
  });
});

}
