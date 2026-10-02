// @vitest-environment jsdom
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { QueueSurfaceWireSchema, type QueueSurfaceWire } from "../../../src/domain/dashboard/projection.js";
import { QueueRow } from "../../../src/dashboard/surfaces/queue.js";
import { StatusBadge } from "../../../src/dashboard/surfaces/status.js";
import { orderMembers, type MemberSurfaceWire } from "../../../src/dashboard/surfaces/queue-model.js";
import { FIXTURE_DAY_WIRE } from "../../parity/helpers/fixture-queue.js";
import { FIXTURE_NOW } from "../../parity/helpers/fixture-identity.js";

function single(status: QueueSurfaceWire["status"]): QueueSurfaceWire {
  const row = FIXTURE_DAY_WIRE.queueSurfaces.find(row => row.surfaceKind === "single" && row.status === status);
  assert.ok(row, `missing ${status} fixture`);
  return row;
}
function render(surface: QueueSurfaceWire, members: readonly MemberSurfaceWire[] = [], selectMode = false): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(QueueRow, {
    surface, members, state: { nowIso: FIXTURE_NOW, openWells: new Set<string>(), selectMode, panelWorkflowId: surface.workflowId },
    handlers: { onSelect: () => {}, onToggleBulk: () => {} }, workflowLabelOf: () => "Separations",
  }));
  return host;
}

describe("approved mixed queue presentation", () => {
  it("keeps mode hazards and the footer attempt while removing leading and info controls", () => {
    const base = single("done");
    const row = QueueSurfaceWireSchema.parse({ ...base, dryRun: true, resolvedInstances: base.resolvedInstances.map(instance => ({ ...instance, instance: "test" })) });
    const host = render(row);
    const body = host.querySelector("[data-queue-body]");
    assert.ok(body);
    assert.equal(body.querySelector("[data-demo-row-title]")?.textContent, row.title);
    assert.equal(body.firstElementChild?.querySelector("svg"), null);
    assert.ok(host.textContent?.includes("dry run"));
    assert.ok(host.textContent?.includes("test"));
    assert.ok(host.textContent?.includes("Done"));
    assert.equal(host.querySelector('[aria-label^="What is this row"]'), null);
    assert.equal(body.querySelector('[aria-label^="Attempts for"]'), null);
    assert.equal(host.querySelector('[aria-label^="Attempts for"]')?.textContent, `#${row.attempt}`);
    assert.ok(host.textContent?.includes(row.traceId));
    assert.ok(!host.textContent?.includes("Attempts ·"));
  });
  it("shows all served progress states, measured durations and the step count below the bar", () => {
    const row = single("running");
    const host = render(row);
    const bar = host.querySelector("[data-queue-progress]");
    assert.ok(bar);
    assert.equal(bar.children.length, row.pipeline.length);
    assert.ok(bar.nextElementSibling?.textContent?.includes(`${row.pipeline.filter(step => step.state === "done").length} / ${row.pipeline.length} steps`));
    assert.ok(!host.textContent?.includes("nodes"));
    for (const [index, step] of row.pipeline.entries()) {
      assert.ok(bar.children[index]?.getAttribute("title")?.includes(`(${step.state})`));
      if (step.durationSec !== undefined) assert.ok(bar.children[index]?.getAttribute("title")?.match(/[0-9]+s|[0-9]+m/u));
    }
    assert.equal(host.querySelectorAll(".animate-spin").length, 1);
    assert.ok(host.querySelector(".animate-spin")?.closest("[data-slot=badge]"));
    const absent = QueueSurfaceWireSchema.parse({ ...row, pipeline: [], liveMessage: { state: "absent", reason: "No active step was recorded" } });
    const empty = render(absent);
    assert.equal(empty.querySelector("[data-queue-progress]"), null);
    assert.ok(!empty.textContent?.includes("0 / 0"));
  });
  it("omits an unmeasured terminal duration and preserves measured zero", () => {
    const done = single("done");
    const unknown = render(QueueSurfaceWireSchema.parse({ ...done, endedAt: { state: "absent", reason: "Historical end not retained" } }));
    assert.ok(!unknown.textContent?.includes("duration unknown"));
    assert.ok(!unknown.textContent?.includes("0s"));
    const zero = render(QueueSurfaceWireSchema.parse({ ...done, endedAt: { state: "present", value: done.startedAt } }));
    assert.ok(zero.textContent?.includes("0s"));
  });
  it("places the bulk selector outside the card and keeps the row's selection target", () => {
    const row = single("queued");
    const host = render(row, [], true);
    const target = host.querySelector("[data-demo-row-id]");
    assert.ok(target);
    const checkbox = host.querySelector('[role="checkbox"]');
    assert.ok(checkbox);
    assert.ok(!target.contains(checkbox));
    assert.equal(target.getAttribute("tabindex"), "0");
    assert.equal(target.getAttribute("aria-pressed"), "false");
  });
  it("shows the served group counter and ordered member statuses in Name/Status columns", () => {
    const operation = FIXTURE_DAY_WIRE.queueSurfaces.find(row => row.surfaceKind === "operation" && row.memberRunIds.length === 3);
    assert.ok(operation && operation.surfaceKind === "operation");
    const members = FIXTURE_DAY_WIRE.queueSurfaces.filter((row): row is MemberSurfaceWire => row.surfaceKind === "member" && operation.memberRunIds.includes(row.runId));
    const host = render(operation, members);
    assert.equal(host.querySelector('[data-queue-member-count]')?.textContent?.trim(), `${operation.memberRollup.terminal}/${operation.memberRollup.total}`);
    assert.deepEqual([...host.querySelectorAll("th")].map(cell => cell.textContent), ["Name", "Status"]);
    const ordered = orderMembers(members);
    assert.deepEqual([...host.querySelectorAll("tbody tr")].map(row => row.getAttribute("data-demo-row-id")), ordered.map(row => String(row.runId)));
    assert.ok([...host.querySelectorAll("tbody tr")].every(row => row.querySelector("td svg") && row.querySelector("td:last-child")?.textContent));
    const unloaded = render(operation);
    assert.ok(unloaded.textContent?.includes("Members not loaded"));
    assert.equal(unloaded.querySelector('[data-queue-member-count]')?.textContent?.trim(), `${operation.memberRollup.terminal}/${operation.memberRollup.total}`);
    assert.deepEqual([...unloaded.querySelectorAll("th")].map(cell => cell.textContent), ["Name", "Status"]);
  });
  it("uses blue for Review messages and preserves yellow Write parked messages", () => {
    const review = render(single("awaiting-approval"));
    const parked = render(single("blocked"));
    assert.ok(review.querySelector("[data-queue-body] .text-ui-info"));
    assert.equal(review.querySelector("[data-queue-body] [class*=ds-status-waiting-fg]"), null);
    assert.ok(parked.querySelector("[data-queue-body] [class*=ds-status-parked-fg]"));
  });
  it("scopes the revised attention treatments to queue pills", () => {
    for (const status of ["waiting", "failed"] as const) {
      const current = renderToStaticMarkup(createElement(StatusBadge, { status }));
      const queue = renderToStaticMarkup(createElement(StatusBadge, { status, presentation: "queue" }));
      assert.notEqual(current, queue);
      assert.match(queue, /svg/u);
      assert.match(queue, status === "waiting" ? /ds-queue-info-bg/u : /ds-queue-danger-bg/u);
    }
  });
});
