// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, it, vi } from "vitest";
import { DashboardApp } from "../../../src/dashboard/app/dashboard-app.js";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { assistantOpen } from "../../../src/dashboard/surfaces/shell/assistant-launcher-model.js";
import { FIXTURE_DAY_WIRE, FIXTURE_IDS } from "../../mocks/helpers/fixture-queue.js";
import { MOCK_WORKFLOW_COMPOSITION } from "../../mocks/helpers/workflow-composition.js";
import { createFixtureBff } from "../../support/helpers/dashboard/fixture-bff.js";
import { loadLazyPages } from "../../support/helpers/dashboard/lazy-pages.js";

const broken = vi.hoisted(() => ({ settings: false, assistant: false, dialog: false, logs: false }));
const crash = () => { throw new Error("Synthetic panel crash"); };
vi.mock("../../../src/dashboard/surfaces/settings/settings.js", async importOriginal => {
  const original = await importOriginal<typeof import("../../../src/dashboard/surfaces/settings/settings.js")>();
  return { ...original, SettingsPage: (props: Parameters<typeof original.SettingsPage>[0]) => broken.settings ? crash() : original.SettingsPage(props) };
});
vi.mock("../../../src/dashboard/surfaces/shell/hub-shell.js", async importOriginal => {
  const original = await importOriginal<typeof import("../../../src/dashboard/surfaces/shell/hub-shell.js")>();
  const HubShell: ComponentType<Parameters<typeof original.HubShell>[0]> = props => broken.assistant ? crash() : createElement(original.HubShell, props);
  return { ...original, HubShell };
});
vi.mock("../../../src/dashboard/surfaces/run-start/run-launch.js", async importOriginal => {
  const original = await importOriginal<typeof import("../../../src/dashboard/surfaces/run-start/run-launch.js")>();
  const RunLaunchHost: ComponentType<Parameters<typeof original.RunLaunchHost>[0]> = props => broken.dialog ? crash() : createElement(original.RunLaunchHost, props);
  return { ...original, RunLaunchHost };
});

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
Reflect.set(globalThis, "ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
let root: Root | undefined;
let reported: unknown[] = [];
beforeEach(() => { reported = []; vi.stubGlobal("reportError", (error: unknown) => reported.push(error)); });
afterEach(async () => {
  await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); localStorage.clear(); window.history.replaceState(null, "", "/");
  broken.settings = broken.assistant = broken.dialog = broken.logs = false; assistantOpen.set(false); vi.unstubAllGlobals();
});

const run = FIXTURE_DAY_WIRE.queueSurfaces.find(row => row.runId === FIXTURE_IDS.openGateRun);
const logsPreviewThrows = (workflows: Parameters<typeof MOCK_WORKFLOW_COMPOSITION>[0]) => {
  const composition = MOCK_WORKFLOW_COMPOSITION(workflows);
  const LogPreview = () => broken.logs ? crash() : null;
  return Object.freeze({ ...composition, harness: { ...composition.harness, LogPreview } });
};
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
async function mount(search: string): Promise<HTMLElement> {
  const { app } = createFixtureBff();
  const transport = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => app.request(url, init) });
  const client = { ...transport, subscribeDay: (input: Parameters<typeof transport.subscribeDay>[0]) => { input.onDay(FIXTURE_DAY_WIRE); input.onState({ state: "live" }); return { select() {}, close: () => undefined }; } };
  window.history.replaceState(null, "", `/?day=${FIXTURE_DAY_WIRE.day}${search}`);
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host, { onCaughtError() {} });
  await act(async () => root?.render(createElement(DashboardClientProvider, { client, children: createElement(DashboardApp, { workflowComposition: logsPreviewThrows }) })));
  await settle();
  await loadLazyPages();
  return host;
}
const notice = (sentence: string) => [...document.querySelectorAll("[role=alert]")].filter(node => node.textContent?.includes(sentence));
const retry = (sentence: string) => [...(notice(sentence)[0]?.querySelectorAll("button") ?? [])].find(button => button.textContent === "Retry");

it("a run panel crash shows its notice, keeps the queue, and another run renders normally", async () => {
  assert(run);
  const other = FIXTURE_DAY_WIRE.queueSurfaces.find(row => row.runId !== run.runId); assert(other);
  broken.logs = true;
  const host = await mount(`&run=${run.runId}&section=logs`);
  assert.equal(notice("Couldn't show this run.").length, 1, host.textContent ?? "");
  assert.equal(reported.length, 1);
  assert.ok(host.querySelector(".dashboard-queue-column") !== null, "the queue stays mounted");
  assert.equal(notice("Page unavailable").length, 0);
  broken.logs = false;
  await act(async () => { window.history.pushState({ hrDashboardRouteCursor: 1 }, "", `/?day=${FIXTURE_DAY_WIRE.day}&run=${other.runId}&section=logs`); window.dispatchEvent(new PopStateEvent("popstate", { state: { hrDashboardRouteCursor: 1 } })); });
  await settle();
  assert.equal(notice("Couldn't show this run.").length, 0);
});

it("a Settings crash shows its notice and the sidebar stays", async () => {
  broken.settings = true;
  const host = await mount("&settings=display");
  assert.equal(notice("Couldn't open Settings.").length, 1, host.textContent ?? "");
  assert.equal(reported.length, 1);
  assert.equal(notice("Page unavailable").length, 0);
  broken.settings = false;
  await act(async () => retry("Couldn't open Settings.")?.click()); await settle();
  assert.equal(notice("Couldn't open Settings.").length, 0);
});

it("an assistant crash shows its notice, keeps the queue, and reopening resets it", async () => {
  broken.assistant = true;
  const host = await mount("");
  assert.equal(notice("Couldn't open the assistant.").length, 1, host.textContent ?? "");
  assert.equal(reported.length, 1);
  assert.equal(notice("Page unavailable").length, 0);
  assert.ok(host.querySelector(".dashboard-queue-column") !== null, "the queue stays mounted");
  broken.assistant = false;
  await act(async () => assistantOpen.set(true)); await settle();
  assert.equal(notice("Couldn't open the assistant.").length, 0);
});

it("a run dialog crash shows its notice, keeps the queue, and reopening resets it", async () => {
  broken.dialog = true;
  const host = await mount("&start=1");
  assert.equal(notice("Couldn't open Start run.").length, 1, host.textContent ?? "");
  assert.equal(reported.length, 1);
  assert.equal(notice("Page unavailable").length, 0);
  assert.ok(host.querySelector(".dashboard-queue-column") !== null, "the queue stays mounted");
  broken.dialog = false;
  await act(async () => { window.history.pushState({ hrDashboardRouteCursor: 1 }, "", `/?day=${FIXTURE_DAY_WIRE.day}`); window.dispatchEvent(new PopStateEvent("popstate", { state: { hrDashboardRouteCursor: 1 } })); });
  await settle();
  assert.equal(notice("Couldn't open Start run.").length, 0);
});
