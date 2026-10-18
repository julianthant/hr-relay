// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act,createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe,it,vi } from "vitest";
import { queryQueueSummaries } from "../../../../src/backend/runs/queries/run-summaries.js";
import {
groupQueueAttempts,
partition,
queueRowAccessibleName,
queueRowTitle,
rowInfoFacts,
visibleRunIds
} from "../../../../src/dashboard/surfaces/queue/queue-model.js";
import { QueuePanel,QueueRow } from "../../../../src/dashboard/surfaces/queue/queue.js";
import {
QueueSurfaceWireSchema,
type QueueSurfaceWire,
} from "../../../../src/models/dashboard/projection.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import {
FIXTURE_DAY,
FIXTURE_DAY_WIRE,
FIXTURE_NOW,
uuidOf,
} from "../../../support/fixtures/dashboard/fixture-day.js";
import { summaryFixture } from "../../../support/helpers/backend/served-database-surfaces-fixtures.js";
import { id } from "../../../support/helpers/database-foundation/fixtures.js";

const rows = FIXTURE_DAY_WIRE.queueSurfaces;

function rowWhere(predicate: (row: QueueSurfaceWire) => boolean): QueueSurfaceWire {
  const row = rows.find(predicate);
  assert.ok(row, "required strict Queue fixture row is missing");
  return row;
}

function panelMarkup(surfaces: readonly QueueSurfaceWire[]): string {
  return renderToStaticMarkup(createElement(QueuePanel, {
    surfaces,
    state: { nowIso: FIXTURE_NOW, openWells: new Set<string>(), panelWorkflowId: "person-lookup" },
    handlers: { onSelect: () => undefined },
    actionsOf: (surface: QueueSurfaceWire) => surface.actions,
    workflowLabelOf: () => "Person Lookup",
    panelLabel: "Person Lookup",
    day: FIXTURE_DAY,
    isToday: true,
  }));
}

function rowMarkup(surface: QueueSurfaceWire): string {
  return renderToStaticMarkup(createElement(QueueRow, {
    surface,
    state: { nowIso: FIXTURE_NOW, openWells: new Set<string>(), panelWorkflowId: "person-lookup" },
    handlers: { onSelect: () => undefined },
    actionsOf: (candidate: QueueSurfaceWire) => candidate.actions,
    workflowLabelOf: () => "Person Lookup",
  }));
}

describe("Queue consumes the served day boundary", () => {
  it("keeps operation members contained once while keyboard traversal reaches the same loaded rows", () => {
    const operation = rowWhere((row) => row.surfaceKind === "operation" && row.memberRunIds.length === 3);
    assert.equal(operation.surfaceKind, "operation");
    if (operation.surfaceKind !== "operation") throw new Error("operation fixture changed shape");
    const selected = rows.filter((row) => row.runId === operation.runId
      || (row.lineage.state === "child" && row.lineage.parentRunId === operation.runId));

    const partitioned = partition(selected);
    assert.deepEqual(partitioned.top.map((row) => row.runId), [operation.runId]);
    assert.deepEqual(
      new Set((partitioned.membersOf.get(operation.runId) ?? []).map((row) => row.runId)),
      new Set(operation.memberRunIds),
    );
    assert.deepEqual(new Set(visibleRunIds(selected)), new Set([operation.runId, ...operation.memberRunIds]));

    const markup = panelMarkup(selected);
    assert.equal((markup.match(new RegExp(`data-demo-row-id="${operation.runId}"`, "gu")) ?? []).length, 1);
    for (const memberRunId of operation.memberRunIds) {
      assert.equal((markup.match(new RegExp(`data-demo-row-id="${memberRunId}"`, "gu")) ?? []).length, 1);
    }
    assert.match(markup, new RegExp(`${operation.memberRollup.terminal} of ${operation.memberRollup.total} finished; ${operation.memberRollup.failed} failed`, "u"));
  });

  it("retains every row when bounded summary pages are assembled, then applies only the requested scope", () => {
    const f = summaryFixture();
    try {
      const selectedIds = [id(9761), id(9762), id(9763)];
      const now = "2026-09-09T12:00:00.000Z";
      for (const runId of selectedIds) f.db.authority.runs.enqueue(RunRecordSchema.parse({
        ...f.run, envelope: { ...f.run.envelope, runId, itemId: runId, enqueuedAt: now },
        lifecycle: { state: "queued" }, version: 1, claimGeneration: 0, createdAt: now, updatedAt: now,
      }));
      f.servedReader.list = () => { throw new Error("consumer-must-not-enumerate-history"); };
      let after: { localDay: string; runId: string } | undefined;
      const seen: string[] = [];
      do {
        const page = queryQueueSummaries(f.db, { workflow: "person-lookup", fromDay: "2026-09-09", toDay: "2026-09-09",
          status: "queued", limit: 1, ...(after === undefined ? {} : { after }) });
        seen.push(...page.items.map((row) => row.runId));
        after = page.next ?? undefined;
      } while (after !== undefined);
      assert.deepEqual(seen, selectedIds);
      const served = f.projection.buildDashboardDayWire("2026-09-09").queueSurfaces;
      assert.deepEqual(visibleRunIds(served), seen);
      const markup = panelMarkup(served);
      for (const runId of seen) assert.equal(markup.split(`data-demo-row-id="${runId}"`).length - 1, 1);
      assert.deepEqual(queryQueueSummaries(f.db, { workflow: "person-lookup", status: "failed", limit: 1 }).items, []);
    } finally { f.dispose(); }
  });

  it("renders one queue row for repeated item attempts and opens the exact selected run", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const first = rowWhere((row) => row.surfaceKind === "single" && row.status === "failed");
    const newest = QueueSurfaceWireSchema.parse({
      ...first,
      runId: uuidOf(9710),
      itemId: first.itemId,
      attempt: first.attempt + 1,
      status: "done",
      endedAt: { state: "present", value: FIXTURE_NOW },
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const opened: string[] = [];
    try {
      await act(async () => root.render(createElement(QueuePanel, {
        surfaces: [first, newest],
        state: { nowIso: FIXTURE_NOW, openWells: new Set<string>(), panelWorkflowId: "person-lookup" },
        handlers: { onSelect: (runId) => opened.push(runId) },
        workflowLabelOf: () => "Person Lookup",
        panelLabel: "Person Lookup",
        day: FIXTURE_DAY,
      })));
      assert.equal(host.querySelectorAll("[data-demo-row-id]").length, 1);
      assert.equal(host.querySelector("[data-demo-row-id]")?.getAttribute("data-demo-row-id"), String(newest.runId));
      assert.equal(host.querySelector("[data-demo-row-id]")?.getAttribute("aria-label"), queueRowAccessibleName(newest, FIXTURE_NOW));
      assert.equal(host.querySelector("button[title=\"Attempt 2\"]")?.textContent?.trim(), "#2");
      const trigger = host.querySelector<HTMLButtonElement>(`button[aria-label="Attempts for ${queueRowTitle(newest)}"]`);
      assert.ok(trigger);
      await act(async () => trigger.click());
      const attempt = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(node => node.textContent?.includes(`#${first.attempt}`));
      assert.ok(attempt);
      assert.match(attempt.textContent ?? "", new RegExp(`#${String(first.attempt)}.*Failed`, "u"));
      await act(async () => attempt.click());
      assert.deepEqual(opened, [String(first.runId)]);
      assert.deepEqual(groupQueueAttempts([first, newest])[0]?.attempts.map((entry) => entry.runId), [newest.runId, first.runId]);
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  });

  it("renders warning and duration facts without replacing unavailable values with plausible defaults", () => {
    const warned = rowWhere((row) => row.warnings.state === "present");
    const running = rowWhere((row) => row.status === "running" && row.endedAt.state === "absent");
    const warningMarkup = rowMarkup(warned);
    assert.match(warningMarkup, /lucide-triangle-alert/u);
    assert.match(warningMarkup, new RegExp(`>${String(warned.warnings.state === "present" ? warned.warnings.count : 0)}</span>`, "u"));
    assert.match(queueRowAccessibleName(running, FIXTURE_NOW), /running/u);
    const unavailable = QueueSurfaceWireSchema.parse({ ...running, subtitle: { state: "absent", reason: "Summary subtitle unavailable" } });
    assert.deepEqual(rowInfoFacts(unavailable).find((fact) => fact.label === "Subtitle"), {
      label: "Subtitle", state: "absent", text: "Summary subtitle unavailable",
    });
    assert.equal(rowMarkup(running).includes("took 0s"), false);
  });

  it("draws only canonical served actions; an action-free summary cannot manufacture authorization", () => {
    const queued = rowWhere((row) => row.status === "queued" && row.surfaceKind === "single");
    const authorized = rowMarkup(queued);
    assert.match(authorized, /aria-label="Cancel run/u);
    assert.match(authorized, /aria-label="Run next/u);

    const actionFree = QueueSurfaceWireSchema.parse({ ...queued, actions: [] });
    const refused = rowMarkup(actionFree);
    assert.doesNotMatch(refused, /aria-label="Cancel run/u);
    assert.doesNotMatch(refused, /aria-label="Run next/u);
  });

  it("dispatches the exact served descriptor and revision, and removes the control when authorization disappears", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const queued = rowWhere((row) => row.status === "queued" && row.surfaceKind === "single");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const calls: unknown[][] = [];
    const selections: string[] = [];
    const draw = (surface: QueueSurfaceWire) => createElement(QueueRow, {
      surface,
      state: { nowIso: FIXTURE_NOW, openWells: new Set<string>(), panelWorkflowId: "person-lookup" },
      handlers: { onSelect: (runId) => { selections.push(runId); }, onAction: (...args) => { calls.push(args); } },
      actionsOf: (candidate: QueueSurfaceWire) => candidate.actions,
      workflowLabelOf: () => "Person Lookup",
    });
    try {
      await act(async () => { root.render(draw(queued)); });
      const cancel = host.querySelector<HTMLButtonElement>('button[aria-label^="Cancel run"]');
      assert.ok(cancel);
      for (const key of ["Enter", " "]) {
        const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
        await act(async () => { cancel.dispatchEvent(event); });
        assert.equal(event.defaultPrevented, false, "nested action must retain native keyboard activation");
        assert.deepEqual(selections, []);
      }
      await act(async () => { cancel.click(); });
      assert.equal(calls.length, 1);
      assert.ok(queued.actions.includes(calls[0]?.[0] as typeof queued.actions[number]));
      assert.deepEqual(calls[0]?.[1], { runId: queued.runId, expectedVersion: queued.rowRevision });
      const row = host.querySelector<HTMLElement>(`[data-demo-row-id="${queued.runId}"]`);
      assert.ok(row);
      await act(async () => { row.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
      assert.deepEqual(selections, [queued.runId]);
      await act(async () => { root.render(draw(QueueSurfaceWireSchema.parse({ ...queued, actions: [] }))); });
      assert.equal(host.querySelector('button[aria-label^="Cancel run"]'), null);
      assert.equal(calls.length, 1);
    } finally {
      await act(async () => { root.unmount(); });
      host.remove();
      vi.unstubAllGlobals();
    }
  });
});
