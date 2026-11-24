// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it, vi } from "vitest";
import { DashboardApp } from "../../../src/dashboard/app/dashboard-app.js";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { createFixtureBff } from "../../support/helpers/dashboard/fixture-bff.js";
import { loadLazyPages } from "../../support/helpers/dashboard/lazy-pages.js";

const latePageModules = [
  "../../../src/dashboard/surfaces/explorer/explorer-spec.js",
  "../../../src/dashboard/surfaces/spreadsheets/design/sheets-v2-menu.js",
];
async function assertLatePageModulesSettled(): Promise<void> {
  for (const specifier of latePageModules) {
    let settled = false;
    const pending = import(specifier);
    void pending.then(() => { settled = true; }, () => { settled = true; });
    // A compiled page resolves before the next timer. One still loading does not.
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(settled, true, `${specifier} was still loading after the dashboard render`);
    await pending;
  }
}

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
Reflect.set(globalThis, "ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
Reflect.set(globalThis, "requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0));
Reflect.set(globalThis, "cancelAnimationFrame", clearTimeout);
Element.prototype.scrollIntoView = () => {};
let root: Root | undefined;
afterEach(async () => { await loadLazyPages(); await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); localStorage.clear(); vi.restoreAllMocks(); window.history.replaceState(null, "", "/"); });

it("the storage notice points at Notifications, which the rail offers, and not at a Settings section", async () => {
  const { app } = createFixtureBff();
  const transport = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => app.request(url, init) });
  const client = { ...transport, bootstrap: async () => ({ ...await transport.bootstrap(), storage: { authority: "unavailable" as const } }) };
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root?.render(createElement(DashboardClientProvider, { client, children: createElement(DashboardApp) })); await new Promise(resolve => setTimeout(resolve, 30)); });
  await loadLazyPages();
  await assertLatePageModulesSettled();
  const notice = [...host.querySelectorAll('[role="alert"]')].find(alert => /storage is unavailable/iu.test(alert.textContent ?? ""));
  assert.ok(notice, "the storage alert is visible");
  const text = notice.textContent ?? "";
  assert.doesNotMatch(text, /Open Settings to check storage/u);
  assert.match(text, /See Notifications for details/iu);
  assert.ok(host.querySelector('button[aria-label^="Notifications"]'), "the bell the notice names exists");
});
