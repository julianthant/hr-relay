import { PARITY_WORKFLOW_COMPOSITION } from "../../../../parity/helpers/workflow-composition.js";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it, vi } from "vitest";
import { useRoute, type NativeRouteHistory, type RouteHistoryTarget } from "../../../../../src/dashboard/app/navigation/route-history-model.js";
import { parseRoute, type AppRouteState } from "../../../../../src/dashboard/app/navigation/url-state.js";
import { DashboardApp } from "../../../../../src/dashboard/app/dashboard-app.js";
import { createDashboardClient, type DashboardClient } from "../../../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../../../src/dashboard/state/client-context.js";
import { createFixtureBff } from "../../client/fixtures/helpers/fixture-bff.js";
import { FIXTURE_DAY_WIRE, FIXTURE_IDS } from "../../../../support/fixtures/dashboard/fixture-queue.js";
import { FIXTURE_BOOTSTRAP } from "../../../../support/fixtures/dashboard/fixture-bootstrap.js";
import { LocalDateSchema } from "../../../../../src/rules/identity/ids.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
Reflect.set(globalThis, "ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 35)); }); }
function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(node => node.getAttribute("aria-label") === name || node.textContent?.trim() === name);
  assert.ok(found, `button ${name}`);
  return found;
}
function workflowButton(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>('nav[aria-label="Workflows"] button')]
    .find(node => node.textContent?.trim().startsWith(name));
  assert.ok(found, `workflow ${name}`);
  return found;
}
async function click(node: HTMLElement) { await act(async () => node.click()); await settle(); }
async function mount(search: string, overrides: Partial<DashboardClient> = {}, panelMode: "icon" | "sidebar" = "icon", workflowComposition = PARITY_WORKFLOW_COMPOSITION) {
  window.history.replaceState(null, "", `/${search}`);
  localStorage.setItem("hr-dashboard.workflow-panel", panelMode);
  const { app } = createFixtureBff();
  const client: DashboardClient = {
    ...createDashboardClient({baseUrl:"http://fixture",fetchImpl: async (url, init) => app.request(String(url), init)}),
    subscribeDay(input) { input.onDay(FIXTURE_DAY_WIRE); input.onState({state:"live"}); return {close() {}}; },
    ...overrides,
  };
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(DashboardClientProvider,{client,children:createElement(DashboardApp, { workflowComposition })})));
  await settle();
}
async function historyMove(direction: "back" | "forward") { window.history[direction](); await settle(); await settle(); }

describe("mounted shell navigation", () => {
  it("remembers the selected workflow across navigation and remount, then falls back if it is no longer served", async () => {
    const first = FIXTURE_BOOTSTRAP.workflows[0]; assert.ok(first);
    const workflows = [first, { ...first, id: "separations", code: "sp", label: "Separations" }];
    const bootstrap = async () => ({ ...FIXTURE_BOOTSTRAP, workflows });
    await mount(`?day=${FIXTURE_DAY_WIRE.day}`, { bootstrap }, "sidebar");
    await click(workflowButton("Separations"));
    assert.equal(workflowButton("Separations").getAttribute("aria-current"), "page");
    assert.ok(workflowButton("Separations").querySelector('[aria-label="0 active of 0 in Separations"]'));
    assert.doesNotMatch(document.querySelector('nav[aria-label="Workflows"]')?.textContent ?? "", /active\s*│\s*all/iu);
    assert.equal(localStorage.getItem("hr-dashboard.selected-workflow"), "separations");
    await click(button("Settings"));
    await historyMove("back");
    assert.equal(workflowButton("Separations").getAttribute("aria-current"), "page");

    await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = "";
    await mount(`?day=${FIXTURE_DAY_WIRE.day}`, { bootstrap }, "sidebar");
    assert.equal(workflowButton("Separations").getAttribute("aria-current"), "page");

    await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = "";
    await mount(`?day=${FIXTURE_DAY_WIRE.day}`, {}, "sidebar");
    assert.equal(workflowButton("Person Lookup").getAttribute("aria-current"), "page");
  });
  it("reports detail failure and never calls it an empty selection", async () => {
    await mount(`?day=${FIXTURE_DAY_WIRE.day}&run=missing-run`);
    assert.match(document.body.textContent ?? "", /Run unavailable/);
    assert.doesNotMatch(document.body.textContent ?? "", /No run open/);
  });
  it("joins a deep-linked run to its served workflow even when it is not the first workflow", async () => {
    const first = FIXTURE_BOOTSTRAP.workflows[0]; assert.ok(first);
    await mount(`?day=${FIXTURE_DAY_WIRE.day}&run=${FIXTURE_IDS.runningRun}`, {
      bootstrap: async () => ({...FIXTURE_BOOTSTRAP,workflows:[{...first,id:"another-workflow",label:"Another workflow"},first]}),
    });
    const selected = document.querySelector(`[data-demo-row-id="${FIXTURE_IDS.runningRun}"]`);
    assert.ok(selected, "selected run must belong to the visible queue");
  });
  it("Settings gear toggles the surface and competing keys resolve one takeover", async () => {
    await mount("?settings=keyboard&archive=&explore=missing");
    assert.ok(document.querySelector('[aria-label="Settings"]'));
    const cursor = Number(Reflect.get(Object(window.history.state), "hrDashboardRouteCursor"));
    await click(button("Settings"));
    assert.equal(new URLSearchParams(location.search).has("settings"), false);
    await click(button("Settings"));
    assert.equal(new URLSearchParams(location.search).has("settings"), true);
    assert.equal(Reflect.get(Object(window.history.state), "hrDashboardRouteCursor"), cursor + 2);
    await historyMove("back");
    assert.equal(new URLSearchParams(location.search).has("settings"), false);
    await historyMove("forward");
    assert.equal(new URLSearchParams(location.search).has("settings"), true);
    await click(button("Settings"));
    assert.equal(new URLSearchParams(location.search).has("archive"),false);
    assert.equal(new URLSearchParams(location.search).has("explore"),false);
  });
});

async function editNavigationTimeout() {
  const field = document.querySelector<HTMLInputElement>('input[name="timeouts.navigationMs"]'); assert.ok(field);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set?.call(field,"111");
    field.dispatchEvent(new Event("input",{bubbles:true}));
  });
}
it("keeps the Settings editor and draft across ordinary-section native history", async () => {
  await mount("?settings=performance");
  await editNavigationTimeout();
  const general = [...document.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Settings sections"] a')].find(link => link.textContent?.trim() === "General"); assert.ok(general);
  await click(general);
  await historyMove("back");
  assert.equal(document.querySelector<HTMLInputElement>('input[name="timeouts.navigationMs"]')?.value,"111");
  assert.equal(document.body.textContent?.includes("Discard unsaved settings?"),false);
  const analytics = document.querySelector<HTMLAnchorElement>('nav[aria-label="Settings sections"] a[href="?settings=activity"]'); assert.ok(analytics);
  await click(analytics);
  assert.equal(document.querySelector("h1")?.textContent, "Analytics");
  assert.equal(document.body.textContent?.includes("Discard unsaved settings?"), false);
  await historyMove("back");
  assert.equal(document.querySelector<HTMLInputElement>('input[name="timeouts.navigationMs"]')?.value,"111");
  await click(button("Settings"));
  await click(button("Discard changes"));
  assert.equal(new URLSearchParams(location.search).has("settings"),false);
});
it.each(["?settings=archive", "?archive=", "?archive=archive-demo-run-48216&archiveView=versions"])("keeps retired Archive URL %s explicit and returns to the queue", async search => {
  await mount(search);
  assert.match(document.body.textContent ?? "", /Archive page removed/u);
  assert.equal(document.querySelector('[aria-label="Archive"]'), null);
  assert.equal(document.querySelector('a[href="?settings=archive"]'), null);
  assert.equal(document.querySelectorAll('nav[aria-label="Settings sections"] a').length, 11);
  await click(button("Return to dashboard"));
  assert.equal(parseRoute(location.search).archive, undefined);
  assert.equal(parseRoute(location.search).settings, undefined);
  assert.ok(document.querySelector('[data-demo-row-id]'));
});

async function mountHistory() {
  window.history.replaceState({hrDashboardRouteCursor:2}, "", "/?settings=display");
  let api: NativeRouteHistory | undefined;
  let navigate: ((route: AppRouteState, mode?: "push" | "replace") => void) | undefined;
  let guarded: (() => void) | undefined;
  let target: RouteHistoryTarget | undefined;
  const handler = {current:(next: RouteHistoryTarget) => {
    target = next;
    api?.restore(next, () => { guarded = () => api?.replay(next); });
  }};
  function Harness() {
    const [route, setRoute, native] = useRoute(handler); api=native; navigate=setRoute;
    return createElement("output",null,JSON.stringify(route));
  }
  const host=document.createElement("div"); document.body.append(host);root=createRoot(host);
  await act(async () => root?.render(createElement(Harness)));
  const go = vi.spyOn(window.history,"go").mockImplementation(() => undefined);
  const pop = async (cursor: number, search: string) => {
    await act(async () => {
      window.history.replaceState({hrDashboardRouteCursor:cursor},"",`/${search}`);
      window.dispatchEvent(new PopStateEvent("popstate",{state:{hrDashboardRouteCursor:cursor}}));
    });
  };
  return {pop,go,navigate:(route: AppRouteState, mode?: "push" | "replace") => navigate?.(route, mode),confirm:() => guarded?.(),target:() => target};
}
it("defers a newer door until an in-flight restoration settles and revokes its abandoned guard", async () => {
  const history=await mountHistory();
  await history.pop(1,"?day=2026-08-02");
  assert.deepEqual(history.go.mock.calls,[[1]]);
  await act(async () => history.navigate({start:false,activity:""}));
  assert.equal(location.search,"?day=2026-08-02", "no push at the wrong physical cursor");
  await history.pop(2,"?settings=display");
  assert.equal(location.search,"?activity=");
  await act(async () => history.confirm());
  assert.equal(location.search,"?activity=");
  assert.equal(history.go.mock.calls.length,1);
});
it("a stale confirmation cannot replay after a newer accepted route", async () => {
  const history=await mountHistory();
  await history.pop(1,"?day=2026-08-02");
  await history.pop(2,"?settings=display");
  await act(async () => history.navigate({start:false,settings:"keyboard"}));
  await act(async () => history.confirm());
  assert.equal(location.search,"?settings=keyboard");
  assert.equal(history.go.mock.calls.length,1);
});
it("a newer door wins even while a confirmed native replay is in flight", async () => {
  const history=await mountHistory();
  await history.pop(1,"?day=2026-08-02");
  await history.pop(2,"?settings=display");
  await act(async () => history.confirm());
  await act(async () => history.navigate({start:false,archive:""}));
  await history.pop(1,"?day=2026-08-02");
  assert.equal(location.search,"?archive=");
  assert.deepEqual(history.go.mock.calls,[[1],[-1]]);
});
it("hidden queue shortcuts do not open a run behind Settings",async()=>{
  await mount("?settings=keyboard");
  const before=location.search;
  for(const key of ["j","k","n","r","w","1"]){
    await act(async()=>window.dispatchEvent(new KeyboardEvent("keydown",{key,bubbles:true,cancelable:true})));
  }
  assert.equal(location.search,before);
  assert.equal(document.querySelector('[role="dialog"][aria-label="Workflow Panel"]'),null);
});
it("failed and delayed day snapshots never render an empty or stale queue",async()=>{
  let current: Parameters<DashboardClient["subscribeDay"]>[0] | undefined;
  let old: Parameters<DashboardClient["subscribeDay"]>[0] | undefined;
  await mount(`?day=${FIXTURE_DAY_WIRE.day}&run=${FIXTURE_IDS.runningRun}`,{
    subscribeDay(input){old=current;current=input;if(input.day===FIXTURE_DAY_WIRE.day) input.onDay(FIXTURE_DAY_WIRE);return{close(){}};},
  });
  await act(async()=>{
    window.history.pushState({hrDashboardRouteCursor:1},"","/?day=2026-08-02");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  assert.ok(document.querySelector('[role="status"][aria-label="Loading queue"][aria-busy="true"]'));
  await act(async()=>old?.onDay(FIXTURE_DAY_WIRE));
  assert.equal(document.querySelector(`[data-demo-row-id="${FIXTURE_IDS.runningRun}"]`),null);
  await act(async()=>current?.onDay({...FIXTURE_DAY_WIRE,day:LocalDateSchema.parse("2026-08-02"),queueSurfaces:[],statusCounts:[],workflowCounts:[],monthCounts:[]}));
  assert.equal(document.querySelector('[role="status"][aria-label="Loading queue"]'), null);
});
it("an empty catalog is not a fabricated workflow queue",async()=>{
  await mount("?sessionsPreview=empty",{bootstrap:async()=>({...FIXTURE_BOOTSTRAP,workflows:[]})}, "icon", workflows => ({ ...PARITY_WORKFLOW_COMPOSITION(workflows), catalogIncludesMocks: false, servedDay: true }));
  assert.match(document.body.textContent??"",/No workflows available/);
});
it("a failed day displays its error, with no zero-count status controls",async()=>{
  const {DashboardClientError}=await import("../../../../../src/dashboard/client/index.js");
  await mount(`?day=${FIXTURE_DAY_WIRE.day}`,{subscribeDay(input){input.onState({state:"stopped",error:new DashboardClientError({kind:"network",message:"Queue transport failed"})});return{close(){}};}});
  assert.match(document.body.textContent??"",/Could not load queue/);
  assert.match(document.body.textContent??"",/Queue transport failed/);
  assert.equal(document.querySelector('[aria-label="Filter the queue by status"]'),null);
});

it("native date history preserves a dirty Settings draft, then restores the accepted date", async () => {
  await mount("?day=2026-08-02", {
    subscribeDay(input) {
      input.onDay({ ...FIXTURE_DAY_WIRE, day: LocalDateSchema.parse(input.day), queueSurfaces: [], statusCounts: [], workflowCounts: [], monthCounts: [] });
      input.onState({ state: "live" }); return { close() {} };
    },
  });
  await click(button("Settings"));
  const performance = [...document.querySelectorAll<HTMLAnchorElement>("a")].find(node => node.textContent === "Performance"); assert.ok(performance);
  await click(performance);
  const width = document.querySelector<HTMLInputElement>('input[name="timeouts.navigationMs"]'); assert.ok(width);
  await act(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value"); if (descriptor?.set === undefined) throw new Error("input value setter missing");
    descriptor.set.call(width, "1777"); width.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await historyMove("back"); // Settings root retains its editor.
  await historyMove("back");
  await click(button("Keep editing"));
  assert.equal(width.value, "1777");
  assert.equal(new URLSearchParams(location.search).has("settings"), true);
  await historyMove("back"); await click(button("Discard changes")); await settle();
  assert.equal(new URLSearchParams(location.search).get("day"), "2026-08-02");
  assert.equal(new URLSearchParams(location.search).has("settings"), false);
});

