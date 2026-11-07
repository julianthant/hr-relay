// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act,createElement } from "react";
import { createRoot,type Root } from "react-dom/client";
import { afterEach,it,vi } from "vitest";
import { useRoute,type NativeRouteHistory,type RouteHistoryTarget } from "../../../../src/dashboard/app/navigation/route-history-model.js";
import { type AppRouteState } from "../../../../src/dashboard/app/navigation/url-state.js";

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
