// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it, vi } from "vitest";
import { useRoute, type NativeRouteHistory, type RouteHistoryTarget } from "../../../src/dashboard/app/route-history-model.js";
import { parseRoute, type AppRouteState } from "../../../src/dashboard/app/url-state.js";
import { DashboardApp } from "../../../src/dashboard/app/dashboard-app.js";
import { createDashboardClient, type DashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { createFixtureBff } from "../../parity/helpers/fixture-bff.js";
import { FIXTURE_DAY_WIRE, FIXTURE_IDS } from "../../parity/helpers/fixture-queue.js";
import { FIXTURE_RUN_DETAILS } from "../../parity/helpers/fixture-detail.js";
import { FIXTURE_BOOTSTRAP } from "../../parity/helpers/fixture-bootstrap.js";
import type { RunDetailWire } from "../../../src/domain/dashboard/run-detail.js";
import { LocalDateSchema } from "../../../src/domain/ids.js";
import { RowRevisionSchema } from "../../../src/domain/dashboard/primitives.js";

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
async function mount(search: string, overrides: Partial<DashboardClient> = {}, panelMode: "icon" | "sidebar" = "icon") {
  window.history.replaceState(null, "", `/${search}`);
  localStorage.setItem("hr-dashboard.workflow-panel", panelMode);
  const { app } = createFixtureBff();
  const client: DashboardClient = {
    ...createDashboardClient({baseUrl:"http://fixture",fetchImpl: async (url, init) => app.request(String(url), init)}),
    subscribeDay(input) { input.onDay(FIXTURE_DAY_WIRE); input.onState({state:"live"}); return {close() {}}; },
    ...overrides,
  };
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(DashboardClientProvider,{client,children:createElement(DashboardApp)})));
  await settle();
}
function selectedTab() { return document.querySelector('[role="tab"][aria-selected="true"]')?.textContent; }
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
  it("makes a clicked tab addressable and restores it through native history", async () => {
    await mount(`?day=${FIXTURE_DAY_WIRE.day}&run=${FIXTURE_IDS.doneRun}&section=receipt`);
    assert.match(selectedTab() ?? "", /Receipt/);
    await click(button("Logs"));
    assert.equal(new URLSearchParams(location.search).get("section"), "logs");
    await historyMove("back");
    assert.match(selectedTab() ?? "", /Receipt/);
    await historyMove("forward");
    assert.match(selectedTab() ?? "", /Logs/);
  });
  it("reports unknown and unoffered sections rather than silently selecting logs", async () => {
    await mount(`?day=${FIXTURE_DAY_WIRE.day}&run=${FIXTURE_IDS.runningRun}&section=unknown`);
    assert.match(document.body.textContent ?? "", /Unknown section/);
    assert.equal(selectedTab(), undefined);
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
  it("withholds a mismatched detail while still allowing a matching run", async () => {
    const wrong = FIXTURE_RUN_DETAILS[FIXTURE_IDS.doneRun]; assert.ok(wrong);
    await mount(`?day=${FIXTURE_DAY_WIRE.day}&run=${FIXTURE_IDS.runningRun}`, {runDetail:async () => wrong});
    assert.equal(document.querySelector('[data-testid="log-panel"]'), null);
    assert.match(document.body.textContent ?? "", /Run identity mismatch/);
  });
  it("does not let a delayed abandoned detail replace the final selection", async () => {
    let resolveOld: ((value: RunDetailWire) => void) | undefined;
    const current = FIXTURE_RUN_DETAILS[FIXTURE_IDS.doneRun]; assert.ok(current);
    await mount(`?day=${FIXTURE_DAY_WIRE.day}&run=${FIXTURE_IDS.runningRun}`, {
      runDetail: (id) => id === FIXTURE_IDS.runningRun ? new Promise(resolve => {resolveOld=resolve;}) : Promise.resolve(current),
    });
    assert.match(document.body.textContent ?? "", /Loading run/);
    const row = document.querySelector<HTMLElement>(`[data-demo-row-id="${FIXTURE_IDS.doneRun}"]`); assert.ok(row);
    await click(row);
    const before = selectedTab(); assert.ok(before);
    const old = FIXTURE_RUN_DETAILS[FIXTURE_IDS.runningRun]; assert.ok(old); assert.ok(resolveOld);
    await act(async () => resolveOld?.(old));
    assert.equal(new URLSearchParams(location.search).get("run"), FIXTURE_IDS.doneRun);
    assert.equal(selectedTab(), before);
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

async function editWidth() {
  const field = document.querySelector<HTMLInputElement>('input[type="number"]'); assert.ok(field);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set?.call(field,"1777");
    field.dispatchEvent(new Event("input",{bubbles:true}));
  });
}
it("keeps the Settings editor and draft across section/catalog native history", async () => {
  await mount("?settings=display");
  await editWidth();
  const catalog = [...document.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Settings sections"] a')].find(link => link.textContent?.trim() === "UI catalog"); assert.ok(catalog);
  await click(catalog);
  await historyMove("back");
  assert.equal(document.querySelector<HTMLInputElement>('input[type="number"]')?.value,"1777");
  assert.equal(document.body.textContent?.includes("Discard unsaved settings?"),false);
  const archive = document.querySelector<HTMLAnchorElement>('nav[aria-label="Settings sections"] a[href="?settings=archive"]'); assert.ok(archive);
  await click(archive);
  assert.ok(document.querySelector('[aria-label="Archive mock"]'));
  assert.equal(document.body.textContent?.includes("Discard unsaved settings?"), false);
  await historyMove("back");
  assert.equal(document.querySelector<HTMLInputElement>('input[type="number"]')?.value,"1777");
  await click(button("Settings"));
  await click(button("Discard changes"));
  assert.equal(new URLSearchParams(location.search).has("settings"),false);
});
it("toolbar history restores the selected tab without adding an intermediate tab entry", async () => {
  await mount(`?day=${FIXTURE_DAY_WIRE.day}&run=${FIXTURE_IDS.doneRun}&section=receipt`);
  await click(button("Logs"));
  await click(button("Back"));
  assert.match(selectedTab() ?? "",/Receipt/);
  await click(button("Forward"));
  assert.match(selectedTab() ?? "",/Logs/);
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
  assert.match(document.body.textContent??"",/Loading queue/);
  await act(async()=>old?.onDay(FIXTURE_DAY_WIRE));
  assert.equal(document.querySelector(`[data-demo-row-id="${FIXTURE_IDS.runningRun}"]`),null);
  await act(async()=>current?.onDay({...FIXTURE_DAY_WIRE,day:LocalDateSchema.parse("2026-08-02"),queueSurfaces:[],statusCounts:[],workflowCounts:[],monthCounts:[]}));
  assert.doesNotMatch(document.body.textContent??"",/Loading queue/);
});
it("a served detail failure stays a failure and an empty workflow catalog states absence",async()=>{
  const { DashboardClientError } = await import("../../../src/dashboard/client/index.js");
  await mount(`?day=${FIXTURE_DAY_WIRE.day}&run=${FIXTURE_IDS.runningRun}`,{
    runDetail:async()=>{throw new DashboardClientError({kind:"network",message:"Detail transport failed"});},
  });
  assert.match(document.body.textContent??"",/Could not load run/);
  assert.match(document.body.textContent??"",/Detail transport failed/);
});
it("an empty catalog is not a fabricated workflow queue",async()=>{
  await mount("",{bootstrap:async()=>({...FIXTURE_BOOTSTRAP,workflows:[]})});
  assert.match(document.body.textContent??"",/No workflows available/);
});
it("same-run refresh keeps the verified detail visible and does not invent a history place",async()=>{
  let subscription:Parameters<DashboardClient["subscribeDay"]>[0]|undefined;
  let reads=0;
  let settleRefresh:((value:RunDetailWire)=>void)|undefined;
  const value=FIXTURE_RUN_DETAILS[FIXTURE_IDS.runningRun];assert.ok(value);
  await mount(`?day=${FIXTURE_DAY_WIRE.day}&run=${FIXTURE_IDS.runningRun}`,{
    subscribeDay(input){subscription=input;input.onDay(FIXTURE_DAY_WIRE);return{close(){}};},
    runDetail:()=>++reads===1?Promise.resolve(value):new Promise(resolve=>{settleRefresh=resolve;}),
  });
  assert.equal(button("Back").disabled,true);
  await act(async()=>subscription?.onDay({...FIXTURE_DAY_WIRE,queueSurfaces:FIXTURE_DAY_WIRE.queueSurfaces.map(row=>String(row.runId)===FIXTURE_IDS.runningRun?{...row,rowRevision:RowRevisionSchema.parse(row.rowRevision+1)}:row)}));
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,350));});
  assert.equal(reads,2);assert.match(selectedTab()??"",/Logs/);assert.doesNotMatch(document.body.textContent??"",/Loading run/);
  assert.equal(button("Back").disabled,true);
  await act(async()=>settleRefresh?.({...value,rowRevision:RowRevisionSchema.parse(value.rowRevision+1)}));
  assert.match(selectedTab()??"",/Logs/);
});
it("a known but unoffered section states its absence",async()=>{
  await mount(`?day=${FIXTURE_DAY_WIRE.day}&run=${FIXTURE_IDS.runningRun}&section=people`);
  assert.match(document.body.textContent??"",/Section unavailable/);
  assert.equal(selectedTab(),undefined);
});
it("a failed day displays its error, with no zero-count status controls",async()=>{
  const {DashboardClientError}=await import("../../../src/dashboard/client/index.js");
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
  const general = [...document.querySelectorAll<HTMLAnchorElement>("a")].find(node => node.textContent === "General"); assert.ok(general);
  await click(general);
  const width = document.querySelector<HTMLInputElement>('input[type="number"]'); assert.ok(width);
  await act(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value"); if (descriptor?.set === undefined) throw new Error("input value setter missing");
    descriptor.set.call(width, "1777"); width.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await historyMove("back"); // Settings root retains its editor.
  await historyMove("back"); // The queued destination is the historical day.
  await click(button("Keep editing"));
  assert.equal(width.value, "1777");
  assert.equal(new URLSearchParams(location.search).has("settings"), true);
  await historyMove("back"); await click(button("Discard changes")); await settle();
  assert.equal(new URLSearchParams(location.search).get("day"), "2026-08-02");
  assert.equal(new URLSearchParams(location.search).has("settings"), false);
});

it("replaces transient Archive search without creating history and preserves queued replacement mode", async () => {
  const history = await mountHistory();
  const pushes = vi.spyOn(window.history, "pushState");
  const route: AppRouteState = { start: false, archive: "", archiveBrowse: { filters: { search: "M" } } };
  await act(async () => history.navigate(route, "replace"));
  assert.equal(pushes.mock.calls.length, 0);
  assert.equal(Reflect.get(Object(window.history.state), "hrDashboardRouteCursor"), 2);
  await history.pop(1, "?archive=");
  await act(async () => history.navigate({ ...route, archiveBrowse: { filters: { search: "Morgan" } } }, "replace"));
  await history.pop(2, "?archive=");
  assert.equal(pushes.mock.calls.length, 0);
  assert.equal(Reflect.get(Object(window.history.state), "hrDashboardRouteCursor"), 2);
  assert.match(location.search, /Morgan/);
});

it("queues transient Archive replacement during dirty Settings restoration without replaying an abandoned guard", async () => {
  const history = await mountHistory();
  const pushes = vi.spyOn(window.history, "pushState");
  await history.pop(1, "?day=2026-08-02");
  await act(async () => history.navigate({ start: false, archive: "", archiveBrowse: { filters: { search: "public query" } } }, "replace"));
  assert.equal(location.search, "?day=2026-08-02");
  assert.equal(pushes.mock.calls.length, 0);
  await history.pop(2, "?settings=display");
  assert.equal(Reflect.get(Object(window.history.state), "hrDashboardRouteCursor"), 2);
  assert.deepEqual(history.go.mock.calls, [[1]]);
  assert.equal(pushes.mock.calls.length, 0);
  assert.equal(parseRoute(location.search).archiveBrowse?.filters.search, "public query");
  const accepted = location.search;
  await act(async () => history.confirm());
  assert.equal(location.search, accepted);
  assert.deepEqual(history.go.mock.calls, [[1]]);
});
