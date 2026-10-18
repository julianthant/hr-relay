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
it("acquires cross-day served history for the mounted attempts menu and opens the selected attempt's day", async () => {
  const w = world({ descriptors: { resolve: () => personLookupDescriptor } });
  const runs = Array.from({ length: 7 }, (_, index) => seedPersonLookupPresentation(w, {
    seed: 81 + index, attempt: index + 1, itemId: uuidOf(5081),
    enqueuedAt: `${index < 2 ? "2026-07-31" : "2026-08-03"}T17:0${index + 1}:00.000Z`,
  }).run);
  const current = w.projection.buildDashboardDayWire("2026-08-03");
  assert.equal(current.queueSurfaces.length, 5);
  assert.equal(current.workflowCounts.find(count => count.workflowId === "person-lookup")?.count, 5);
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
    if (url.pathname === "/api/v1/dashboard") return Response.json(w.projection.buildDashboardDayWire(url.searchParams.get("day") ?? "2026-08-03"));
    return app.request(String(input), init);
  } });
  const client = { ...transport,
    bootstrap: async () => FrontendBootstrapWireSchema.parse({ ...FIXTURE_BOOTSTRAP, descriptorHash: current.descriptorHash }),
    subscribeDay: (input: Parameters<typeof transport.subscribeDay>[0]) => {
      input.onDay(w.projection.buildDashboardDayWire(input.day)); input.onState({ state: "live" }); return { close() {} };
    },
  };
  window.history.replaceState(null, "", "/?day=2026-08-03");
  localStorage.setItem("hr-dashboard.workflow-panel", "sidebar");
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(DashboardClientProvider, { client, children: createElement(DashboardApp, { workflowComposition: PARITY_WORKFLOW_COMPOSITION }) })));
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-label^="Attempts for"]'); assert.ok(trigger);
    assert.equal(host.querySelectorAll("[data-demo-row-id]").length, 1);
    await act(async () => trigger.click());
    const options = [...document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
    assert.deepEqual(options.map(option => option.textContent?.match(/#\d+/u)?.[0]), ["#1", "#2", "#3", "#4", "#5", "#6", "#7"]);
    await act(async () => options[0].click());
    const route = new URLSearchParams(window.location.search);
    assert.equal(route.get("run"), uuidOf(81));
    assert.equal(route.get("day"), "2026-07-31");
  } finally { await act(async () => root.unmount()); }
});
