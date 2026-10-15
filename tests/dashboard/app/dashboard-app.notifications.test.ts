// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it, vi } from "vitest";
import { DashboardApp } from "../../../src/dashboard/app/dashboard-app.js";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { parseRoute } from "../../../src/dashboard/app/navigation/url-state.js";
import { PRODUCT_WORKFLOW_COMPOSITION } from "../../../src/dashboard/app/workflow-sources.js";
import { FIXTURE_DAY_WIRE } from "../../parity/helpers/fixture-queue.js";
import { FIXTURE_IDS } from "../../support/fixtures/dashboard/fixture-queue.js";
import { FIXTURE_FAILURE_SECTIONS } from "../../support/fixtures/dashboard/run-detail/receipts-failures.js";
import { createFixtureBff } from "../../support/helpers/dashboard/fixture-bff.js";
import { RunIdSchema } from "../../../src/rules/identity/ids.js";
import { LocalDateSchema } from "../../../src/rules/identity/ids.js";
import type { NotificationDestination } from "../../../src/dashboard/surfaces/notifications/notifications-view-model.js";
import { notificationTargetUnavailable } from "../../../src/dashboard/app/navigation/notification-navigation.js";

const requested = vi.hoisted(() => ({ target: undefined as NotificationDestination | undefined }));
vi.mock("../../../src/dashboard/surfaces/notifications/notifications-preview-model.js", async importOriginal => ({
  ...await importOriginal<typeof import("../../../src/dashboard/surfaces/notifications/notifications-preview-model.js")>(),
  useWorkspaceNotifications: () => ({ state: "ready", pinned: [], items: [{ id: "canonical", title: "Run failed", subject: "Canonical history", workflow: "Person Lookup", detail: "Failure", tone: "danger", age: "", read: false, action: "Open exact target", destination: requested.target }] }),
}));
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
Reflect.set(globalThis, "ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
Reflect.set(globalThis, "requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0));
Reflect.set(globalThis, "cancelAnimationFrame", clearTimeout);
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); localStorage.clear(); vi.restoreAllMocks(); window.history.replaceState(null, "", "/"); });
async function mount(missing = false) {
  const { app } = createFixtureBff();
  const transport = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => app.request(url, init) });
  const reads: string[] = [];
  const client = { ...transport,
    dashboardDay: async (day: string) => { reads.push(day); return { ...FIXTURE_DAY_WIRE, day: LocalDateSchema.parse(day), queueSurfaces: missing ? [] : FIXTURE_DAY_WIRE.queueSurfaces }; },
    subscribeDay: (input: Parameters<typeof transport.subscribeDay>[0]) => {
      input.onDay({ ...FIXTURE_DAY_WIRE, day: LocalDateSchema.parse(input.day) }); input.onState({ state: "live" }); return { close() {} };
    },
  };
  window.history.replaceState(null, "", "/?day=2026-08-04");
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root?.render(createElement(DashboardClientProvider, { client, children: createElement(DashboardApp) })); await new Promise(resolve => setTimeout(resolve, 20)); });
  const bell = document.querySelector<HTMLButtonElement>('button[aria-label^="Notifications,"]'); assert(bell);
  await act(async () => { bell.click(); await new Promise(resolve => setTimeout(resolve, 10)); });
  const target = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Open exact target"); assert(target);
  await act(async () => { target.click(); await new Promise(resolve => setTimeout(resolve, 30)); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  return { host, reads };
}
it("opens canonical historical run detail while ordinary workflow sources remain mock", async () => {
  const runId = RunIdSchema.parse(FIXTURE_IDS.failedRun);
  const row = FIXTURE_DAY_WIRE.queueSurfaces.find(row => row.runId === runId); assert(row);
  assert.equal(PRODUCT_WORKFLOW_COMPOSITION.sources[row.workflowId], "mock");
  requested.target = { kind: "run", runId, day: FIXTURE_DAY_WIRE.day };
  const { host, reads } = await mount();
  assert.deepEqual(reads, [FIXTURE_DAY_WIRE.day]);
  const params = new URLSearchParams(location.search);
  assert.equal(params.get("run"), runId);
  assert.equal(params.get("day"), FIXTURE_DAY_WIRE.day);
  assert(host.textContent?.includes("Source order · cross-source chronology unavailable"));
  assert.equal(host.textContent?.includes("Run unavailable"), false);
});
it("opens the exact failure step through the existing Logs initial focus input", async () => {
  const section = FIXTURE_FAILURE_SECTIONS[FIXTURE_IDS.failedRun].failure;
  assert(section.section === "failure" && section.payload.state === "available");
  const failureId = section.payload.value.failureId;
  requested.target = { kind: "failure", runId: RunIdSchema.parse(FIXTURE_IDS.failedRun), failureId, day: FIXTURE_DAY_WIRE.day };
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const top = this.getAttribute("aria-labelledby")?.endsWith(failureId) ? 1200 : 0;
    return { x: 0, y: top, top, left: 0, right: 100, bottom: top + 100, width: 100, height: 100, toJSON() {} };
  });
  const { host } = await mount();
  const view = parseRoute(location.search).view;
  assert.deepEqual(view?.logFailure, { runId: RunIdSchema.parse(FIXTURE_IDS.failedRun), failureId });
  const step = host.querySelector<HTMLElement>(`section[aria-labelledby$="${failureId}"]`); assert(step);
  assert.equal(step.closest<HTMLElement>(".overflow-y-auto")?.scrollTop, 1200);
  assert.equal(host.textContent?.includes(notificationTargetUnavailable()), false);
});
it("keeps a missing canonical target in the inbox and shows its catalog refusal", async () => {
  requested.target = { kind: "run", runId: RunIdSchema.parse(FIXTURE_IDS.failedRun), day: FIXTURE_DAY_WIRE.day };
  const { host } = await mount(true);
  assert.equal(new URLSearchParams(location.search).get("run"), null);
  assert(host.textContent?.includes(notificationTargetUnavailable()));
});
