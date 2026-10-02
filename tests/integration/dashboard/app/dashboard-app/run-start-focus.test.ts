// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it } from "vitest";
import { DashboardApp } from "../../../../../src/dashboard/app/dashboard-app.js";
import { RUN_START_DOOR_ID } from "../../../../../src/dashboard/app/dashboard-app-model.js";
import { createDashboardClient, type DashboardClient } from "../../../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../../../src/dashboard/state/client-context.js";
import { createFixtureBff } from "../../client/fixtures/helpers/fixture-bff.js";
import { FIXTURE_INTAKE_MAPPING } from "../../../../support/fixtures/dashboard/fixture-intake.js";
import { FIXTURE_DAY_WIRE } from "../../../../support/fixtures/dashboard/fixture-queue.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
Reflect.set(globalThis, "ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount()); root = undefined;
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
      else { button("Dashboard").focus(); await key("r"); }
      const dialog=document.querySelector('[role="dialog"]'); assert.ok(dialog);
      assert.ok(dialog.contains(document.activeElement),"opening must move focus into the dialog");
      if(dismissal === "Escape") await key("Escape"); else await click(button(dismissal));
      assert.ok(document.querySelector('[role="dialog"]') === null);
      assert.ok(document.activeElement === door, `focus returned to ${document.activeElement?.tagName}, not the Run door`);
    });
  }
}

async function upload() {
  await click(button("Start a run"));
  await click(button("Import a spreadsheet"));
  const input=document.querySelector('input[type="file"]'); assert.ok(input);
  const file=new File(["fixture"],"fixture.csv",{type:"text/csv"});
  Object.defineProperty(file,"arrayBuffer",{value:() => Promise.resolve(new ArrayBuffer(7))});
  Object.defineProperty(input,"files",{configurable:true,value:{length:1,item:(index:number) => index === 0 ? file : null}});
  await act(async () => input.dispatchEvent(new Event("change",{bubbles:true})));
  await settle();
}
it("successful Intake handoff keeps arrival focus, and the next Run dismissal restores its door",async () => {
  await mount({uploadIntakeFile:async () => ({state:"created",session:FIXTURE_INTAKE_MAPPING})});
  await upload();
  const intake=document.querySelector('section[aria-label="Spreadsheet intake"]'); assert.ok(intake);
  assert.ok(document.activeElement === intake,"dialog cleanup must preserve Intake arrival focus");
  assert.equal(new URLSearchParams(location.search).get("intake"),FIXTURE_INTAKE_MAPPING.intakeSessionId);
  await click(button("Close"));
  assert.ok(document.activeElement === button("Start a run"));
  await click(button("Start a run")); await key("Escape");
  assert.ok(document.activeElement === button("Start a run"),"a previous handoff must not suppress the next dismissal");
});
it.each(["Cancel","Escape","Close"])("a late accepted upload after %s neither steals restored focus nor reopens Intake",async dismissal => {
  let resolve: ((result: Awaited<ReturnType<DashboardClient["uploadIntakeFile"]>>) => void) | undefined;
  await mount({uploadIntakeFile:() => new Promise(done => {resolve=done;})});
  await upload(); assert.ok(resolve,"upload reached the client");
  if(dismissal === "Escape") await key("Escape"); else await click(button(dismissal));
  assert.ok(document.activeElement === button("Start a run"));
  await act(async () => resolve?.({state:"created",session:FIXTURE_INTAKE_MAPPING})); await settle();
  assert.ok(document.querySelector('section[aria-label="Spreadsheet intake"]') === null);
  assert.equal(new URLSearchParams(location.search).has("intake"),false);
  assert.ok(document.activeElement === button("Start a run"));
});
