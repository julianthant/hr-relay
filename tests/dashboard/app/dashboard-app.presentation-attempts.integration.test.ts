// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, it } from "vitest";
import { DashboardApp } from "../../../src/dashboard/app/dashboard-app.js";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { FrontendBootstrapWireSchema } from "../../../src/models/dashboard/bootstrap.js";
import { ItemAttemptHistoryResponseSchema } from "../../../src/models/dashboard/item-attempt-history.js";
import { createRunQueueProjectionTestWorld } from "../../support/helpers/backend/run-queue-projection-world.js";
import { personLookupDescriptor } from "../../support/helpers/registered-workflows.js";
import { seedPersonLookupPresentation } from "../../support/fixtures/person-lookup-presentation.js";
import { uuidOf } from "../../support/helpers/backend/dashboard-harness.js";
import { FIXTURE_BOOTSTRAP } from "../../parity/helpers/fixture-bootstrap.js";
import { PARITY_WORKFLOW_COMPOSITION } from "../../parity/helpers/workflow-composition.js";
import { createFixtureBff } from "../../support/helpers/dashboard/fixture-bff.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
Reflect.set(globalThis, "ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
const { world, cleanup } = createRunQueueProjectionTestWorld();
afterEach(() => { cleanup(); document.body.replaceChildren(); localStorage.clear(); window.history.replaceState(null, "", "/"); });
it("shows the selected day's runs by start time and keeps that day when an attempt is selected", async () => {
  const w = world({ descriptors: { resolve: () => personLookupDescriptor } });
  const selectedDay = "2026-08-03";
  const runs = [
    { seed: 86, attempt: 3, enqueuedAt: "2026-08-03T17:40:00.000Z" },
    { seed: 81, attempt: 1, enqueuedAt: "2026-07-31T17:01:00.000Z" },
    { seed: 83, attempt: 7, enqueuedAt: "2026-08-03T17:10:00.000Z" },
    { seed: 87, attempt: 6, enqueuedAt: "2026-08-03T17:50:00.000Z" },
    { seed: 82, attempt: 2, enqueuedAt: "2026-07-31T17:02:00.000Z" },
    { seed: 85, attempt: 4, enqueuedAt: "2026-08-03T17:30:00.000Z" },
    { seed: 84, attempt: 5, enqueuedAt: "2026-08-03T17:20:00.000Z" },
  ].map(({ seed, attempt, enqueuedAt }) => seedPersonLookupPresentation(w, { seed, attempt, itemId: uuidOf(5081), enqueuedAt }).run);
  const current = w.projection.buildDashboardDayWire(selectedDay);
  const chronologicalRunIds = [uuidOf(83), uuidOf(84), uuidOf(85), uuidOf(86), uuidOf(87)];
  assert.equal(current.queueSurfaces.length, 5);
  assert.equal(current.workflowCounts.find(count => count.workflowId === "person-lookup")?.count, 5);
  assert.deepEqual(current.attemptHistory?.map(entry => entry.runId).toSorted(), chronologicalRunIds.toSorted());
  const { app } = createFixtureBff();
  const transport = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (input, init) => {
    const url = new URL(String(input));
    const history = /^\/api\/v1\/runs\/([^/]+)\/attempt-history$/u.exec(url.pathname);
    if (history !== null) {
      const selected = runs.find(run => run.envelope.runId === history[1]); assert.ok(selected);
      return Response.json(ItemAttemptHistoryResponseSchema.parse({ schemaVersion: 1, state: "available",
        selected: { state: "present", disposition: "live", runId: selected.envelope.runId, workflowId: "person-lookup", itemId: selected.envelope.itemId,
          attempt: selected.envelope.attempt, rowRevision: selected.version },
        item: { workflowId: "person-lookup", itemId: selected.envelope.itemId },
        page: { limit: 25, offset: 0, totalEntries: runs.length, nextCursor: null, entries: runs.map(run => ({ disposition: "live",
          runId: run.envelope.runId, workflowId: "person-lookup", itemId: run.envelope.itemId, attempt: run.envelope.attempt,
          rowRevision: run.version, partitionDay: run.envelope.enqueuedAt.slice(0, 10) })) } }));
    }
    return app.request(String(input), init);
  } });
  const history = await transport.itemAttemptHistory(uuidOf(87));
  if (history.state !== "available") throw new Error("fixture attempt history unavailable");
  assert.deepEqual(history.page.entries.map(entry => entry.runId).toSorted(), runs.map(run => run.envelope.runId).toSorted());
  const client = { ...transport,
    bootstrap: async () => FrontendBootstrapWireSchema.parse({ ...FIXTURE_BOOTSTRAP, descriptorHash: current.descriptorHash }),
    subscribeDay: (input: Parameters<typeof transport.subscribeDay>[0]) => {
      input.onDay(w.projection.buildDashboardDayWire(input.day)); input.onState({ state: "live" }); return { close() {} };
    },
  };
  window.history.replaceState(null, "", `/?day=${selectedDay}`);
  localStorage.setItem("hr-dashboard.workflow-panel", "sidebar");
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(DashboardClientProvider, { client, children: createElement(DashboardApp, { workflowComposition: PARITY_WORKFLOW_COMPOSITION }) })));
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-label^="Attempts for"]'); assert.ok(trigger);
    assert.equal(host.querySelectorAll("[data-demo-row-id]").length, 1);
    assert.equal(host.querySelector("[data-demo-row-id]")?.getAttribute("data-demo-row-id"), chronologicalRunIds[chronologicalRunIds.length - 1]);
    await act(async () => trigger.click());
    const options = [...document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
    assert.equal(trigger.textContent?.match(/#\d+/u)?.[0], "#5");
    assert.deepEqual(options.map(option => option.textContent?.match(/#\d+/u)?.[0]), ["#1", "#2", "#3", "#4", "#5"]);
    await act(async () => options[1]?.click());
    const route = new URLSearchParams(window.location.search);
    assert.equal(route.get("run"), chronologicalRunIds[1]);
    assert.equal(route.get("day"), selectedDay);
  } finally { await act(async () => root.unmount()); }
});
