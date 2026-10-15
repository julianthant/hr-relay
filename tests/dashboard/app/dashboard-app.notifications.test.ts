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
import { NotificationWireSchema } from "../../../src/models/dashboard/projection.js";
import { NotificationCommandRequestSchema } from "../../../src/rules/commands/commands.js";
import { CrossDateSearchPageSchema, type CrossDateSearchQueryInput } from "../../../src/models/dashboard/search.js";
import { zeroMatchSearchPage } from "../../support/helpers/dashboard/search-page-fixtures.js";
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
  await act(async () => { root?.render(createElement(DashboardClientProvider, { client, children: createElement(DashboardApp, { workflowComposition: () => ({ ...PRODUCT_WORKFLOW_COMPOSITION, inbox: "mock" as const }) }) })); await new Promise(resolve => setTimeout(resolve, 20)); });
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
it("mounts served inbox controls and reports only the served search authority total", async () => {
  const { app } = createFixtureBff();
  let rows = NotificationWireSchema.array().parse([{ kind: "notification", notificationId: "00000000-0000-4000-8000-000000000111", actorId: "local-operator", channel: "ping", count: 1, publicationId: "a".repeat(64), trigger: "storage", readState: "unread", state: "unread", severity: "warning", title: "Storage degraded", occurredAt: "2026-08-03T17:00:00Z", revision: 1, context: { state: "not-applicable" }, sourceEvent: { state: "available", kind: "storage-degraded" }, link: { kind: "storage" } }]);
  const writes: unknown[] = [], queries: string[] = [];
  const transport = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => {
    const path = new URL(url).pathname;
    if (path === "/api/v1/notifications") return Response.json(rows);
    if (path === "/api/v1/notifications/status") return Response.json({ state: "ready", pending: 0 });
    if (path === "/api/v1/commands") {
      const body = init?.body; if (typeof body !== "string") throw new Error("command body must be JSON text");
      const command = NotificationCommandRequestSchema.parse(JSON.parse(body)); writes.push(command);
      rows = NotificationWireSchema.array().parse(rows.map(row => ({ ...row, revision: 2, state: "read", readState: "read" })));
      return Response.json({ state: "applied", commandId: command.commandId, affectedTargets: [{ family: "notification", notificationId: command.target.notificationId }] });
    }
    return app.request(url, init);
  } });
  const client = { ...transport,
    searchRuns: async (query: CrossDateSearchQueryInput) => { queries.push(query.q); return CrossDateSearchPageSchema.parse({ ...zeroMatchSearchPage(), totalMatches: 1, results: [{ runId: FIXTURE_IDS.failedRun, traceId: "pl-120000-0099", workflowId: "person-lookup", partitionDay: FIXTURE_DAY_WIRE.day, registration: { state: "registered", label: "Person Lookup", code: "pl", categoryId: "people" }, state: "done", shape: "single", dryRun: true, priority: "bulk", systems: [], runNumber: { state: "absent", reason: "not recorded" }, retryOf: { state: "absent", reason: "first" }, enqueuedAt: "2026-08-03T12:00:00Z", endedAt: { state: "absent", reason: "not recorded" }, match: { field: "actor", strength: "exact" }, metadata: { subject: { state: "available", value: "Exact served subject" }, actor: { state: "available", value: "local-operator" }, version: 1, failureCode: null, evidence: { receipt: false, failure: false, diagnostic: false } } }] }); },
    subscribeDay: (input: Parameters<typeof transport.subscribeDay>[0]) => { input.onDay({ ...FIXTURE_DAY_WIRE, day: LocalDateSchema.parse(input.day) }); input.onState({ state: "live" }); return { close() {} }; },
  };
  window.history.replaceState(null, "", `/?day=${FIXTURE_DAY_WIRE.day}`);
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root?.render(createElement(DashboardClientProvider, { client, children: createElement(DashboardApp) })); await new Promise(resolve => setTimeout(resolve, 20)); });
  const bell = host.querySelector<HTMLButtonElement>('button[aria-label="Notifications, 1 unread"]'); assert(bell);
  await act(async () => bell.click());
  assert(host.textContent?.includes("Storage degraded")); assert.equal(host.textContent?.includes("Canonical history"), false);
  const read = host.querySelector<HTMLButtonElement>('button[aria-label="Mark read: Storage degraded"]'); assert(read);
  await act(async () => { read.click(); await new Promise(resolve => setTimeout(resolve, 20)); });
  assert.equal(writes.length, 1); assert(host.querySelector('button[aria-label="Notifications, 0 unread"]'));
  assert.equal(queries.length, 0);
  const search = host.querySelector<HTMLButtonElement>('button[aria-label="Search runs"]'); assert(search);
  await act(async () => { search.click(); await new Promise(resolve => setTimeout(resolve, 20)); });
  assert.equal(queries.length, 1); assert(document.body.textContent?.includes("Exact served subject"));
  assert([...document.querySelectorAll('[role="status"]')].some(node => node.textContent === "1 run"));
  const query = document.querySelector<HTMLInputElement>('input[aria-label="Search runs"]'); assert(query);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(query, "local-operator");
    query.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 20));
  });
  assert(queries.includes("local-operator"));
  assert(document.body.textContent?.includes("Exact served subject"));
});
