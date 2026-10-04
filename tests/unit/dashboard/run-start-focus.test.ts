// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it } from "vitest";
import { DashboardApp } from "../../../src/dashboard/app/dashboard-app.js";
import { RUN_START_DOOR_ID } from "../../../src/dashboard/app/dashboard-app-model.js";
import { createDashboardClient, type DashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { createFixtureBff } from "../../parity/helpers/fixture-bff.js";
import { resetSpreadsheetMocks } from "../../../src/dashboard/surfaces/spreadsheet-mock-model.js";
import { FIXTURE_DAY_WIRE } from "../../parity/helpers/fixture-queue.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
Reflect.set(globalThis, "ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount()); root = undefined;
  resetSpreadsheetMocks();
  document.body.replaceChildren(); localStorage.clear(); window.history.replaceState(null, "", "/");
});
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 35)); }); }
function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(node => node.getAttribute("aria-label") === name || node.textContent?.trim() === name);
  assert.ok(found, `missing ${name}`); return found;
}
async function click(node: HTMLElement) { await act(async () => { node.focus(); node.click(); }); await settle(); }
async function key(value: string) {
  await act(async () => { (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", {key:value,bubbles:true,cancelable:true})); });
  await settle();
}
async function mount(overrides: Partial<DashboardClient> = {}) {
  window.history.replaceState(null, "", `/?day=${FIXTURE_DAY_WIRE.day}`);
  localStorage.setItem("hr-dashboard.workflow-panel", "icon");
  const { app } = createFixtureBff();
  const client: DashboardClient = {
    ...createDashboardClient({baseUrl:"http://fixture",fetchImpl:async (url,init) => app.request(String(url),init)}),
    subscribeDay(input) { input.onDay(FIXTURE_DAY_WIRE); input.onState({state:"live"}); return {close() {}}; },
    ...overrides,
  };
  const host=document.createElement("div"); document.body.append(host); root=createRoot(host);
  await act(async () => root?.render(createElement(DashboardClientProvider,{client,children:createElement(DashboardApp)})));
  await settle();
}
for (const launch of ["external button", "keyboard shortcut"] as const) {
  for (const dismissal of ["Cancel", "Escape", "Close"] as const) {
    it(`${launch}: ${dismissal} restores the Run launch control after the real dialog unmounts`,async () => {
      await mount();
      const door=button("Start a run"); assert.equal(door.id,RUN_START_DOOR_ID);
      if(launch === "external button") await click(door);
      else { button("Settings").focus(); await key("r"); }
      const dialog=document.querySelector('[role="dialog"]'); assert.ok(dialog);
      assert.ok(dialog.contains(document.activeElement),"opening must move focus into the dialog");
      if(dismissal === "Escape") await key("Escape"); else await click(button(dismissal));
      assert.ok(document.querySelector('[role="dialog"]') === null);
      assert.ok(document.activeElement === door, `focus returned to ${document.activeElement?.tagName}, not the Run door`);
    });
  }
}

it("spreadsheet import is a Settings destination and leaves the Run launch focus intact", async () => {
  let uploads = 0;
  await mount({ uploadIntakeFile: async () => { uploads++; throw new Error("unexpected intake"); } });
  await click(button("Start a run"));
  assert.equal(document.querySelectorAll('input[type="file"]').length, 0);
  await key("Escape"); assert.ok(document.activeElement === button("Start a run"));
  await click(button("Settings"));
  const link = [...document.querySelectorAll("a")].find(node => node.textContent?.trim() === "Spreadsheets"); assert.ok(link);
  await click(link);
  await click(button("Import spreadsheet"));
  await click(button("Import roster"));
  assert.equal(document.querySelectorAll('[role="dialog"]').length, 0);
  assert.ok(document.body.textContent?.includes("Roster imported"));
  assert.equal(uploads, 0); assert.equal(new URLSearchParams(location.search).has("intake"), false);
});
it.each(["Cancel", "Escape", "Close"])("standalone spreadsheet import: %s closes without registering or starting a run", async dismissal => {
  await mount(); await click(button("Settings"));
  const link = [...document.querySelectorAll("a")].find(node => node.textContent?.trim() === "Spreadsheets"); assert.ok(link); await click(link);
  const before = document.querySelector('section[aria-label="Spreadsheets"]')?.textContent;
  await click(button("Import spreadsheet"));
  if (dismissal === "Escape") await key("Escape"); else await click(button(dismissal));
  assert.equal(document.querySelectorAll('[role="dialog"]').length, 0);
  assert.equal(document.querySelector('section[aria-label="Spreadsheets"]')?.textContent, before);
  assert.equal(new URLSearchParams(location.search).has("intake"), false);
});
