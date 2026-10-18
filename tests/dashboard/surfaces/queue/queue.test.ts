import { createAwaitingQueueFixtures } from "../../../support/helpers/dashboard/awaiting-queue-fixtures.js";
// @vitest-environment jsdom
import assert_m0 from 'node:assert/strict';
import { act as act_m0,createElement as createElement_m0 } from 'react';
import { createRoot as createRoot_m0,type Root as Root_m0 } from 'react-dom/client';
import { it as it_m0 } from 'vitest';
import { QueuePanel as QueuePanel_m0,type QueueHandlers as QueueHandlers_m0,type QueueViewState as QueueViewState_m0 } from '../../../../src/dashboard/surfaces/queue/queue.js';
import { FIXTURE_NOW as FIXTURE_NOW_m0 } from '../../../parity/helpers/fixture-identity.js';
import { FIXTURE_DAY_WIRE as FIXTURE_DAY_WIRE_m0 } from '../../../parity/helpers/fixture-queue.js';
// @vitest-environment jsdom
import assert_m1 from "node:assert/strict";
import { createElement as createElement_m1 } from "react";
import { renderToStaticMarkup as renderToStaticMarkup_m1 } from "react-dom/server";
import { describe as describe_m1,it as it_m1 } from "vitest";
import { orderMembers as orderMembers_m1,type MemberSurfaceWire as MemberSurfaceWire_m1 } from "../../../../src/dashboard/surfaces/queue/queue-model.js";
import { QueueRow as QueueRow_m1 } from "../../../../src/dashboard/surfaces/queue/queue.js";
import { QueueSurfaceWireSchema as QueueSurfaceWireSchema_m1,type QueueSurfaceWire as QueueSurfaceWire_m1 } from "../../../../src/models/dashboard/projection.js";
import { FIXTURE_NOW as FIXTURE_NOW_m1 } from "../../../parity/helpers/fixture-identity.js";
import { FIXTURE_DAY_WIRE as FIXTURE_DAY_WIRE_m1 } from "../../../parity/helpers/fixture-queue.js";

import assert_m2 from "node:assert/strict";
import { createElement as createElement_m2 } from "react";
import { renderToStaticMarkup as renderToStaticMarkup_m2 } from "react-dom/server";
import { describe as describe_m2,it as it_m2 } from "vitest";
import { QueueRow as QueueRow_m2 } from "../../../../src/dashboard/surfaces/queue/queue.js";



{


Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
let root: Root_m0 | undefined;
let host: HTMLDivElement | undefined;
const _afterEachFixture0 = () => { act_m0(() => root?.unmount()); host?.remove(); root = undefined; host = undefined; };

it_m0('redraws only affected selections while preserving new handlers, clock and bulk state', async () => {
try {


  const rows = FIXTURE_DAY_WIRE_m0.queueSurfaces.filter(row => row.surfaceKind === 'single').slice(0, 3);
  assert_m0.equal(rows.length, 3);
  const renders: string[] = [];
  const actionsOf = (row: typeof rows[number]) => { renders.push(row.runId); return row.actions; };
  const label = () => 'Fixture';
  let state: QueueViewState_m0 = { nowIso: FIXTURE_NOW_m0, openWells: new Set() };
  let handlers: QueueHandlers_m0 = { onSelect() {} };
  host = document.createElement('div'); document.body.append(host); root = createRoot_m0(host);
  const draw = () => act_m0(() => root?.render(createElement_m0(QueuePanel_m0, { surfaces: rows, state, handlers,
    actionsOf, workflowLabelOf: label, panelLabel: 'Fixture', day: FIXTURE_DAY_WIRE_m0.day })));
  draw(); assert_m0.equal(renders.length, 3); renders.length = 0;
  state = { ...state, selectedRunId: rows[0].runId }; handlers = { ...handlers }; draw();
  assert_m0.deepEqual(renders, [rows[0].runId]); renders.length = 0;
  state = { ...state, selectedRunId: rows[1].runId }; draw();
  assert_m0.deepEqual(new Set(renders), new Set([rows[0].runId, rows[1].runId])); renders.length = 0;
  assert_m0.equal(host.querySelector(`[data-demo-row-id="${rows[0].runId}"]`)?.getAttribute('aria-pressed'), 'false');
  assert_m0.equal(host.querySelector(`[data-demo-row-id="${rows[1].runId}"]`)?.getAttribute('aria-pressed'), 'true');
  const selected: string[] = []; handlers = { onSelect(id) { selected.push(id); } }; draw();
  assert_m0.equal(renders.length, 3); renders.length = 0;
  act_m0(() => host?.querySelector<HTMLElement>(`[data-demo-row-id="${rows[2].runId}"]`)?.click());
  assert_m0.deepEqual(selected, [rows[2].runId]);
  state = { ...state, nowIso: '2026-08-14T19:00:00.000Z' }; draw(); assert_m0.equal(renders.length, 3); renders.length = 0;
  state = { ...state, selectMode: true, bulkIds: new Set([rows[2].runId]) }; handlers = { ...handlers, onToggleBulk() {} }; draw();
  assert_m0.equal(renders.length, 3);
  assert_m0.equal(host.querySelectorAll('[role="checkbox"][aria-checked="true"]').length, 1);

} finally {
_afterEachFixture0();
}
});

it_m0('updates the containing operation when selection moves between members', async () => {
try {


  const operation = FIXTURE_DAY_WIRE_m0.queueSurfaces.find(row => row.surfaceKind === 'operation' && row.memberRunIds.length === 3);
  assert_m0.ok(operation && operation.surfaceKind === 'operation');
  const members = FIXTURE_DAY_WIRE_m0.queueSurfaces.filter(row => row.surfaceKind === 'member' && operation.memberRunIds.includes(row.runId));
  const surfaces = [operation, ...members]; const label = () => 'Fixture'; const handlers = { onSelect() {} };
  const wells = new Set<string>();
  host = document.createElement('div'); document.body.append(host); root = createRoot_m0(host);
  const draw = (selectedRunId: string) => act_m0(() => root?.render(createElement_m0(QueuePanel_m0, { surfaces,
    state: { nowIso: FIXTURE_NOW_m0, openWells: wells, selectedRunId }, handlers,
    workflowLabelOf: label, panelLabel: 'Fixture', day: FIXTURE_DAY_WIRE_m0.day })));
  draw(members[0].runId);
  const selected = () => [...host!.querySelectorAll('tbody button[aria-pressed="true"]')].map(button => button.closest('tr')?.getAttribute('data-demo-row-id'));
  assert_m0.deepEqual(selected(), [members[0].runId]);
  draw(members[1].runId); assert_m0.deepEqual(selected(), [members[1].runId]);

} finally {
_afterEachFixture0();
}
});

it_m0('does not transfer a missing selected attempt or its command version to the surviving attempt', async () => {
try {
  const first = FIXTURE_DAY_WIRE_m0.queueSurfaces.find(row => row.surfaceKind === 'single');
  assert_m0.ok(first);
  const action = { kind: 'command' as const, key: 'cancel', command: 'cancel' as const, label: 'Cancel surviving attempt',
    intent: 'neutral' as const, placement: ['footer' as const, 'menu' as const], expectedVersion: first.rowRevision + 1 };
  const newest = QueueSurfaceWireSchema_m1.parse({ ...first, runId: '00000000-8000-4000-8000-000000000001',
    attempt: first.attempt + 1, rowRevision: action.expectedVersion, actions: [action] });
  const sent: unknown[] = [];
  const handlers: QueueHandlers_m0 = { onSelect() {}, onAction(descriptor, target) { sent.push([descriptor, target]); } };
  const state: QueueViewState_m0 = { nowIso: FIXTURE_NOW_m0, openWells: new Set(), selectedRunId: first.runId };
  const label = () => 'Fixture';
  const actionsOf = (row: typeof first) => row.actions;
  host = document.createElement('div'); document.body.append(host); root = createRoot_m0(host);
  const draw = (surfaces: readonly typeof first[]) => act_m0(() => root?.render(createElement_m0(QueuePanel_m0, {
    surfaces, state, handlers, actionsOf, workflowLabelOf: label, panelLabel: 'Fixture', day: FIXTURE_DAY_WIRE_m0.day,
  })));
  draw([first, newest]);
  assert_m0.equal(host.querySelector('[data-demo-row-id]')?.getAttribute('data-demo-row-id'), first.runId);
  draw([newest]);
  assert_m0.equal(host.querySelector('[data-demo-row-id]')?.getAttribute('data-demo-row-id'), newest.runId);
  assert_m0.equal(host.querySelector('[data-demo-row-id]')?.getAttribute('aria-pressed'), 'false');
  const cancel = host.querySelector<HTMLButtonElement>('button[aria-label="Cancel surviving attempt"]');
  assert_m0.ok(cancel);
  act_m0(() => cancel.click());
  assert_m0.deepEqual(sent, [[action, { runId: newest.runId, expectedVersion: newest.rowRevision }]]);
} finally {
_afterEachFixture0();
}
});
}

{


function single(status: QueueSurfaceWire_m1["status"]): QueueSurfaceWire_m1 {
  const row = FIXTURE_DAY_WIRE_m1.queueSurfaces.find(row => row.surfaceKind === "single" && row.status === status);
  assert_m1.ok(row, `missing ${status} fixture`);
  return row;
}
function render(surface: QueueSurfaceWire_m1, members: readonly MemberSurfaceWire_m1[] = [], selectMode = false): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup_m1(createElement_m1(QueueRow_m1, {
    surface, members, state: { nowIso: FIXTURE_NOW_m1, openWells: new Set<string>(), selectMode, panelWorkflowId: surface.workflowId },
    handlers: { onSelect: () => {}, onToggleBulk: () => {} }, workflowLabelOf: () => "Separations",
  }));
  return host;
}

describe_m1("approved mixed queue presentation", () => {
  it_m1("keeps mode hazards and the footer attempt while removing leading and info controls", () => {
    const base = single("done");
    const row = QueueSurfaceWireSchema_m1.parse({ ...base, attempt: 7, dryRun: true, resolvedInstances: base.resolvedInstances.map(instance => ({ ...instance, instance: "test" })) });
    const host = render(row);
    const body = host.querySelector("[data-queue-body]");
    assert_m1.ok(body);
    assert_m1.equal(body.querySelector("[data-demo-row-title]")?.textContent, row.title);
    assert_m1.equal(body.firstElementChild?.querySelector("svg"), null);
    assert_m1.ok(host.textContent?.includes("dry run"));
    assert_m1.ok(host.textContent?.includes("test"));
    assert_m1.ok(host.textContent?.includes("Done"));
    assert_m1.equal(host.querySelector('[aria-label^="What is this row"]'), null);
    assert_m1.equal(body.querySelector('[aria-label^="Attempts for"]'), null);
    assert_m1.equal(host.querySelector('[aria-label^="Attempts for"]')?.textContent, "#1");
    const identity = [...host.querySelectorAll('span[title]')].find(element => element.getAttribute('title') === row.traceId);
    assert_m1.ok(identity);
    assert_m1.match(identity.textContent ?? "", /^[A-Z0-9]+\d{8}$/u);
    assert_m1.ok(!host.textContent?.includes("Attempts ·"));
  });
  it_m1("shows all served progress states, measured durations and the step count below the bar", () => {
    const row = single("running");
    const host = render(row);
    const bar = host.querySelector("[data-queue-progress]");
    assert_m1.ok(bar);
    assert_m1.equal(bar.children.length, row.pipeline.length);
    assert_m1.ok(bar.nextElementSibling?.textContent?.includes(`${row.pipeline.filter(step => step.state === "done").length} / ${row.pipeline.length} steps`));
    assert_m1.ok(!host.textContent?.includes("nodes"));
    for (const [index, step] of row.pipeline.entries()) {
      assert_m1.ok(bar.children[index]?.getAttribute("title")?.includes(`(${step.state})`));
      if (step.durationSec !== undefined) assert_m1.ok(bar.children[index]?.getAttribute("title")?.match(/[0-9]+s|[0-9]+m/u));
    }
    assert_m1.equal(host.querySelectorAll(".animate-spin").length, 1);
    assert_m1.ok(host.querySelector(".animate-spin")?.closest("[data-slot=badge]"));
    const absent = QueueSurfaceWireSchema_m1.parse({ ...row, pipeline: [], liveMessage: { state: "absent", reason: "No active step was recorded" } });
    const empty = render(absent);
    assert_m1.equal(empty.querySelector("[data-queue-progress]"), null);
    assert_m1.ok(!empty.textContent?.includes("0 / 0"));
  });
  it_m1("omits an unmeasured terminal duration and preserves measured zero", () => {
    const done = single("done");
    const unknown = render(QueueSurfaceWireSchema_m1.parse({ ...done, endedAt: { state: "absent", reason: "Historical end not retained" } }));
    assert_m1.ok(!unknown.textContent?.includes("duration unknown"));
    assert_m1.ok(!unknown.textContent?.includes("0s"));
    const zero = render(QueueSurfaceWireSchema_m1.parse({ ...done, endedAt: { state: "present", value: done.startedAt } }));
    assert_m1.ok(zero.textContent?.includes("0s"));
  });
  it_m1("places the bulk selector outside the card and keeps the row's selection target", () => {
    const row = single("queued");
    const host = render(row, [], true);
    const target = host.querySelector("[data-demo-row-id]");
    assert_m1.ok(target);
    const checkbox = host.querySelector('[role="checkbox"]');
    assert_m1.ok(checkbox);
    assert_m1.ok(!target.contains(checkbox));
    assert_m1.equal(target.getAttribute("tabindex"), "0");
    assert_m1.equal(target.getAttribute("aria-pressed"), "false");
  });
  it_m1("shows the served group counter and ordered member statuses in Name/Status columns", () => {
    const operation = FIXTURE_DAY_WIRE_m1.queueSurfaces.find(row => row.surfaceKind === "operation" && row.memberRunIds.length === 3);
    assert_m1.ok(operation && operation.surfaceKind === "operation");
    const members = FIXTURE_DAY_WIRE_m1.queueSurfaces.filter((row): row is MemberSurfaceWire_m1 => row.surfaceKind === "member" && operation.memberRunIds.includes(row.runId));
    const host = render(operation, members);
    assert_m1.equal(host.querySelector('[data-queue-member-count]')?.textContent?.trim(), `${operation.memberRollup.terminal}/${operation.memberRollup.total}`);
    assert_m1.deepEqual([...host.querySelectorAll("th")].map(cell => cell.textContent), ["Name", "Status"]);
    const ordered = orderMembers_m1(members);
    assert_m1.deepEqual([...host.querySelectorAll("tbody tr")].map(row => row.getAttribute("data-demo-row-id")), ordered.map(row => String(row.runId)));
    assert_m1.ok([...host.querySelectorAll("tbody tr")].every(row => row.querySelector("td svg") && row.querySelector("td:last-child")?.textContent));
    const unloaded = render(operation);
    assert_m1.ok(unloaded.textContent?.includes("Members not loaded"));
    assert_m1.equal(unloaded.querySelector('[data-queue-member-count]')?.textContent?.trim(), `${operation.memberRollup.terminal}/${operation.memberRollup.total}`);
    assert_m1.deepEqual([...unloaded.querySelectorAll("th")].map(cell => cell.textContent), ["Name", "Status"]);
  });
  it_m1("uses blue for Review messages and preserves yellow Write parked messages", () => {
    const review = render(single("awaiting-approval"));
    const parked = render(single("blocked"));
    assert_m1.ok(review.querySelector("[data-queue-body] .text-ui-info"));
    assert_m1.equal(review.querySelector("[data-queue-body] [class*=ds-status-waiting-fg]"), null);
    assert_m1.ok(parked.querySelector("[data-queue-body] [class*=ds-status-parked-fg]"));
  });
});
}

{


const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const NOW = "2026-08-14T17:00:00.000Z";
const RUN_ID = "11111111-1111-4111-8111-111111111111";

const { surface } = createAwaitingQueueFixtures(RUN_ID, HASH_A, HASH_B, NOW);

describe_m2("the row's accessible name carries the age", () => {

  it_m2("renders the production QueueRow press target with the composed gate age", () => {
    const row = surface({
      gateOpenedAt: { state: "present", value: "2026-08-14T16:42:00.000Z" },
    });
    const markup = renderToStaticMarkup_m2(createElement_m2(QueueRow_m2, {
      surface: row,
      state: {
        openWells: new Set<string>(),
        panelWorkflowId: "person-lookup",
        nowIso: NOW,
      },
      handlers: { onSelect: () => undefined },
      workflowLabelOf: () => "Person Lookup",
    }));

    assert_m2.ok(markup.includes('aria-label="Jordan Reyes — review · 18m 0s"'));
  });
});
}
