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
import { WorkflowBootstrapPrimitiveSchema } from "../../../src/models/dashboard/bootstrap.js";
import { RunDetailWireSchema } from "../../../src/models/dashboard/run-detail.js";
import { QueueSurfaceWireSchema, NotificationWireSchema } from "../../../src/models/dashboard/projection.js";
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
async function mount(missing = false, mixed = false) {
  const { app } = createFixtureBff();
  const transport = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => app.request(url, init) });
  const reads: string[] = [];
  const dayRows = FIXTURE_DAY_WIRE.queueSurfaces.map(row => mixed && row.runId === FIXTURE_IDS.failedRun ? QueueSurfaceWireSchema.parse({ ...row, workflowId: "separations" }) : row);
  const target = requested.target; assert(target && (target.kind === "run" || target.kind === "failure"));
  const notification = NotificationWireSchema.parse({ kind: "notification", notificationId: "00000000-0000-4000-8000-000000000111", actorId: "local-operator", channel: "ping", count: 1, publicationId: "a".repeat(64), trigger: "failed", readState: "unread", state: "unread", severity: "error", title: "Run failed", occurredAt: "2026-08-03T17:00:00Z", revision: 1, context: { state: "available", subject: "Canonical history", workflow: mixed ? "Separations" : "Person Lookup" }, sourceEvent: { state: "available", kind: "run-failed" }, link: target.kind === "failure" ? { kind: "failure", runId: target.runId, failureId: target.failureId } : { kind: "run", runId: target.runId } });
  const client = { ...transport,
    notificationSnapshot: async () => [notification], notificationStatus: async () => ({ state: "ready" as const, pending: 0 }), notificationTarget: async () => target,
    bootstrap: async () => { const boot = await transport.bootstrap(); return mixed ? { ...boot, workflows: [...boot.workflows, { ...WorkflowBootstrapPrimitiveSchema.parse(boot.workflows[0]), id: "separations", code: "sep", label: "Separations" }] } : boot; },
    runDetail: async (id: string) => { const detail = await transport.runDetail(id); return mixed && id === FIXTURE_IDS.failedRun ? RunDetailWireSchema.parse({ ...detail, header: { ...detail.header, workflowId: "separations" } }) : detail; },
    dashboardDay: async (day: string) => { reads.push(day); return { ...FIXTURE_DAY_WIRE, day: LocalDateSchema.parse(day), queueSurfaces: missing ? [] : dayRows }; },
    subscribeDay: (input: Parameters<typeof transport.subscribeDay>[0]) => {
      input.onDay({ ...FIXTURE_DAY_WIRE, day: LocalDateSchema.parse(input.day), queueSurfaces: dayRows }); input.onState({ state: "live" }); return { close() {} };
    },
  };
  window.history.replaceState(null, "", "/?day=2026-08-04");
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root?.render(createElement(DashboardClientProvider, { client, children: createElement(DashboardApp, { workflowComposition: () => ({ ...PRODUCT_WORKFLOW_COMPOSITION, sources: mixed ? { ...PRODUCT_WORKFLOW_COMPOSITION.sources, "person-lookup": "served" as const } : PRODUCT_WORKFLOW_COMPOSITION.sources }) }) })); await new Promise(resolve => setTimeout(resolve, 20)); });
  const bell = document.querySelector<HTMLButtonElement>('button[aria-label^="Notifications,"]'); assert(bell);
  await act(async () => { bell.click(); await new Promise(resolve => setTimeout(resolve, 10)); });
  const targetButton = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Open log"); assert(targetButton);
  await act(async () => { targetButton.click(); await new Promise(resolve => setTimeout(resolve, 30)); });
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

it("admits a canonical Separations historical target while Person Lookup is served and Separations stays mock", async () => {
  requested.target = { kind: "run", runId: RunIdSchema.parse(FIXTURE_IDS.failedRun), day: FIXTURE_DAY_WIRE.day };
  const { host, reads } = await mount(false, true);
  assert.deepEqual(reads, [FIXTURE_DAY_WIRE.day]);
  assert.equal(new URLSearchParams(location.search).get("run"), FIXTURE_IDS.failedRun);
  assert.equal(parseRoute(location.search).view?.workflow, "separations");
  assert.equal(parseRoute(location.search).view?.preview, null);
  assert.equal(host.textContent?.includes(notificationTargetUnavailable()), false);
});
it("refreshes the destination inbox after a delayed cross-day mark-read settles", async () => {
  const { app } = createFixtureBff();
  const runId = RunIdSchema.parse(FIXTURE_IDS.failedRun), notificationId = "00000000-0000-4000-8000-000000000111";
  let rows = NotificationWireSchema.array().parse([{ kind: "notification", notificationId, actorId: "local-operator", channel: "ping", count: 1, publicationId: "a".repeat(64), trigger: "failed", readState: "unread", state: "unread", severity: "error", title: "Delayed read", occurredAt: "2026-08-03T17:00:00Z", revision: 1, context: { state: "available", subject: "Historical subject", workflow: "Person Lookup" }, sourceEvent: { state: "available", kind: "run-failed" }, link: { kind: "run", runId } }]);
  let commit = () => {};
  const delayed = new Promise<void>(resolve => { commit = resolve; });
  let writes = 0, inboxReads = 0;
  const days: string[] = [];
  const transport = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => {
    const path = new URL(url).pathname;
    if (path === "/api/v1/notifications") { inboxReads++; return Response.json(rows); }
    if (path === "/api/v1/notifications/status") return Response.json({ state: "ready", pending: 0 });
    if (path.endsWith("/target")) return Response.json({ kind: "run", runId, day: FIXTURE_DAY_WIRE.day });
    if (path === "/api/v1/commands") {
      const body = init?.body; if (typeof body !== "string") throw new Error("command body must be JSON text");
      const command = NotificationCommandRequestSchema.parse(JSON.parse(body)); writes++;
      await delayed;
      rows = NotificationWireSchema.array().parse(rows.map(row => ({ ...row, revision: 2, state: "read", readState: "read" })));
      return Response.json({ state: "applied", commandId: command.commandId, affectedTargets: [{ family: "notification", notificationId }] });
    }
    return app.request(url, init);
  } });
  const client = { ...transport,
    dashboardDay: async (day: string) => ({ ...FIXTURE_DAY_WIRE, day: LocalDateSchema.parse(day), notifications: rows }),
    subscribeDay: (input: Parameters<typeof transport.subscribeDay>[0]) => {
      days.push(input.day); input.onDay({ ...FIXTURE_DAY_WIRE, day: LocalDateSchema.parse(input.day), notifications: rows }); input.onState({ state: "live" }); return { close() {} };
    },
  };
  window.history.replaceState(null, "", "/?day=2026-08-02");
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root?.render(createElement(DashboardClientProvider, { client, children: createElement(DashboardApp) })); await new Promise(resolve => setTimeout(resolve, 20)); });
  const bell = host.querySelector<HTMLButtonElement>('button[aria-label="Notifications, 1 unread"]'); assert(bell);
  await act(async () => bell.click());
  const open = [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Open log"); assert(open);
  await act(async () => { open.click(); await new Promise(resolve => setTimeout(resolve, 30)); });
  assert.equal(new URLSearchParams(location.search).get("day"), FIXTURE_DAY_WIRE.day);
  assert.equal(writes, 1); assert.deepEqual(days, ["2026-08-02", FIXTURE_DAY_WIRE.day]);
  assert(host.querySelector('button[aria-label="Notifications, 1 unread"]'));
  const before = inboxReads;
  await act(async () => { commit(); await new Promise(resolve => setTimeout(resolve, 30)); });
  assert(inboxReads > before, "settlement must read current destination authority");
  assert(host.querySelector('button[aria-label="Notifications, 0 unread"]'));
  await act(async () => bell.click());
  assert(host.querySelector('button[aria-label="Mark unread: Delayed read"]'));
  assert.equal(writes, 1);
});
