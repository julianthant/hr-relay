// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it, vi } from "vitest";
import { DashboardApp } from "../../../src/dashboard/app/dashboard-app.js";
import { createDashboardClient, type DashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { createPersonPreferences } from "../../../src/dashboard/state/person-preferences-model.js";
import { DashboardDayWireSchema, type DashboardDayWire } from "../../../src/models/dashboard/projection.js";
import { FIXTURE_DAY_WIRE } from "../../support/helpers/dashboard/mock-world/fixture-queue.js";
import { MOCK_WORKFLOW_COMPOSITION } from "../../support/helpers/dashboard/mock-world/workflow-composition.js";
import { createFixtureBff } from "../../support/helpers/dashboard/fixture-bff.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
Reflect.set(globalThis, "ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
Element.prototype.scrollIntoView = () => {};
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); localStorage.clear(); window.history.replaceState(null, "", "/"); });

const settle = (ms = 20) => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); });
/** A browser forward entry the dashboard reads as its own, then the real Back. */
const forward = async (search: string) => {
  await act(async () => { window.history.pushState({ hrDashboardRouteCursor: 1 }, "", search); window.dispatchEvent(new PopStateEvent("popstate", { state: { hrDashboardRouteCursor: 1 } })); });
  await settle();
};
const back = async () => { await act(async () => { window.history.back(); await new Promise(resolve => setTimeout(resolve, 20)); }); };

it("Back to a kept day with its run open shows both at once, marked by a spinner, then the fresh day", async () => {
  const day = FIXTURE_DAY_WIRE.day;
  const otherDay = "2026-08-02";
  const run = FIXTURE_DAY_WIRE.queueSurfaces.find(row => row.surfaceKind === "single" && row.parent === null);
  assert(run);
  const other = DashboardDayWireSchema.parse({ ...FIXTURE_DAY_WIRE, day: otherDay, queueSurfaces: [], attemptHistory: undefined, monthCounts: [{ day: otherDay, count: 0 }] });
  const { app } = createFixtureBff();
  const transport = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => app.request(url, init) });
  const streams: { day: string; serve: (frame: DashboardDayWire) => void }[] = [];
  const client: DashboardClient = { ...transport, subscribeDay: input => {
    streams.push({ day: input.day, serve: frame => { input.onDay(frame); input.onState({ state: "live" }); } });
    return { select() {}, close: () => undefined };
  } };
  window.history.replaceState(null, "", `/?day=${day}&run=${run.runId}`);
  const preview = createPersonPreferences("preview");
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(createElement(DashboardClientProvider, { client, children: createElement(DashboardApp, { workflowComposition: MOCK_WORKFLOW_COMPOSITION, previewPreferences: preview }) })));
  await settle();
  await act(async () => streams.at(-1)?.serve(FIXTURE_DAY_WIRE));
  const queueColumn = () => host.querySelector(".dashboard-queue-column");
  const runRow = () => host.querySelector(`[data-demo-row-id="${run.runId}"]`);
  const runTitle = () => host.querySelector('[aria-label="Selected run logs"] h2')?.textContent;
  const updating = () => host.querySelector('[aria-label="Queue header"] .queue-header-actions [data-queue-stale] [role="status"][aria-label="Refreshing"]')?.parentElement ?? undefined;
  await vi.waitFor(() => assert.equal(runTitle(), run.title));

  await forward(`/?day=${otherDay}`);
  assert.equal(streams.at(-1)?.day, otherDay);
  await act(async () => streams.at(-1)?.serve(other));
  await vi.waitFor(() => assert.equal(runRow() === null, true));

  await back();
  assert.equal(new URLSearchParams(window.location.search).get("run"), run.runId);
  assert.equal(streams.at(-1)?.day, day, "the return reads the day again");
  assert.ok(runRow(), "the kept day's queue shows at once");
  assert.equal(queueColumn()?.getAttribute("aria-busy"), "true");
  assert.equal(runTitle(), run.title, "the open run shows from the kept day, not a skeleton");
  assert.equal(host.querySelector(`[data-demo-row-id="${run.runId}"] [aria-label^="Actions"]`) === null, true);
  assert.ok(updating()?.classList.contains("invisible"), "a fast reload shows a named spinner, still hidden");
  await settle(350);
  assert.equal(updating()?.classList.contains("invisible"), false, "a slow reload shows the spinner");

  await act(async () => streams.at(-1)?.serve(FIXTURE_DAY_WIRE));
  await vi.waitFor(() => assert.equal(queueColumn()?.hasAttribute("aria-busy"), false));
  assert.equal(updating() === undefined, true);
  assert.ok(runRow());
  assert.equal(runTitle(), run.title);
});

it("Back to a kept day gives the held run's Logs no Pause, Stop or Cancel, and sends no command until the day is fresh", async () => {
  const day = FIXTURE_DAY_WIRE.day;
  const otherDay = "2026-08-02";
  const run = FIXTURE_DAY_WIRE.queueSurfaces.find(row => row.parent !== null && row.status === "running" && row.actions.some(action => action.kind === "command" && action.command === "cancel"));
  assert(run);
  const other = DashboardDayWireSchema.parse({ ...FIXTURE_DAY_WIRE, day: otherDay, queueSurfaces: [], attemptHistory: undefined, monthCounts: [{ day: otherDay, count: 0 }] });
  const { app } = createFixtureBff();
  const commands: string[] = [];
  const transport = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => {
    if (new URL(String(url)).pathname === "/api/v1/commands") commands.push(typeof init?.body === "string" ? init.body : "command");
    return app.request(url, init);
  } });
  const streams: { day: string; serve: (frame: DashboardDayWire) => void }[] = [];
  const client: DashboardClient = { ...transport, subscribeDay: input => {
    streams.push({ day: input.day, serve: frame => { input.onDay(frame); input.onState({ state: "live" }); } });
    return { select() {}, close: () => undefined };
  } };
  window.history.replaceState(null, "", `/?day=${day}&run=${run.runId}`);
  const preview = createPersonPreferences("preview");
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(createElement(DashboardClientProvider, { client, children: createElement(DashboardApp, { workflowComposition: MOCK_WORKFLOW_COMPOSITION, previewPreferences: preview }) })));
  await settle();
  await act(async () => streams.at(-1)?.serve(FIXTURE_DAY_WIRE));
  const logs = () => host.querySelector('[aria-label="Selected run logs"]');
  const runControls = () => [...logs()?.querySelectorAll("button") ?? []].map(button => button.getAttribute("aria-label") ?? button.textContent ?? "").filter(label => /^(Pause|Stop|Cancel)\b/.test(label));
  await vi.waitFor(() => assert.ok(runControls().length > 0, "the fresh day's running member shows its controls"));

  await forward(`/?day=${otherDay}`);
  await act(async () => streams.at(-1)?.serve(other));
  await vi.waitFor(() => assert.equal(logs() === null, true));

  await back();
  assert.equal(streams.at(-1)?.day, day);
  assert.ok(logs(), "the held run shows at once");
  assert.deepEqual(runControls(), [], "a held run carries no command authority");
  for (const button of logs()?.querySelectorAll("button") ?? []) await act(async () => { button.click(); });
  await settle();
  assert.deepEqual(commands, [], "nothing is sent while the fresh day is held");

  await act(async () => streams.at(-1)?.serve(FIXTURE_DAY_WIRE));
  await vi.waitFor(() => assert.ok(runControls().length > 0, "the fresh day brings the controls back"));
});

it("a stream reset with a run open shows neither the pre-reset row nor its logs while the replacement day is held", async () => {
  const day = FIXTURE_DAY_WIRE.day;
  const run = FIXTURE_DAY_WIRE.queueSurfaces.find(row => row.surfaceKind === "single" && row.parent === null);
  assert(run);
  const { app } = createFixtureBff();
  const transport = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => app.request(url, init) });
  const streams: { serve: (frame: DashboardDayWire) => void; reset: () => void }[] = [];
  const client: DashboardClient = { ...transport, subscribeDay: input => {
    streams.push({ serve: frame => { input.onDay(frame); input.onState({ state: "live" }); }, reset: () => input.onState({ state: "connecting" }) });
    return { select() {}, close: () => undefined };
  } };
  window.history.replaceState(null, "", `/?day=${day}&run=${run.runId}`);
  const preview = createPersonPreferences("preview");
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(createElement(DashboardClientProvider, { client, children: createElement(DashboardApp, { workflowComposition: MOCK_WORKFLOW_COMPOSITION, previewPreferences: preview }) })));
  await settle();
  await act(async () => streams.at(-1)?.serve(FIXTURE_DAY_WIRE));
  const runTitle = () => host.querySelector('[aria-label="Selected run logs"] h2')?.textContent;
  const runRow = () => host.querySelector(`[data-demo-row-id="${run.runId}"]`);
  await vi.waitFor(() => assert.equal(runTitle(), run.title));

  await act(async () => streams.at(-1)?.reset());
  await settle();
  assert.equal(runRow() === null, true, "the pre-reset queue is not shown");
  assert.notEqual(runTitle(), run.title, "the pre-reset run is not shown in Logs");

  await act(async () => streams.at(-1)?.serve(FIXTURE_DAY_WIRE));
  await vi.waitFor(() => assert.equal(runTitle(), run.title));
});
