// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement, Profiler } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it, vi } from "vitest";
import { DashboardApp } from "../../../src/dashboard/app/dashboard-app.js";
import { PRODUCT_WORKFLOW_COMPOSITION, workflowComposition } from "../../../src/dashboard/app/workflow-sources.js";
import { CommandExecutor, type CommandExecutionScope } from "../../../src/dashboard/app/commands/command-executor.js";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { ToastProvider, TooltipProvider } from "../../../src/dashboard/ds/ui.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { createServedClock, ServedClockContext } from "../../../src/dashboard/state/served-clock.js";
import { SessionPanel } from "../../../src/dashboard/surfaces/sessions/session-panel.js";
import { NotificationsPanel } from "../../../src/dashboard/surfaces/notifications/notifications-view.js";
import { NotificationWireSchema } from "../../../src/models/dashboard/projection.js";
import { FIXTURE_DAY_WIRE, FIXTURE_NOW } from "../../mocks/helpers/fixture-day.js";
import { FIXTURE_START_PICKER_BOOTSTRAP } from "../../mocks/helpers/fixture-start.js";
import { servedFixtureSources } from "../../mocks/helpers/workflow-composition.js";
import { launchWorkflows } from "../../../src/dashboard/surfaces/run-start/run-launch-model.js";
import { parseWorkflows } from "../../../src/dashboard/surfaces/shell/shell-model.js";
import { buildWorkflowCatalog } from "../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
import { createFixtureBff } from "../../support/helpers/dashboard/fixture-bff.js";

// LoadedApp resolves the date selection once per render, so this counts its renders.
const appRenders = vi.hoisted(() => ({ count: 0 }));
vi.mock("../../../src/dashboard/app/navigation/date-state-model.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../../../src/dashboard/app/navigation/date-state-model.js")>();
  return { ...actual, resolveDateSelection: (...args: Parameters<typeof actual.resolveDateSelection>) => { appRenders.count += 1; return actual.resolveDateSelection(...args); } };
});

// The Sessions bar and each worker card count their own renders; the elapsed text inside a card is its own leaf.
const sessionRenders = vi.hoisted(() => ({ view: 0, card: 0 }));
vi.mock("../../../src/dashboard/surfaces/sessions/sessions-view.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../../../src/dashboard/surfaces/sessions/sessions-view.js")>();
  return { ...actual, SessionsView: (props: Parameters<typeof actual.SessionsView>[0]) => { sessionRenders.view += 1; return actual.SessionsView(props); } };
});
vi.mock("../../../src/dashboard/surfaces/sessions/worker-card.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../../../src/dashboard/surfaces/sessions/worker-card.js")>();
  return { ...actual, WorkerCard: (props: Parameters<typeof actual.WorkerCard>[0]) => { sessionRenders.card += 1; return actual.WorkerCard(props); } };
});

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
Reflect.set(globalThis, "ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
Element.prototype.scrollIntoView = () => {};
let root: Root | undefined;
let monotonic = 0;
afterEach(async () => {
  await act(async () => root?.unmount()); root = undefined;
  document.body.replaceChildren(); localStorage.clear(); vi.useRealTimers(); vi.restoreAllMocks(); window.history.replaceState(null, "", "/");
});
const fakeClock = () => {
  monotonic = 0;
  vi.spyOn(performance, "now").mockImplementation(() => monotonic);
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
};
const tick = (ms: number) => act(async () => { monotonic += ms; vi.advanceTimersByTime(ms); });

it("ten ticks re-render no part of a collapsed Sessions panel", async () => {
  fakeClock();
  const client = createDashboardClient({ baseUrl: "http://sessions.test", fetchImpl: async () => { throw new Error("no request is expected"); } });
  const scope: CommandExecutionScope = { actorId: "local-operator", client, authority: {}, dayRequest: {} };
  const binding = { client, executor: new CommandExecutor(() => scope), scope, day: FIXTURE_DAY_WIRE.day, now: () => FIXTURE_NOW,
    dayState: { subscribePublications: () => () => {}, request: scope.dayRequest, day: { state: "loaded" as const, value: FIXTURE_DAY_WIRE }, connection: { state: "live" as const }, refresh() {} } };
  const served = launchWorkflows(parseWorkflows(FIXTURE_START_PICKER_BOOTSTRAP.workflows), FIXTURE_START_PICKER_BOOTSTRAP.workbookCompatibility);
  const catalog = buildWorkflowCatalog(served, servedFixtureSources(served));
  const clock = createServedClock(FIXTURE_NOW);
  let commits = 0;
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root?.render(createElement(ServedClockContext.Provider, { value: clock }, createElement(TooltipProvider, null, createElement(ToastProvider, null,
    createElement(Profiler, { id: "sessions", onRender: () => { commits += 1; } }, createElement(SessionPanel, { catalog, binding, open: false, onOpenChange() {} })))))));
  await act(async () => {});
  assert.match(document.querySelector(".session-pill-counts")?.textContent ?? "", /\d/);
  const drawn = commits;
  for (let second = 0; second < 10; second += 1) await tick(1000);
  assert.equal(commits, drawn, "a tick re-rendered the collapsed Sessions panel");
});

it("ten minutes of ticks re-render LoadedApp never, while the open inbox's age advances", async () => {
  const { app } = createFixtureBff();
  const transport = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => app.request(url, init) });
  const boot = await transport.bootstrap();
  const occurredAt = new Date(Date.parse(boot.serverClock.now) - 5 * 60_000).toISOString();
  const notification = NotificationWireSchema.parse({ notificationId: "00000000-0000-4000-8000-000000000111", actorId: "local-operator", channel: "ping", count: 1, publicationId: "a".repeat(64),
    readState: "unread", state: "unread", occurredAt, revision: 1, kind: "notification", trigger: "failed", severity: "error", title: "Run failed",
    context: { state: "available", subject: "Canonical history", workflow: "Person Lookup" }, sourceEvent: { state: "available", kind: "run-failed" }, link: { kind: "run", runId: FIXTURE_DAY_WIRE.queueSurfaces[0].runId } });
  const client = { ...transport, bootstrap: async () => boot,
    notificationSnapshot: async () => [notification], notificationStatus: async () => ({ state: "ready" as const, pending: 0 }) };
  fakeClock();
  const host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
  await act(async () => { root?.render(createElement(DashboardClientProvider, { client, children: createElement(DashboardApp, { workflowComposition: () => workflowComposition(PRODUCT_WORKFLOW_COMPOSITION.sources) }) })); await new Promise(resolve => setTimeout(resolve, 20)); });
  const bell = document.querySelector<HTMLButtonElement>('button[aria-label^="Notifications,"]'); assert(bell);
  await act(async () => { bell.click(); await new Promise(resolve => setTimeout(resolve, 10)); });
  const age = () => document.querySelector(".notification-item-age")?.textContent;
  assert.equal(age(), "5 min ago");
  const drawn = appRenders.count;
  assert.ok(drawn > 0);
  for (let minute = 0; minute < 10; minute += 1) await tick(60_000);
  assert.equal(age(), "15 min ago");
  assert.equal(appRenders.count, drawn, "a tick re-rendered LoadedApp");
});

it("ten ticks re-render neither an open Sessions panel nor its worker cards, while their elapsed texts advance", async () => {
  fakeClock();
  const client = createDashboardClient({ baseUrl: "http://sessions.test", fetchImpl: async () => { throw new Error("no request is expected"); } });
  const scope: CommandExecutionScope = { actorId: "local-operator", client, authority: {}, dayRequest: {} };
  const served = launchWorkflows(parseWorkflows(FIXTURE_START_PICKER_BOOTSTRAP.workflows), FIXTURE_START_PICKER_BOOTSTRAP.workbookCompatibility);
  const catalog = buildWorkflowCatalog(served, servedFixtureSources(served));
  const clock = createServedClock(FIXTURE_NOW);
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  const elapsed = () => [...host.querySelectorAll("article footer > span:first-child")].map(span => span.textContent).join("|");
  for (const day of [FIXTURE_DAY_WIRE, { ...FIXTURE_DAY_WIRE, workerCards: [], unavailableWorkerCards: [] }]) {
    const binding = { client, executor: new CommandExecutor(() => scope), scope, day: FIXTURE_DAY_WIRE.day, now: () => FIXTURE_NOW,
      dayState: { subscribePublications: () => () => {}, request: scope.dayRequest, day: { state: "loaded" as const, value: day }, connection: { state: "live" as const }, refresh() {} } };
    await act(async () => root?.render(createElement(ServedClockContext.Provider, { value: clock }, createElement(TooltipProvider, null, createElement(ToastProvider, null,
      createElement(SessionPanel, { catalog, binding, open: true, onOpenChange() {} }))))));
    await act(async () => {});
    const views = sessionRenders.view, cards = sessionRenders.card, seen = [elapsed()];
    for (let second = 0; second < 10; second += 1) { await tick(1000); seen.push(elapsed()); }
    assert.equal(sessionRenders.view, views, "a tick re-rendered the open Sessions panel");
    assert.equal(sessionRenders.card, cards, "a tick re-rendered a worker card");
    if (day.workerCards.length > 0) assert.equal(new Set(seen).size, seen.length, "the workers' elapsed texts did not advance on every tick");
  }
});

it("an updated notification shows its new age at once, even when the label it had matches", async () => {
  fakeClock();
  const clock = createServedClock(FIXTURE_NOW);
  const at = (seconds: number) => new Date(Date.parse(FIXTURE_NOW) + seconds * 1000).toISOString();
  const item = (occurredAt: string) => ({ id: "n-1", title: "Run failed", subject: "", workflow: "", detail: "", tone: "danger" as const,
    age: "served age", at: occurredAt, read: false, action: "Open log", destination: { kind: "none" as const } });
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  const draw = (occurredAt: string) => act(async () => root?.render(createElement(ServedClockContext.Provider, { value: clock }, createElement(TooltipProvider, null,
    createElement(NotificationsPanel, { state: { state: "ready", items: [item(occurredAt)], pinned: [] }, activeId: "", showPriority: false, onShowPriority() {},
      dismissed: [], onDismiss() {}, onControl() {}, onReadAll() {}, onOpen() {}, onBack() {}, notice: "" })))));
  const age = () => host.querySelector(".notification-item-age")?.textContent;
  await draw(at(-70));
  assert.equal(age(), "1 min ago");
  await tick(40_000);
  assert.equal(age(), "1 min ago");
  // The same notice recurs: 70 s old at the current instant, so its label equals the one already shown.
  await draw(at(-30));
  assert.equal(age(), "1 min ago");
  await tick(10_000);
  assert.equal(age(), "1 min ago");
  await tick(40_000);
  assert.equal(age(), "2 min ago");
});
