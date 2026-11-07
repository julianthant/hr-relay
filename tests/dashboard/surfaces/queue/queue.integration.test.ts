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
visibleQueueKeys,
queueScopeWorkflow
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

import { queueParentFixture } from "../../../support/helpers/dashboard/queue-parent-fixture.js";
import { queueKeyboardEntries, queueMemberKey, queueMemberSelection } from "../../../../src/dashboard/surfaces/queue/queue-model.js";
import type { QueueRecordMember } from "../../../../src/models/dashboard/projection.js";

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
  it("keeps shared lookup records individually selectable and targets failed pages at their own logs", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const source = rowWhere(row => row.surfaceKind === "operation" && row.memberRunIds.length === 3);
    assert.equal(source.surfaceKind, "operation");
    if (source.surfaceKind !== "operation") throw new Error("operation fixture changed shape");
    const members = source.memberRunIds.map(runId => rowWhere(row => row.runId === runId));
    const owner = { runId: source.runId, workflowId: "ocr", partitionDay: FIXTURE_DAY, label: "OCR", status: "awaiting-approval", panelKind: "review" };
    const refs = [1, 2, 3].map(page => ({ runId: source.runId, recordId: `${"a".repeat(64)}#emergency-contact#${page}` }));
    const surface = QueueSurfaceWireSchema.parse({ ...source, title: "Three source records", recordMembers: {
      runIds: source.memberRunIds, members: [...refs.map((record, index) => ({ kind: "record", record,
        title: index === 1 ? "Example, Robin" : "Example, Avery", status: "awaiting-approval", statusLabel: "Needs lookup",
        childRunIds: [members[index === 1 ? 1 : 0].runId], target: { ...owner, section: "review", record } })),
      { kind: "page-failure", ownerRunId: source.runId, sourcePage: 9, title: "Page 9", status: "failed", statusLabel: "Failed",
        childRunIds: [members[2].runId], target: { ...owner, runId: members[2].runId, workflowId: "ocr-page", label: "OCR page", panelKind: "run", status: "failed", section: "logs" } }],
    } });
    assert.equal(surface.surfaceKind, "operation");
    if (surface.surfaceKind !== "operation" || surface.recordMembers === undefined) throw new Error("record fixture missing");
    const served = [surface, ...members];
    const keys = visibleQueueKeys(served);
    assert.equal(new Set(keys).size, 5);
    assert.ok(members.every(member => !keys.includes(member.runId)));
    const recordMembers = surface.recordMembers;
    assert.deepEqual(queueKeyboardEntries(served).filter(entry => entry.kind === "record").map(entry => entry.member),
      [recordMembers.members[3], ...recordMembers.members.slice(0, 3)]);
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    const selected: QueueRecordMember[] = [], native: string[] = [];
    try {
      await act(async () => root.render(createElement(QueuePanel, {
        surfaces: served, state: { nowIso: FIXTURE_NOW, openWells: new Set<string>(), selectedMember: queueMemberSelection(recordMembers.members[1]) },
        handlers: { onSelect: runId => native.push(runId), onOpenMember: member => selected.push(member) },
        workflowLabelOf: () => "Fixture", panelLabel: "Fixture", day: FIXTURE_DAY,
      })));
      for (const member of surface.recordMembers.members) {
        const key = queueMemberKey(queueMemberSelection(member));
        const line = [...host.querySelectorAll<HTMLTableRowElement>("tr[data-demo-row-id]")].find(line => line.dataset.demoRowId === key);
        assert.ok(line);
        for (const target of [line, ...line.cells]) {
          selected.length = 0;
          await act(async () => target.dispatchEvent(new MouseEvent("click", { bubbles: true })));
          assert.deepEqual(selected, [member]);
        }
        const name = line.querySelector<HTMLButtonElement>("button[aria-pressed]"); assert.ok(name);
        assert.equal(name.type, "button"); assert.equal(name.tabIndex, 0);
        assert.doesNotMatch(name.className, /underline/u);
        selected.length = 0;
        await act(async () => name.click());
        assert.deepEqual(selected, [member]);
        assert.doesNotMatch(line.textContent ?? "", /Retry/u);
      }
      assert.deepEqual(native, []);
      assert.equal(host.querySelectorAll('button[aria-pressed="true"]').length, 1);
      if (source.memberPreview.state === "present") assert.ok(!host.textContent?.includes(source.memberPreview.value));
    } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
  });
  it("keeps operation members contained once while keyboard traversal reaches the same loaded rows", () => {
    const operation = rowWhere((row) => row.surfaceKind === "operation" && row.memberRunIds.length === 3);
    assert.equal(operation.surfaceKind, "operation");
    if (operation.surfaceKind !== "operation") throw new Error("operation fixture changed shape");
    const selected = rows.filter((row) => row.runId === operation.runId
      || (row.parent !== null && row.parent.runId === operation.runId));

    const partitioned = partition(selected);
    assert.deepEqual(partitioned.top.map((row) => row.runId), [operation.runId]);
    assert.deepEqual(
      new Set((partitioned.membersOf.get(operation.runId) ?? []).map((row) => row.runId)),
      new Set(operation.memberRunIds),
    );
    assert.deepEqual(new Set(visibleQueueKeys(selected)), new Set([operation.runId, ...operation.memberRunIds]));

    const markup = panelMarkup(selected);
    assert.equal((markup.match(new RegExp(`data-demo-row-id="${operation.runId}"`, "gu")) ?? []).length, 1);
    for (const memberRunId of operation.memberRunIds) {
      assert.equal((markup.match(new RegExp(`data-demo-row-id="${memberRunId}"`, "gu")) ?? []).length, 1);
    }
    assert.match(markup, new RegExp(`${operation.memberRollup.terminal} of ${operation.memberRollup.total} finished; ${operation.memberRollup.failed} failed`, "u"));
  });

  it("retains nested inline context, failure lines, linked gates and keyboard traversal", () => {
    const base = rowWhere(row => row.surfaceKind === "single");
    const parent = QueueSurfaceWireSchema.parse({ ...base, surfaceKind: "operation", runId: uuidOf(4301), parent: null,
      title: "Outer group", memberRunIds: [uuidOf(4302)], memberRollup: { total: 1, terminal: 0, failed: 0 },
      memberPreview: { state: "present", value: "Inner group" } });
    const nested = QueueSurfaceWireSchema.parse({ ...parent, runId: uuidOf(4302), workflowId: "ocr", title: "Inner group",
      parent: queueParentFixture(parent.runId, { workflowId: parent.workflowId }), memberRunIds: [uuidOf(4303)],
      memberRollup: { total: 1, terminal: 1, failed: 1 }, linkedRuns: [{ runId: uuidOf(4304), workflowId: "i9-lookup",
        partitionDay: FIXTURE_DAY, label: "I-9 lookup", panelKind: "review", status: "awaiting-approval" }] });
    const failed = QueueSurfaceWireSchema.parse({ ...base, runId: uuidOf(4303), workflowId: "ocr-page", title: "Page 9",
      parent: queueParentFixture(nested.runId, { visibility: "hidden-unless-failed", workflowId: nested.workflowId }),
      status: "failed", endedAt: { state: "present", value: FIXTURE_NOW } });
    const served = [parent, nested, failed];
    assert.equal(queueScopeWorkflow(failed, served), parent.workflowId);
    assert.equal(queueScopeWorkflow(nested, served), parent.workflowId);
    assert.deepEqual(visibleQueueKeys(served), [parent.runId, nested.runId, failed.runId]);
    const markup = panelMarkup(served);
    for (const row of served) assert.equal((markup.match(new RegExp(`data-demo-row-id="${row.runId}"`, "gu")) ?? []).length, 1);
    assert.match(markup, /I-9 lookup/u);
    assert.match(markup, /Members of Inner group/u);
    assert.match(markup, /Page 9/u);
  });

  it("selects the member from the whole line and retains its keyboard button", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const operation = rowWhere((row) => row.surfaceKind === "operation" && row.memberRunIds.length === 3);
    assert.equal(operation.surfaceKind, "operation");
    if (operation.surfaceKind !== "operation") throw new Error("operation fixture changed shape");
    const members = operation.memberRunIds.map(runId => rowWhere(row => row.runId === runId));
    const member = members[0];
    assert.ok(member);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const opened: string[] = [];
    try {
      await act(async () => root.render(createElement(QueuePanel, {
        surfaces: [operation, ...members],
        state: { nowIso: FIXTURE_NOW, selectedRunId: operation.runId, openWells: new Set<string>() },
        handlers: { onSelect: runId => opened.push(runId) },
        workflowLabelOf: () => "Fixture",
        panelLabel: "Fixture",
        day: FIXTURE_DAY,
      })));
      const line = host.querySelector<HTMLTableRowElement>(`tr[data-demo-row-id="${member.runId}"]`);
      assert.ok(line);
      const status = line.querySelector("td:last-child span");
      assert.ok(status);
      for (const target of [line, ...line.cells, status]) {
        opened.length = 0;
        await act(async () => { target.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
        assert.deepEqual(opened, [String(member.runId)]);
      }
      const name = line.querySelector<HTMLButtonElement>("button[aria-pressed]");
      assert.ok(name);
      assert.equal(name.tagName, "BUTTON");
      assert.equal(name.type, "button");
      assert.equal(name.tabIndex, 0);
      name.focus();
      assert.equal(document.activeElement, name);
      opened.length = 0;
      await act(async () => name.click());
      assert.deepEqual(opened, [String(member.runId)]);
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  });

  it("retains every row when bounded summary pages are assembled, then applies only the requested scope", async () => {
    const f = await summaryFixture();
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
      assert.deepEqual(visibleQueueKeys(served), seen);
      const markup = panelMarkup(served);
      for (const runId of seen) assert.equal(markup.split(`data-demo-row-id="${runId}"`).length - 1, 1);
      assert.deepEqual(queryQueueSummaries(f.db, { workflow: "person-lookup", status: "failed", limit: 1 }).items, []);
    } finally { await f.dispose(); }
  });

  it("renders one queue row for repeated item attempts and opens the exact selected run", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const first = QueueSurfaceWireSchema.parse({ ...rowWhere((row) => row.surfaceKind === "single" && row.status === "failed"), attempt: 7, startedAt: "2026-08-03T16:00:00.000Z" });
    const newest = QueueSurfaceWireSchema.parse({
      ...first,
      runId: uuidOf(9710),
      itemId: first.itemId,
      attempt: first.attempt + 1,
      startedAt: "2026-08-03T17:00:00.000Z",
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
      const attempt = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(node => node.textContent?.includes("#1"));
      assert.ok(attempt);
      assert.match(attempt.textContent ?? "", /#1.*Failed/u);
      await act(async () => attempt.click());
      assert.deepEqual(opened, [String(first.runId)]);
      assert.equal(first.attempt, 7);
      assert.equal(newest.attempt, 8);
      await act(async () => root.render(createElement(QueuePanel, {
        surfaces: [first, newest],
        state: { nowIso: FIXTURE_NOW, selectedRunId: first.runId, openWells: new Set<string>(), panelWorkflowId: "person-lookup" },
        handlers: { onSelect: (runId) => opened.push(runId) },
        workflowLabelOf: () => "Person Lookup",
        panelLabel: "Person Lookup",
        day: FIXTURE_DAY,
      })));
      assert.equal(host.querySelector("button[title=\"Attempt 1\"]")?.textContent?.trim(), "#1");
      assert.deepEqual(groupQueueAttempts([first, newest])[0]?.attempts.map((entry) => entry.runId), [newest.runId, first.runId]);
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  });

  it("renames a row title in place only when the host offers it: Enter saves, Escape cancels, empty restores", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const row = rowWhere((candidate) => candidate.surfaceKind === "single" && candidate.parent === null);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const renamed: [string, string][] = [];
    const draw = (onRenameTitle?: (runId: string, name: string) => void) => createElement(QueuePanel, {
      surfaces: [row],
      state: { nowIso: FIXTURE_NOW, openWells: new Set<string>(), panelWorkflowId: row.workflowId },
      handlers: { onSelect: () => undefined, ...(onRenameTitle === undefined ? {} : { onRenameTitle }) },
      workflowLabelOf: () => "Person Lookup",
      panelLabel: "Person Lookup",
      day: FIXTURE_DAY,
    });
    const title = () => host.querySelector<HTMLElement>("[data-demo-row-title]");
    const input = () => host.querySelector<HTMLInputElement>('input[aria-label="Run name"]');
    const edit = async (value: string, key: string) => {
      await act(async () => title()?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
      const field = input();
      assert.ok(field);
      assert.equal(field.value, queueRowTitle(row));
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, value);
        field.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => field.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
      assert.equal(input(), null);
    };
    try {
      await act(async () => root.render(draw()));
      await act(async () => title()?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
      assert.equal(input(), null);
      await act(async () => root.render(draw((runId, name) => renamed.push([runId, name]))));
      await edit("  April contacts  ", "Enter");
      await edit("Ignored", "Escape");
      await edit("", "Enter");
      assert.deepEqual(renamed, [[row.runId, "April contacts"], [row.runId, ""]]);
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
