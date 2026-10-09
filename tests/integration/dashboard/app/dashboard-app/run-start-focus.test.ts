import { PARITY_WORKFLOW_COMPOSITION } from "../../../../parity/helpers/workflow-composition.js";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it, vi } from "vitest";
import { DashboardApp } from "../../../../../src/dashboard/app/dashboard-app.js";
import { RUN_START_DOOR_ID } from "../../../../../src/dashboard/app/dashboard-app-model.js";
import { createDashboardClient, type DashboardClient } from "../../../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../../../src/dashboard/state/client-context.js";
import { createFixtureBff } from "../../client/fixtures/helpers/fixture-bff.js";
import { importSpreadsheet } from "../../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-editor-model.js";
import { resetSpreadsheetMocks, useSpreadsheetMocks, registeredSpreadsheetWorkbook, type RegisteredSpreadsheet } from "../../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-mock-model.js";
import { FIXTURE_DAY_WIRE } from "../../../../support/fixtures/dashboard/fixture-queue.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
Reflect.set(globalThis, "ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
let root: Root | undefined;
let registeredFiles: readonly RegisteredSpreadsheet[] = [];
function RegistryProbe() { registeredFiles = useSpreadsheetMocks().files; return null; }
afterEach(async () => {
  await act(async () => root?.unmount()); root = undefined;
  resetSpreadsheetMocks(); vi.unstubAllGlobals();
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
  await act(async () => root?.render(createElement(DashboardClientProvider,{client,children:createElement(Fragment, null, createElement(DashboardApp, { workflowComposition: PARITY_WORKFLOW_COMPOSITION }), createElement(RegistryProbe))})));
  await settle();
}
async function chooseSpreadsheet() {
  vi.stubGlobal("Worker", class {
    onmessage?: (event: MessageEvent) => void;
    terminate() {}
    postMessage(request: { kind: string; name: string; data: ArrayBuffer }) {
      assert.equal(request.kind, "import");
      void importSpreadsheet(request.name, request.data).then(value => this.onmessage?.(new MessageEvent("message", { data: { state: "ready", value } })));
    }
  });
  const bytes = new TextEncoder().encode("Name,Employee ID\nJordan Lee,10800000\n");
  const file = new File([bytes], "Focus roster.csv", { type: "text/csv" });
  Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.buffer });
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Open XLSX or CSV"]'); assert.ok(input);
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  await settle();
  assert.ok(document.querySelector('[role="dialog"]'));
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
  await chooseSpreadsheet();
  await click(button("Import selected columns"));
  assert.equal(document.querySelectorAll('[role="dialog"]').length, 0);
  assert.ok(document.body.textContent?.includes("Spreadsheet imported"));
  const imported = registeredFiles.find(file => file.name === "Focus roster.csv"); assert.ok(imported);
  const workbook = registeredSpreadsheetWorkbook(imported);
  assert.equal(workbook.sheets[0].rows[1].cells[0].value, "Jordan Lee");
  assert.equal(String(workbook.sheets[0].rows[1].cells[1].value), "10800000");
  assert.equal(uploads, 0); assert.equal(new URLSearchParams(location.search).has("intake"), false);
});
it.each(["Cancel", "Escape", "Close"])("standalone spreadsheet import: %s closes without registering or starting a run", async dismissal => {
  let starts = 0;
  await mount({ submitStartPlan: async () => { starts++; throw new Error("unexpected start"); } }); await click(button("Settings"));
  const link = [...document.querySelectorAll("a")].find(node => node.textContent?.trim() === "Spreadsheets"); assert.ok(link); await click(link);
  const before = registeredFiles.map(file => file.id);
  await click(button("Import spreadsheet"));
  await chooseSpreadsheet();
  if (dismissal === "Escape") await key("Escape"); else await click(button(dismissal === "Cancel" ? "Cancel import" : dismissal));
  assert.equal(document.querySelectorAll('[role="dialog"]').length, 0);
  assert.deepEqual(registeredFiles.map(file => file.id), before);
  assert.equal(starts, 0);
  assert.equal(document.activeElement, button(dismissal === "Cancel" ? "Import spreadsheet" : "Review import"));
  assert.equal(new URLSearchParams(location.search).has("intake"), false);
});
